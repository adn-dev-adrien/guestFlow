// specs/non-card-option-served-persons.md rule 29 — `quantity` stays 1 on a typed line, so the readers
// that print a count print the figure the server sends: the people served or the nights, as the fiche's
// field reads them. Driven through the real engine, model and schema.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const vatRegimeModel = require('../models/vatRegimeModel');
const { buildStoredSummary } = require('../utils/storedSummary');
const { displayCountOf } = require('../utils/typedCounts');
const { toReceptionReservationView } = require('../utils/receptionView');
const { localIsoDate } = require('../utils/localDate');

const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localIsoDate(d);
};
const START = inDays(40);
const END = inDays(45); // 5 nights
const STAY = { startDate: START, endDate: END };

const PP = 301; const PPN = 302; const NIGHT = 303; const FLAT = 304; const CARD = 305; const INSURANCE = 306;
const BF_NIGHT = 307; const BF_PPN = 308;

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Client')").run();
const addOption = db.prepare(`INSERT INTO options (id, title, price, priceType, showsPlanningCard, isCancellationInsurance, autoOptionType)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`);
addOption.run(PP, 'Linge', 8, 'per_person', 0, 0, null);
addOption.run(PPN, 'Repas', 10, 'per_person_per_night', 0, 0, null);
addOption.run(NIGHT, 'Bois', 5, 'per_night', 0, 0, null);
addOption.run(FLAT, 'Ménage', 80, 'per_stay', 0, 0, null);
addOption.run(CARD, 'Dîner', 20, 'per_person', 1, 0, null);
addOption.run(INSURANCE, 'Assurance', 3, 'per_night', 0, 1, null);
addOption.run(BF_NIGHT, 'Café', 4, 'per_night', 0, 0, 'breakfast');
addOption.run(BF_PPN, 'Panier', 6, 'per_person_per_night', 0, 0, 'breakfast');
for (const id of [PP, PPN, NIGHT, FLAT, CARD, INSURANCE, BF_NIGHT, BF_PPN]) {
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(id);
}

const stayId = Number(db.prepare(`INSERT INTO reservations
    (propertyId, clientId, startDate, endDate, adults, platform, totalPrice, discountPercent, finalPrice, depositAmount, balanceAmount, kind)
    VALUES (1, 1, ?, ?, 4, 'direct', 500, 0, 500, 0, 500, 'reservation')`).run(START, END).lastInsertRowid);
const addLine = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardPersons, cardNights)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
addLine.run(stayId, PP, 1, 8, 3, 'per_person', 24, 3, null);
addLine.run(stayId, PPN, 1, 10, 10, 'per_person_per_night', 100, 2, null);
addLine.run(stayId, NIGHT, 1, 5, 2, 'per_night', 10, null, 2);
addLine.run(stayId, FLAT, 2, 80, 2, 'per_stay', 160, null, null);
addLine.run(stayId, CARD, 3, 20, 9, 'per_person', 180, 3, null);
addLine.run(stayId, INSURANCE, 1, 3, 5, 'per_night', 15, null, null);

const figures = (lines) => Object.fromEntries(lines.filter((l) => l.optionId).map((l) => [Number(l.optionId), l.displayCount]));

const quote = async (selectedOptions) => {
  let payload;
  let status = 200;
  const res = { status(code) { status = code; return this; }, json(body) { payload = body; return this; } };
  await controller.calculatePrice({
    body: { propertyId: 1, startDate: START, endDate: END, adults: 4, children: 0, teens: 0, platform: 'direct', selectedOptions, selectedResources: [] },
    user: { roles: ['admin'] },
  }, res);
  assert.equal(status, 200, JSON.stringify(payload));
  return payload;
};

test('rule 29 — the figure is the people served or the nights, never the base quantity of 1', () => {
  assert.equal(displayCountOf({ priceType: 'per_person', quantity: 1, billedUnits: 3 }, STAY), 3);
  assert.equal(displayCountOf({ priceType: 'per_night', quantity: 1, billedUnits: 2 }, STAY), 2);
  assert.equal(displayCountOf({ priceType: 'per_person_per_night', quantity: 1, billedUnits: 10 }, STAY), 2);
});

test('rule 29 — a line nobody typed reads the whole party or the whole stay', () => {
  assert.equal(displayCountOf({ priceType: 'per_person', quantity: 1, billedUnits: 4 }, STAY), 4);
  assert.equal(displayCountOf({ priceType: 'per_night', quantity: 1, billedUnits: 5 }, STAY), 5);
});

test('rule 29 — a per-person-per-night figure that does not divide evenly reads 2 decimals', () => {
  const threeNights = { startDate: inDays(40), endDate: inDays(43) };
  assert.equal(displayCountOf({ priceType: 'per_person_per_night', quantity: 1, billedUnits: 5 }, threeNights), 1.67);
});

test('rule 29 — every other line keeps its quantity: other price types, a card, the insurance, a line with no billed units', () => {
  assert.equal(displayCountOf({ priceType: 'per_stay', quantity: 2, billedUnits: 2 }, STAY), 2);
  assert.equal(displayCountOf({ priceType: 'percent_of_stay', quantity: 1, billedUnits: 1 }, STAY), 1);
  assert.equal(displayCountOf({ priceType: 'per_person', quantity: 3, billedUnits: 9 }, STAY, { isCard: true }), 3);
  assert.equal(displayCountOf({ priceType: 'per_night', quantity: 1, billedUnits: 5 }, STAY, { isInsurance: true }), 1);
  assert.equal(displayCountOf({ priceType: 'per_person', quantity: 2, billedUnits: null }, STAY), 2);
  assert.equal(displayCountOf({ priceType: 'per_person_per_night', quantity: 2, billedUnits: 10 }, {}), 2);
});

test('rule 18 + 29 — a drifted line reads as what it bills', () => {
  assert.equal(displayCountOf({ priceType: 'per_person', quantity: 1.1, billedUnits: 12.1 }, STAY), 12.1);
});

test('rule 29 — the stay read by the dashboard and the SAS carries the figure on each line', () => {
  const lines = figures(model.getByIdWithDetails(stayId).options);
  assert.deepEqual(lines, { [PP]: 3, [PPN]: 2, [NIGHT]: 2, [FLAT]: 2, [CARD]: 3, [INSURANCE]: 1 });
});

test('rule 29 — the reception view keeps the figure', () => {
  const view = toReceptionReservationView(model.getByIdWithDetails(stayId));
  assert.equal(figures(view.options)[PP], 3);
});

test('rule 29 — the stored summary carries it too', () => {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(stayId);
  const summary = buildStoredSummary({ row, db, vatRegime: vatRegimeModel, headline: {} });
  assert.deepEqual(figures(summary.optionLines), { [PP]: 3, [PPN]: 2, [NIGHT]: 2, [FLAT]: 2, [CARD]: 3, [INSURANCE]: 1 });
});

test('rule 29 — the live quote carries the typed figure, and what the line follows when nobody typed', async () => {
  const typed = figures((await quote([
    { optionId: PP, quantity: 1, cardPersons: 3 },
    { optionId: PPN, quantity: 1, cardPersons: 2 },
    { optionId: NIGHT, quantity: 1, cardNights: 2 },
    { optionId: FLAT, quantity: 2 },
  ])).optionLines);
  assert.deepEqual([typed[PP], typed[PPN], typed[NIGHT], typed[FLAT]], [3, 2, 2, 2]);
  const untouched = figures((await quote([{ optionId: PP, quantity: 1 }, { optionId: NIGHT, quantity: 1 }])).optionLines);
  assert.deepEqual([untouched[PP], untouched[NIGHT]], [4, 5]);
});

test('rule 29 — a non-card breakfast counted by the day reads its mornings, however many are typed', async () => {
  const lines = (await quote([
    { optionId: BF_NIGHT, quantity: 1, cardNights: 3 },
    { optionId: BF_PPN, quantity: 1, cardPersons: 2 },
  ])).optionLines;
  const byId = new Map(lines.map((l) => [Number(l.optionId), l]));
  assert.deepEqual([byId.get(BF_NIGHT).quantityUnit, byId.get(BF_NIGHT).displayCount], ['morning', 3]);
  assert.deepEqual([byId.get(BF_PPN).quantityUnit, byId.get(BF_PPN).displayCount], ['morning', 5]);
});
