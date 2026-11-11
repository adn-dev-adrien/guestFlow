/**
 * calendarLayout — the pixel geometry shared by the two calendars (specs/calendar-property-parity.md
 * rules 9, 10, 18). Pure: turns the stays and closures of a month into week rows, lane-packed bars
 * and per-week segments. Nothing here is a business rule: which stays exist, their labels, colours and
 * past flag all come from `GET /api/calendar`.
 *
 * A stay and a closure share one geometry: from the middle of `startDate` to the middle of `endDate`
 * (the departure / reopening day), square at a week split.
 */
import { formatDate, shiftDate, getDaysInMonth } from './calendarVisuals';

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

export function mondayIndex(dateStr) {
  return (new Date(`${dateStr}T12:00:00`).getDay() + 6) % 7;
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function frDay(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return `${d} ${MONTHS_FR[(m || 1) - 1]}`;
}

/** « 5 juillet » or « 30 juin → 2 juillet ». */
export function frRange(start, end) {
  return start === end ? frDay(start) : `${frDay(start)} → ${frDay(end)}`;
}

/** The dates a closure keeps shut: from `startDate` to the last closed day (the day before it reopens). */
export function closedRange(item) {
  return frRange(item.startDate, shiftDate(item.endDate, -1));
}

/** One label per week for a closure. */
export function closureLabel(item) {
  return item.global ? 'Tout fermé' : `${item.propertyName || 'Logement'} fermé`;
}

const GLOBAL_GROUP_KEY = '';
const GLOBAL_LABEL = 'Tous les logements';

/**
 * The first and last day shown by the week rows of a month block: whole weeks, Monday to Sunday.
 * Edge days belong to the block (rule 16).
 */
export function monthGridRange(year, month) {
  const first = formatDate(year, month, 1);
  const from = shiftDate(first, -mondayIndex(first));
  const last = formatDate(year, month, getDaysInMonth(year, month));
  const to = shiftDate(last, 6 - mondayIndex(last));
  return { from, to };
}

/** The Monday of each week row of a month block. */
export function monthWeekStarts(year, month) {
  const { from, to } = monthGridRange(year, month);
  const starts = [];
  for (let day = from; day <= to; day = shiftDate(day, 7)) starts.push(day);
  return starts;
}

/**
 * Normalises the payload's stays and closures into one item list.
 * Item: { key, kind: 'reservation' | 'closure', groupKey, propertyName, startDate, endDate, label, ... }.
 * `groupKey` drives the per-logement lane grouping ('' = a closure of every logement).
 */
export function normalizeItems(stays, closures) {
  const items = [];
  for (const s of (Array.isArray(stays) ? stays : [])) {
    if (!s || !s.startDate || !s.endDate) continue;
    const propertyName = s.propertyName || '';
    items.push({
      key: `r${s.id}`, kind: 'reservation', reservationId: s.id,
      groupKey: propertyName || `#${s.propertyId}`, propertyName,
      startDate: s.startDate, endDate: s.endDate,
      platform: s.platform, platformDisplay: s.platformDisplay,
      color: s.color, textColor: s.textColor, past: Boolean(s.past),
      guestLabel: s.label,
      label: `${propertyName ? `${propertyName} · ` : ''}${s.label}`,
    });
  }
  for (const c of (Array.isArray(closures) ? closures : [])) {
    if (!c || !c.startDate || !c.endDate || c.endDate <= c.startDate) continue;
    const isGlobal = Boolean(c.global);
    items.push({
      key: `c${c.id}`, kind: 'closure', global: isGlobal,
      groupKey: isGlobal ? GLOBAL_GROUP_KEY : (c.propertyName || `#${c.propertyId}`),
      propertyName: isGlobal ? GLOBAL_LABEL : (c.propertyName || ''),
      startDate: c.startDate, endDate: c.endDate,
      label: c.label || 'Fermé',
    });
  }
  return items;
}

/**
 * The segment of every item that touches the week starting `weekStart`, with fractional column edges
 * (0..7): half a column in at a true start, half a column short at a true end, flush at a week split.
 */
export function weekSegments(weekStart, items) {
  const weekEnd = shiftDate(weekStart, 6);
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.startDate && it.endDate && it.endDate >= weekStart && it.startDate <= weekEnd)
    .map((it) => {
      const segStart = it.startDate > weekStart ? it.startDate : weekStart;
      const segEnd = it.endDate < weekEnd ? it.endDate : weekEnd;
      const startCol = Math.max(0, Math.min(6, daysBetween(weekStart, segStart)));
      const endCol = Math.max(0, Math.min(6, daysBetween(weekStart, segEnd)));
      const roundStart = segStart === it.startDate;
      const roundEnd = segEnd === it.endDate;
      return {
        item: it, startCol, endCol, roundStart, roundEnd,
        leftEdge: startCol + (roundStart ? 0.5 : 0),
        rightEdge: (endCol + 1) - (roundEnd ? 0.5 : 0),
      };
    })
    .filter((seg) => seg.rightEdge - seg.leftEdge > 0);
}

/**
 * Month grid + per-week bars, lane-packed and GROUPED BY LOGEMENT. A logement's stays and closures share
 * its lane group (rule 9): a stay ending the day a closure starts shares the lane, their half-day edges meet.
 * A closure of every logement is not a lane: it hatches whole day columns (`closedAll`) and gets one label.
 * Returns { weeks: [{ days, bars, laneCount, globalClosures }] }.
 */
export function buildMonthLayout(year, month, items, todayStr) {
  const list = Array.isArray(items) ? items.filter((it) => it && it.startDate && it.endDate) : [];
  const weeks = monthWeekStarts(year, month).map((weekStart) => {
    const weekEnd = shiftDate(weekStart, 6);
    const globalClosures = list
      .filter((it) => it.kind === 'closure' && it.global)
      .map((item) => {
        const first = item.startDate > weekStart ? item.startDate : weekStart;
        const lastClosedDay = shiftDate(item.endDate, -1);
        const last = lastClosedDay < weekEnd ? lastClosedDay : weekEnd;
        return first <= last ? { item, startCol: daysBetween(weekStart, first), endCol: daysBetween(weekStart, last) } : null;
      })
      .filter(Boolean);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(weekStart, i);
      return {
        date,
        inMonth: new Date(`${date}T12:00:00`).getMonth() === month,
        isToday: date === todayStr,
        closedAll: globalClosures.some(({ item }) => item.startDate <= date && date < item.endDate),
      };
    });

    const segments = weekSegments(weekStart, list.filter((it) => !(it.kind === 'closure' && it.global)));
    const groups = new Map();
    for (const seg of segments) {
      if (!groups.has(seg.item.groupKey)) groups.set(seg.item.groupKey, []);
      groups.get(seg.item.groupKey).push(seg);
    }
    let laneBase = 0;
    for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b, 'fr'))) {
      const segs = groups.get(key).sort((a, b) => (a.leftEdge - b.leftEdge)
        || (b.rightEdge - b.leftEdge) - (a.rightEdge - a.leftEdge)
        || String(a.item.key).localeCompare(String(b.item.key)));
      const laneEnds = [];
      for (const seg of segs) {
        // A same-day turnover (ends at X.5, starts at X.5) shares the lane.
        let local = laneEnds.findIndex((end) => end <= seg.leftEdge);
        if (local === -1) { local = laneEnds.length; laneEnds.push(seg.rightEdge); } else laneEnds[local] = seg.rightEdge;
        seg.lane = laneBase + local;
      }
      laneBase += laneEnds.length;
    }
    return { days, bars: segments, laneCount: laneBase, globalClosures };
  });
  return { weeks };
}

// Items overlapping a month, ordered by arrival date (the phone's stay agenda reads as a chronological
// timeline of check-ins). Logement + key only break ties between same-day arrivals for a stable order.
export function monthItems(year, month, items) {
  const mStart = formatDate(year, month, 1);
  const mEnd = formatDate(year, month, getDaysInMonth(year, month));
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.startDate && it.endDate && it.startDate <= mEnd && it.endDate >= mStart)
    .sort((a, b) => a.startDate.localeCompare(b.startDate)
      || a.groupKey.localeCompare(b.groupKey, 'fr')
      || String(a.key).localeCompare(String(b.key)));
}
