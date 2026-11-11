/**
 * calendarVisuals — pure date / percentage / colour / label helpers for the reservation calendar.
 * No React, no side effects. Extracted verbatim from CalendarPage so the day-cell gradient math,
 * occupancy geometry and labels live in one testable place.
 */
import { alpha } from '@mui/material/styles';
import { getBlockedNightConflictInfo } from './reservationConflicts';

export const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
// The French abbreviations: cutting the full name gave « Nove. », « Octo. », and « Jui » for both June
// and July (2026-10-27 spec review).
export const MONTH_SHORT_NAMES = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

// Time window for the proportional day fill: 8h → 21h (13h range).
export const DAY_START = 8;
export const DAY_END = 21;
export const DAY_RANGE = DAY_END - DAY_START;

export const CLEANING_COLOR = '#e53935';
export const BLOCKED_NIGHT_COLOR = '#ff9800'; // Orange pour les nuits bloquées

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function shiftDate(dateStr, daysDelta) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + daysDelta);
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

export function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

export function hourToPercent(hour) {
  return Math.max(0, Math.min(100, ((hour - DAY_START) / DAY_RANGE) * 100));
}

// The closure texture: soft ink hatching (resolved from the theme — it is a CSS string, not an sx token).
export const closureHatch = (theme) => {
  const soft = alpha(theme.palette.text.primary, 0.05);
  const strong = alpha(theme.palette.text.primary, 0.13);
  return `repeating-linear-gradient(135deg, ${soft} 0 6px, ${strong} 6px 12px)`;
};

// A stay that is over: a 14 % tint of its platform colour, a 3 px stripe of it, ink text
// (specs/calendar-property-parity.md rule 8).
export const barTint = (color) => alpha(color, 0.14);

export function getBlockedNightInfo(dateStr, reservations) {
  const blockedNightInfo = getBlockedNightConflictInfo(dateStr, reservations);
  if (!blockedNightInfo) return null;

  if (blockedNightInfo.type === 'early-arrival') {
    return {
      ...blockedNightInfo,
      startPct: hourToPercent(17),
      endPct: 100,
      client: blockedNightInfo.reservation,
    };
  }

  if (blockedNightInfo.type === 'late-departure-evening') {
    return {
      ...blockedNightInfo,
      startPct: hourToPercent(timeToHour(blockedNightInfo.reservation?.checkOutTime || '10:00')),
      endPct: 100,
      client: blockedNightInfo.reservation,
    };
  }

  if (blockedNightInfo.type === 'late-departure-morning') {
    return {
      ...blockedNightInfo,
      startPct: 0,
      endPct: hourToPercent(10),
      client: blockedNightInfo.reservation,
    };
  }

  return null;
}

export function compactName(firstName, lastName) {
  const f = (firstName || '').charAt(0);
  const l = lastName || '';
  const full = f ? `${f}. ${l}` : l;
  return full.length > 8 ? full.slice(0, 7) + '…' : full;
}
