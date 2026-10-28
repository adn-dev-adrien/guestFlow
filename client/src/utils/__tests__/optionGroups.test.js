// specs/inte-performance.md rule 21 — the stay view names the options of a group by id; the client joins
// them back to the property's options.
import { expandOptionGroups } from '../optionGroups';

const OPTIONS = [{ id: 1, title: 'Linge', price: 7 }, { id: 2, title: 'Bain', price: 30 }];

test('rule 21: ids become the whole options, in the group order, an option may sit in several groups', () => {
  const groups = { ungrouped: [{ id: 2 }], groups: [{ category: 'A', pinned: true, options: [{ id: 2 }, { id: 1 }] }, { category: 'B', options: [{ id: 1 }] }] };
  const expanded = expandOptionGroups(groups, OPTIONS);
  expect(expanded.ungrouped).toEqual([OPTIONS[1]]);
  expect(expanded.groups[0]).toEqual({ category: 'A', pinned: true, options: [OPTIONS[1], OPTIONS[0]] });
  expect(expanded.groups[1].options).toEqual([OPTIONS[0]]);
});

test('rule 21: an unknown id is kept as it came, a missing structure stays missing', () => {
  expect(expandOptionGroups({ ungrouped: [{ id: 9 }], groups: [] }, OPTIONS).ungrouped).toEqual([{ id: 9 }]);
  expect(expandOptionGroups(null, OPTIONS)).toBeNull();
  expect(expandOptionGroups({ ungrouped: [], groups: [] }, undefined)).toEqual({ ungrouped: [], groups: [] });
});
