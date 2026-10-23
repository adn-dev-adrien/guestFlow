// Display helpers of the bank reconciliation (specs/qonto-bank-reconciliation.md §6). Every amount,
// state and wording comes from the server; this only formats cents for the eye.
import { formatCurrency } from '../sdk';

export const money = (cents) => formatCurrency(Number(cents) / 100);

export const CONFIDENCE_STATUS = { sur: 'success', probable: 'info', verifier: 'warning' };

/** « 460,00 » or « 460.5 » → cents, or null when it is not a plain amount (comma or dot, 2 decimals max). */
export function parseEuroInput(text) {
  const v = String(text ?? '').replace(/[\s€]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [int, dec = ''] = v.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

/** « 12345 » cents → « 123,45 », the value an amount field starts with. */
export const centsToInput = (cents) => {
  const n = Math.max(0, Math.round(Number(cents) || 0));
  return `${Math.floor(n / 100)},${String(n % 100).padStart(2, '0')}`;
};

export const lastReadLabel = (iso) => {
  if (!iso) return 'Compte pas encore lu';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Compte pas encore lu';
  const pad = (n) => String(n).padStart(2, '0');
  return `Lu le ${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const readFailureLabel = (lastError) => {
  if (!lastError) return null;
  const d = new Date(lastError.at);
  const pad = (n) => String(n).padStart(2, '0');
  const when = Number.isNaN(d.getTime()) ? '' : ` le ${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `Lecture du compte impossible${when} · ${lastError.message}`;
};
