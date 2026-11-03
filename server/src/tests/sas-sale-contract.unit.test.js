// The arrival SAS sale, what the write path accepts (specs/sas-breakfast-and-catering-upsell.md rule 15) and how it reads
// the sale of a tab still running the previous bundle (specs/non-card-option-served-persons.md rule 28).
// Driven through the real schema, the real catalogue query and the real commit.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const { priceOptionSale } = require('../utils/sasOptionSale');
const { todayIso } = require('../utils/localDate');
const { addIsoDays: addDaysIso } = require('../utils/occupancy');

const PROPERTY = 1;
const OTHER_PROPERTY = 2;
const CATER = 201;
const BREAKFAST = 202;
const PER_PERSON = 203;
const INSURANCE = 210;
const HIDDEN = 211;
const AUTO = 212;
const ARCHIVED = 213;
const OTHER_CATEGORY = 214;
const NOT_THIS_PROPERTY = 215;
const NOT_CARD_BREAKFAST_PROPERTY = 3;
const NOT_CARD_BREAKFAST = 216;
const FICHE_LINE = 217;

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (?, 'Granja', 6), (?, 'Estiva', 4), (?, 'Lodge', 4)")
  .run(PROPERTY, OTHER_PROPERTY, NOT_CARD_BREAKFAST_PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Sas')").run();

const insertOption = db.prepare(`INSERT INTO options
  (id, title, price, priceType, category, displayToClient, autoEnabled, isCancellationInsurance, archivedAt, autoOptionType, showsPlanningCard, cardRepeat, planningCardTimes)
  VALUES (@id, @title, @price, @priceType, @category, @displayToClient, @autoEnabled, @isCancellationInsurance, @archivedAt, @autoOptionType, @showsPlanningCard, @cardRepeat, @planningCardTimes)`);
const option = (over) => insertOption.run({
  price: 10, priceType: 'per_stay', category: 'Restauration', displayToClient: 1, autoEnabled: 0, isCancellationInsurance: 0,
  archivedAt: null, autoOptionType: null, showsPlanningCard: 0, cardRepeat: 'once', planningCardTimes: '[]', ...over,
});
option({ id: CATER, title: 'Planche' });
option({ id: BREAKFAST, title: 'Petit déjeuner', price: 8, priceType: 'per_person_per_night', autoOptionType: 'breakfast', showsPlanningCard: 1, cardRepeat: 'once_per_day', planningCardTimes: '["09:00"]' });
option({ id: PER_PERSON, title: 'Panier', price: 8, priceType: 'per_person' });
option({ id: INSURANCE, title: 'Assurance annulation', isCancellationInsurance: 1 });
option({ id: HIDDEN, title: 'Cachée', displayToClient: 0 });
option({ id: AUTO, title: 'Automatique', autoEnabled: 1 });
option({ id: ARCHIVED, title: 'Archivée', archivedAt: `${todayIso()} 00:00:00` });
option({ id: OTHER_CATEGORY, title: 'Bière', category: 'Boissons' });
option({ id: NOT_THIS_PROPERTY, title: 'Ailleurs' });
option({ id: NOT_CARD_BREAKFAST, title: 'Petit déjeuner sans carte', autoOptionType: 'breakfast' });
option({ id: FICHE_LINE, title: 'Prise sur la fiche' });
const link = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
for (const id of [CATER, BREAKFAST, PER_PERSON, INSURANCE, HIDDEN, AUTO, ARCHIVED, OTHER_CATEGORY, FICHE_LINE]) link.run(PROPERTY, id);
link.run(OTHER_PROPERTY, NOT_THIS_PROPERTY);
link.run(NOT_CARD_BREAKFAST_PROPERTY, NOT_CARD_BREAKFAST);

let nextOffset = 0;
function stay({ propertyId = PROPERTY, adults = 4, nights = 2 } = {}) {
  const start = addDaysIso(todayIso(), nextOffset);
  nextOffset += nights + 1;
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, teens, children, babies, platform, totalPrice, finalPrice, kind, checkInTime, checkOutTime)
      VALUES (?, 1, ?, ?, ?, 0, 0, 0, 'direct', 100, 100, 'reservation', '16:00', '10:00')`)
    .run(propertyId, start, addDaysIso(start, nights), adults).lastInsertRowid);
  for (let i = 0; i < nights; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'fixed', 50)")
      .run(id, addDaysIso(start, i));
  }
  return id;
}

const sold = (reservationId, ...optionIds) => model.resolveSasOptionSales(
  reservationId, optionIds.map((optionId) => ({ optionId, units: 1 })),
).map((line) => line.optionId);

const holdLine = (reservationId, optionId, sasArrivalOrigin = 1) => db.prepare(`INSERT INTO reservation_options
  (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin)
  VALUES (?, ?, 1, 10, 1, 'per_stay', 10, 1, ?)`).run(reservationId, optionId, sasArrivalOrigin);

test('rule 15 — what the offer sells goes through', () => {
  assert.deepEqual(sold(stay(), CATER), [CATER]);
});

test('rule 15 — the card breakfast the offer announces goes through', () => {
  const id = stay();
  const { startDate } = db.prepare('SELECT startDate FROM reservations WHERE id = ?').get(id);
  const lines = model.resolveSasOptionSales(id, [{ optionId: BREAKFAST, occurrences: [{ date: addDaysIso(startDate, 1), time: '09:00' }] }]);
  assert.deepEqual(lines.map((line) => line.optionId), [BREAKFAST]);
});

const EXCLUDED = [
  ['the cancellation insurance, on a stay already started', INSURANCE],
  ['an option hidden from guests', HIDDEN],
  ['an automatic option', AUTO],
  ['an archived option', ARCHIVED],
  ['an option outside « Restauration »', OTHER_CATEGORY],
  ['an option not attached to this property', NOT_THIS_PROPERTY],
  ['an unknown option', 99999],
];
for (const [what, optionId] of EXCLUDED) {
  test(`rule 15 — refused by the write path: ${what}`, () => {
    assert.deepEqual(sold(stay(), optionId), []);
  });
}

test('rule 15 — a breakfast with no planning card is sold from the fiche, never here', () => {
  assert.deepEqual(sold(stay({ propertyId: NOT_CARD_BREAKFAST_PROPERTY }), NOT_CARD_BREAKFAST), []);
});

test('rule 15 — a line taken on the fiche is still never re-routed to the complement', () => {
  const id = stay();
  holdLine(id, FICHE_LINE, 0);
  assert.deepEqual(sold(id, FICHE_LINE), []);
});

test('rule 15 — the preview shows the drop: the plan prices only what the offer sells', () => {
  const id = stay();
  const plan = model.planArrivalSas(id, {
    complementItems: [],
    bathLinenAdded: undefined,
    soldOptions: [{ optionId: CATER, units: 1 }, { optionId: HIDDEN, units: 3 }, { optionId: NOT_THIS_PROPERTY, units: 500 }],
  });
  assert.deepEqual(plan.lines.map((line) => line.optionId), [CATER]);
  assert.equal(plan.arrivalComplementTotal, 10);
});

test('rule 15 — the commit stores none of it', () => {
  const id = stay();
  const complement = model.commitArrivalSas(id, {
    soldOptions: [INSURANCE, HIDDEN, ARCHIVED, NOT_THIS_PROPERTY].map((optionId) => ({ optionId, units: 3 })),
  });
  assert.equal(complement, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

for (const [what, optionId] of [
  ['since archived', ARCHIVED],
  ['since hidden from guests', HIDDEN],
  ['since moved out of « Restauration »', OTHER_CATEGORY],
]) {
  test(`rule 15 — a line this SAS already sold stays its own, ${what}`, () => {
    const id = stay();
    holdLine(id, optionId);
    assert.deepEqual(sold(id, optionId), [optionId]);
  });
}

test('rule 15 — a held line opens nothing else: the offer still bounds the rest of the sale', () => {
  const id = stay();
  holdLine(id, ARCHIVED);
  assert.deepEqual(sold(id, ARCHIVED, HIDDEN), [ARCHIVED]);
});

const legacy = (priceType, over = {}) => priceOptionSale({ id: 9, price: 20, priceType, showsPlanningCard: 0 }, {
  persons: 5, nights: 2, maxPersons: 6, ...over,
});

test('rule 28 — a per-person sale sent with units only reads as the people served, quantity 1', () => {
  const line = legacy('per_person', { units: 3 });
  assert.equal(line.quantity, 1);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.totalPrice, 60);
});

test('rule 28 — per person per night: the units are divided by the nights, never by the party', () => {
  const line = legacy('per_person_per_night', { units: 6 });
  assert.equal(line.quantity, 1);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.billedUnits, 6);
  assert.equal(line.totalPrice, 120);
});

test('rule 28 — never a decimal: a remainder is not billed, and at least one person is served', () => {
  const line = legacy('per_person_per_night', { units: 5 });
  assert.equal(line.cardPersons, 2);
  assert.equal(line.billedUnits, 4);
  const one = legacy('per_person', { units: 0.5 });
  assert.equal(one.cardPersons, 1);
  assert.equal(one.quantity, 1);
});

test('rule 28 — the old default (the whole party) stays NULL and follows the party', () => {
  const line = legacy('per_person', { units: 5 });
  assert.equal(line.cardPersons, null);
  assert.equal(line.billedUnits, 5);
});

test('rule 28 — a stay with no night bills nothing, and never divides by zero', () => {
  assert.equal(legacy('per_person_per_night', { units: 3, nights: 0 }), null);
});

test('rule 28 — persons wins over units; no units and no persons is the party, as before', () => {
  assert.equal(legacy('per_person', { units: 2, servedPersons: 4 }).cardPersons, 4);
  const party = legacy('per_person', {});
  assert.equal(party.cardPersons, null);
  assert.equal(party.billedUnits, 5);
});

test('rule 28 — a units-only sale on any other price type is unchanged', () => {
  const night = legacy('per_night', { units: 3 });
  assert.equal(night.cardNights, 3);
  assert.equal(night.billedUnits, 3);
  const flat = legacy('per_stay', { units: 2 });
  assert.equal(flat.quantity, 2);
  assert.equal(flat.billedUnits, 2);
});

test('rule 28 — through the real resolver: a stale tab sells 3 meals, not the party', () => {
  const id = stay({ adults: 4 });
  const [line] = model.resolveSasOptionSales(id, [{ optionId: PER_PERSON, units: 3 }]);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.quantity, 1);
  assert.equal(line.totalPrice, 24);
});
