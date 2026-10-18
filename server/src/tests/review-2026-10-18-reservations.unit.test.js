// specs/review-2026-10-18-reservations.md — the small reservation fixes of the review of 2026-10-18.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { __test: { showsStruckOriginal }, generateDevisPdf } = require('../utils/devisPdf');
const { __test: { withQuantityUnit } } = require('../utils/pricing');

test('rule 2 — a « was » price is struck only above the billed one', () => {
  assert.equal(showsStruckOriginal(404.87, 403.56), true);
  // The review's devis: engine 403,56 €, manual 404,87 € — no strike-through any more.
  assert.equal(showsStruckOriginal(403.56, 404.87), false);
  assert.equal(showsStruckOriginal(100, 100), false);
  assert.equal(showsStruckOriginal(0, 50), false);
});

test('rule 2 — a manual price above the engine price still renders the devis', async () => {
  const buf = await generateDevisPdf({
    devisNumber: '2026-10-001', status: 'draft', startDate: '2099-06-01', endDate: '2099-06-03',
    checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 403.56, customPrice: 404.87, discountPercent: 0, finalPrice: 404.87,
    touristTaxRate: 0, touristTaxTotal: 0, depositAmount: 0, balanceAmount: 404.87, cautionAmount: 0,
    property: { id: 1, name: 'Gîte', checkInTime: '15:00', checkOutTime: '10:00' },
    client: { id: 1, firstName: 'Jean', lastName: 'Dupont' }, options: [], resources: [], nights: [],
  }, { companyName: 'Co' });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('rule 4 — the reviewed texts address nobody', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const files = {
    'client/src/components/ClientFormFields.jsx': 'Adresse en une ligne : n° rue CP ville',
    'client/src/components/reservation/OptionRow.jsx': 'Par défaut toute la tablée.',
    'server/src/utils/qonto/qontoSettingsController.js': 'Identifiants Qonto manquants (Réglages › Paiements).',
  };
  for (const [file, expected] of Object.entries(files)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(source.includes(expected), `${file} carries « ${expected} »`);
    assert.doesNotMatch(source, /Dépose ou saisis|baissez-la|renseigne-les/, file);
  }
});

test('rule 5 — a breakfast counted by the day, or placed on its mornings, counts mornings', () => {
  const breakfast = { id: 6, autoOptionType: 'breakfast', priceType: 'per_person_per_night', showsPlanningCard: 0 };
  assert.equal(withQuantityUnit({ optionId: 6, quantity: 3, priceType: 'per_person_per_night' }, breakfast).quantityUnit, 'morning');
  const card = { ...breakfast, showsPlanningCard: 1 };
  assert.equal(withQuantityUnit({ optionId: 6, quantity: 2, cardOccurrences: [{}, {}] }, card).quantityUnit, 'morning');
});

test('rule 5 — portions still to plan, and other options, are left unnamed', () => {
  const card = { id: 6, autoOptionType: 'breakfast', priceType: 'per_person_per_night', showsPlanningCard: 1 };
  assert.equal(withQuantityUnit({ optionId: 6, quantity: 6, toBeScheduled: true, cardOccurrences: [] }, card).quantityUnit, undefined);
  assert.equal(withQuantityUnit({ optionId: 7, quantity: 2, priceType: 'per_stay' }, { id: 7, priceType: 'per_stay' }).quantityUnit, undefined);
  assert.equal(withQuantityUnit({ optionId: 8, quantity: 2, priceType: 'per_person' }, { id: 8, autoOptionType: 'breakfast', priceType: 'per_person' }).quantityUnit, undefined);
});
