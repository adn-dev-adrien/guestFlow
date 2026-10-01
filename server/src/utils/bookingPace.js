// Booking pace — « réservations à date » against the same date last year (specs/booking-pace.md §3).
// Pure: every function takes plain stays and ISO dates, no database.
//
// A stay is `{ propertyId, startDate, endDate, totalSejour, bookedOn, cancelledOn }`, dates as
// YYYY-MM-DD. `bookedOn` is the day its fiche was created (rule 1); `cancelledOn` is null for a stay
// still booked.

const { shiftYear, shiftMonth, change } = require('./yearOverYear');

const DAY = 86400000;
const METRICS = ['reservations', 'nights', 'revenue'];
const MONTHS_AHEAD = 12;
const CURVE_DAYS = 365;
const CURVE_STEP = 5;
const TONE_THRESHOLD = 0.05;

const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso, n) => new Date(toMs(iso) + n * DAY).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const nightsOf = (s) => Math.max(0, Math.round((toMs(s.endDate) - toMs(s.startDate)) / DAY));

// Rule 2 — booked on or before `date`, and not cancelled on or before it.
function isOnBooks(stay, date) {
  if (!stay.bookedOn || stay.bookedOn > date) return false;
  return !(stay.cancelledOn && stay.cancelledOn <= date);
}

// Rule 3 — a stay's share of month `ym`: its arrival (réservations), its nights falling in the month
// (nuits), or its « total de séjour » spread evenly over its nights (CA des nuits).
function valueInMonth(stay, ym, metric) {
  if (metric === 'reservations') return String(stay.startDate).slice(0, 7) === ym ? 1 : 0;
  const monthStart = toMs(`${ym}-01`);
  const from = Math.max(toMs(stay.startDate), monthStart);
  const to = Math.min(toMs(stay.endDate), monthStart + monthLengthMs(ym));
  const nights = Math.max(0, Math.round((to - from) / DAY));
  if (metric === 'nights') return nights;
  const total = nightsOf(stay);
  if (total === 0) return String(stay.startDate).slice(0, 7) === ym ? Number(stay.totalSejour || 0) : 0;
  return (Number(stay.totalSejour || 0) * nights) / total;
}

function monthLengthMs(ym) {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return Date.UTC(y, m, 1) - Date.UTC(y, m - 1, 1);
}

// The whole stay, for the pickup chips (rule 12).
function wholeValue(stay, metric) {
  if (metric === 'reservations') return 1;
  if (metric === 'nights') return nightsOf(stay);
  return Number(stay.totalSejour || 0);
}

const roundFor = (metric, v) => (metric === 'revenue' ? round2(v) : Math.round(v));

function onBooksIn(stays, ym, at, metric) {
  let v = 0;
  for (const s of stays) if (isOnBooks(s, at)) v += valueInMonth(s, ym, metric);
  return roundFor(metric, v);
}

function monthsFrom(today, count) {
  const first = today.slice(0, 7);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const y = Number(first.slice(0, 4)) + Math.floor((Number(first.slice(5, 7)) - 1 + i) / 12);
    const m = ((Number(first.slice(5, 7)) - 1 + i) % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

// Rule 8 — the earliest creation day is the initial import, where every stay booked before GuestFlow
// landed at once: booking dates are trusted from the day after.
function paceStartOf(stays) {
  let min = null;
  for (const s of stays) if (s.bookedOn && (min == null || s.bookedOn < min)) min = s.bookedOn;
  return min ? addDays(min, 1) : null;
}

const FR_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FR_LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const FR_NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const FR_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const FR_TICK = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const shortDate = (iso) => FR_SHORT.format(new Date(toMs(iso)));
const monthLabel = (ym) => FR_MONTH.format(new Date(toMs(`${ym}-01`)));
// « oct. », with the year on January and on the first month of the chart: « janv. 27 ».
const monthTick = (ym, first) => {
  const t = FR_TICK.format(new Date(toMs(`${ym}-01`)));
  return ym.endsWith('-01') || first ? `${t} ${ym.slice(2, 4)}` : t;
};
const longDate = (iso) => FR_LONG.format(new Date(toMs(iso)));

function formatValue(metric, v) {
  const n = FR_NUMBER.format(Math.round(v));
  if (metric === 'revenue') return `${n} €`;
  if (metric === 'nights') return `${n} ${Math.round(v) > 1 ? 'nuits réservées' : 'nuit réservée'}`;
  return `${n} ${Math.round(v) > 1 ? 'réservations' : 'réservation'}`;
}

function toneOf(delta, deltaPct) {
  if (deltaPct == null) return delta > 0 ? 'success' : 'neutral';
  if (deltaPct > TONE_THRESHOLD) return 'success';
  if (deltaPct < -TONE_THRESHOLD) return 'error';
  return 'neutral';
}

// Rule 11 — the sentence above the chart; the badge is drawn by the client from delta / deltaPct.
function summaryOf({ months, today, metric, comparableFrom, comparableAsOf }) {
  const comparable = months.filter((m) => m.sameTimeLastYear != null);
  const scope = comparable.length === MONTHS_AHEAD || comparable.length === 0
    ? 'pour les 12 prochains mois'
    : `sur les ${comparable.length} mois comparables`;
  const what = metric === 'revenue' ? ' de CA des nuits réservé' : '';
  if (!comparable.length) {
    const current = roundFor(metric, months.reduce((n, m) => n + m.current, 0));
    return {
      current, sameTimeLastYear: null, delta: null, deltaPct: null, change: null, comparableMonths: 0, tone: 'neutral',
      text: `Au ${shortDate(today)}, ${formatValue(metric, current)}${what} ${scope}.`,
      notice: !comparableAsOf && comparableFrom
        ? `La comparaison à date s'affichera à partir du ${longDate(comparableFrom)} : il faut un an de dates de réservation. En attendant, les pointillés montrent ce que chaque mois a fait l'an dernier.`
        : null,
    };
  }
  const current = roundFor(metric, comparable.reduce((n, m) => n + m.current, 0));
  const previous = roundFor(metric, comparable.reduce((n, m) => n + m.sameTimeLastYear, 0));
  const delta = roundFor(metric, current - previous);
  const deltaPct = previous > 0 ? round4((current - previous) / previous) : null;
  const euro = metric === 'revenue' ? ' €' : '';
  let signed = 'autant';
  if (Math.round(delta) > 0) signed = `+${FR_NUMBER.format(Math.round(delta))}${euro}`;
  else if (Math.round(delta) < 0) signed = `−${FR_NUMBER.format(Math.abs(Math.round(delta)))}${euro}`;
  return {
    current, sameTimeLastYear: previous, delta, deltaPct, change: change(current, previous),
    comparableMonths: comparable.length,
    tone: toneOf(delta, deltaPct),
    text: `Au ${shortDate(today)}, ${formatValue(metric, current)}${what} ${scope}, contre ${FR_NUMBER.format(Math.round(previous))}${euro} l'an dernier à la même date (${signed}).`,
    notice: null,
  };
}

// Rule 12 — net pickup over (asOf − days, asOf], for stays arriving after asOf.
function pickupOver(stays, asOf, days, metric) {
  const from = addDays(asOf, -days);
  let v = 0;
  for (const s of stays) {
    if (!(s.startDate > asOf)) continue;
    if (s.bookedOn && s.bookedOn > from && s.bookedOn <= asOf) v += wholeValue(s, metric);
    if (s.cancelledOn && s.cancelledOn > from && s.cancelledOn <= asOf) v -= wholeValue(s, metric);
  }
  return roundFor(metric, v);
}

/**
 * Rules 5-12 — the twelve stay months from today's, with their three figures, the summary and the
 * pickup. `coverageMonth` (YYYY-MM, finance-dashboard-redesign rule 17) says from when last year's
 * stays exist at all; `null` → nothing of last year is shown.
 */
function buildPace({ stays, today, metric, coverageMonth }) {
  const lastYearDay = shiftYear(today, -1);
  const paceStart = paceStartOf(stays);
  const comparableAsOf = Boolean(paceStart) && lastYearDay >= paceStart;
  const comparableFrom = paceStart ? shiftYear(paceStart, 1) : null;

  const months = monthsFrom(today, MONTHS_AHEAD).map((month, i) => {
    const lastYearMonth = shiftMonth(month, -1);
    const covered = Boolean(coverageMonth) && lastYearMonth >= coverageMonth;
    const current = onBooksIn(stays, month, today, metric);
    const lastYearFinal = covered ? onBooksIn(stays, lastYearMonth, today, metric) : null;
    const sameTimeLastYear = covered && comparableAsOf ? onBooksIn(stays, lastYearMonth, lastYearDay, metric) : null;
    return {
      month,
      label: monthLabel(month),
      lastYearLabel: monthLabel(lastYearMonth),
      tick: monthTick(month, i === 0),
      current,
      sameTimeLastYear,
      lastYearFinal,
      comparable: sameTimeLastYear != null,
      delta: sameTimeLastYear == null ? null : roundFor(metric, current - sameTimeLastYear),
      deltaPct: sameTimeLastYear > 0 ? round4((current - sameTimeLastYear) / sameTimeLastYear) : null,
      remaining: lastYearFinal == null ? null : roundFor(metric, Math.max(0, lastYearFinal - current)),
      reachedPct: lastYearFinal > 0 ? round4(current / lastYearFinal) : null,
    };
  }).map((m) => ({ ...m, tone: m.delta == null ? 'neutral' : toneOf(m.delta, m.deltaPct) }));

  const earliestBooked = paceStart ? addDays(paceStart, -1) : null;
  const pickup = {};
  for (const days of [7, 30]) {
    const lastYearKnown = Boolean(earliestBooked) && addDays(lastYearDay, -days) >= earliestBooked;
    pickup[`last${days}`] = {
      current: pickupOver(stays, today, days, metric),
      lastYear: lastYearKnown ? pickupOver(stays, lastYearDay, days, metric) : null,
    };
  }

  return {
    asOf: today,
    asOfLastYear: lastYearDay,
    metric,
    paceStart,
    comparableFrom,
    summary: summaryOf({ months, today, metric, comparableFrom, comparableAsOf }),
    pickup,
    months,
  };
}

/**
 * Rule 13 — the cumulative value on the books for `month` by days before its first day, this year up
 * to today, last year over the whole span once its booking dates are trusted.
 */
function buildPickupCurve({ stays, month, today, metric, coverageMonth }) {
  const first = `${month}-01`;
  const lastYearMonth = shiftMonth(month, -1);
  const lastYearFirst = `${lastYearMonth}-01`;
  const paceStart = paceStartOf(stays);
  const covered = Boolean(coverageMonth) && lastYearMonth >= coverageMonth;
  const points = [];
  for (let daysBefore = CURVE_DAYS; daysBefore >= 0; daysBefore -= CURVE_STEP) {
    const at = addDays(first, -daysBefore);
    const lastYearAt = addDays(lastYearFirst, -daysBefore);
    points.push({
      daysBefore,
      current: at <= today ? onBooksIn(stays, month, at, metric) : null,
      lastYear: covered && paceStart && lastYearAt >= paceStart ? onBooksIn(stays, lastYearMonth, lastYearAt, metric) : null,
    });
  }
  const todayDaysBefore = Math.max(0, Math.round((toMs(first) - toMs(today)) / DAY));
  return { month, label: monthLabel(month), lastYearLabel: monthLabel(lastYearMonth), metric, todayDaysBefore, points };
}

module.exports = {
  METRICS, isOnBooks, valueInMonth, paceStartOf, pickupOver, buildPace, buildPickupCurve, addDays,
};
