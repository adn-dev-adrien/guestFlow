// specs/inte-performance.md rule 9 — one shared « count + word » helper instead of three copies.
import { plural } from '../formatters';

test('rule 9: an « s » from two, none for zero or one', () => {
  expect(plural(0, 'texte')).toBe('0 texte');
  expect(plural(1, 'texte')).toBe('1 texte');
  expect(plural(2, 'texte')).toBe('2 textes');
});
