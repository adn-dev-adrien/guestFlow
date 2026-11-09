/**
 * Service hours — when someone is on site to prepare an order or light the bath (specs/guest-app.md rules 31,
 * 39-42). Pure: the schedule and the instant come in, nothing reads a database or a clock.
 *
 * A schedule is `{ weekly, exceptions, closures }`:
 *   weekly     — `{ 0: [{ from, to }], …, 6: [...] }`, JS weekdays (0 = Sunday), `HH:MM` ranges;
 *   exceptions — `[{ date, closed, ranges }]`: that date is closed, or open on its own ranges;
 *   closures   — the all-properties establishment closures `[{ startDate, endDate }]`, nights
 *                `startDate ≤ d < endDate`: no service on those days.
 * Every time is Europe/Paris wall clock; a range never crosses midnight.
 *
 * `unconstrained: true` — nothing is stored yet (no range, no exception, shared or of the lodging): the service
 * counts as always open, so nothing waits on hours the operator never set. Once anything is stored, a day
 * without a range is closed.
 */

const sdk = require('../sdk');

const { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT, toParisIso, wallClockToDate } = sdk.coreModule('stayWindow');

const MINUTES_PER_DAY = 1440;
const STEP_MINUTES = 30;
// How far the next opening is looked for: two weeks covers any holiday a stay can wait through.
const LOOKAHEAD_DAYS = 14;

const LABELS = Object.freeze({
  fr: Object.freeze({
    locale: 'fr-FR',
    today: 'Aujourd’hui',
    tomorrow: 'Demain',
    time: (minutes) => {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
    },
    asap: (time) => `Dès que possible — vers ${time}`,
    resumes: (when, time) => `Le service reprend ${when ? `${when} ` : ''}à ${time} — vous pouvez commander dès maintenant pour plus tard`,
    resumesTomorrow: 'demain',
    closedUntilDeparture: 'Le service est fermé jusqu’à votre départ',
  }),
  en: Object.freeze({
    locale: 'en-GB',
    today: 'Today',
    tomorrow: 'Tomorrow',
    time: (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`,
    asap: (time) => `As soon as possible — around ${time}`,
    resumes: (when, time) => `Service resumes ${when ? `${when} ` : ''}at ${time} — you can order now for later`,
    resumesTomorrow: 'tomorrow',
    closedUntilDeparture: 'The service is closed until your departure',
  }),
});

const toMinutes = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return h * 60 + m;
};
const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const dayIndex = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
const dateOf = (index) => new Date(index * 86400000).toISOString().slice(0, 10);
const addDays = (date, days) => dateOf(dayIndex(date) + days);
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** A wall-clock moment `{ date, minutes }` as absolute minutes, so two days compare. */
const absolute = ({ date, minutes }) => dayIndex(date) * MINUTES_PER_DAY + minutes;

/** The Europe/Paris wall clock of an instant: `{ date, minutes }`. */
function wallClock(instant) {
  const iso = toParisIso(instant) || '';
  return { date: iso.slice(0, 10), minutes: toMinutes(iso.slice(11, 16)) };
}

/** A stay's check-in and check-out, as wall-clock moments. */
function stayBounds(stay) {
  return {
    checkIn: { date: stay.startDate, minutes: toMinutes(stay.checkInTime || DEFAULT_CHECK_IN) },
    checkOut: { date: stay.endDate || stay.startDate, minutes: toMinutes(stay.checkOutTime || DEFAULT_CHECK_OUT) },
  };
}

const closedBy = (closures, date) => (closures || []).some((c) => String(c.startDate) <= date && date < String(c.endDate));

/** Rule 40 — the service ranges of a date, in minutes, sorted: closures, then the date's exception, then the week. */
function rangesOn(date, schedule) {
  if (closedBy(schedule.closures, date)) return [];
  const exception = (schedule.exceptions || []).find((e) => e.date === date);
  const ranges = exception ? (exception.closed ? [] : exception.ranges || []) : ((schedule.weekly || {})[weekdayOf(date)] || []);
  return ranges.map((r) => ({ from: toMinutes(r.from), to: toMinutes(r.to) })).sort((a, b) => a.from - b.from);
}

/** Whether the service is open at a wall-clock moment: a range holds it, its end excluded. */
function isOpenAt({ date, minutes }, schedule) {
  if (schedule.unconstrained) return true;
  return rangesOn(date, schedule).some((r) => r.from <= minutes && minutes < r.to);
}

/**
 * Rule 31 — `({ date, time }) → boolean`: whether someone is on site to light a cold resource at that moment,
 * the end of a range included (the one on duty lights it on leaving). The scheduler of `hourly-resources`
 * calls it with `start − heatUpMinutes`.
 */
function ignitionInHours(schedule) {
  if (schedule.unconstrained) return () => true;
  return ({ date, time }) => {
    const minutes = toMinutes(time);
    return rangesOn(date, schedule).some((r) => r.from <= minutes && minutes <= r.to);
  };
}

/** Rule 42 — the first moment the service is open from `from` on (itself when open), or null within the lookahead. */
function nextOpening(from, schedule) {
  for (let day = 0; day <= LOOKAHEAD_DAYS; day += 1) {
    const date = addDays(from.date, day);
    const ranges = rangesOn(date, schedule);
    const open = ranges.find((r) => (day > 0 ? true : r.to > from.minutes));
    if (open) return { date, minutes: day === 0 ? Math.max(open.from, from.minutes) : open.from };
  }
  return null;
}

/**
 * Rule 41 — the delivery times t, 30-min steps, with check-in ≤ t < check-out and [t − lead, t] after `now`
 * inside ONE service range. → wall-clock moments in time order. A delivery time has no capacity.
 */
function deliveryTimes({ now, stay, leadMinutes, schedule }) {
  const lead = Math.max(0, Number(leadMinutes) || 0);
  const { checkIn, checkOut } = stayBounds(stay);
  const earliest = Math.max(absolute(checkIn), absolute(now) + lead);
  const latest = absolute(checkOut);
  if (schedule.unconstrained) {
    const list = [];
    for (let t = Math.ceil(earliest / STEP_MINUTES) * STEP_MINUTES; t < latest; t += STEP_MINUTES) {
      const day = Math.floor(t / MINUTES_PER_DAY);
      list.push({ date: dateOf(day), minutes: t - day * MINUTES_PER_DAY });
    }
    return list;
  }
  const times = new Map();
  const first = dayIndex(now.date) > dayIndex(checkIn.date) ? now.date : checkIn.date;
  for (let date = first; dayIndex(date) <= dayIndex(checkOut.date); date = addDays(date, 1)) {
    const base = dayIndex(date) * MINUTES_PER_DAY;
    rangesOn(date, schedule).forEach((range) => {
      const opensAt = Math.max(base + range.from + lead, earliest);
      for (let t = Math.ceil(opensAt / STEP_MINUTES) * STEP_MINUTES; t <= base + range.to && t < latest; t += STEP_MINUTES) {
        times.set(t, { date, minutes: t - base });
      }
    });
  }
  return [...times.keys()].sort((a, b) => a - b).map((t) => times.get(t));
}

const instantOf = ({ date, minutes }) => toParisIso(wallClockToDate(date, toTime(minutes)));

function dayLabel(date, today, L) {
  if (date === today) return L.today;
  if (date === addDays(today, 1)) return L.tomorrow;
  return new Intl.DateTimeFormat(L.locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00Z`));
}

/**
 * Rules 41-42 — the delivery picker, ready to render: the times grouped by day with their labels, and
 * « Dès que possible » on the first one while the service is open now (else the picker starts at the next
 * opening, and the shop's banner says so).
 */
function deliveryPicker({ now, stay, leadMinutes, schedule, lang }) {
  const L = LABELS[lang] || LABELS.fr;
  const at = wallClock(now);
  const times = deliveryTimes({ now: at, stay, leadMinutes, schedule });
  const days = [];
  times.forEach((t) => {
    if (!days.length || days[days.length - 1].date !== t.date) days.push({ date: t.date, label: dayLabel(t.date, at.date, L), slots: [] });
    days[days.length - 1].slots.push({ at: instantOf(t), label: L.time(t.minutes) });
  });
  const asap = times.length && isOpenAt(at, schedule) ? { at: instantOf(times[0]), label: L.asap(L.time(times[0].minutes)) } : null;
  return { asap, days };
}

/**
 * Rule 42 — the shop's `service`: open now or not, and when closed the next opening before the check-out with
 * the banner « Le service reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard ».
 */
function serviceState({ now, stay, schedule, lang }) {
  const L = LABELS[lang] || LABELS.fr;
  const at = wallClock(now);
  if (isOpenAt(at, schedule)) return { openNow: true };
  const next = nextOpening(at, schedule);
  if (!next || absolute(next) >= absolute(stayBounds(stay).checkOut)) return { openNow: false, bannerLabel: L.closedUntilDeparture };
  const when = next.date === at.date ? '' : (next.date === addDays(at.date, 1) ? L.resumesTomorrow : dayLabel(next.date, at.date, L));
  return { openNow: false, nextOpening: instantOf(next), bannerLabel: L.resumes(when, L.time(next.minutes)) };
}

module.exports = {
  deliveryPicker, deliveryTimes, ignitionInHours, nextOpening, rangesOn, serviceState, wallClock,
};
