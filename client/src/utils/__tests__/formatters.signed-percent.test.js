// specs/reservation-payment-ledger.md rule 62 — « +28 % » / « −31 % », whole and signed.
import { formatSignedPercent } from '../formatters';

test('signs a whole percentage with a plus or the typographic minus', () => {
  expect(formatSignedPercent(28)).toBe('+28 %');
  expect(formatSignedPercent(-31.2)).toBe('−31 %');
  expect(formatSignedPercent(25.1)).toBe('+25 %');
});

test('zero has no sign, and a non-number reads as a dash', () => {
  expect(formatSignedPercent(0)).toBe('0 %');
  expect(formatSignedPercent(null)).toBe('—');
  expect(formatSignedPercent('abc')).toBe('—');
});
