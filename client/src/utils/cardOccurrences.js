/**
 * Option-driven planning card occurrences (specs/option-planning-card.md §3.2 + §3.4).
 *
 * A card-option's billed quantity and its planning cards are both driven by the per-reservation
 * SELECTED occurrences. The reservation form keeps the FULL candidate grid as working state —
 * one entry per (stay day × time slot) — each carrying a `checked` flag + an editable `time` +
 * a `slot` handle. Only the CHECKED ones are sent to the server (stripped to `{ date, time }`,
 * what it stores and renders). Keeping the unchecked candidates in form state makes the checklist,
 * the reconcile-on-date-change, and the edit-load reload all unambiguous.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Every card-option repeats across the stay days (decision 2026-06-17): « une fois par jour »
// (`once_per_day`, one slot) or « plusieurs fois par jour » (`multiple_per_day`, N slots). The legacy
// 'daily' value is treated the same. (There is no single fixed-date mode anymore.)
export function isDailyCard(option) {
  return option?.cardRepeat === 'once_per_day'
    || option?.cardRepeat === 'multiple_per_day'
    || option?.cardRepeat === 'daily';
}

// The configured time slots for a daily card-option (≥1; an empty config → one untimed slot/day).
export function dailySlots(option) {
  const times = Array.isArray(option?.planningCardTimes) ? option.planningCardTimes.filter((t) => t != null) : [];
  return times.length > 0 ? times : [''];
}

// Enumerate the stay days startDate..endDate INCLUSIVE (the candidate days, §3.2/§3.3 decision).
export function enumerateStayDates(startDate, endDate) {
  if (!ISO_DATE_RE.test(String(startDate || '')) || !ISO_DATE_RE.test(String(endDate || ''))) return [];
  // UTC-based math so the day never shifts under a local timezone (toISOString on a local-parsed
  // midnight would roll to the previous day in UTC+ zones).
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
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

export function occKey(date, slot) {
  return `${date}#${slot}`;
}

// Is the guest present at (date, time) given the stay window + check-in/out times? Only the boundary
// days are constrained: on the arrival day a slot before `checkInTime` is excluded; on the departure
// day a slot after `checkOutTime` is excluded; middle days are always present. An untimed slot or
// absent check times → present (no constraint). `HH:MM` strings compare lexicographically.
export function isPresent(date, time, startDate, endDate, checkInTime, checkOutTime) {
  const t = String(time || '');
  if (!t) return true;
  if (date === startDate && checkInTime && t < String(checkInTime)) return false;
  if (date === endDate && checkOutTime && t > String(checkOutTime)) return false;
  return true;
}

// Subtract `mins` minutes from an `HH:MM` string, clamped at 00:00. Used for the breakfast
// departure-morning rule below. Returns the input unchanged when it isn't a valid time.
export function subtractMinutes(hhmm, mins) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const total = Math.max(0, (Number(m[1]) * 60) + Number(m[2]) - Number(mins || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Seed time for a (date, slot-time) candidate when first enabling / reconciling a daily card-option.
// Standard rule: keep it only if the guest is present (boundary days filtered by check-in/out).
// EXCEPTION — breakfast (`autoOptionType === 'breakfast'`): it is still served the DEPARTURE morning
// even when the option's time falls after check-out (e.g. breakfast 09:00, check-out 08:00). In that
// case the occurrence is kept but retimed to 30 min before the scheduled departure, so a short stay
// whose check-out precedes breakfast still bills it (specs/option-planning-card.md §3.2). Returns the
// time string to seed, or null to exclude the candidate.
export function seedTime(option, date, time, startDate, endDate, checkInTime, checkOutTime) {
  const t = String(time || '');
  if (option?.autoOptionType === 'breakfast' && date === endDate && checkOutTime && t && t > String(checkOutTime)) {
    return subtractMinutes(checkOutTime, 30);
  }
  return isPresent(date, t, startDate, endDate, checkInTime, checkOutTime) ? t : null;
}

// 'once' single occurrence: the option default date (else stay start) + its first slot time.
function onceEntry(option, startDate, checked) {
  const date = (option?.planningCardDate && ISO_DATE_RE.test(option.planningCardDate))
    ? option.planningCardDate
    : (ISO_DATE_RE.test(String(startDate || '')) ? startDate : '');
  return { date, time: dailySlots(option)[0] || '', slot: 0, checked, done: false };
}

// Build the full candidate grid, every candidate CHECKED (first enable — §3.2 "all checked by
// default"). Boundary-day slots outside the guest's presence (check-in/out) are excluded (§ presence).
export function buildInitialGrid(option, startDate, endDate, checkInTime, checkOutTime) {
  if (!isDailyCard(option)) {
    const e = onceEntry(option, startDate, true);
    return e.date ? [e] : [];
  }
  const slots = dailySlots(option);
  const days = enumerateStayDates(startDate, endDate);
  const out = [];
  for (const date of days) {
    slots.forEach((time, slot) => {
      const eff = seedTime(option, date, time, startDate, endDate, checkInTime, checkOutTime);
      if (eff == null) return;
      out.push({ date, time: eff, slot, checked: true, done: false });
    });
  }
  // Safety net: a manual enable must NEVER yield an empty grid when the stay has days. The breakfast
  // departure-morning rule (seedTime) already covers the common short-stay case; this catches any other
  // daily option whose every slot falls outside the guest's presence window — otherwise the server
  // returns no line for 0 occurrences and the next recompute drops it (the toggle bounces back off).
  // Seed all days unfiltered so the operator can take the option and adjust the days.
  if (out.length === 0 && days.length > 0) {
    for (const date of days) {
      slots.forEach((time, slot) => out.push({ date, time: time || '', slot, checked: true, done: false }));
    }
  }
  return out;
}

// Build the grid from a stored selection (edit-load): candidates CHECKED iff matched in `stored`
// ({ date, time }[]). Daily matches a stored time to its slot by default-time, falling back to the
// next free slot for an edited time. Unmatched grid candidates stay UNCHECKED (the saved choice).
export function buildGridFromStored(option, startDate, endDate, stored, checkInTime, checkOutTime) {
  const list = (Array.isArray(stored) ? stored : []).filter((o) => ISO_DATE_RE.test(String(o?.date || '')));
  if (!isDailyCard(option)) {
    const base = onceEntry(option, startDate, false);
    if (!base.date) return [];
    if (list.length > 0) return [{ date: list[0].date, time: String(list[0].time || ''), slot: 0, checked: true, done: Boolean(list[0].done) }];
    return [base];
  }
  const slots = dailySlots(option);
  // Map stored occurrences → (date, slot) with edited-time tolerance.
  const checkedByKey = new Map();
  const byDate = new Map();
  for (const o of list) {
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date).push({ time: String(o.time || ''), done: Boolean(o.done) });
  }
  for (const [date, entries] of byDate.entries()) {
    const used = new Set();
    for (const entry of entries) {
      let slot = slots.findIndex((t, i) => (t || '') === entry.time && !used.has(i));
      if (slot < 0) slot = slots.findIndex((_t, i) => !used.has(i));
      if (slot < 0) slot = used.size;
      used.add(slot);
      checkedByKey.set(occKey(date, slot), entry);
    }
  }
  const out = [];
  const days = enumerateStayDates(startDate, endDate);
  // Union the stay days with any stored-occurrence days that fell outside the current range, so a
  // later date change can't silently drop a saved (billed) occurrence.
  const allDates = Array.from(new Set([...days, ...list.map((o) => o.date)])).sort();
  for (const date of allDates) {
    slots.forEach((time, slot) => {
      const k = occKey(date, slot);
      const matched = checkedByKey.get(k);
      const effectiveTime = matched ? matched.time : (time || '');
      // Skip a candidate the guest can't attend (boundary day, outside check-in/out) — unless it was
      // explicitly stored (a saved/billed occurrence is never silently dropped).
      if (!matched && !isPresent(date, effectiveTime, startDate, endDate, checkInTime, checkOutTime)) return;
      out.push({
        date, slot,
        time: effectiveTime,
        checked: matched != null,
        done: matched ? Boolean(matched.done) : false,
      });
    });
  }
  return out;
}

// Reconcile an existing grid with new stay dates (§3.4 "recompute when dates change"): preserve the
// checked/time state of surviving (date, slot) candidates, drop out-of-range days, add brand-new
// in-range days × slots PRE-CHECKED. Returns the SAME reference when nothing changed.
export function reconcileGrid(option, startDate, endDate, current, checkInTime, checkOutTime) {
  if (!isDailyCard(option)) {
    // Once: keep the single entry; just clamp a missing date to the new stay start.
    const cur = (current || [])[0];
    if (cur && cur.date) return current;
    const e = onceEntry(option, startDate, true);
    return e.date ? [e] : (current || []);
  }
  const cur = current || [];
  const days = enumerateStayDates(startDate, endDate);
  const byKey = new Map(cur.map((o) => [occKey(o.date, o.slot ?? 0), o]));
  // Slot → effective time: the per-reservation edited time (from the current grid) wins over the
  // option default, so presence on the boundary days follows what the operator actually set.
  const slotTime = new Map();
  for (const o of cur) { const s = o.slot ?? 0; if (!slotTime.has(s)) slotTime.set(s, o.time || ''); }
  dailySlots(option).forEach((t, s) => { if (!slotTime.has(s)) slotTime.set(s, t || ''); });
  const slotsSorted = [...slotTime.keys()].sort((a, b) => a - b);
  // Adding a slot to an existing day inherits that day's checked state; a brand-new day → checked.
  const dayHasAny = (date) => cur.some((o) => o.date === date);
  const dayChecked = (date) => cur.some((o) => o.date === date && o.checked);
  const next = [];
  for (const date of days) {
    for (const slot of slotsSorted) {
      const time = slotTime.get(slot) || '';
      const eff = seedTime(option, date, time, startDate, endDate, checkInTime, checkOutTime);
      if (eff == null) continue;
      const existing = byKey.get(occKey(date, slot));
      next.push(existing || { date, time: eff, slot, checked: dayHasAny(date) ? dayChecked(date) : true, done: false });
    }
  }
  if (next.length === cur.length
      && next.every((o, i) => cur[i] && cur[i].date === o.date && cur[i].slot === o.slot
        && cur[i].time === o.time && cur[i].checked === o.checked && Boolean(cur[i].done) === Boolean(o.done))) {
    return current;
  }
  return next;
}

// The CHECKED occurrences stripped for the wire/signature ({ date, time } only — what the server
// stores). This is the set that drives billedUnits + the planning cards.
export function toWireOccurrences(grid) {
  return (Array.isArray(grid) ? grid : [])
    .filter((o) => o && o.checked && ISO_DATE_RE.test(String(o.date || '')))
    // `done` (planning « préparé » flag, §3.5) round-trips so a reservation re-save preserves it.
    .map((o) => ({ date: o.date, time: String(o.time || ''), done: Boolean(o.done) }));
}

// Count of selected occurrences (checked candidates).
export function selectedCount(grid) {
  return (Array.isArray(grid) ? grid : []).filter((o) => o && o.checked && ISO_DATE_RE.test(String(o.date || ''))).length;
}
