/**
 * A plugin's order lands on the fiche as mid-stay extras (specs/plugins-phase-1-sdk.md rule 47; first used by
 * specs/guest-app.md rules 24, 30, 34, 35). The money and the reservation write stay core: an order is priced and
 * written exactly as the operator's « Enregistrer » on a locked fiche writes a mid-stay extra
 * (specs/mid-stay-extras-on-locked-fiche.md rules 1, 9) — the stored state rebuilt as the fiche's PUT body, the
 * order's lines added to it, then `performUpdate`. The window, the arrival floors (`ARRIVAL_EXTRAS_FROZEN`), the
 * closed window (`MID_STAY_EXTRAS_CLOSED`), the session conflicts and the engine are the fiche's own.
 *
 *   priceOrder(reservationId, lines, { pending? }) → { status: 200, byKey, total } | { status, body }
 *   commitOrder(reservationId, { source, ref, history, lines, paid?, within? }) → { status: 200, byKey, total, settledCents } | { status, body }
 *
 * `lines` — the order's lines, already judged by the plugin (what is sold, the slots, the mornings):
 *   { kind: 'option', id, quantity }                       a unit, or one more person on a per-person option
 *   { kind: 'breakfast', id, mornings: [date], time, persons }   the mornings and hour of the breakfast line
 *   { kind: 'resource', id, quantity?, sessions?: [{ date, start, end }] }
 * `byKey` — what the order adds to the end-of-stay complement per line key (`opt:<id>`, `res:<id>`): the engine's
 * answer for the stay with the order minus its answer for the stay without it, so free units, free minutes, the
 * stay's price lock and per-lodging prices all apply as they do on the fiche. A 0 € line adds nothing.
 * `pending` — the lines of the caller's orders not on the fiche yet but already promised (a card order awaiting its
 * payment): they take their free units and minutes first, so the order is priced as the stay + pending + order minus
 * the stay + pending, and a later order never takes an allowance a pending one was quoted with.
 *
 * The caller names its order: `source` (its basket source, `[a-z][a-zA-Z0-9-]*`) and `ref` (its own id) mark the
 * settled note of a paid order; `history: { field, label, text }` is the stay's history entry, written in the
 * caller's words.
 *
 * Persons (rule 47 reading of 2026-11-10, audit R36-M-H1): the engine serves a per-person line at most
 * max(1, party, the lodging's capacity) persons, so persons ordered beyond what is left would be delivered and never
 * billed. Such an order is refused before anything is priced: 409 `ORDER_PERSONS_EXCEEDED` with `{ key, left }` —
 * a per-person option whose persons (the stay's line, the pending orders and this one) exceed the ceiling, and a
 * breakfast asking more persons than its line already serves (that line keeps its persons, guest-app rule 27bis).
 *
 * `paid` — `{ amountCents, paidDate, reference }` for a card order: the order's sale is collected at once, as a
 * settled mid-stay note (specs/mid-stay-notes.md rule 1) carrying the order and the provider's reference, so the
 * end-of-stay complement owes nothing for it and the books take it on the payment day. `within(result)` runs in
 * the same transaction, after the write: the plugin's own order row moves with the fiche, or neither does.
 */

const { toUpdateBody } = require('./reservationUpdateBody');
const { storedMidStayLines, parseNotes } = require('./midStayExtras');
const { normalizeOccurrences } = require('./cardOccurrences');
const { syncStay: syncAllocations } = require('./paymentAllocationsSync');
const { nextLineId } = require('./lineRowTarget');

const database = () => require('../database');
const reservations = () => require('../models/reservationsModel');
const controller = () => require('../controllers/reservationsController');

const ROLLBACK = Symbol('mid-stay-order-rollback');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
const sessionsHours = (sessions) => round2((sessions || [])
  .reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0) / 60);

const partyOf = (body) => Math.max(0, (Number(body.adults) || 0) + (Number(body.teens) || 0) + (Number(body.children) || 0));

function autoEnabledIds(db) {
  return new Set(db.prepare('SELECT id FROM options WHERE COALESCE(autoEnabled, 0) = 1').all().map((o) => Number(o.id)));
}

/** The fiche's PUT body for the stored stay, or null when it is not a live reservation. */
function storedBody(reservationId) {
  const current = reservations().getByIdWithDetails(Number(reservationId));
  if (!current || current.kind !== 'reservation') return null;
  return toUpdateBody(current, autoEnabledIds(database()));
}

function optionRows(db, lines) {
  const ids = [...new Set(lines.filter((l) => l.kind !== 'resource').map((l) => Number(l.id)))];
  if (!ids.length) return new Map();
  return new Map(db.prepare(`SELECT id, priceType FROM options WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids)
    .map((row) => [Number(row.id), row]));
}

function withBreakfast(body, line) {
  const options = body.options.slice();
  const index = options.findIndex((o) => Number(o.optionId) === Number(line.id));
  const stored = index >= 0 ? normalizeOccurrences(options[index].cardOccurrences || []) : [];
  const chosen = new Set(line.mornings);
  // A morning the order names takes its hour; the others keep theirs (guest-app rule 27bis), a prepared one its flag.
  const merged = normalizeOccurrences([
    ...stored.filter((o) => !chosen.has(o.date)),
    ...stored.filter((o) => chosen.has(o.date) && o.done).map((o) => ({ ...o, time: line.time })),
    ...line.mornings.filter((date) => !stored.some((o) => o.date === date && o.done)).map((date) => ({ date, time: line.time })),
  ]);
  if (index >= 0) {
    // A line with no mornings placed yet keeps its quantity: the order places mornings, it never lowers what the stay
    // already holds (an arrival-frozen or included line would refuse, or re-bill, a lower one).
    const quantity = Math.max(Number(options[index].quantity) || 0, merged.length);
    options[index] = { ...options[index], quantity, cardOccurrences: merged };
  } else {
    options.push({ optionId: Number(line.id), quantity: merged.length, cardOccurrences: merged, cardPersons: Number(line.persons) });
  }
  return { ...body, options };
}

// Rule 13 / 85: what an order sells is a line of its own, never added to the line the stay already holds. `nextLineId()` is the number
// the line is priced and written under (null for a simulation that is never written).
const appendedLine = (nextLineId, fields) => {
  const lineId = nextLineId();
  return { ...fields, newLine: true, ...(lineId != null ? { lineId } : {}) };
};

function withOption(body, line, row, nextLineId) {
  const options = body.options.slice();
  const quantity = Number(line.quantity);
  // A per-person option counts the people it serves (specs/non-card-option-served-persons.md rule 12).
  if (row && String(row.priceType) === 'per_person') options.push(appendedLine(nextLineId, { optionId: Number(line.id), quantity: 1, cardPersons: quantity }));
  else options.push(appendedLine(nextLineId, { optionId: Number(line.id), quantity }));
  return { ...body, options };
}

function withResource(body, line, nextLineId) {
  const sessions = Array.isArray(line.sessions) ? line.sessions.map((s) => ({ date: s.date, start: s.start, end: s.end })) : [];
  const added = sessions.length ? sessionsHours(sessions) : Number(line.quantity || 0);
  return { ...body, resources: [...body.resources, appendedLine(nextLineId, { resourceId: Number(line.id), quantity: added, offered: false, inComplement: 0, sessions })] };
}

/** The most persons a per-person line of the stay can serve: `pricing.resolveServedPersons`'s own ceiling. */
function personsCeiling(body, maxGuests) {
  return Math.max(1, partyOf(body), Number(maxGuests) > 0 ? Math.floor(Number(maxGuests)) : 0);
}

/** The persons a stored line serves: its own count, else the party it follows. */
const servedBy = (line, body) => (line && line.cardPersons != null ? Number(line.cardPersons) : partyOf(body));

/**
 * Pure — the first order line asking more persons than the stay can still be served, `{ key, left }`, or null.
 * Read on the body BEFORE the line is merged, so the pending orders merged ahead of it count as served already.
 */
function personsShortfall(body, lines, rows, maxGuests) {
  const ceiling = personsCeiling(body, maxGuests);
  let next = { ...body, options: (body.options || []).slice(), resources: (body.resources || []).slice() };
  for (const line of lines || []) {
    const key = `opt:${Number(line.id)}`;
    const held = next.options.filter((o) => Number(o.optionId) === Number(line.id));
    const stored = held[0];
    const row = rows.get(Number(line.id));
    if (line.kind === 'breakfast') {
      const asked = Number(line.persons) || 0;
      const left = stored ? servedBy(stored, next) : ceiling;
      if (asked > left) return { key, left };
    } else if (line.kind === 'option' && row && String(row.priceType) === 'per_person') {
      const served = held.reduce((sum, o) => sum + servedBy(o, next), 0);
      if (served + Number(line.quantity) > ceiling) return { key, left: Math.max(0, ceiling - served) };
    }
    next = mergeOrderLines(next, [line], rows);
  }
  return null;
}

function personsRefusal(body, lines, rows) {
  const capacity = reservations().getPropertyCapacity(Number(body.propertyId)) || {};
  const short = personsShortfall(body, lines, rows, capacity.maxGuests);
  if (!short) return null;
  return {
    status: 409,
    body: {
      error: 'Plus assez de personnes à servir pour cet article.', code: 'ORDER_PERSONS_EXCEEDED', key: short.key, left: short.left,
    },
  };
}

/**
 * The fiche body with the order's lines appended — each unit or resource line is a NEW line of its own (rules 13, 85), numbered by `nextLineId(table)`
 * (default: unnumbered, for a simulation that is never written). A breakfast keeps merging into the stay's breakfast line: its mornings are
 * the stay's slots, a morning named again is the same morning with a new hour, not a second sale.
 */
function mergeOrderLines(body, lines, rows = new Map(), nextLineId = () => null) {
  return (lines || []).reduce((next, line) => {
    if (line.kind === 'resource') return withResource(next, line, () => nextLineId('reservation_resources'));
    if (line.kind === 'breakfast') return withBreakfast(next, line);
    return withOption(next, line, rows.get(Number(line.id)), () => nextLineId('reservation_options'));
  }, { ...body, options: (body.options || []).slice(), resources: (body.resources || []).slice() });
}

function remainderByKey(row) {
  const byKey = new Map();
  storedMidStayLines(row && row.endOfStayComplementDetail).forEach((line) => {
    if (!line.key) return;
    byKey.set(line.key, round2((byKey.get(line.key) || 0) + Number(line.amount || 0)));
  });
  return byKey;
}

function deltaOf(before, after) {
  const byKey = {};
  const keys = new Set([...before.keys(), ...after.keys()]);
  keys.forEach((key) => {
    const amount = round2((after.get(key) || 0) - (before.get(key) || 0));
    if (amount > 0) byKey[key] = amount;
  });
  const total = round2(Object.values(byKey).reduce((sum, n) => sum + n, 0));
  return { byKey, total };
}

const refusal = (result) => ({ status: result.status, body: result.body });

const numbered = () => (table) => nextLineId(database(), table);

// The plugins read what an order added per ARTICLE (`opt:<id>`, `res:<id>`): the amounts of the lines the order appended are added up under it.
function perArticle(byKey, body) {
  const articleOf = new Map();
  for (const line of body.options || []) if (line.lineId != null) articleOf.set(`line:reservation_options:${Number(line.lineId)}`, `opt:${Number(line.optionId)}`);
  for (const line of body.resources || []) if (line.lineId != null) articleOf.set(`line:reservation_resources:${Number(line.lineId)}`, `res:${Number(line.resourceId)}`);
  const out = {};
  for (const [key, amount] of Object.entries(byKey)) out[articleOf.get(key) || key] = round2((out[articleOf.get(key) || key] || 0) + amount);
  return out;
}

/** Rule 24 — the order priced by the fiche's own engine, after the pending orders, nothing written. */
function priceOrder(reservationId, lines, { pending = [] } = {}) {
  const id = Number(reservationId);
  const stored = storedBody(id);
  if (!stored) return { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } };
  const all = [...(pending || []), ...lines];
  const rows = optionRows(database(), all);
  const body = pending && pending.length ? mergeOrderLines(stored, pending, rows, numbered()) : stored;
  const persons = personsRefusal(body, lines, rows);
  if (persons) return persons;
  const save = controller().performUpdate;
  const base = save(id, structuredClone(body), { dryRun: true });
  if (base.status !== 200) return refusal(base);
  const sent = mergeOrderLines(body, lines, rows, numbered());
  const next = save(id, sent, { dryRun: true });
  if (next.status !== 200) return refusal(next);
  const added = deltaOf(remainderByKey(base.row), remainderByKey(next.row));
  return { status: 200, byKey: perArticle(added.byKey, sent), total: added.total };
}

/**
 * Rule 35 — the card's money collects the order's sale at once: one settled note, its amounts taken from the
 * remainder the order just added, up to what was paid. What the order added beyond the payment stays on the
 * end-of-stay complement; what the payment brought beyond the sale is returned as `excessCents`.
 */
function settlePaid(id, byKey, { source, ref, amountCents, paidDate, reference }) {
  let left = round2(Number(amountCents || 0) / 100);
  const items = [];
  Object.entries(byKey).forEach(([key, amount]) => {
    const take = round2(Math.min(amount, left));
    if (take <= 0) return;
    items.push({ key, amount: take });
    left = round2(left - take);
  });
  if (!items.length) return { settledCents: 0, excessCents: Math.round(left * 100) };
  const note = reservations().settleMidStayNote(id, { items, cash: false });
  const db = database();
  const notes = parseNotes(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)
    .map((n) => (Number(n.id) === Number(note.id)
      ? { ...n, ...(paidDate ? { paidDate } : {}), source: String(source), ref: String(ref), ...(reference ? { reference: String(reference) } : {}) }
      : n));
  db.prepare("UPDATE reservations SET midStaySettledNotes = ?, updatedAt = datetime('now') WHERE id = ?").run(JSON.stringify(notes), id);
  syncAllocations(db, id);
  return { settledCents: Math.round(round2(note.total) * 100), excessCents: Math.round(left * 100) };
}

const SOURCE = /^[a-z][a-zA-Z0-9-]{0,39}$/;

function namingError({ source, ref, history }) {
  if (!SOURCE.test(String(source || ''))) return 'commitOrder needs the caller\'s source';
  if (ref === undefined || ref === null || String(ref) === '') return 'commitOrder needs the order\'s ref';
  if (!history || typeof history !== 'object' || !history.field || !history.label || !history.text) return 'commitOrder needs a history entry { field, label, text }';
  return null;
}

/** The order written on the fiche, its history entry and its payment, in one transaction. */
function commitOrder(reservationId, {
  source, ref, history, lines, paid = null, within = null,
} = {}) {
  const error = namingError({ source, ref, history });
  if (error) throw new Error(error);
  const id = Number(reservationId);
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const body = storedBody(id);
      if (!body) {
        outcome = { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } };
        throw ROLLBACK;
      }
      const rows = optionRows(db, lines);
      const persons = personsRefusal(body, lines, rows);
      if (persons) {
        outcome = persons;
        throw ROLLBACK;
      }
      const save = controller().performUpdate;
      const base = save(id, structuredClone(body), { dryRun: true });
      if (base.status !== 200) {
        outcome = refusal(base);
        throw ROLLBACK;
      }
      const written = save(id, mergeOrderLines(body, lines, rows, numbered()));
      if (written.status !== 200) {
        outcome = refusal(written);
        throw ROLLBACK;
      }
      const priced = deltaOf(remainderByKey(base.row), remainderByKey(reservations().getRow(id)));
      reservations().addHistoryEntry(id, 'update', [{
        field: String(history.field), label: String(history.label), from: null, to: String(history.text),
      }]);
      const money = paid ? settlePaid(id, priced.byKey, { source, ref, ...paid }) : { settledCents: 0, excessCents: 0 };
      outcome = { status: 200, ...priced, ...money };
      if (typeof within === 'function') within(outcome);
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
}

module.exports = {
  priceOrder, commitOrder, mergeOrderLines, storedBody, optionRows, personsRefusal, remainderByKey, deltaOf,
};
