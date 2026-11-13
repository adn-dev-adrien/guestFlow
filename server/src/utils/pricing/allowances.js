/**
 * ALLOWANCES — the stay's free units and free minutes (specs/pricing-components.md §3 rule 41).
 *
 * Contract: grants come from the catalogue (`options.freeUnits` per lodging, `resources.freeMinutes`) and from what the
 * stay was sold with (its tariff snapshot); consumption is read from the lines. This is the read-only form of what the
 * engine has always computed — same numbers:
 *   consumeAllowance({ granted, isDirect, billedUnits, unitPrice })   → { used, amount, chargedUnits, realTotal }
 *   releaseAllowance(line)                                            → { returned, amount } — a removed line's share back to the pool
 *   createFreeUnitsLedger({ lockedTariff, optionsById, lockedOptionsById, isDirectBooking })
 *                                                                     → { grantedFreeUnitsFor, consumedFreeUnitsFor, ... }
 *                                                                       and, for an article sold on several lines (rule 85), the allowance of the
 *                                                                       article counted ONCE: `remainingFreeUnitsFor` / `takeFreeUnits`,
 *                                                                       `consumedLeftFor` / `takeConsumed`, `remainingFreeMinutesFor` / `takeFreeMinutes`
 *   applyFreeUnitsToLine, applyPerHourFreeMinutes, normalizeBilledUnits  — the engine's own helpers, unchanged
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('./money');

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

function normalizeBilledUnits(value) {
  const units = Number(value);
  if (!Number.isFinite(units)) return 0;
  return Math.max(0, units);
}

function applyPerHourFreeMinutes(baseUnits, freeMinutes) {
  const normalizedUnits = normalizeBilledUnits(baseUnits);
  const normalizedFreeMinutes = Math.max(0, Number(freeMinutes || 0));
  const freeUnits = roundMoney(normalizedFreeMinutes / 60);
  return roundMoney(Math.max(0, normalizedUnits - freeUnits));
}

// specs/tariff-recipes/spec.md §3.9 rules 52bis-52ter — the first N units of an option are covered
// by the rate (the direct welcome pack's two breakfasts). The operator orders the FULL quantity and
// only the units beyond the free ones are billed; `billedUnits` — what the Planning and SAS cards
// prepare — is deliberately untouched. Own-channel bookings only — `direct` AND `Lodgify`, the
// booking engine on the operator's own site (rule 53): the pack is the single difference with a
// commissioned channel, and a platform reservation is priced by its recorded gross.
function applyFreeUnitsToLine({ option, isDirectBooking, billedUnits, unitPrice, lockedFreeUnits = null }) {
  // A sold reservation replays the units it was GRANTED (rule 12bis): raising the pack from 2 to 3
  // breakfasts must not retroactively widen what an old booking got for free.
  const granted = lockedFreeUnits != null ? Number(lockedFreeUnits) : Number(option.freeUnits || 0);
  const freeUnits = isDirectBooking
    ? Math.min(Math.max(0, granted), billedUnits)
    : 0;
  const chargedUnits = roundMoney(Math.max(0, billedUnits - freeUnits));
  return {
    freeUnits,
    freeUnitsAmount: roundMoney(freeUnits * unitPrice),
    chargedUnits,
    realTotal: roundMoney(chargedUnits * unitPrice),
  };
}

function consumeAllowance({ granted, isDirect, billedUnits, unitPrice }) {
  const free = applyFreeUnitsToLine({ option: { freeUnits: 0 }, isDirectBooking: isDirect, billedUnits, unitPrice, lockedFreeUnits: granted });
  return {
    used: free.freeUnits, amount: free.freeUnitsAmount, chargedUnits: free.chargedUnits, realTotal: free.realTotal,
  };
}

function releaseAllowance(line) {
  const returned = Math.max(0, Number(line && line.freeUnits) || 0);
  return { returned, amount: roundMoney(returned * (Number(line && line.unitPrice) || 0)) };
}

function createFreeUnitsLedger({ lockedTariff, optionsById, lockedOptionsById, isDirectBooking }) {
  // specs/tariff-recipes/spec.md §3 rules 12bis + 66 — the free units of an option are read from two
  // maps of the tariff snapshot, never one:
  //   - `grantedFreeUnitsByOption`: what the stay was GRANTED per option (0 included). It survives
  //     every save, the option removed, its quantity lowered or the stay moved to a platform, so a
  //     re-added welcome pack is not billed. An option absent from it was never on the stay: it gets
  //     today's catalogue.
  //   - `freeUnitsByOption`: what the stored lines were CONSUMED net of at the last save — only the
  //     add-back of a sold line reads it (rule 56).
  // A snapshot written before rule 66 only has the consumed map: it stands in for the grant (the best
  // lower bound we have), an option already on the stay but absent from it was granted nothing, and an
  // option new to the stay gets the catalogue.
  const soldGrantMap = lockedTariff && isPlainObject(lockedTariff.grantedFreeUnitsByOption)
    ? lockedTariff.grantedFreeUnitsByOption
    : null;
  const consumedMap = lockedTariff && isPlainObject(lockedTariff.freeUnitsByOption)
    ? lockedTariff.freeUnitsByOption
    : {};
  const grantedFreeUnitsFor = (optionId) => {
    const key = String(optionId);
    const live = Math.max(0, Number(optionsById.get(Number(optionId))?.freeUnits || 0));
    if (!lockedTariff) return live;                       // no snapshot → sold now, at the catalogue
    if (soldGrantMap) return Object.prototype.hasOwnProperty.call(soldGrantMap, key)
      ? Math.max(0, Number(soldGrantMap[key] || 0))
      : live;
    if (Object.prototype.hasOwnProperty.call(consumedMap, key)) return Math.max(0, Number(consumedMap[key] || 0));
    return lockedOptionsById.has(Number(optionId)) ? 0 : live;
  };
  // What a stored line is net of. A legacy snapshot recorded it at the creation only, for a direct
  // sale: on a platform save it has nothing to add back.
  const consumedFreeUnitsFor = (optionId) => {
    if (!lockedTariff) return 0;
    const consumed = Math.max(0, Number(consumedMap[String(optionId)] || 0));
    return soldGrantMap || isDirectBooking ? consumed : 0;
  };
  // Rule 85: the allowance belongs to the article, not to a line. The lines of an article are priced in order and each takes what the
  // ones before left; an article on one line sees the whole grant, exactly as before.
  const taken = { grant: new Map(), consumed: new Map(), minutes: new Map() };
  const left = (kind, id, total) => Math.max(0, total - (taken[kind].get(String(id)) || 0));
  const take = (kind, id, units) => taken[kind].set(String(id), (taken[kind].get(String(id)) || 0) + Math.max(0, Number(units) || 0));
  return {
    soldGrantMap,
    consumedMap,
    grantedFreeUnitsFor,
    consumedFreeUnitsFor,
    remainingFreeUnitsFor: (optionId) => left('grant', optionId, grantedFreeUnitsFor(optionId)),
    takeFreeUnits: (optionId, units) => take('grant', optionId, units),
    consumedLeftFor: (optionId) => left('consumed', optionId, consumedFreeUnitsFor(optionId)),
    takeConsumed: (optionId, units) => take('consumed', optionId, units),
    remainingFreeMinutesFor: (resourceId, freeMinutes) => left('minutes', resourceId, Math.max(0, Number(freeMinutes) || 0)),
    takeFreeMinutes: (resourceId, minutes) => take('minutes', resourceId, minutes),
  };
}

module.exports = {
  normalizeBilledUnits,
  applyPerHourFreeMinutes,
  applyFreeUnitsToLine,
  consumeAllowance,
  releaseAllowance,
  createFreeUnitsLedger,
};
