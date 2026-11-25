// Presentation of a voucher's figures: the server hands over whole cents, the screens read euros.
import { displayDate, formatCurrency } from '../sdk';

export const formatCents = (cents) => formatCurrency(Number(cents) / 100);

export const formatDay = (iso) => displayDate(iso);

// What an operator types in an « € » field → whole cents, or null when it is not an amount.
export function eurosToCents(text) {
  const clean = String(text).trim().replace(/\s/g, '').replace(',', '.').replace('−', '-');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

// UX hint only, shown while typing: the server judges the rate again on save and its sentence wins.
export function vatRateHint(text, T) {
  const raw = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (raw === '') return T.empty;
  if (!/^\d+(\.\d+)?$/.test(raw)) return T.notNumber;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return T.decimals;
  return Number(raw) > 100 ? T.range : null;
}

export const centsToEuros = (cents) => String(Number(cents) / 100).replace('.', ',');

// « 45 min », « 1 h », « 1 h 30 » — a duration the way the shop says it (the server's steps are minutes).
export function formatMinutes(minutes) {
  const m = Number(minutes);
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
