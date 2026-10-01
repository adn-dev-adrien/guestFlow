// Comparison with last year (specs/finance-dashboard-redesign.md §3.6 rules 17-21). Pure.
//
// Nothing is ever compared to a month that has no data: the coverage starts with the month of the
// earliest reservation of the scope, and a month is comparable once the same month a year earlier is
// on or after it. A window is compared on its comparable part only, on both sides.

const monthOf = (iso) => String(iso).slice(0, 7);

// One year earlier / later; 29 February lands on the 28th.
function shiftYear(iso, delta) {
  const y = Number(iso.slice(0, 4)) + delta;
  let md = iso.slice(4);
  if (md === '-02-29') md = '-02-28';
  return `${String(y).padStart(4, '0')}${md}`;
}

const shiftMonth = (ym, delta) => shiftYear(`${ym}-01`, delta).slice(0, 7);

function coverageMonth(earliestStartDate) {
  return earliestStartDate ? monthOf(earliestStartDate) : null;
}

function isComparableMonth(ym, coverage) {
  return Boolean(coverage) && shiftMonth(ym, -1) >= coverage;
}

function monthsTouched(from, to) {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * The comparable part of a window and its twin a year earlier (rules 18 + 20).
 * @returns {null | { current: {from,to}, previous: {from,to}, months, totalMonths, complete }}
 */
function comparableRange(window, coverage) {
  if (!coverage) return null;
  const earliest = `${coverage}-01`;
  const prevTo = shiftYear(window.to, -1);
  const naturalPrevFrom = shiftYear(window.from, -1);
  const prevFrom = naturalPrevFrom >= earliest ? naturalPrevFrom : earliest;
  if (prevFrom > prevTo) return null;
  const curFrom = prevFrom === naturalPrevFrom ? window.from : shiftYear(prevFrom, 1);
  return {
    current: { from: curFrom, to: window.to },
    previous: { from: prevFrom, to: prevTo },
    months: monthsTouched(curFrom, window.to),
    totalMonths: monthsTouched(window.from, window.to),
    complete: prevFrom === naturalPrevFrom,
  };
}

// Change in percent, one decimal; null when there is nothing to compare against.
function change(current, previous) {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

module.exports = { shiftYear, shiftMonth, coverageMonth, isComparableMonth, comparableRange, change, monthsTouched };
