// specs/pricing-components.md §3 rule 94 reading (stabilisation loop t16, VS16-2, 2026-11-17) — `storedCustomIdsByKey`: the row ids a save
// wrote, answered by the fiche's re-read, keyed by the `customKey` each free line was sent under; any doubt answers null (rule 19 then).
import { storedCustomIdsByKey } from '../bookingFormHydration';

const sent = [{ customKey: '41', description: 'Bois' }, { customKey: 'custom_9', description: 'Bois' }, { customKey: 'custom_10', description: ' Pain  frais ' }];
const row = (customOptionId, title) => ({ isCustom: 1, customOptionId, title });

test('one stored row per sent line, in order: the numbered label of a repeat and spacing/case differences included', () => {
  const ids = storedCustomIdsByKey(sent, [{ optionId: 3 }, row(71, 'Bois'), row(72, 'Bois (2)'), row(73, 'pain frais')]);
  expect([...ids]).toEqual([['41', 71], ['custom_9', 72], ['custom_10', 73]]);
});

test('a different count (a line sold meanwhile), another label or a row without id answers null', () => {
  expect(storedCustomIdsByKey(sent, [row(71, 'Bois'), row(72, 'Bois (2)')])).toBeNull();
  expect(storedCustomIdsByKey(sent, [row(71, 'Bois'), row(72, 'Bûches'), row(73, 'Pain frais')])).toBeNull();
  expect(storedCustomIdsByKey(sent, [row(71, 'Bois'), row(null, 'Bois (2)'), row(73, 'Pain frais')])).toBeNull();
  expect(storedCustomIdsByKey([], [])).toBeNull();
});
