// specs/sas-arrival-total-server-side.md rules 4-7 — the arrival draft: intent only, one object for
// the preview and the commit.
import buildArrivalDraft from '../arrivalDraft';

test('rules 6-7 — linen by item, kept lines by row, each with its gesture; no amount anywhere', () => {
  const draft = buildArrivalDraft({
    activeKeys: ['intro', 'linenItems', 'cleaning', 'recap'],
    missingBed: { 1: 2, 3: 0 },
    keptLines: [{ customOptionId: 41, label: 'Ancien article' }],
    cleaningAdded: true,
    offered: new Set(['bed:1', 'kept:41', 'option:5', 'extraGuests:0', 'cleaning', 'dep:2']),
  });
  expect(draft.linenItems).toEqual([{ itemId: 1, qty: 2, offered: true }]);
  expect(draft.keptLines).toEqual([{ customOptionId: 41, offered: true }]);
  expect(draft.cleaningAdded).toBe(true);
  expect(draft.cleaningOffered).toBe(true);
  expect(draft.offeredExtras).toEqual([{ kind: 'option', id: 5 }, { kind: 'extraGuests', id: 0 }]);
  expect(JSON.stringify(draft)).not.toMatch(/amount|price|total/i);
});

test('rule 4 — a page that did not run leaves its field undefined (tri-state), the sales included', () => {
  const draft = buildArrivalDraft({ activeKeys: ['intro', 'recap'], cleaningAdded: true, bathLinenAdded: true });
  expect(draft.cleaningAdded).toBeUndefined();
  expect(draft.bathLinenAdded).toBeUndefined();
  expect(draft.soldOptions).toBeUndefined();
});

test('rule 4 — the sale steps send moments for a card option, units otherwise', () => {
  const draft = buildArrivalDraft({
    activeKeys: ['breakfastSale', 'cateringAsk', 'recap'],
    soldSelections: [
      { offer: { optionId: 6 }, occurrences: [{ date: '2026-07-11', time: '09:00' }], persons: 2, units: 2 },
      { offer: { optionId: 27 }, occurrences: null, persons: null, units: 1 },
    ],
  });
  expect(draft.soldOptions).toEqual([
    { optionId: 6, occurrences: [{ date: '2026-07-11', time: '09:00' }], persons: 2 },
    { optionId: 27, units: 1 },
  ]);
});
