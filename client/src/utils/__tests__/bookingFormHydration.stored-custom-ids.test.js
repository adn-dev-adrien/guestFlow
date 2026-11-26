// specs/pricing/pricing-components.md §3 rule 94 reading (stabilisation loop t16, VS16-2, 2026-11-17) — `storedCustomIdsByKey`: the row ids a save
// wrote, answered by the fiche's re-read, keyed by the `customKey` each free line was sent under; any doubt answers null (rule 19 then).
import { storedCustomIdsByKey, adoptStoredCustomLines } from '../bookingFormHydration';

const sent = [{ customKey: '41', description: 'Bois' }, { customKey: 'custom_9', description: 'Bois' }, { customKey: 'custom_10', description: ' Pain  frais ' }];
const row = (customOptionId, title) => ({ isCustom: 1, customOptionId, title });

test('one stored row per sent line, in order: the numbered label of a repeat and spacing/case differences included', () => {
  const ids = storedCustomIdsByKey(sent, [{ optionId: 3 }, row(71, 'Bois'), row(72, 'Bois (2)'), row(73, 'pain frais')]);
  expect([...ids].map(([key, r]) => [key, r.customOptionId, r.title])).toEqual([['41', 71, 'Bois'], ['custom_9', 72, 'Bois (2)'], ['custom_10', 73, 'pain frais']]);
});

test('a different count (a line sold meanwhile), another label or a row without id answers null', () => {
  expect(storedCustomIdsByKey(sent, [row(71, 'Bois'), row(72, 'Bois (2)')])).toBeNull();
  expect(storedCustomIdsByKey(sent, [row(71, 'Bois'), row(72, 'Bûches'), row(73, 'Pain frais')])).toBeNull();
  expect(storedCustomIdsByKey(sent, [row(71, 'Bois'), row(null, 'Bois (2)'), row(73, 'Pain frais')])).toBeNull();
  expect(storedCustomIdsByKey([], [])).toBeNull();
});

// VS16-3 — the line takes its row id and, its text unchanged since the send, the stored label (« Bois (2) »); a text changed since is kept.
test('adoptStoredCustomLines: id + stored label when the text is the one sent; id only when it changed; null when nothing answers', () => {
  const lines = [{ customKey: '41', customOptionId: 41, description: 'Bois', amount: 15 }, { customKey: 'custom_9', description: 'Bois ', amount: 10 }, { customKey: 'custom_10', description: 'Pain complet', amount: 4 }];
  const rows = [row(71, 'Bois'), row(72, 'Bois (2)'), row(73, 'Pain frais')];
  expect(adoptStoredCustomLines(lines, sent, rows)).toEqual([
    { customKey: '41', customOptionId: 71, description: 'Bois', amount: 15 },
    { customKey: 'custom_9', customOptionId: 72, description: 'Bois (2)', amount: 10 },
    { customKey: 'custom_10', customOptionId: 73, description: 'Pain complet', amount: 4 },
  ]);
  expect(adoptStoredCustomLines(lines, sent, rows.slice(0, 2))).toBeNull();
});
