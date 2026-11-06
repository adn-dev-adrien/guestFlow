// Year-over-year comparison of the Suivi financier's headline figures
// (specs/finance-revpar-year-over-year.md §3). Pure: the window, the coverage, today and the tracking
// start come in, nothing is read here.
//
// It does not define comparability a second time: the comparable range is the dashboard's
// (yearOverYear.comparableRange, finance-dashboard-redesign rules 17-21) and « last year as it stood »
// is known from the booking pace's tracking start (rule 33, paceStartOf). This file only names the
// outcome — comparable or not, the one reason, the one notice — and shapes each figure's comparison.

const yoy = require('./yearOverYear');
const { monthLabel } = require('./financeWindow');

// Rule 23 — « 1er janvier 2027 ».
const { formatDateLongFr: longDate } = require('./dateFr');

// The first day of the month after `ym`.
function firstDayAfter(ym) {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const REASONS = ['noHistory', 'notYetKnown', 'noPreviousValue', 'noCurrentValue'];

/**
 * Rules 4-7 — the comparable range of a window and what the page says about it.
 * @param {{ window: {from,to}, coverage: string|null, today: string, trackingStart: string|null }}
 * @returns {{ range, snapshotKnown, knownAt, status: { comparable, reason, notice, months, totalMonths,
 *   complete, comparableFrom, current, previous } }}
 */
function comparisonWindow({ window, coverage, today, trackingStart }) {
  const snapshotKnown = yoy.lastYearSnapshotKnown(today, trackingStart);
  const natural = yoy.comparableRange(window, coverage);
  const range = natural && !snapshotKnown ? yoy.clampToMonthsOver(natural, today) : natural;
  const totalMonths = yoy.monthsTouched(window.from, window.to);
  const base = {
    comparable: false, reason: null, notice: null, months: 0, totalMonths, complete: false,
    comparableFrom: null, current: null, previous: null,
  };
  let status;
  if (!natural) {
    status = {
      ...base,
      reason: 'noHistory',
      notice: coverage
        ? `Pas de comparaison avec l'an dernier : les données commencent en ${monthLabel(coverage)}.`
        : "Pas de comparaison avec l'an dernier : aucun séjour enregistré.",
    };
  } else if (!range) {
    // Rule 6 — the first day a part of the window compares: its first month is over, or a year of
    // booking dates is reached (the booking pace's own `comparableFrom`), whichever comes first.
    const monthOver = firstDayAfter(natural.current.from.slice(0, 7));
    // Rule 22 — the pace's own `comparableFrom` (a tracking start on 29 February is known on 1 March).
    const snapshotFrom = yoy.snapshotKnownFrom(trackingStart);
    const bySnapshot = Boolean(snapshotFrom) && snapshotFrom < monthOver;
    const comparableFrom = bySnapshot ? snapshotFrom : monthOver;
    // Rule 23 — the sentence says what the date is about, so that it never reads against the pace's.
    status = {
      ...base,
      reason: 'notYetKnown',
      comparableFrom,
      notice: bySnapshot
        ? `Comparaison avec l'an dernier à partir du ${longDate(comparableFrom)}, avec un an de dates de réservation.`
        : `Comparaison avec l'an dernier une fois le premier mois terminé, à partir du ${longDate(comparableFrom)}.`,
    };
  } else {
    let notice = null;
    if (!range.complete) {
      // Rule 21 — each clamp that removed months gives its reason: the data's start, the months not over.
      const byCoverage = !natural.complete;
      const byMonthsOver = range.months < natural.months;
      const reasons = [
        ...(byCoverage ? [`les données commencent en ${monthLabel(coverage)}`] : []),
        ...(byMonthsOver ? ['un mois en cours se compare une fois terminé'] : []),
      ];
      notice = `Comparaison sur ${range.months} mois sur ${totalMonths} : ${reasons.join(', et ')}.`;
    }
    status = {
      ...base,
      comparable: true,
      notice,
      months: range.months,
      complete: range.complete,
      current: { ...range.current },
      previous: { ...range.previous },
    };
  }
  return { range, snapshotKnown, knownAt: yoy.shiftYear(today, -1), status };
}

const notComparable = (unit, reason) => ({ current: null, previous: null, change: null, unit, comparable: false, reason });

// Rule 9 — half away from zero, so +0,05 pt and −0,05 pt round alike; never a « −0 ».
function pointsChange(current, previous) {
  const bp = Math.round(current * 10000) - Math.round(previous * 10000);
  const tenths = Math.sign(bp) * Math.round(Math.abs(bp) / 10);
  return tenths / 10 || 0;
}

/**
 * Rules 8-10 — one figure against last year. `unit`: 'percent' (money, counts, per-night amounts:
 * the change in %, one decimal, yearOverYear.change) or 'points' (a rate: the change in points, one
 * decimal). `status` is comparisonWindow's.
 */
function compare(current, previous, unit, status) {
  if (!status.comparable) return notComparable(unit, status.reason);
  const out = { current, previous, change: null, unit, comparable: false, reason: null };
  if (previous == null || (unit === 'percent' && !(previous > 0))) return { ...out, reason: 'noPreviousValue' };
  if (current == null) return { ...out, reason: 'noCurrentValue' };
  const change = unit === 'points' ? pointsChange(current, previous) : yoy.change(current, previous);
  return { ...out, change, comparable: true };
}

module.exports = { comparisonWindow, compare, pointsChange, firstDayAfter, REASONS };
