// specs/pricing-components.md §3 rule 85 — the fiche edits an article's FIRST line; the lines sold after it (flagged `laterLine` by the server) are
// carried as they are, each naming its own stored line, and never reach the form's option state, the offered set or the frozen unit prices.
import {
  hydrateSelectedOptions, hydrateSelectedResources, hydrateLaterLines, hydrateOfferedOptionIds, frozenUnitPrices,
} from '../bookingFormHydration';

const options = [
  { lineId: 1, optionId: 7, quantity: 1, unitPrice: 6.5, totalPrice: 6.5, offered: 0, inComplement: 0, laterLine: false },
  { lineId: 2, optionId: 7, quantity: 2, unitPrice: 7, totalPrice: 14, offered: 1, inComplement: 1, laterLine: true },
  { lineId: 3, optionId: 8, quantity: 1, unitPrice: 25, totalPrice: 25, offered: 0, laterLine: false },
  { title: 'Texte libre', isCustom: true, customOptionId: 4, laterLine: false },
];
const resources = [
  { lineId: 5, resourceId: 3, quantity: 1, unitPrice: 40, totalPrice: 40, sessions: '[]', laterLine: false },
  { lineId: 6, resourceId: 3, quantity: 1, unitPrice: 40, totalPrice: 40, sessions: [{ date: '2030-01-02', start: '20:00', end: '21:00' }], laterLine: true },
];

test('the form keeps one option per article: its first line', () => {
  const selected = hydrateSelectedOptions(options, { startDate: '2030-01-01', endDate: '2030-01-04' }, [], undefined);
  expect(selected.map((o) => [o.optionId, o.quantity])).toEqual([[7, 1], [8, 1]]);
  expect(hydrateSelectedResources(resources).map((r) => r.resourceId)).toEqual([3]);
});

test('a later line rides as a wire line that names its stored line and its own offered flag', () => {
  const later = hydrateLaterLines(options, resources);
  expect(later.laterOptions).toEqual([{ lineId: 2, optionId: 7, quantity: 2, offered: true, inComplement: 1 }]);
  expect(later.laterResources).toEqual([expect.objectContaining({ lineId: 6, resourceId: 3, quantity: 1, offered: false, sessions: [{ date: '2030-01-02', start: '20:00', end: '21:00' }] })]);
});

test('an offered later line does not offer the article’s first line, and does not set its frozen unit price', () => {
  expect([...hydrateOfferedOptionIds(options)]).toEqual([]);
  expect(frozenUnitPrices(options.filter((o) => !o.isCustom), 'optionId')).toEqual({ 7: 6.5, 8: 25 });
});

test('a stay with one line per article gives no later line at all', () => {
  expect(hydrateLaterLines([{ lineId: 1, optionId: 7, quantity: 1, laterLine: false }], [{ lineId: 2, resourceId: 3, laterLine: false }])).toEqual({ laterOptions: [], laterResources: [] });
});
