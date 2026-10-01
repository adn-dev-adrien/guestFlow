// Occupancy of the logements (specs/finance-dashboard-redesign.md §3.7 rules 24-25). Pure.
//
// Sellable nights = the nights of the period minus those covered by an establishment closure — a
// global one (propertyId NULL) or the logement's own. A closure's `endDate` is the reopening day,
// hence exclusive, like a stay's departure. Nights sold are night-based: a stay's nights are counted
// in the month they fall in, whatever its attribution date.

const DAY = 86400000;
const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t) => new Date(t).toISOString().slice(0, 10);

function* nightsOf(from, toExclusive) {
  for (let t = toTime(from); t < toTime(toExclusive); t += DAY) yield toIso(t);
}

const addDays = (iso, n) => toIso(toTime(iso) + n * DAY);

// The closed nights of a logement, as a Set of ISO dates, over [from, to] (to inclusive).
function closedNightSet(propertyId, from, to, closures) {
  const closed = new Set();
  for (const c of closures || []) {
    if (c.propertyId != null && Number(c.propertyId) !== Number(propertyId)) continue;
    const start = c.startDate > from ? c.startDate : from;
    const endExclusive = c.endDate < addDays(to, 1) ? c.endDate : addDays(to, 1);
    for (const night of nightsOf(start, endExclusive)) closed.add(night);
  }
  return closed;
}

function sellableNights(propertyId, from, to, closures) {
  const closed = closedNightSet(propertyId, from, to, closures);
  let n = 0;
  for (const night of nightsOf(from, addDays(to, 1))) if (!closed.has(night)) n += 1;
  return n;
}

// Nights of the given stays falling in [from, to] (to inclusive).
function nightsSold(stays, from, to) {
  let n = 0;
  for (const s of stays) {
    const start = s.startDate > from ? s.startDate : from;
    const endExclusive = s.endDate < addDays(to, 1) ? s.endDate : addDays(to, 1);
    for (let t = toTime(start); t < toTime(endExclusive); t += DAY) n += 1;
  }
  return n;
}

// Rule 23 — a logement with no sellable night has no rate (a gap on the chart), never a 0.
const rate = (sold, sellable) => (sellable > 0 ? Math.round((sold / sellable) * 10000) / 10000 : null);

/**
 * Occupancy of each logement over [from, to], plus the total.
 * `startOf(property)` is the first day the logement has data (its coverage start, rule 24): nights
 * before it are neither sold nor sellable — a month without any data is a gap, never a 0 %.
 * @returns {{ byProperty: Map<id, {sold, sellable, rate}>, sold, sellable, rate }}
 */
function occupancyOver(properties, stays, closures, from, to, { startOf } = {}) {
  const byProperty = new Map();
  let sold = 0;
  let sellable = 0;
  for (const p of properties) {
    const start = startOf ? startOf(p) : from;
    if (!start || start > to) {
      byProperty.set(p.id, { sold: 0, sellable: 0, rate: null });
      continue;
    }
    const pFrom = start > from ? start : from;
    const ownStays = stays.filter((s) => Number(s.propertyId) === Number(p.id));
    const pSold = nightsSold(ownStays, pFrom, to);
    const pSellable = sellableNights(p.id, pFrom, to, closures);
    byProperty.set(p.id, { sold: pSold, sellable: pSellable, rate: rate(pSold, pSellable) });
    sold += pSold;
    sellable += pSellable;
  }
  return { byProperty, sold, sellable, rate: rate(sold, sellable) };
}

// Revenue per night sold and RevPAR (rule 25), on the page's revenue basis.
const revenuePerNight = (revenue, nights) => (nights > 0 ? Math.round((revenue / nights) * 100) / 100 : null);
const revPar = (revenue, sellable) => (sellable > 0 ? Math.round((revenue / sellable) * 100) / 100 : null);

module.exports = { sellableNights, nightsSold, occupancyOver, rate, revenuePerNight, revPar, addDays };
