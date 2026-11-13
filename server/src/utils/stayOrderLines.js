/**
 * The lines an order or a sale adds to a stay, as the fiche's PUT body carries them (specs/pricing-components.md §3.F, rules 13, 85; the removal
 * of `midStayOrderCommit`, C30). `extraSale` prices and writes through them; nothing here writes.
 *
 *   storedBody(reservationId)            → the fiche's PUT body for the stored stay, or null when it is not a live reservation
 *   optionRows(db, lines)                → the catalogue rows (`id`, `priceType`) of the option lines
 *   mergeOrderLines(body, lines, rows, nextLineId?) → the body with the lines appended
 *   personsRefusal(body, lines, rows)    → 409 `ORDER_PERSONS_EXCEEDED` `{ status, body }`, or null
 *   remainderByKey(row) / deltaOf(before, after) → what a save added to the end-of-stay complement per line key
 *
 * `lines` — already judged by the seller (what is sold, the slots, the mornings):
 *   { kind: 'option', id, quantity }                       a unit, or one more person on a per-person option
 *   { kind: 'breakfast', id, mornings: [date], time, persons }   the mornings and hour of the breakfast line
 *   { kind: 'resource', id, quantity?, sessions?: [{ date, start, end }] }
 *
 * Persons (plugins-phase-1-sdk.md rule 47 reading of 2026-11-10, audit R36-M-H1): the engine serves a per-person line at most
 * max(1, party, the lodging's capacity) persons, so persons ordered beyond what is left would be delivered and never
 * billed. Such an order is refused before anything is priced: 409 `ORDER_PERSONS_EXCEEDED` with `{ key, left }` —
 * a per-person option whose persons (the stay's line and this one) exceed the ceiling, and a
 * breakfast asking more persons than its line already serves (that line keeps its persons, guest-app rule 27bis).
 */

const { toUpdateBody } = require('./reservationUpdateBody');
const { storedMidStayLines } = require('./midStayExtras');
const { normalizeOccurrences } = require('./cardOccurrences');
const { roundMoneyOrZero: round2 } = require('./pricing/money');

const database = () => require('../database');
const reservations = () => require('../models/reservationsModel');

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
  // A new sale is billed whatever the article's other lines are: « offert » is the line's own (it never follows the article's set).
  const own = line.noFreeUnits ? { noFreeUnits: true } : {};
  if (row && String(row.priceType) === 'per_person') options.push(appendedLine(nextLineId, { optionId: Number(line.id), quantity: 1, cardPersons: quantity, offered: false, ...own }));
  else options.push(appendedLine(nextLineId, { optionId: Number(line.id), quantity, offered: false, ...own }));
  return { ...body, options };
}

function withResource(body, line, nextLineId) {
  const sessions = Array.isArray(line.sessions) ? line.sessions.map((s) => ({ date: s.date, start: s.start, end: s.end })) : [];
  const added = sessions.length ? sessionsHours(sessions) : Number(line.quantity || 0);
  // Guest-app rule 82 — hours the stay already holds and has not placed are placed first: the sessions join that line, which sells nothing more.
  if (line.placeOnHeld) {
    const index = body.resources.findIndex((r) => Number(r.resourceId) === Number(line.id)
      && round2(Number(r.quantity || 0) - sessionsHours(r.sessions || [])) >= added);
    if (index >= 0) {
      const resources = body.resources.slice();
      resources[index] = { ...resources[index], sessions: [...(resources[index].sessions || []), ...sessions] };
      return { ...body, resources };
    }
  }
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
 * Read on the body BEFORE the line is merged.
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

module.exports = {
  mergeOrderLines, storedBody, optionRows, personsRefusal, remainderByKey, deltaOf,
};
