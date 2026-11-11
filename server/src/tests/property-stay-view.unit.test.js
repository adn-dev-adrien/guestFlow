// specs/inte-performance.md rule 14 — GET /api/properties/:id?view=stay leaves out the pricing seasons
// (about 60 % of the detail), which only the tariff pages render; the default answer is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'property-stay-view-'));
process.env.DB_PATH = path.join(DIR, 'guestflow.db');
process.env.GUESTFLOW_LOCAL_ENV = path.join(DIR, '.env.local');

const model = require('../models/propertiesModel');
const { getOne } = require('../controllers/propertiesController');

const DETAIL = {
  id: 1, name: 'Le Gîte', singleBeds: 2, doubleBeds: 3, maxGuests: 10, defaultCheckIn: '15:00', cleaningHours: 3,
  options: [{ id: 1, title: 'Linge', price: 7 }, { id: 2, title: 'Bain', price: 30 }],
  optionGroups: { ungrouped: [{ id: 1, title: 'Linge', price: 7 }], groups: [{ category: 'Animations', pinned: [{ id: 2, title: 'Bain', price: 30 }], foldable: [{ id: 1, title: 'Linge', price: 7 }], enabledCount: 0, options: [{ id: 2, title: 'Bain', price: 30 }, { id: 1, title: 'Linge', price: 7 }] }] }, resources: [], icalSources: [], closureRanges: [],
  pricingRules: Array.from({ length: 40 }, (_, i) => ({ id: i, label: `Saison ${i}`, pricePerNight: 100 + i, progressiveTiers: [] })),
};

function answer(query) {
  const original = model.getByIdWithDetails;
  model.getByIdWithDetails = () => ({ ...DETAIL });
  let body;
  try { getOne({ params: { id: 1 }, query }, { json: (b) => { body = b; return b; }, status() { return this; } }); } finally { model.getByIdWithDetails = original; }
  return body;
}

test('rule 14: the default detail keeps its pricing rules', () => {
  assert.equal(answer({}).pricingRules.length, 40);
});

test('rule 14: the stay view has everything but the pricing rules', () => {
  const stay = answer({ view: 'stay' });
  const { pricingRules, optionGroups, ...rest } = DETAIL; // eslint-disable-line no-unused-vars
  assert.equal('pricingRules' in stay, false);
  const { optionGroups: staysGroups, ...stayRest } = stay;
  assert.deepEqual(stayRest, rest);
  assert.ok(staysGroups);
});

test('rule 14: the stay view is lighter than the detail', () => {
  assert.ok(JSON.stringify(answer({ view: 'stay' })).length < JSON.stringify(answer({})).length * 0.5);
});

test('rule 14: an unknown view answers the full detail', () => {
  assert.equal(answer({ view: 'nope' }).pricingRules.length, 40);
});

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('rule 21: the stay view names the options of a group by id, drops the pinned and foldable slices, keeps the other group fields', () => {
  const { optionGroups } = answer({ view: 'stay' });
  assert.deepEqual(optionGroups.ungrouped, [{ id: 1 }]);
  assert.deepEqual(optionGroups.groups, [{ category: 'Animations', enabledCount: 0, options: [{ id: 2 }, { id: 1 }] }]);
  assert.equal('pinned' in optionGroups.groups[0] || 'foldable' in optionGroups.groups[0], false, 'the slices the fiche recomputes are not sent');
  assert.equal(JSON.stringify(optionGroups).includes('price'), false, 'no option field is repeated in the groups');
});

test('rule 21: the default detail keeps the groups whole', () => {
  assert.equal(answer({}).optionGroups.groups[0].options[0].title, 'Bain');
});
