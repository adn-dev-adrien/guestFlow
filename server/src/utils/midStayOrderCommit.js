/**
 * A plugin's order lands on the fiche as mid-stay extras (specs/plugins-phase-1-sdk.md rule 47; first used by
 * specs/guest-app.md rules 24, 30, 34, 35). The money and the reservation write stay core: an order is priced and
 * written exactly as the operator's « Enregistrer » on a locked fiche writes a mid-stay extra
 * (specs/mid-stay-extras-on-locked-fiche.md rules 1, 9) — the stored state rebuilt as the fiche's PUT body, the
 * order's lines added to it, then `performUpdate`. The window, the arrival floors (`ARRIVAL_EXTRAS_FROZEN`), the
 * closed window (`MID_STAY_EXTRAS_CLOSED`), the session conflicts and the engine are the fiche's own.
 *
 *   priceOrder(reservationId, lines, { pending? }) → { status: 200, byKey, total, collectAt } | { status, body }
 *   commitOrder(reservationId, { source, ref, history, lines, paid?, within? }) → { status: 200, byKey, total, collectAt, settledCents } | { status, body }
 *   orderCollection(reservationId) → 'arrival' | 'departure' | 'unavailable' | 'closed'
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
 *
 * Before the arrival (rule 47 reading of 2026-11-10; specs/guest-app.md rules 66-67) — while the arrival is not marked
 * (`isArrivalNotMarked`) the end-of-stay complement does not exist yet, so the order's lines are written as ordinary
 * lines of the fiche, saved as the day before the arrival (`performUpdate`'s `beforeArrival`). When the stay's pre-arrival
 * money is settled (`preArrivalSettled` of the engine), or on a platform's stay (whose extras it always routes there), the
 * engine routes what they cost to the ARRIVAL complement, where
 * the arrival SAS collects it, and `collectAt` reads `'arrival'`; `byKey` is what each line's billed total gains. The
 * commit refuses, nothing written: 409 `ORDER_OFF_ARRIVAL_COMPLEMENT` when the order would move another bucket (acompte,
 * solde, an installment, the end-of-stay complement) or when Σ `byKey` differs from the arrival complement's growth;
 * 409 `ORDER_STAY_PRICE_MOVED` when the order would move the tourist tax (the order's own growth is all it may move:
 * the stored stay is never replayed against its stored price, which platform stays rarely match to the cent). A `paid` commit before the arrival is accepted (rule 85): its money
 * is recorded as a settled note of the arrival moment, which the engine subtracts from the arrival complement, so
 * nothing is collected twice. From the arrival on, the path is the end-of-stay one above, `collectAt` `'departure'`.
 *
 * Charges (rule 83): `{ kind: 'charge', key, label, amount }` is a line the plugin priced itself (the bath's evening
 * supplement) written as a custom line of the fiche tagged `orderChargeKey = key`. Hours already on the stay (rule 82): a
 * resource line's sold hours rise only by the hours its sessions place beyond the hours not yet placed.
 *
 *   amendOrder(reservationId, { source, ref, history, from, to, within? }) → { status: 200, byKey, total } | { status, body }
 *     the order's lines as it stands (`from`) become `to`, before the arrival only, in one transaction: each line's
 *     difference is applied to the stay's line (never below what the stay held without the order) and measured as above.
 */

const { toUpdateBody } = require('./reservationUpdateBody');
const { storedMidStayLines, parseNotes, extraLineKey } = require('./midStayExtras');
const { normalizeOccurrences } = require('./cardOccurrences');
const { quoteStoredReservation } = require('./storedReservationQuote');
const { readInstallmentSummary } = require('./installmentSummary');

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
  const ids = [...new Set(lines.filter((l) => l.kind !== 'resource' && l.kind !== 'charge').map((l) => Number(l.id)))];
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
  // Rule 30 — the sessions join the stay's line; a unit resource adds its quantity.
  const added = sessions.length ? sessionsHours(sessions) : Number(line.quantity || 0);
  if (index >= 0) {
    const stored = resources[index];
    const storedSessions = Array.isArray(stored.sessions) ? stored.sessions : [];
    // Rule 82 — hours the stay already holds and has not placed come first: only the hours beyond them are sold more.
    const unplaced = sessions.length ? Math.max(0, round2(Number(stored.quantity || 0) - sessionsHours(storedSessions))) : 0;
    resources[index] = {
      ...stored,
      quantity: round2(Number(stored.quantity || 0) + Math.max(0, round2(added - unplaced))),
      sessions: [...storedSessions, ...sessions],
    };
  } else {
    resources.push({ resourceId: Number(line.id), quantity: added, offered: false, inComplement: 0, sessions });
  }
  return { ...body, resources };
}

/** Rule 83 — a charge the plugin priced: a custom line of the fiche, routed with the rest of the order. */
function withCharge(body, line) {
  const amount = round2(line.amount);
  if (amount <= 0) return body;
  return {
    ...body,
    customOptions: [...(body.customOptions || []), {
      customKey: `order-charge-${line.key}`, description: String(line.label), amount, offered: false, inComplement: 1,
    }],
  };
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
    const stored = next.options.find((o) => Number(o.optionId) === Number(line.id));
    const row = rows.get(Number(line.id));
    if (line.kind === 'breakfast') {
      const asked = Number(line.persons) || 0;
      const left = stored ? servedBy(stored, next) : ceiling;
      if (asked > left) return { key, left };
    } else if (line.kind === 'option' && row && String(row.priceType) === 'per_person') {
      const served = stored ? servedBy(stored, next) : 0;
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

/** Pure — the fiche body with the order's lines added: quantities add to the stay's line of the same item (rule 34). */
function mergeOrderLines(body, lines, rows = new Map()) {
  return (lines || []).reduce((next, line) => {
    if (line.kind === 'charge') return withCharge(next, line);
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

const refuse409 = (error, code) => ({ status: 409, body: { error, code } });
const OFF_ARRIVAL_COMPLEMENT = () => refuse409('Cette commande ne peut pas être prise en ligne pour ce séjour.', 'ORDER_OFF_ARRIVAL_COMPLEMENT');
const STAY_PRICE_MOVED = () => refuse409('Cette commande ne peut pas être prise en ligne pour ce séjour.', 'ORDER_STAY_PRICE_MOVED');

const endOfStayCollected = (row) => Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1;

/**
 * Where a plugin's order is collected for this stay right now (specs/guest-app.md rules 67-68): `arrival` while the arrival
 * is not marked and an order can only grow the arrival complement — the pre-arrival money is settled, or the stay is a
 * platform's, whose extras the engine always routes there (the measure of rule 66 still guards the buckets) — `departure`
 * once the arrival is marked and the end-of-stay complement is open, `closed` once it is collected, `unavailable` when
 * an acompte, a solde or an installment is still due (an order would grow it) or the stay is not a live reservation.
 */
function orderCollection(reservationId) {
  const id = Number(reservationId);
  const row = reservations().getRow(id);
  if (!row || String(row.kind || 'reservation') !== 'reservation') return 'unavailable';
  if (endOfStayCollected(row)) return 'closed';
  if (!reservations().isArrivalNotMarked(id)) return 'departure';
  let quote = null;
  try {
    quote = quoteStoredReservation(database(), row);
  } catch {
    return 'unavailable';
  }
  // A platform stay forces every extra into the arrival complement whatever its payment state (force-extras-complement-on-platform
  // §3), so an order can only grow that bucket there; a direct stay needs its pre-arrival money settled (rule 68).
  return quote && !quote.error && (quote.preArrivalSettled || quote.platformSale) ? 'arrival' : 'unavailable';
}

const totalsByKey = (lines) => {
  const totals = new Map();
  (lines || []).forEach((line) => {
    const key = extraLineKey(line);
    if (key) totals.set(key, round2((totals.get(key) || 0) + Number(line.totalPrice || 0)));
  });
  return totals;
};

const sameMoney = (a, b) => Math.abs(round2(Number(a) || 0) - round2(Number(b) || 0)) < 0.005;

/**
 * Rule 66 — the order measured on the arrival complement: both saves played as the day before the arrival, nothing
 * written. The order may grow the arrival complement and nothing else.
 */
function measureBeforeArrival(id, body, merged) {
  const save = controller().performUpdate;
  const options = { dryRun: true, beforeArrival: true };
  const base = save(id, structuredClone(body), options);
  if (base.status !== 200) return refusal(base);
  const next = save(id, merged, options);
  if (next.status !== 200) return refusal(next);
  // An order never re-prices the stay (rule 66): its own growth is all it may move, never the tourist tax.
  if (!sameMoney(next.row.touristTaxTotal, base.row.touristTaxTotal)) return STAY_PRICE_MOVED();
  // A plan carries the acompte and the solde (direct-installments rule 4): its rows, not those two columns, are its buckets.
  const buckets = readInstallmentSummary(database(), id) ? ['endOfStayComplementAmount'] : ['depositAmount', 'balanceAmount', 'endOfStayComplementAmount'];
  const moved = buckets.some((column) => !sameMoney(next.row[column], base.row[column]));
  if (moved) return OFF_ARRIVAL_COMPLEMENT();
  const before = totalsByKey(base.lines);
  const after = totalsByKey(next.lines);
  const byKey = {};
  new Set([...before.keys(), ...after.keys()]).forEach((key) => {
    const gain = round2((after.get(key) || 0) - (before.get(key) || 0));
    if (gain > 0) byKey[key] = gain;
  });
  const total = round2(Object.values(byKey).reduce((sum, n) => sum + n, 0));
  const growth = round2(Number(next.row.complementAmount || 0) - Number(base.row.complementAmount || 0));
  if (Math.abs(total - growth) >= 0.01) return OFF_ARRIVAL_COMPLEMENT();
  return { status: 200, byKey, total, collectAt: 'arrival' };
}

/** Rule 24 — the order priced by the fiche's own engine, after the pending orders, nothing written. */
function priceOrder(reservationId, lines, { pending = [] } = {}) {
  const id = Number(reservationId);
  const stored = storedBody(id);
  if (!stored) return { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } };
  const all = [...(pending || []), ...lines];
  const rows = optionRows(database(), all);
  const body = pending && pending.length ? mergeOrderLines(stored, pending, rows) : stored;
  const persons = personsRefusal(body, lines, rows);
  if (persons) return persons;
  if (reservations().isArrivalNotMarked(id) && !endOfStayCollected(reservations().getRow(id))) {
    if (orderCollection(id) !== 'arrival') return OFF_ARRIVAL_COMPLEMENT();
    return measureBeforeArrival(id, body, mergeOrderLines(body, lines, rows));
  }
  const save = controller().performUpdate;
  const base = save(id, structuredClone(body), { dryRun: true });
  if (base.status !== 200) return refusal(base);
  const next = save(id, mergeOrderLines(body, lines, rows), { dryRun: true });
  if (next.status !== 200) return refusal(next);
  return { status: 200, ...deltaOf(remainderByKey(base.row), remainderByKey(next.row)), collectAt: 'departure' };
}

/**
 * Rule 35 — the card's money collects the order's sale at once: one settled note, its amounts taken from the
 * remainder the order just added, up to what was paid. What the order added beyond the payment stays on the
 * end-of-stay complement; what the payment brought beyond the sale is returned as `excessCents`.
 */
function settlePaid(id, byKey, {
  source, ref, amountCents, paidDate, reference,
}, { beforeArrival = false } = {}) {
  let left = round2(Number(amountCents || 0) / 100);
  const items = [];
  Object.entries(byKey).forEach(([key, amount]) => {
    const take = round2(Math.min(amount, left));
    if (take <= 0) return;
    items.push({ key, amount: take });
    left = round2(left - take);
  });
  if (!items.length) return { settledCents: 0, excessCents: Math.round(left * 100) };
  // Rule 85 — before the arrival the money is the arrival complement's: a note of the arrival moment, which the engine
  // subtracts; no end-of-stay line moves.
  if (beforeArrival) {
    const arrivalNote = reservations().settleOrderNoteBeforeArrival(id, {
      items, paidDate, source, ref, reference,
    });
    return { settledCents: Math.round(round2(arrivalNote.total) * 100), excessCents: Math.round(left * 100) };
  }
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
      const rows = optionRows(db, lines);
      const persons = personsRefusal(body, lines, rows);
      if (persons) {
        outcome = persons;
        throw ROLLBACK;
      }
      const save = controller().performUpdate;
      const beforeArrival = reservations().isArrivalNotMarked(id) && !endOfStayCollected(reservations().getRow(id));
      let measured = null;
      if (beforeArrival) {
        if (orderCollection(id) !== 'arrival') outcome = OFF_ARRIVAL_COMPLEMENT();
        else {
          measured = measureBeforeArrival(id, body, mergeOrderLines(body, lines, rows));
          if (measured.status !== 200) outcome = measured;
        }
        if (outcome) throw ROLLBACK;
      }
      const base = measured ? null : save(id, structuredClone(body), { dryRun: true });
      if (base && base.status !== 200) {
        outcome = refusal(base);
        throw ROLLBACK;
      }
      // Rule 85 — the card money is recorded first, so the save that writes the order's lines already reads the arrival
      // complement net of it (stored net, never raised back by a later save).
      const arrivalMoney = beforeArrival && paid ? settlePaid(id, measured.byKey, { source, ref, ...paid }, { beforeArrival }) : null;
      const written = save(id, mergeOrderLines(body, lines, rows), { beforeArrival });
      if (written.status !== 200) {
        outcome = refusal(written);
        throw ROLLBACK;
      }
      const priced = measured
        ? { byKey: measured.byKey, total: measured.total }
        : deltaOf(remainderByKey(base.row), remainderByKey(reservations().getRow(id)));
      tagCharges(id, lines);
      reservations().addHistoryEntry(id, 'update', [{
        field: String(history.field), label: String(history.label), from: null, to: String(history.text),
      }]);
      const money = arrivalMoney || (paid ? settlePaid(id, priced.byKey, { source, ref, ...paid }, { beforeArrival }) : { settledCents: 0, excessCents: 0 });
      outcome = { status: 200, ...priced, collectAt: beforeArrival ? 'arrival' : 'departure', ...money };
      if (typeof within === 'function') within(outcome);
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
}

/** Rule 83 — the custom rows the save just wrote for the order's charges take the order's key. */
function tagCharges(id, lines) {
  const db = database();
  const hasColumn = db.prepare('PRAGMA table_info(reservation_custom_options)').all().some((c) => c.name === 'orderChargeKey');
  if (!hasColumn) return;
  (lines || []).filter((l) => l.kind === 'charge' && round2(l.amount) > 0).forEach((line) => {
    const row = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ? AND description = ? AND orderChargeKey IS NULL AND COALESCE(sasArrivalOrigin, 0) = 0 ORDER BY id DESC LIMIT 1')
      .get(id, String(line.label));
    if (row) db.prepare('UPDATE reservation_custom_options SET orderChargeKey = ? WHERE id = ?').run(String(line.key), row.id);
  });
}

const sameSession = (a, b) => a.date === b.date && a.start === b.start && a.end === b.end;

/** Pure — `body` with `line` taken out: the order's quantity, sessions, mornings or charge come off the stay's own line. */
function withoutOrderLine(body, line, rows) {
  if (line.kind === 'charge') {
    const keyed = Array.isArray(body.customOptions) ? body.customOptions : [];
    const index = keyed.findIndex((c) => String(c.orderChargeKey || '') === String(line.key));
    if (index < 0) return body;
    return { ...body, customOptions: keyed.filter((_, i) => i !== index) };
  }
  if (line.kind === 'resource') {
    const resources = body.resources.slice();
    const index = resources.findIndex((r) => Number(r.resourceId) === Number(line.id));
    if (index < 0) return body;
    const stored = resources[index];
    const sessions = (Array.isArray(stored.sessions) ? stored.sessions : []).filter((s) => !(line.sessions || []).some((o) => sameSession(o, s)));
    const placedBefore = sessionsHours(stored.sessions || []);
    const removed = round2(placedBefore - sessionsHours(sessions));
    const quantity = Math.max(0, round2(Number(stored.quantity || 0) - Math.min(removed, Number(line.addedHours != null ? line.addedHours : removed))));
    if (!sessions.length && quantity <= 0) return { ...body, resources: resources.filter((_, i) => i !== index) };
    resources[index] = { ...stored, quantity, sessions };
    return { ...body, resources };
  }
  const options = body.options.slice();
  const index = options.findIndex((o) => Number(o.optionId) === Number(line.id));
  if (index < 0) return body;
  const stored = options[index];
  if (line.kind === 'breakfast') {
    const chosen = new Set(line.mornings || []);
    const occurrences = normalizeOccurrences((stored.cardOccurrences || []).filter((o) => !chosen.has(o.date)));
    if (!occurrences.length) return { ...body, options: options.filter((_, i) => i !== index) };
    options[index] = { ...stored, quantity: occurrences.length, cardOccurrences: occurrences };
    return { ...body, options };
  }
  const row = rows.get(Number(line.id));
  if (row && String(row.priceType) === 'per_person') {
    const served = stored.cardPersons != null ? Number(stored.cardPersons) : partyOf(body);
    const left = served - Number(line.quantity);
    if (left <= 0) return { ...body, options: options.filter((_, i) => i !== index) };
    options[index] = { ...stored, quantity: 1, cardPersons: left };
    return { ...body, options };
  }
  const quantity = round2(Number(stored.quantity || 0) - Number(line.quantity));
  if (quantity <= 0) return { ...body, options: options.filter((_, i) => i !== index) };
  options[index] = { ...stored, quantity };
  return { ...body, options };
}

/**
 * Rule 87 — an unpaid order of an arrival not yet marked, changed: `from` is the order's lines as they stand, `to` what
 * it becomes (a line absent from `to` is removed, a lower quantity lowers the stay's line, a session or a morning left
 * out comes off). Both saves are measured as the day before the arrival; only the arrival complement may move (rule 66).
 * The stay's history entry and the plugin's own row (`within`) move with the fiche, or nothing does.
 */
function amendOrder(reservationId, {
  source, ref, history, from, to, within = null,
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
      const beforeArrival = reservations().isArrivalNotMarked(id) && !endOfStayCollected(reservations().getRow(id));
      if (!beforeArrival) {
        outcome = refuse409('Commande non modifiable.', 'ORDER_NOT_EDITABLE');
        throw ROLLBACK;
      }
      const rows = optionRows(db, [...(from || []), ...(to || [])]);
      const keyed = withChargeKeys(id, body);
      let lowered = keyed;
      let raised = [];
      (from || []).forEach((line) => {
        const target = (to || []).find((t) => lineIdentity(t) === lineIdentity(line));
        if (!target) {
          lowered = withoutOrderLine(lowered, line, rows);
          return;
        }
        if (line.kind === 'option' && Number(target.quantity) > Number(line.quantity)) {
          raised.push({ ...target, quantity: Number(target.quantity) - Number(line.quantity) });
        } else if (line.kind === 'option' && Number(target.quantity) < Number(line.quantity)) {
          lowered = withoutOrderLine(lowered, { ...line, quantity: Number(line.quantity) - Number(target.quantity) }, rows);
        } else if (line.kind === 'resource') {
          const dropped = (line.sessions || []).filter((s) => !(target.sessions || []).some((o) => sameSession(o, s)));
          if (dropped.length) lowered = withoutOrderLine(lowered, { ...line, sessions: dropped, addedHours: line.addedHours }, rows);
        } else if (line.kind === 'breakfast') {
          const dropped = (line.mornings || []).filter((m) => !(target.mornings || []).includes(m));
          if (dropped.length) lowered = withoutOrderLine(lowered, { ...line, mornings: dropped }, rows);
        } else if (line.kind === 'charge' && round2(target.amount) !== round2(line.amount)) {
          lowered = withoutOrderLine(lowered, line, rows);
          raised.push(target);
        }
      });
      if (orderCollection(id) !== 'arrival') {
        outcome = OFF_ARRIVAL_COMPLEMENT();
        throw ROLLBACK;
      }
      const merged = mergeOrderLines(lowered, raised, rows);
      const persons = personsRefusal(lowered, raised, rows);
      if (persons) {
        outcome = persons;
        throw ROLLBACK;
      }
      const measured = measureAmend(id, body, merged);
      if (measured.status !== 200) {
        outcome = measured;
        throw ROLLBACK;
      }
      const written = controller().performUpdate(id, stripChargeKeys(merged), { beforeArrival: true });
      if (written.status !== 200) {
        outcome = refusal(written);
        throw ROLLBACK;
      }
      tagCharges(id, raised);
      reservations().addHistoryEntry(id, 'update', [{
        field: String(history.field), label: String(history.label), from: null, to: String(history.text),
      }]);
      outcome = { status: 200, byKey: measured.byKey, total: measured.total, collectAt: 'arrival' };
      if (typeof within === 'function') within(outcome);
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
}

const lineIdentity = (line) => `${line.kind}:${line.kind === 'charge' ? line.key : line.id}`;

/** The charges' keys ride on the body's custom lines while the amendment is computed, then leave before the save. */
function withChargeKeys(id, body) {
  const db = database();
  const hasColumn = db.prepare('PRAGMA table_info(reservation_custom_options)').all().some((c) => c.name === 'orderChargeKey');
  if (!hasColumn || !Array.isArray(body.customOptions)) return body;
  const keys = new Map(db.prepare('SELECT id, orderChargeKey FROM reservation_custom_options WHERE reservationId = ? AND orderChargeKey IS NOT NULL').all(id)
    .map((r) => [Number(r.id), r.orderChargeKey]));
  return {
    ...body,
    customOptions: body.customOptions.map((c) => (keys.has(Number(c.customOptionId)) ? { ...c, orderChargeKey: keys.get(Number(c.customOptionId)) } : c)),
  };
}

function stripChargeKeys(body) {
  if (!Array.isArray(body.customOptions)) return body;
  return { ...body, customOptions: body.customOptions.map(({ orderChargeKey, ...rest }) => rest) };
}

/** Rule 66, applied to an amendment: both saves played as the day before the arrival, only the arrival complement may move. */
function measureAmend(id, body, merged) {
  const options = { dryRun: true, beforeArrival: true };
  const save = controller().performUpdate;
  const base = save(id, structuredClone(body), options);
  if (base.status !== 200) return refusal(base);
  const next = save(id, stripChargeKeys(structuredClone(merged)), options);
  if (next.status !== 200) return refusal(next);
  // An order never re-prices the stay (rule 66): its own growth is all it may move, never the tourist tax.
  if (!sameMoney(next.row.touristTaxTotal, base.row.touristTaxTotal)) return STAY_PRICE_MOVED();
  const buckets = readInstallmentSummary(database(), id) ? ['endOfStayComplementAmount'] : ['depositAmount', 'balanceAmount', 'endOfStayComplementAmount'];
  if (buckets.some((column) => !sameMoney(next.row[column], base.row[column]))) return OFF_ARRIVAL_COMPLEMENT();
  const before = totalsByKey(base.lines);
  const after = totalsByKey(next.lines);
  const byKey = {};
  new Set([...before.keys(), ...after.keys()]).forEach((key) => {
    const change = round2((after.get(key) || 0) - (before.get(key) || 0));
    if (change !== 0) byKey[key] = change;
  });
  const total = round2(Object.values(byKey).reduce((sum, n) => sum + n, 0));
  return { status: 200, byKey, total };
}

module.exports = {
  priceOrder, commitOrder, amendOrder, mergeOrderLines, orderCollection,
};
