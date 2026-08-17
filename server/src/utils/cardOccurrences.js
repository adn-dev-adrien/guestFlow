/**
 * Card-option occurrences — server-side twin of `client/src/utils/cardOccurrences.js`.
 *
 * A card option (`options.showsPlanningCard = 1`) is billed by the MOMENTS it is served on, never by
 * a raw quantity: `quantity = number of occurrences`, `billedUnits = occurrences × persons`
 * (specs/option-planning-card.md §3.4). The reservation form owns that grid in the browser; the
 * arrival SAS now sells the same options (specs/sas-breakfast-and-catering-upsell.md), so the
 * candidate grid and its presence rules must exist server-side too — the wizard sends the chosen
 * moments and the server re-derives quantity, units and price (CLAUDE.md §6.0).
 *
 * Pure — no DB access. `option` is a catalogue row (`cardRepeat`, `planningCardTimes`,
 * `autoOptionType`, `breakfastTime`).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return ISO_DATE_RE.test(String(value || ''));
}

// Stay days startDate..endDate INCLUSIVE — the candidate days of a daily card. UTC math so the day
// never shifts under a local timezone.
function enumerateStayDates(startDate, endDate) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
  const [sy, sm, sd] = String(startDate).split('-').map(Number);
  const [ey, em, ed] = String(endDate).split('-').map(Number);
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  if (Number.isNaN(cur) || Number.isNaN(end) || cur > end) return [];
  const out = [];
  for (let i = 0; i < 366 && cur <= end; i += 1) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86400000;
  }
  return out;
}

function nightsBetween(startDate, endDate) {
  return Math.max(0, enumerateStayDates(startDate, endDate).length - 1);
}

// Every card option repeats across the stay days: « une fois par jour » (`once_per_day`) or
// « plusieurs fois par jour » (`multiple_per_day`). The legacy 'daily' value behaves the same.
function isDailyCard(option) {
  const repeat = String(option?.cardRepeat || '');
  return repeat === 'once_per_day' || repeat === 'multiple_per_day' || repeat === 'daily';
}

// The configured time slots of a card option (≥ 1; an empty config → one untimed slot per day).
// `planningCardTimes` comes decorated as an array by optionsModel, raw JSON straight from SQL.
function cardSlots(option) {
  let times = option?.planningCardTimes;
  if (typeof times === 'string') {
    try { times = JSON.parse(times || '[]'); } catch { times = []; }
  }
  const list = (Array.isArray(times) ? times : []).filter((t) => t != null);
  if (list.length > 0) return list.map((t) => String(t));
  const fallback = String(option?.breakfastTime || '').trim();
  return [fallback];
}

// Subtract `mins` minutes from an `HH:MM` string, clamped at 00:00.
function subtractMinutes(hhmm, mins) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const total = Math.max(0, (Number(m[1]) * 60) + Number(m[2]) - Number(mins || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Is the guest present at (date, time)? Only the boundary days are constrained: before check-in on
// the arrival day, after check-out on the departure day. An untimed slot is always present.
function isPresent(date, time, startDate, endDate, checkInTime, checkOutTime) {
  const t = String(time || '');
  if (!t) return true;
  if (date === startDate && checkInTime && t < String(checkInTime)) return false;
  if (date === endDate && checkOutTime && t > String(checkOutTime)) return false;
  return true;
}

// Effective time of a candidate, or null when the guest can't attend it. EXCEPTION — breakfast is
// still served the DEPARTURE morning even when its hour falls after check-out: the occurrence is
// kept, retimed to 30 min before departure (specs/option-planning-card.md §3.2).
function seedTime(option, date, time, startDate, endDate, checkInTime, checkOutTime) {
  const t = String(time || '');
  if (option?.autoOptionType === 'breakfast' && date === endDate && checkOutTime && t && t > String(checkOutTime)) {
    return subtractMinutes(checkOutTime, 30);
  }
  return isPresent(date, t, startDate, endDate, checkInTime, checkOutTime) ? t : null;
}

/**
 * The candidate moments of a card option over a stay: one entry per (stay day × slot) the guest can
 * attend. For the breakfast option this yields exactly the served mornings — the arrival morning is
 * out (the guest is not there yet at 09:00) and the departure morning is in — i.e. as many mornings
 * as the stay has nights, which is the control the SAS needs on « combien de matins ».
 *
 * @returns {Array<{date: string, time: string, slot: number}>}
 */
function buildCandidateGrid(option, { startDate, endDate, checkInTime, checkOutTime } = {}) {
  if (!isDailyCard(option)) {
    const date = isIsoDate(option?.planningCardDate) ? option.planningCardDate : startDate;
    if (!isIsoDate(date)) return [];
    return [{ date, time: cardSlots(option)[0] || '', slot: 0 }];
  }
  const slots = cardSlots(option);
  const out = [];
  for (const date of enumerateStayDates(startDate, endDate)) {
    slots.forEach((time, slot) => {
      const eff = seedTime(option, date, time, startDate, endDate, checkInTime, checkOutTime);
      if (eff == null) return;
      out.push({ date, time: eff, slot });
    });
  }
  return out;
}

/**
 * Sanitize occurrences coming from the wire or from storage into `[{ date, time }]`: valid ISO dates
 * only, no duplicate (date, time), chronological. `done` (the planning « préparé » flag) rides along
 * when present so a re-commit never loses it.
 */
function normalizeOccurrences(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list || '[]'); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const date = String(entry?.date || '').slice(0, 10);
    if (!isIsoDate(date)) continue;
    const time = String(entry?.time || '').trim();
    const key = `${date}#${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry?.done ? { date, time, done: true } : { date, time });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

module.exports = {
  isIsoDate,
  enumerateStayDates,
  nightsBetween,
  isDailyCard,
  cardSlots,
  subtractMinutes,
  isPresent,
  seedTime,
  buildCandidateGrid,
  normalizeOccurrences,
};
