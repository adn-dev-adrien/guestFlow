// specs/reservation-price-arithmetic.md rules 8-9 — an amount copied off a platform statement
// carries a currency symbol and thousands separators. It used to be unreadable, and rule 4 then
// silently reverted the field to its last committed value: on a fresh reservation that value is
// empty, so pasting « 1 197,00 € » into « Total séjour facturé par la plateforme » simply erased
// what the operator had just pasted, with no message (reported on production 2026-09-25).
import { evaluateArithmetic, normalizeMoneyInput } from '../arithmetic';

const NBSP = ' ';         // what a copy-paste from a French page actually carries
const NARROW_NBSP = ' ';  // and what Intl.NumberFormat('fr-FR') emits since ICU 63

test('rule 8 — the euro sign is decoration, not an unreadable character', () => {
  expect(evaluateArithmetic('460,48 €')).toBe(460.48);
  expect(evaluateArithmetic('460,48€')).toBe(460.48);
  expect(evaluateArithmetic('€ 460,48')).toBe(460.48);
  expect(evaluateArithmetic('460,48 EUR')).toBe(460.48);
});

test('rule 8 — a currency symbol alone is still nothing to commit', () => {
  expect(evaluateArithmetic('€')).toBeNull();
  expect(evaluateArithmetic('  ')).toBeNull();
});

test('rule 9 — a space between thousands is a separator, whatever space it is', () => {
  expect(evaluateArithmetic('1 197,00')).toBe(1197);
  expect(evaluateArithmetic(`1${NBSP}197,00`)).toBe(1197);
  expect(evaluateArithmetic(`1${NARROW_NBSP}197,00`)).toBe(1197);
  expect(evaluateArithmetic('10 000')).toBe(10000);
  expect(evaluateArithmetic('1 234 567,89')).toBe(1234567.89);
});

test('rule 9 — a dot groups thousands only when it cannot be the decimal mark', () => {
  expect(evaluateArithmetic('1.197,00')).toBe(1197);
  expect(evaluateArithmetic('1.234.567')).toBe(1234567);
  // Ambiguous on its own → still the decimal point it has always been.
  expect(evaluateArithmetic('300.50')).toBe(300.5);
  expect(evaluateArithmetic('1.234')).toBe(1.234);
  // …and an expression of three-decimal numbers stays an expression, not one big integer.
  expect(evaluateArithmetic('1.234+5.678')).toBe(6.912);
});

test('rules 8-9 — a statement amount still composes with the arithmetic (rule 1)', () => {
  expect(evaluateArithmetic('1 197,00 € + 50')).toBe(1247);
  expect(evaluateArithmetic('1 197,00 € - 35,91 €')).toBe(1161.09);
  expect(evaluateArithmetic('100 + 2 * (3 + 7)')).toBe(120);
});

test('rules 8-9 — what is genuinely unreadable stays unreadable (rule 4)', () => {
  expect(evaluateArithmetic('abc')).toBeNull();
  expect(evaluateArithmetic('100+')).toBeNull();
  expect(evaluateArithmetic('(100')).toBeNull();
  expect(evaluateArithmetic('100 %')).toBeNull();
});

test('rules 8-9 — normalizeMoneyInput is a pure text pass, never a parser', () => {
  expect(normalizeMoneyInput(`1${NBSP}197,00 €`)).toBe('1197,00');
  expect(normalizeMoneyInput('100 + 20')).toBe('100 + 20');
  expect(normalizeMoneyInput(null)).toBe('');
});
