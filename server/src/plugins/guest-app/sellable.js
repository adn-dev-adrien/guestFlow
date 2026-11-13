/**
 * Which items a lodging's shop shows, and their free / included state (specs/guest-app.md rules 23, 25).
 * Pure: the lodging's catalogue as the pricing engine reads it, the plugin rows and what the stay already
 * received come in; the sold items go out. The free units are judged by the engine's own
 * `applyFreeUnitsToLine`, never re-implemented here.
 */

const sdk = require('../sdk');

const { applyFreeUnitsToLine, roundMoney } = sdk.coreModule('pricing');
const { isClientVisibleOption } = sdk.coreModule('optionVisibility');

const HOURLY = 'per_hour';

// Rule 23 — a price the app can sell by quantity. `free` is always included (rule 25's 0 €).
const SELLABLE_TYPES = Object.freeze({
  option: Object.freeze(['per_stay', 'per_person', 'free']),
  resource: Object.freeze(['per_stay', HOURLY, 'free']),
});

const AUTO_TIMED = Object.freeze(['early_check_in', 'late_check_out']);
const BREAKFAST = 'breakfast';
const DEFAULT_BREAKFAST_TIME = '09:00';

const TYPE_REFUSALS = Object.freeze({
  per_night: 'Un prix par nuit ne se vend pas à la quantité dans l’application.',
  per_person_per_night: 'Un prix par personne et par nuit ne se vend pas à la quantité dans l’application.',
  percent_of_stay: 'Un prix en pourcentage du séjour ne se vend pas dans l’application.',
  per_participant_progressive: 'Un prix dégressif par participant ne se vend pas dans l’application.',
});
const OTHER_TYPE_REFUSAL = 'Ce type de prix ne se vend pas dans l’application.';
// Audit R36b N2 — the engine bills a per-person resource quantity × party: « 1 » ordered for 4 people is 4 persons.
const RESOURCE_PER_PERSON_REFUSAL = 'Une ressource au prix par personne ne se vend pas dans l’application.';
const INSURANCE_REFUSAL = 'L’assurance annulation ne se vend pas dans l’application.';
const AUTO_TIMED_REFUSAL = 'Une option horaire automatique (arrivée anticipée, départ tardif) ne se vend pas dans l’application.';
const INTERNAL_REFUSAL = 'Une option interne n’est jamais montrée aux clients.';
const CARD_REFUSAL = 'Une option du planning se vend par moment, pas à la quantité, dans l’application.';

const SELLABLE = Object.freeze({ ok: true, reason: null });
const refused = (reason) => ({ ok: false, reason });

/** Rule 23 — whether the switch « Vendu dans l'app » may be on for this catalogue row, and why not. */
function sellabilityOf(kind, row) {
  if (kind === 'option') {
    if (Number(row.isCancellationInsurance || 0) === 1) return refused(INSURANCE_REFUSAL);
    if (AUTO_TIMED.includes(row.autoOptionType)) return refused(AUTO_TIMED_REFUSAL);
    if (!isClientVisibleOption(row)) return refused(INTERNAL_REFUSAL);
    // Rule 27bis — the breakfast is sold by the morning whatever its price type: the core prices it.
    if (row.autoOptionType === BREAKFAST) return SELLABLE;
    // Rule 23 — any other option of the planning is billed by its moments, which an order line does not carry.
    if (Number(row.showsPlanningCard || 0) === 1) return refused(CARD_REFUSAL);
  }
  if (kind === 'resource' && row.priceType === 'per_person') return refused(RESOURCE_PER_PERSON_REFUSAL);
  if (SELLABLE_TYPES[kind].includes(row.priceType)) return SELLABLE;
  return refused(TYPE_REFUSALS[row.priceType] || OTHER_TYPE_REFUSAL);
}

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

const sessionsMinutes = (sessions) => (Array.isArray(sessions) ? sessions : [])
  .reduce((sum, s) => sum + Math.max(0, minutesOf(s && s.end) - minutesOf(s && s.start)), 0);

const add = (map, id, value) => map.set(id, roundMoney((map.get(id) || 0) + value));
const keyOf = (kind, id) => `${kind}:${Number(id)}`;
// An order line names the breakfast by its own kind; it is an option of the catalogue all the same.
const catalogueKind = (kind) => (kind === BREAKFAST ? 'option' : kind);
const lineMinutes = (line) => Math.max(Number(line.quantity || 0) * 60, sessionsMinutes(line.sessions));

/**
 * Rule 25 — what the stay already received, and what its orders already took:
 *  - `optionUnits` / `resourceMinutes`, for the free units and minutes: the lines on the fiche, plus the
 *    orders not on it yet (awaiting payment). An option counts its billed units (what the free units apply
 *    to), an hourly resource its minutes — the sold hours, or the sessions placed when they say more;
 *  - `orderedUnits` (`kind:id`), for the allowance of a 0 € item: every order that stands, in units, an
 *    hourly resource in hours.
 */
function stayConsumption({ optionLines = [], resourceLines = [], pendingOrderLines = [], orderedLines = [] }) {
  const optionUnits = new Map();
  const resourceMinutes = new Map();
  const orderedUnits = new Map();
  optionLines.forEach((line) => add(optionUnits, Number(line.optionId), Number(line.billedUnits) || Number(line.quantity) || 0));
  resourceLines.forEach((line) => add(resourceMinutes, Number(line.resourceId), lineMinutes(line)));
  pendingOrderLines.forEach((line) => {
    if (catalogueKind(line.kind) === 'option') add(optionUnits, Number(line.id), Number(line.quantity) || 0);
    if (line.kind === 'resource') add(resourceMinutes, Number(line.id), lineMinutes(line));
  });
  orderedLines.forEach((line) => {
    const units = line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length
      ? lineMinutes(line) / 60
      : Number(line.quantity) || 0;
    add(orderedUnits, keyOf(catalogueKind(line.kind), line.id), units);
  });
  return { optionUnits, resourceMinutes, orderedUnits };
}

const addDays = (ymd, days) => {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Rule 27bis — the mornings a breakfast can still be served: from the morning after the arrival, and
 * from today only while its service hour has not passed, up to the departure morning.
 * `today` / `time` are the Paris date and wall-clock time of now.
 */
function remainingMornings({ startDate, endDate, today, time, serviceTime }) {
  const fromToday = String(time) < String(serviceTime || DEFAULT_BREAKFAST_TIME) ? today : addDays(today, 1);
  const first = addDays(startDate, 1) > fromToday ? addDays(startDate, 1) : fromToday;
  const mornings = [];
  for (let date = first; date <= endDate; date = addDays(date, 1)) mornings.push(date);
  return mornings;
}

/**
 * Rule 25 — an option's free units, granted once per stay to an own-channel booking: what the stay was
 * granted (its tariff snapshot, else today's catalogue) and what is left once the stay's units took theirs.
 */
function optionFreeUnits(row, { isDirectBooking, grantedFreeUnitsByOption, consumed }) {
  const key = String(row.id);
  const recorded = grantedFreeUnitsByOption && Object.prototype.hasOwnProperty.call(grantedFreeUnitsByOption, key);
  const candidate = Math.max(0, Number(recorded ? grantedFreeUnitsByOption[key] : row.freeUnits) || 0);
  const free = (billedUnits) => applyFreeUnitsToLine({
    option: row, isDirectBooking, billedUnits, unitPrice: Number(row.price || 0), lockedFreeUnits: candidate,
  }).freeUnits;
  const granted = free(candidate);
  if (granted <= 0) return null;
  return { granted, left: roundMoney(granted - free(consumed)) };
}

/** Rule 25 — a resource's free minutes, granted once per stay, minus the minutes it already received. */
function resourceFreeMinutes(row, consumed) {
  const granted = Math.max(0, Number(row.freeMinutes || 0));
  if (granted <= 0) return null;
  return { granted, left: Math.max(0, granted - Math.min(granted, consumed)) };
}

/**
 * Rules 23, 25 — the items this lodging's shop shows, in catalogue order.
 *  options / resources: the engine's applicable catalogue of the lodging (effective price, free units /
 *    minutes); a resource also needs its link (`linkedResourceIds`: its lodgings, or « Tous les logements »)
 *  items: Map `kind:id` → `guest_app_items` row
 *  offeredDefaultIds: the options the lodging offers by default
 *  stay: { isDirectBooking, grantedFreeUnitsByOption, optionLines, optionUnits, resourceMinutes, orderedUnits }
 *  hourlyOffered(resource): whether something prices the hours (the `hourly-resources` plugin)
 * → [{ kind ('option' | 'breakfast' | 'resource'), row, item, included, alreadyIncluded, includedLeft,
 *      freeUnits, freeMinutes, hourly }]
 * A 0 € item is limited per stay to its `maxQuantity`, across the orders that stand: `includedLeft`.
 */
function shopItems({ options = [], resources = [], items, linkedResourceIds, offeredDefaultIds, stay, hourlyOffered }) {
  const includedLeft = (kind, id, item) => Math.max(0, roundMoney(Number(item.maxQuantity) - (stay.orderedUnits.get(keyOf(kind, id)) || 0)));
  const soldItem = (kind, row) => {
    const item = items.get(keyOf(kind, row.id));
    return item && Number(item.sold) === 1 && sellabilityOf(kind, row).ok ? item : null;
  };
  const sold = [];
  options.forEach((row) => {
    const item = !row.archivedAt && soldItem('option', row);
    if (!item) return;
    const breakfast = row.autoOptionType === BREAKFAST;
    const carried = stay.optionUnits.has(Number(row.id));
    const alreadyIncluded = carried && (offeredDefaultIds.has(Number(row.id))
      || (breakfast && (stay.optionLines || []).some((line) => Number(line.optionId) === Number(row.id) && Number(line.offered) === 1)));
    // Rule 27bis — a breakfast the stay already has is still ordered, to choose its mornings and hour.
    const included = Number(row.price || 0) === 0 || (breakfast && alreadyIncluded);
    const consumed = stay.optionUnits.get(Number(row.id)) || 0;
    sold.push({
      kind: breakfast ? BREAKFAST : 'option',
      row,
      item,
      included,
      alreadyIncluded: alreadyIncluded && !breakfast,
      includedLeft: included ? includedLeft('option', row.id, item) : null,
      freeUnits: included ? null : optionFreeUnits(row, { ...stay, consumed }),
      freeMinutes: null,
      hourly: false,
    });
  });
  resources.forEach((row) => {
    if (!linkedResourceIds.has(Number(row.id))) return;
    const item = soldItem('resource', row);
    const hourly = row.priceType === HOURLY;
    // The guest app never prices hours itself: without the plugin that does, the resource is not sold.
    if (!item || (hourly && !hourlyOffered(row))) return;
    const included = Number(row.price || 0) === 0;
    sold.push({
      kind: 'resource',
      row,
      item,
      included,
      alreadyIncluded: false,
      includedLeft: included ? includedLeft('resource', row.id, item) : null,
      freeUnits: null,
      freeMinutes: hourly && !included ? resourceFreeMinutes(row, stay.resourceMinutes.get(Number(row.id)) || 0) : null,
      hourly,
    });
  });
  return sold;
}

module.exports = { BREAKFAST, DEFAULT_BREAKFAST_TIME, remainingMornings, sellabilityOf, shopItems, stayConsumption };
