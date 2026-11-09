// specs/tourist-tax-report-v2.md rules 2-5 — the window of the tourist-tax report: a month, a quarter, a year or a
// custom du / au. Pure: today is passed in, never read here. A month is the existing extraction's month, a quarter
// or a year the union of its months, a custom window reuses the finance window's validation (D7: ≤ 750 days,
// impossible day « Deux dates à choisir. », both ends inside the date window).

const { getMonthBounds } = require('./financeCalcs');
const { addDays } = require('./dateDays');
const { resolveWindow, monthLabel, MESSAGES: WINDOW_MESSAGES } = require('./financeWindow');
const { horizonStart } = require('./stayDates');

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const MESSAGES = {
  badKind: WINDOW_MESSAGES.badKind,
  badMonth: 'Mois invalide. Format attendu: YYYY-MM.',
  badQuarter: 'Trimestre invalide. Format attendu: YYYY-Qn.',
  badYear: 'Année invalide. Format attendu: YYYY.',
  future: 'Les mois futurs ne sont pas autorisés.',
};

const PERIODS = ['month', 'quarter', 'year', 'custom'];
const QUARTER = /^(\d{4})-Q([1-4])$/;
const YEAR = /^\d{4}$/;

const pad2 = (n) => String(n).padStart(2, '0');

/** The first day of the month after today's: nothing is attributed on or after it yet (rule 4). */
function nextMonthStart(today) {
  return getMonthBounds(String(today).slice(0, 7)).endExclusive;
}

function monthsWindow(firstMonth, count, label, kind, extra) {
  const first = getMonthBounds(firstMonth);
  let endExclusive = first.start;
  for (let i = 0; i < count; i += 1) endExclusive = getMonthBounds(endExclusive.slice(0, 7)).endExclusive;
  return { kind, from: first.start, to: addDays(endExclusive, -1), toExclusive: endExclusive, label, ...extra };
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Rule 27 — the asked month, quarter or year is judged BEFORE any window is built: a year before 1000 is refused
// with the period's own message, and one starting after the current month is « future » (9999 included).
function windowOf({ period, month, quarter, year, from, to, today }) {
  const current = String(today).slice(0, 7);
  if (period === 'month') {
    const ym = String(month || '');
    const match = MONTH.exec(ym);
    if (!match || Number(match[1]) < 1000) return { error: MESSAGES.badMonth };
    if (ym > current) return { error: MESSAGES.future };
    return { window: monthsWindow(ym, 1, monthLabel(ym), 'month', { month: ym }) };
  }
  if (period === 'quarter') {
    const match = QUARTER.exec(String(quarter || ''));
    if (!match || Number(match[1]) < 1000) return { error: MESSAGES.badQuarter };
    const q = Number(match[2]);
    const firstMonth = `${match[1]}-${pad2((q - 1) * 3 + 1)}`;
    if (firstMonth > current) return { error: MESSAGES.future };
    const label = `T${q} ${match[1]} (${SHORT_MONTHS[(q - 1) * 3]}–${SHORT_MONTHS[(q - 1) * 3 + 2]})`;
    return { window: monthsWindow(firstMonth, 3, label, 'quarter', { quarter: `${match[1]}-Q${q}` }) };
  }
  if (period === 'year') {
    const y = String(year || '');
    if (!YEAR.test(y) || Number(y) < 1000) return { error: MESSAGES.badYear };
    if (`${y}-01` > current) return { error: MESSAGES.future };
    return { window: monthsWindow(`${y}-01`, 12, `Année ${y}`, 'year', { year: y }) };
  }
  if (period === 'custom') {
    const resolved = resolveWindow({ kind: 'custom', from, to, today });
    if (!resolved.ok) return { error: resolved.error };
    return { window: { ...resolved.window, toExclusive: addDays(resolved.window.to, 1) } };
  }
  return { error: MESSAGES.badKind };
}

/**
 * @param {{ period?: string, month?: string, quarter?: string, year?: string, from?: string, to?: string, today: string }} input
 * @returns {{ ok: true, window: { kind, from, to, toExclusive, label, coveredTo, coveredToExclusive, futureExcluded } }
 *          | { ok: false, error: string }}
 */
function resolveTaxPeriod({ period = 'month', today, ...input }) {
  const kind = PERIODS.includes(period) ? period : null;
  const { window, error } = windowOf({ period: kind, today, ...input });
  if (error) return { ok: false, error };
  const limit = nextMonthStart(today);
  if (window.from >= limit) return { ok: false, error: MESSAGES.future };
  const coveredToExclusive = window.toExclusive < limit ? window.toExclusive : limit;
  return {
    ok: true,
    window: {
      ...window,
      coveredTo: addDays(coveredToExclusive, -1),
      coveredToExclusive,
      futureExcluded: coveredToExclusive !== window.toExclusive,
    },
  };
}

const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthAt = (index) => `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad2((index % 12) + 1)}`;

/**
 * Rule 15 — what the period pickers offer, newest first and labelled: every month, quarter and year from the
 * first month holding a stay (`firstMonth`, the current one when there is none) to the current month, never before
 * the date window's start (today − 5 years, the month it falls in), and the month the page opens on (the previous
 * one: the month a declaration is usually made for). An older month stays readable by its query, it is not offered
 * — except the one being read (rule 29).
 *
 * @param {{ firstMonth?: string|null, today: string }} input
 * @returns {{ months: Array<{value,label}>, quarters: Array<{value,label}>, years: Array<{value,label}>, defaultMonth: string }}
 */
function periodChoices({ firstMonth, today, window = null }) {
  const current = String(today).slice(0, 7);
  const defaultMonth = monthAt(monthIndex(current) - 1);
  const oldest = horizonStart(today).slice(0, 7);
  const asked = firstMonth && getMonthBounds(firstMonth) && firstMonth < current ? firstMonth : current;
  // Rule 29 — the month the page opens on is always offered, even before the first stay.
  const earliest = asked < defaultMonth ? asked : defaultMonth;
  const first = earliest < oldest ? oldest : earliest;
  const months = [];
  for (let i = monthIndex(current); i >= monthIndex(first); i -= 1) {
    const ym = monthAt(i);
    months.push({ value: ym, label: monthLabel(ym) });
  }
  const quarterLabel = (quarter) => windowOf({ period: 'quarter', quarter, today }).window.label;
  const quarters = [];
  const years = [];
  for (const { value } of months) {
    const quarter = `${value.slice(0, 4)}-Q${Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1}`;
    if (!quarters.some((q) => q.value === quarter)) quarters.push({ value: quarter, label: quarterLabel(quarter) });
    if (!years.some((y) => y.value === value.slice(0, 4))) years.push({ value: value.slice(0, 4), label: value.slice(0, 4) });
  }
  // Rule 29 — the selection read is always among the options, so its picker never shows blank.
  const ensure = (list, value, label) => {
    if (value && !list.some((o) => o.value === value)) {
      list.push({ value, label });
      list.sort((x, y) => (x.value < y.value ? 1 : -1));
    }
  };
  if (window && window.kind === 'month') ensure(months, window.month, window.label);
  if (window && window.kind === 'quarter') ensure(quarters, window.quarter, window.label);
  if (window && window.kind === 'year') ensure(years, window.year, window.year);
  return { months, quarters, years, defaultMonth };
}

module.exports = { resolveTaxPeriod, periodChoices, MESSAGES, PERIODS };
