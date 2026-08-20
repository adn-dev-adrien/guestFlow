// specs/option-categories.md §3 rules 1-3, 9 — pure grouping/ordering of the option catalogue.

const test = require('node:test');
const assert = require('node:assert');

const { normalizeCategory, groupOptionsByCategory, listCategories, isPinnedOption, pinCancellationInsurance } = require('../utils/optionGrouping');

const opt = (id, title, category = '') => ({ id, title, category });

test('normalizeCategory trims, collapses blanks to ungrouped, preserves case', () => {
  assert.equal(normalizeCategory('  Boissons  '), 'Boissons');
  assert.equal(normalizeCategory('   '), '');
  assert.equal(normalizeCategory(''), '');
  assert.equal(normalizeCategory(null), '');
  assert.equal(normalizeCategory(undefined), '');
  // Case is the operator's choice — we never normalise it away, only whitespace.
  assert.equal(normalizeCategory('boissons'), 'boissons');
});

test('uncategorised options come first, sorted by title', () => {
  const { ungrouped, groups } = groupOptionsByCategory([
    opt(1, 'Ménage'),
    opt(2, 'Arrivée anticipée'),
    opt(3, 'Linge de lit'),
  ]);
  assert.deepEqual(ungrouped.map((o) => o.title), ['Arrivée anticipée', 'Linge de lit', 'Ménage']);
  assert.deepEqual(groups, []);
});

test('groups are ordered by category with French collation, options by title inside', () => {
  const { ungrouped, groups } = groupOptionsByCategory([
    opt(1, 'Champagne - bouteille 75cl', 'Boissons'),
    opt(2, 'Planche S', 'Restauration'),
    opt(3, 'Balade nocturne', 'Animations'),
    opt(4, 'Blonde du Pilat 75cl', 'Boissons'),
    opt(5, 'Ménage'),
    opt(6, 'Animation-chasse aux œufs', 'Animations'),
  ]);
  assert.deepEqual(ungrouped.map((o) => o.title), ['Ménage']);
  assert.deepEqual(groups.map((g) => g.category), ['Animations', 'Boissons', 'Restauration']);
  assert.deepEqual(groups[0].options.map((o) => o.title), ['Animation-chasse aux œufs', 'Balade nocturne']);
  assert.deepEqual(groups[1].options.map((o) => o.title), ['Blonde du Pilat 75cl', 'Champagne - bouteille 75cl']);
});

test('accents and case do not break the category ordering', () => {
  // ASCII ordering would push « Éclairage » after « Fruits » (É = 0xC9 > F) and « boissons »
  // after every capitalised label. French collation keeps them where a reader expects them.
  const { groups } = groupOptionsByCategory([
    opt(1, 'a', 'Fruits'),
    opt(2, 'b', 'Éclairage'),
    opt(3, 'c', 'Animations'),
  ]);
  assert.deepEqual(groups.map((g) => g.category), ['Animations', 'Éclairage', 'Fruits']);
});

test('whitespace-only and padded labels normalise into the same group', () => {
  const { ungrouped, groups } = groupOptionsByCategory([
    opt(1, 'a', ' Boissons'),
    opt(2, 'b', 'Boissons '),
    opt(3, 'c', '   '),
  ]);
  assert.deepEqual(ungrouped.map((o) => o.id), [3]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, 'Boissons');
  assert.equal(groups[0].options.length, 2);
});

test('enabled options are split out of the remainder — the pinned/folded rule', () => {
  // specs/option-categories.md §3 rule 9: the pinned slice renders outside the collapse, so a
  // collapsed section can never hide a charge.
  const { groups } = groupOptionsByCategory([
    opt(1, 'Champagne', 'Boissons'),
    opt(2, 'Jus de pomme 1L', 'Boissons'),
    opt(3, 'Mad Max', 'Boissons'),
  ], [3, 1]);
  const boissons = groups[0];
  assert.deepEqual(boissons.pinned.map((o) => o.title), ['Champagne', 'Mad Max']);
  assert.deepEqual(boissons.foldable.map((o) => o.title), ['Jus de pomme 1L']);
  assert.equal(boissons.enabledCount, 2);
  // `options` stays the full ordered list so a caller that doesn't care about the split can use it.
  assert.equal(boissons.options.length, 3);
});

test('enabled ids are compared numerically — string ids from a form payload still match', () => {
  const { groups } = groupOptionsByCategory([opt(4, 'Champagne', 'Boissons')], ['4']);
  assert.equal(groups[0].enabledCount, 1);
  assert.equal(groups[0].foldable.length, 0);
});

test('no enabled ids → everything is foldable', () => {
  const { groups } = groupOptionsByCategory([opt(1, 'Champagne', 'Boissons')]);
  assert.equal(groups[0].enabledCount, 0);
  assert.equal(groups[0].foldable.length, 1);
});

test('an alwaysVisible option is pinned even when nothing is selected — rule 9bis', () => {
  // How « Petit déjeuner » keeps showing on every fiche now that it lives under « Restauration ».
  const pdj = { id: 9, title: 'Petit déjeuner', category: 'Restauration', alwaysVisible: 1 };
  const { groups } = groupOptionsByCategory([pdj, opt(10, 'Planche S', 'Restauration')]);
  assert.deepEqual(groups[0].pinned.map((o) => o.title), ['Petit déjeuner']);
  assert.deepEqual(groups[0].foldable.map((o) => o.title), ['Planche S']);
  // …but it does NOT count as selected: the header chip must stay at 0.
  assert.equal(groups[0].enabledCount, 0);
});

test('an alwaysVisible option that IS selected counts once, in both slices consistently', () => {
  const pdj = { id: 9, title: 'Petit déjeuner', category: 'Restauration', alwaysVisible: 1 };
  const { groups } = groupOptionsByCategory([pdj], [9]);
  assert.equal(groups[0].pinned.length, 1);
  assert.equal(groups[0].foldable.length, 0);
  assert.equal(groups[0].enabledCount, 1);
});

test('isPinnedOption is the single definition of the rule, reused by the fiche and the widget', () => {
  const enabled = new Set([2]);
  assert.equal(isPinnedOption({ id: 1, alwaysVisible: 1 }, enabled), true);
  assert.equal(isPinnedOption({ id: 2 }, enabled), true);
  assert.equal(isPinnedOption({ id: 3 }, enabled), false);
  assert.equal(isPinnedOption({ id: 3, alwaysVisible: 0 }, enabled), false);
  assert.equal(isPinnedOption({ id: 3 }, null), false);
});

test('empty and nullish inputs are safe', () => {
  assert.deepEqual(groupOptionsByCategory([]), { ungrouped: [], groups: [] });
  assert.deepEqual(groupOptionsByCategory(null), { ungrouped: [], groups: [] });
  assert.deepEqual(groupOptionsByCategory(undefined), { ungrouped: [], groups: [] });
});

test('listCategories returns the distinct labels in display order', () => {
  assert.deepEqual(listCategories([
    opt(1, 'a', 'Restauration'),
    opt(2, 'b', 'Boissons'),
    opt(3, 'c', 'Boissons'),
    opt(4, 'd', ''),
  ]), ['Boissons', 'Restauration']);
  assert.deepEqual(listCategories([]), []);
});

// specs/cancellation-insurance.md §3.4 rule 28 — the insurance is read after the stay's own
// conditions, so it leaves the alphabet and sits right after « Départ tardif ».

const lateCheckout = (id, category = '') => ({ id, title: 'Départ tardif', category, autoOptionType: 'late_check_out' });
const insurance = (id, category = '') => ({ id, title: 'Assurance annulation', category, isCancellationInsurance: 1 });

test('the cancellation insurance is pinned just after « Départ tardif »', () => {
  const { ungrouped } = groupOptionsByCategory([
    opt(1, 'Ménage'),
    insurance(2),
    opt(3, 'Arrivée anticipée'),
    lateCheckout(4),
    opt(5, 'Linge de lit'),
  ]);
  assert.deepEqual(ungrouped.map((o) => o.title), [
    'Arrivée anticipée', 'Départ tardif', 'Assurance annulation', 'Linge de lit', 'Ménage',
  ]);
});

test('with several « Départ tardif » rows the insurance lands after the last one', () => {
  // One late-checkout option per property scope is a normal catalogue — the insurance must not
  // wedge itself between two identical lines.
  const list = pinCancellationInsurance([
    opt(1, 'Arrivée anticipée'),
    insurance(2),
    lateCheckout(3),
    lateCheckout(4),
    opt(5, 'Ménage'),
  ]);
  assert.deepEqual(list.map((o) => o.id), [1, 3, 4, 2, 5]);
});

test('no « Départ tardif » in the block → the insurance keeps its alphabetical place', () => {
  const { ungrouped } = groupOptionsByCategory([
    opt(1, 'Ménage'),
    insurance(2),
    opt(3, 'Arrivée anticipée'),
  ]);
  assert.deepEqual(ungrouped.map((o) => o.title), ['Arrivée anticipée', 'Assurance annulation', 'Ménage']);
});

test('the pin never crosses a category boundary', () => {
  // « juste après Départ tardif » means nothing when the two live in different sections.
  const { ungrouped, groups } = groupOptionsByCategory([
    lateCheckout(1),
    insurance(2, 'Assurances'),
    opt(3, 'Assiette de charcuterie', 'Assurances'),
  ]);
  assert.deepEqual(ungrouped.map((o) => o.id), [1]);
  assert.deepEqual(groups[0].options.map((o) => o.title), ['Assiette de charcuterie', 'Assurance annulation']);
});

test('an insurance categorised WITH its late checkout is pinned inside that category', () => {
  const { groups } = groupOptionsByCategory([
    lateCheckout(1, 'Séjour'),
    insurance(2, 'Séjour'),
    opt(3, 'Zzz', 'Séjour'),
  ]);
  assert.deepEqual(groups[0].options.map((o) => o.id), [1, 2, 3]);
});

test('a catalogue without any insurance is returned untouched', () => {
  const list = [opt(1, 'a'), opt(2, 'b')];
  assert.deepEqual(pinCancellationInsurance(list).map((o) => o.id), [1, 2]);
  assert.deepEqual(pinCancellationInsurance([]), []);
});
