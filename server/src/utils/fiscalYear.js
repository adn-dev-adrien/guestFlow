// Fiscal-year arithmetic — pure helpers, no DB, no clock (specs/fiscal-year-and-nights-sold.md §3.1).
//
// The operator declares a CLOSING MONTH (1..12). The exercise ends on the last day of that month and
// starts on the first day of the following one: closing September → 1 Oct … 30 Sep of the next year.
// Closing December is the calendar year, which is the default and reproduces the pre-spec behaviour.
//
// An exercise is keyed by its END year and labelled « 2025-2026 » (or « 2026 » when the exercise is a
// calendar year). Every function takes its reference date as a parameter so the whole file is
// deterministic and unit-testable.

const DEFAULT_END_MONTH = 12;

function normaliseEndMonth(endMonth) {
  const n = Number(endMonth);
  if (!Number.isInteger(n) || n < 1 || n > 12) return DEFAULT_END_MONTH;
  return n;
}

const pad2 = (n) => String(n).padStart(2, '0');

// Last day of `month` in `year`, via « day 0 of the following month » — correct on February of a
// leap year, where a hard-coded 28 would silently drop a day.
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Bounds of the exercise whose END year is `endYear`.
function boundsForEndYear(endMonth, endYear) {
  const closing = normaliseEndMonth(endMonth);
  const startMonth = (closing % 12) + 1;
  // Calendar-year exercise (closing December) starts in its own end year; any other closing month
  // starts in the previous one.
  const startYear = closing === 12 ? endYear : endYear - 1;
  return {
    key: endYear,
    label: closing === 12 ? `${endYear}` : `${startYear}-${endYear}`,
    from: `${String(startYear).padStart(4, '0')}-${pad2(startMonth)}-01`,
    to: `${String(endYear).padStart(4, '0')}-${pad2(closing)}-${pad2(lastDayOfMonth(endYear, closing))}`,
  };
}

// The exercise containing `dateIso` (YYYY-MM-DD). A date in a month past the closing month belongs to
// the exercise that closes NEXT year.
function containing(endMonth, dateIso) {
  const closing = normaliseEndMonth(endMonth);
  const match = /^(\d{4})-(\d{2})/.exec(String(dateIso || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const endYear = month <= closing ? year : year + 1;
  return boundsForEndYear(closing, endYear);
}

// Resolve the exercise to report on: an explicit key when it is a plausible year, else the one
// containing `today`. Never throws — an unparseable key falls back to the current exercise so a
// hand-edited URL degrades instead of 400-ing (spec §3.5 rule 24).
function resolve(endMonth, { key, today } = {}) {
  const closing = normaliseEndMonth(endMonth);
  const asked = Number(key);
  if (Number.isInteger(asked) && asked >= 2000 && asked <= 9999) {
    return boundsForEndYear(closing, asked);
  }
  return containing(closing, today);
}

// The selector's options (spec §3.5 rule 23): every exercise between the earliest and the latest
// attribution date found in the data, plus the current one, newest first. A missing/invalid bound
// simply doesn't widen the range — the current exercise is always present.
function list(endMonth, { minDate, maxDate, today } = {}) {
  const closing = normaliseEndMonth(endMonth);
  const current = containing(closing, today);
  if (!current) return [];
  const first = containing(closing, minDate);
  const last = containing(closing, maxDate);
  const fromKey = Math.min(current.key, first ? first.key : current.key);
  const toKey = Math.max(current.key, last ? last.key : current.key);
  const out = [];
  for (let key = toKey; key >= fromKey; key -= 1) {
    const bounds = boundsForEndYear(closing, key);
    out.push({ ...bounds, isCurrent: key === current.key });
  }
  return out;
}

module.exports = {
  DEFAULT_END_MONTH,
  normaliseEndMonth,
  boundsForEndYear,
  containing,
  resolve,
  list,
};
