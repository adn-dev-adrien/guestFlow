/**
 * A plugin's order lands on the fiche as mid-stay extras (specs/plugins-phase-1-sdk.md rule 46; first used by
 * specs/guest-app.md rules 24, 30, 34, 35). The money and the reservation write stay core: an order is priced and
 * written exactly as the operator's « Enregistrer » on a locked fiche writes a mid-stay extra
 * (specs/mid-stay-extras-on-locked-fiche.md rules 1, 9) — the stored state rebuilt as the fiche's PUT body, the
 * order's lines added to it, then `performUpdate`. The window, the arrival floors (`ARRIVAL_EXTRAS_FROZEN`), the
 * closed window (`MID_STAY_EXTRAS_CLOSED`), the session conflicts and the engine are the fiche's own.
 *
 *   priceOrder(reservationId, lines)           → { status: 200, byKey, total } | { status, body }
 *   commitOrder(reservationId, { source, ref, history, lines, paid?, within? }) → { status: 200, byKey, total, settledCents } | { status, body }
 *
 * `lines` — the order's lines, already judged by the plugin (what is sold, the slots, the mornings):
 *   { kind: 'option', id, quantity }                       a unit, or one more person on a per-person option
 *   { kind: 'breakfast', id, mornings: [date], time, persons }   the mornings and hour of the breakfast line
 *   { kind: 'resource', id, quantity?, sessions?: [{ date, start, end }] }
 * `byKey` — what the order adds to the end-of-stay complement per line key (`opt:<id>`, `res:<id>`): the engine's
 * answer for the stay with the order minus its answer for the stay without it, so free units, free minutes, the
 * stay's price lock and per-lodging prices all apply as they do on the fiche. A 0 € line adds nothing.
 *
 * The caller names its order: `source` (its basket source, `[a-z][a-zA-Z0-9-]*`) and `ref` (its own id) mark the
 * settled note of a paid order; `history: { field, label, text }` is the stay's history entry, written in the
 * caller's words.
 *
 * `paid` — `{ amountCents, paidDate, reference }` for a card order: the order's sale is collected at once, as a
 * settled mid-stay note (specs/mid-stay-notes.md rule 1) carrying the order and the provider's reference, so the
 * end-of-stay complement owes nothing for it and the books take it on the payment day. `within(result)` runs in
 * the same transaction, after the write: the plugin's own order row moves with the fiche, or neither does.
 */

const { toUpdateBody } = require('./reservationUpdateBody');
const { storedMidStayLines, parseNotes } = require('./midStayExtras');
const { normalizeOccurrences } = require('./cardOccurrences');

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
    options[index] = { ...options[index], quantity: merged.length, cardOccurrences: merged };
  } else {
    options.push({ optionId: Number(line.id), quantity: merged.length, cardOccurrences: merged, cardPersons: Number(line.persons) });
  }
  return { ...body, options };
}

function withOption(body, line, row) {
  const options = body.options.slice();
  const index = options.findIndex((o) => Number(o.optionId) === Number(line.id));
  const quantity = Number(line.quantity);
  // A per-person option counts the people it serves (specs/non-card-option-served-persons.md rule 12).
  if (row && String(row.priceType) === 'per_person') {
    if (index >= 0) {
      const served = options[index].cardPersons != null ? Number(options[index].cardPersons) : partyOf(body);
      options[index] = { ...options[index], quantity: 1, cardPersons: served + quantity };
    } else {
      options.push({ optionId: Number(line.id), quantity: 1, cardPersons: quantity });
    }
  } else if (index >= 0) {
    options[index] = { ...options[index], quantity: round2(Number(options[index].quantity || 0) + quantity) };
  } else {
    options.push({ optionId: Number(line.id), quantity });
  }
  return { ...body, options };
}

function withResource(body, line) {
  const resources = body.resources.slice();
  const index = resources.findIndex((r) => Number(r.resourceId) === Number(line.id));
  const sessions = Array.isArray(line.sessions) ? line.sessions.map((s) => ({ date: s.date, start: s.start, end: s.end })) : [];
  // Rule 30 — the sessions join the stay's line and raise its sold hours; a unit resource adds its quantity.
  const added = sessions.length ? sessionsHours(sessions) : Number(line.quantity || 0);
  if (index >= 0) {
    const stored = resources[index];
    resources[index] = {
      ...stored,
      quantity: round2(Number(stored.quantity || 0) + added),
      sessions: [...(Array.isArray(stored.sessions) ? stored.sessions : []), ...sessions],
    };
  } else {
    resources.push({ resourceId: Number(line.id), quantity: added, offered: false, inComplement: 0, sessions });
  }
  return { ...body, resources };
}

/** Pure — the fiche body with the order's lines added: quantities add to the stay's line of the same item (rule 34). */
function mergeOrderLines(body, lines, rows = new Map()) {
  return (lines || []).reduce((next, line) => {
    if (line.kind === 'resource') return withResource(next, line);
    if (line.kind === 'breakfast') return withBreakfast(next, line);
    return withOption(next, line, rows.get(Number(line.id)));
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

/** Rule 24 — the order priced by the fiche's own engine, nothing written. */
function priceOrder(reservationId, lines) {
  const id = Number(reservationId);
  const body = storedBody(id);
  if (!body) return { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } };
  const save = controller().performUpdate;
  const base = save(id, structuredClone(body), { dryRun: true });
  if (base.status !== 200) return refusal(base);
  const next = save(id, mergeOrderLines(body, lines, optionRows(database(), lines)), { dryRun: true });
  if (next.status !== 200) return refusal(next);
  return { status: 200, ...deltaOf(remainderByKey(base.row), remainderByKey(next.row)) };
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
      const save = controller().performUpdate;
      const base = save(id, structuredClone(body), { dryRun: true });
      if (base.status !== 200) {
        outcome = refusal(base);
        throw ROLLBACK;
      }
      const written = save(id, mergeOrderLines(body, lines, optionRows(db, lines)));
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

module.exports = { priceOrder, commitOrder, mergeOrderLines };
