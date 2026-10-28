// specs/options-resources-ux.md rules 2-7, 26 — the admin catalogue shaped for the screen: grouped in the
// fiche's reading order, priced per property, annotated with the traits that make an option special.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCatalogueView, buildArchivedItems } = require('../utils/optionCatalogueView');
const { archiveBlockedReason } = require('../utils/optionArchiveGuard');

const GRANJA = { id: 1, name: 'Granja' };
const ESTIVA = { id: 2, name: 'Estiva' };
const PROPS = [GRANJA, ESTIVA];

let nextId = 1;
const option = (over = {}) => ({
  id: nextId++, title: 'Option', description: '', priceType: 'per_stay', price: 10, category: '',
  propertyIds: [1, 2], propertyPrices: {}, propertyDefaults: {}, optionProgressiveTiers: [],
  displayToClient: 1, ...over,
});

const itemsOf = (view) => view.groups.flatMap((g) => g.items);
const find = (view, title) => itemsOf(view).find((i) => i.title === title);
const traitKeys = (item) => item.traits.map((t) => t.key);

test('rule 2: ungrouped options first under « Sans catégorie », then the categories in French collation', () => {
  const view = buildCatalogueView([
    option({ title: 'Vin', category: 'Boissons' }),
    option({ title: 'Ménage' }),
    option({ title: 'Bière', category: 'Éclairage' }),
    option({ title: 'Jus', category: 'boissons' }),
    option({ title: 'Anim', category: 'Animations' }),
  ], PROPS);
  assert.deepEqual(view.groups.map((g) => g.label), ['Sans catégorie', 'Animations', 'Boissons', 'boissons', 'Éclairage']);
  assert.equal(view.groups[0].key, 'none');
  assert.equal(view.groups[1].key, 'cat:Animations');
  assert.equal(view.groups[1].count, 1);
});

test('rule 2: options inside a group are sorted by title and the cancellation insurance is pinned after « Départ tardif »', () => {
  const view = buildCatalogueView([
    option({ title: 'Zeste' }),
    option({ title: 'Assurance annulation', isCancellationInsurance: 1 }),
    option({ title: 'Départ tardif', autoOptionType: 'late_check_out' }),
    option({ title: 'Brunch' }),
  ], PROPS);
  assert.deepEqual(view.groups[0].items.map((i) => i.title), ['Brunch', 'Départ tardif', 'Assurance annulation', 'Zeste']);
});

test('rule 2: an empty catalogue has no group, no chip, a zero total', () => {
  assert.deepEqual(buildCatalogueView([], PROPS), { total: 0, chips: [], groups: [] });
});

test('rule 3: one value when every applicable property shares the price, with its unit', () => {
  const view = buildCatalogueView([
    option({ title: 'A', priceType: 'per_stay', price: 25 }),
    option({ title: 'B', priceType: 'per_person', price: 4.5 }),
    option({ title: 'C', priceType: 'per_night', price: 8 }),
    option({ title: 'D', priceType: 'per_person_per_night', price: 3 }),
  ], PROPS);
  assert.deepEqual(find(view, 'A').price, { value: '25 €', unit: '/ séjour', note: '' });
  assert.deepEqual(find(view, 'B').price, { value: '4,50 €', unit: '/ pers.', note: '' });
  assert.equal(find(view, 'C').price.unit, '/ jour');
  assert.equal(find(view, 'D').price.unit, '/ pers. / jour');
});

test('rule 3: « min – max » and « selon logement » when the properties differ; an override at 0 counts', () => {
  const view = buildCatalogueView([
    option({ title: 'Ménage', price: 30, propertyPrices: { 2: 80 } }),
    option({ title: 'Offert à Granja', price: 30, propertyPrices: { 1: 0 } }),
  ], PROPS);
  assert.deepEqual(find(view, 'Ménage').price, { value: '30 € – 80 €', unit: '/ séjour', note: 'selon logement' });
  assert.equal(find(view, 'Offert à Granja').price.value, '0 € – 30 €');
});

test('rule 3: the base price is not displayed when every applicable property overrides it', () => {
  const view = buildCatalogueView([
    option({ title: 'Petit déjeuner', price: 8, priceType: 'per_person_per_night', propertyPrices: { 1: 10, 2: 10 } }),
  ], PROPS);
  assert.equal(find(view, 'Petit déjeuner').price.value, '10 €');
  assert.equal(find(view, 'Petit déjeuner').price.note, '');
});

test('rule 3: the base price is not displayed for an option nobody proposes', () => {
  const view = buildCatalogueView([option({ title: 'Orpheline', price: 8, propertyIds: [] })], PROPS);
  assert.equal(find(view, 'Orpheline').price.value, '—');
});

test('rule 3: free, percentage and progressive options each have their own wording', () => {
  const view = buildCatalogueView([
    option({ title: 'Gratuite', priceType: 'free', price: 0 }),
    option({ title: 'Assurance', priceType: 'percent_of_stay', price: 4.5, propertyPrices: { 2: 6 } }),
    option({ title: 'Dégressive', priceType: 'per_participant_progressive', optionProgressiveTiers: [
      { participantNumber: 1, unitPrice: 20 }, { participantNumber: 3, unitPrice: 5 },
    ] }),
    option({ title: 'Sans palier', priceType: 'per_participant_progressive' }),
  ], PROPS);
  assert.deepEqual(find(view, 'Gratuite').price, { value: 'Gratuit', unit: '', note: '' });
  assert.deepEqual(find(view, 'Assurance').price, { value: '4,5 % – 6 %', unit: 'du séjour', note: 'selon logement' });
  assert.deepEqual(find(view, 'Dégressive').price, { value: '5 € – 20 €', unit: '/ participant, dégressif', note: '' });
  assert.equal(find(view, 'Sans palier').price.value, '—');
});

test('rule 4: with a property, only its options are returned, priced for it', () => {
  const view = buildCatalogueView([
    option({ title: 'Partout', price: 30, propertyPrices: { 2: 80 } }),
    option({ title: 'Granja seule', propertyIds: [1] }),
    option({ title: 'Estiva seule', propertyIds: [2] }),
  ], PROPS, { propertyId: 2 });
  assert.deepEqual(itemsOf(view).map((i) => i.title), ['Estiva seule', 'Partout']);
  assert.equal(find(view, 'Partout').price.value, '80 €');
  assert.equal(find(view, 'Partout').price.note, '');
});

test('rule 7: the chips and the total describe the whole catalogue, not the property filter', () => {
  const options = [
    option({ title: 'Vin', category: 'Boissons', propertyIds: [1] }),
    option({ title: 'Jus', category: 'Boissons' }),
    option({ title: 'Ménage' }),
  ];
  const full = buildCatalogueView(options, PROPS);
  const filtered = buildCatalogueView(options, PROPS, { propertyId: 2 });
  assert.deepEqual(full.chips, [
    { key: 'none', label: 'Sans catégorie', count: 1 },
    { key: 'cat:Boissons', label: 'Boissons', count: 2 },
  ]);
  assert.deepEqual(filtered.chips, full.chips);
  assert.equal(filtered.total, 3);
  assert.equal(filtered.groups.find((g) => g.key === 'cat:Boissons').count, 1);
});

test('rule 5: no trait for an ordinary option', () => {
  const view = buildCatalogueView([option({ title: 'Ordinaire' })], PROPS);
  assert.deepEqual(find(view, 'Ordinaire').traits, []);
});

test('rule 5: scope — one or two names, then a count, « Aucun logement » when the scope is empty', () => {
  const three = [...PROPS, { id: 3, name: 'Tente' }, { id: 4, name: 'Mas' }];
  const view = buildCatalogueView([
    option({ title: 'Une', propertyIds: [1] }),
    option({ title: 'Deux', propertyIds: [1, 2] }),
    option({ title: 'Trois', propertyIds: [1, 2, 3] }),
    option({ title: 'Nulle part', propertyIds: [] }),
  ], three);
  assert.deepEqual(find(view, 'Une').traits, [{ key: 'scope', label: 'Granja seulement', tone: 'neutral' }]);
  assert.equal(find(view, 'Deux').traits[0].label, 'Granja et Estiva seulement');
  assert.equal(find(view, 'Trois').traits[0].label, '3 logements seulement');
  assert.deepEqual(find(view, 'Nulle part').traits, [{ key: 'scope', label: 'Aucun logement', tone: 'warning' }]);
});

test('rule 5: Offert and Inclus come from the per-property defaults; « tous les logements » when all are concerned', () => {
  const view = buildCatalogueView([
    option({ title: 'Linge', propertyDefaults: { 1: { offered: true }, 2: { offered: true } } }),
    option({ title: 'Tapis', propertyDefaults: { 1: { offered: true } } }),
    option({ title: 'Ménage', propertyDefaults: { 2: { offered: false } } }),
    option({ title: 'Mixte', propertyDefaults: { 1: { offered: true }, 2: { offered: false } } }),
  ], PROPS);
  assert.deepEqual(find(view, 'Linge').traits, [{ key: 'offered', label: 'Offert · tous les logements', tone: 'success' }]);
  assert.deepEqual(find(view, 'Tapis').traits, [{ key: 'offered', label: 'Offert · Granja', tone: 'success' }]);
  assert.deepEqual(find(view, 'Ménage').traits, [{ key: 'included', label: 'Inclus · Estiva', tone: 'info' }]);
  assert.deepEqual(traitKeys(find(view, 'Mixte')), ['offered', 'included']);
});

test('rule 5: Interne for an option hidden from the client, but not for a missing flag', () => {
  const view = buildCatalogueView([
    option({ title: 'Tapis de bain', displayToClient: 0 }),
    option({ title: 'Ancien', displayToClient: undefined }),
  ], PROPS);
  assert.deepEqual(find(view, 'Tapis de bain').traits, [{ key: 'internal', label: 'Interne', tone: 'neutral' }]);
  assert.deepEqual(find(view, 'Ancien').traits, []);
});

test('rule 5: planning — the slots, a count past two, the breakfast time', () => {
  const view = buildCatalogueView([
    option({ title: 'Repas', showsPlanningCard: 1, planningCardTimes: ['12:00', '19:30'] }),
    option({ title: 'Tournée', showsPlanningCard: 1, planningCardTimes: ['08:00', '12:00', '19:30'] }),
    option({ title: 'Petit déjeuner', autoOptionType: 'breakfast', breakfastTime: '09:30' }),
    option({ title: 'Sans carte', showsPlanningCard: 0, planningCardTimes: ['10:00'] }),
  ], PROPS);
  assert.equal(find(view, 'Repas').traits[0].label, 'Planning 12:00 · 19:30');
  assert.equal(find(view, 'Tournée').traits[0].label, 'Planning 3× par jour');
  assert.equal(find(view, 'Petit déjeuner').traits[0].label, 'Planning 09:30');
  assert.deepEqual(find(view, 'Sans carte').traits, []);
});

test('rule 5: the cancellation insurance is « Non proposée · tarif à 0 » unless a plugin prices it', () => {
  const insurance = option({ title: 'Assurance', isCancellationInsurance: 1, priceType: 'percent_of_stay', price: 0 });
  const priced = option({ title: 'Assurance payante', isCancellationInsurance: 1, priceType: 'percent_of_stay', price: 5 });
  const view = buildCatalogueView([insurance, priced], PROPS);
  assert.deepEqual(find(view, 'Assurance').traits, [{ key: 'insurance', label: 'Non proposée · tarif à 0', tone: 'warning' }]);
  assert.deepEqual(find(view, 'Assurance payante').traits, []);
  const dynamic = buildCatalogueView([insurance], PROPS, { insuranceDynamic: true });
  assert.deepEqual(find(dynamic, 'Assurance').traits, []);
});

test('rule 5: traits come in the documented order', () => {
  const view = buildCatalogueView([option({
    title: 'Tout', propertyIds: [1], displayToClient: 0, showsPlanningCard: 1, planningCardTimes: ['12:00'],
    propertyDefaults: { 1: { offered: true } },
  })], PROPS);
  assert.deepEqual(traitKeys(find(view, 'Tout')), ['scope', 'offered', 'internal', 'planning']);
});

test('rule 6: a system option is not archivable, with the reason; the guard is the one remove() uses', () => {
  const view = buildCatalogueView([
    option({ title: 'Petit déjeuner', autoOptionType: 'breakfast' }),
    option({ title: 'Assurance', isCancellationInsurance: 1 }),
    option({ title: 'Libre' }),
  ], PROPS);
  assert.deepEqual([find(view, 'Petit déjeuner').archivable, find(view, 'Petit déjeuner').archiveBlockedReason], [false, 'Option système']);
  assert.equal(find(view, 'Assurance').archivable, false);
  assert.deepEqual([find(view, 'Libre').archivable, find(view, 'Libre').archiveBlockedReason], [true, '']);
  assert.equal(archiveBlockedReason({ autoOptionType: 'cleaning' }), 'Option système');
  assert.equal(archiveBlockedReason({ isCancellationInsurance: 1 }), 'Option système');
  assert.equal(archiveBlockedReason({}), '');
});

test('rule 26: the archived options keep their name, category and archive date', () => {
  assert.deepEqual(
    buildArchivedItems([{ id: 4, title: 'Vélo', category: ' Sorties ', archivedAt: '2026-10-01 10:00:00', price: 9 }]),
    [{ id: 4, title: 'Vélo', category: 'Sorties', archivedAt: '2026-10-01 10:00:00' }],
  );
  assert.deepEqual(buildArchivedItems(null), []);
});
