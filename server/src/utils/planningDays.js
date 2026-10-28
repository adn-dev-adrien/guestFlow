/**
 * Day arithmetic and labels of the planning payloads (specs/dashboard-planning-scroll.md rules 2, 8,
 * 9): every calendar day of a window, the French labels of a day, how far a day is from today, and the
 * bound of a window. Pure; dates are `YYYY-MM-DD` read as UTC so a daylight-saving change never
 * shifts a count.
 */

const { addDays } = require('./dateDays');
const { frenchDayLabel } = require('./upcomingArrivals');

const MAX_WINDOW_DAYS = 31;

const SHORT_LABEL = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
});
const SHORT_LABEL_WITH_YEAR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day: `2026-02-30` has the shape but no day behind it. */
function isCalendarDay(value) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** `null` when `[from, to]` is an acceptable window, else the error code to answer with. */
function checkWindow(from, to) {
  if (!isCalendarDay(from) || !isCalendarDay(to) || from > to) return 'INVALID_DATE_RANGE';
  if (daysBetween(from, to) + 1 > MAX_WINDOW_DAYS) return 'INVALID_DATE_RANGE';
  return null;
}

function shortDayLabel(isoDate, today) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const otherYear = String(isoDate).slice(0, 4) !== String(today).slice(0, 4);
  return (otherYear ? SHORT_LABEL_WITH_YEAR : SHORT_LABEL).format(d);
}

/** « demain » or « dans N jours » (calendar days). Empty for today or a past day. */
function relativeLabel(today, date) {
  const n = daysBetween(today, date);
  if (n === 1) return 'demain';
  return n > 1 ? `dans ${n} jours` : '';
}

/** Every day of `[from, to]` with its labels and its place relative to `today`, cards left empty. */
function windowDays(from, to, today) {
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({
      date,
      label: frenchDayLabel(date, today),
      shortLabel: shortDayLabel(date, today),
      isToday: date === today,
      isPast: date < today,
    });
  }
  return days;
}

/** `{ [date]: id[] }` from `[{ id, date }]` rows already in order. */
function idsByDate(rows) {
  const out = {};
  for (const { id, date } of rows) (out[date] = out[date] || []).push(id);
  return out;
}

module.exports = {
  MAX_WINDOW_DAYS, isCalendarDay, daysBetween, checkWindow, relativeLabel, windowDays, idsByDate,
};
