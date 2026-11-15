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

export const centsToEuros = (cents) => String(Number(cents) / 100).replace('.', ',');
