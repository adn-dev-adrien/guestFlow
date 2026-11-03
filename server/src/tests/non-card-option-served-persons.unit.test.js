// specs/non-card-option-served-persons.md — the people served and the nights typed on a non-card option:
// the SAS sale, the arrival floor, the laundry and breakfast readers, and the one-shot migration.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { priceOptionSale, buildOptionOffer } = require('../utils/sasOptionSale');
const { arrivalLineFloors } = require('../utils/midStayExtrasWindow');
const { computeReservationContract } = require('../plugins/linen/linenInventory');
const { runServedPersonsOptionMigration } = require('../utils/servedPersonsOptionMigration');
const { typedCountOf } = require('../utils/typedCounts');
const laundryModel = require('../plugins/linen/laundryModel').buildModel(db);
const breakfastModel = require('../models/breakfastModel');

const OPTION = { id: 500, title: 'Repas', price: 17, priceType: 'per_person' };

test('rule 12 — a SAS sale per person stores the people served, never a base quantity', () => {
  const line = priceOptionSale(OPTION, { unitPrice: 17, persons: 4, nights: 2, servedPersons: 3, maxPersons: 8 });
  assert.equal(line.quantity, 1);
  assert.equal(line.cardPersons, 3);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.totalPrice, 51);
});

test('rule 12 — the whole party is stored NULL and follows the party', () => {
  const line = priceOptionSale(OPTION, { unitPrice: 17, persons: 4, nights: 2, maxPersons: 8 });
  assert.equal(line.cardPersons, null);
  assert.equal(line.billedUnits, 4);
});

test('rule 12 — per person per night multiplies the nights, and per night stores the typed nights', () => {
  const ppn = priceOptionSale({ ...OPTION, priceType: 'per_person_per_night' }, { unitPrice: 10, persons: 4, nights: 3, servedPersons: 2, maxPersons: 8 });
  assert.deepEqual([ppn.quantity, ppn.cardPersons, ppn.billedUnits], [1, 2, 6]);
  const night = priceOptionSale({ ...OPTION, priceType: 'per_night' }, { unitPrice: 5, persons: 4, nights: 3, units: 2 });
  assert.deepEqual([night.quantity, night.cardNights, night.billedUnits], [1, 2, 2]);
  const wholeStay = priceOptionSale({ ...OPTION, priceType: 'per_night' }, { unitPrice: 5, persons: 4, nights: 3, units: 3 });
  assert.equal(wholeStay.cardNights, null);
});

test('rule 5 — the people served are capped at the larger of the party and the capacity', () => {
  const line = priceOptionSale(OPTION, { unitPrice: 17, persons: 4, nights: 2, servedPersons: 40, maxPersons: 8 });
  assert.equal(line.billedUnits, 8);
});

test('re-opening a SAS reopens on what it sold', () => {
  const offer = buildOptionOffer(OPTION, { unitPrice: 17, persons: 4, nights: 2, maxPersons: 8, sold: { cardPersons: 3, billedUnits: 3 } });
  assert.equal(offer.selectedPersons, 3);
  assert.equal(offer.unitsPerPerson, 1);
  assert.equal(buildOptionOffer({ ...OPTION, priceType: 'per_person_per_night' }, { persons: 4, nights: 3 }).unitsPerPerson, 3);
});

test('rule 17 — a line sold at arrival keeps its floor in people', () => {
  const lines = [{ optionId: 500, quantity: 1, totalPrice: 51, typedCount: 3 }];
  const floors = arrivalLineFloors({ 'opt:500': 51 }, lines);
  assert.equal(floors['opt:500'].minTypedCount, 3);
  const grown = arrivalLineFloors({ 'opt:500': 51 }, [{ optionId: 500, quantity: 1, totalPrice: 85, typedCount: 5 }]);
  assert.equal(grown['opt:500'].minTypedCount, 3);
});

test('rule 17 — what the field shows, read from what the line bills', () => {
  const stay = { startDate: '2099-01-01', endDate: '2099-01-04' };
  assert.equal(typedCountOf({ priceType: 'per_person', billedUnits: 3 }, stay), 3);
  assert.equal(typedCountOf({ priceType: 'per_person_per_night', billedUnits: 6 }, stay), 2);
  assert.equal(typedCountOf({ priceType: 'per_night', billedUnits: 2 }, stay), 2);
  assert.equal(typedCountOf({ priceType: 'per_stay', billedUnits: 2 }, stay), null);
});

test('rule 6 — towels count the people served, the whole party when nobody typed', () => {
  const towel = { towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1 };
  const reservation = { adults: 4, teens: 0, children: 1 };
  const contract = (explicitServedSum) => computeReservationContract({
    reservation,
    bedLinenContext: {},
    bathroomContext: { explicitOption: towel, explicitServedSum },
    bathMatContext: { active: false },
  });
  assert.equal(contract(3).large, 3);
  const followed = computeReservationContract({
    reservation,
    bedLinenContext: {},
    bathroomContext: { propertyDefaultOption: towel },
    bathMatContext: { active: false },
  });
  assert.equal(followed.large, 5);
});

// The 8 lines measured in production on 2026-11-03, plus the cases the rules name.
db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (900, 'Granja', 13)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (900, 'Test', 'Client')").run();
db.prepare(`INSERT INTO options (id, title, price, priceType) VALUES (908, 'Linge de lit', 7, 'per_person'),
  (909, 'Linge de toilette', 8, 'per_person'), (910, 'Panier', 10, 'per_person_per_night'), (911, 'Bois', 5, 'per_night')`).run();
db.prepare("INSERT INTO options (id, title, price, priceType, isCancellationInsurance) VALUES (912, 'Assurance', 5, 'per_night', 1)").run();
db.prepare("INSERT INTO options (id, title, price, priceType, showsPlanningCard) VALUES (913, 'Repas', 5, 'per_person', 1)").run();

let nextId = 9000;
function line(optionId, { adults, children = 0, nights = 2, quantity, billedUnits, priceType = 'per_person', totalPrice = 0 }) {
  nextId += 1;
  const id = nextId;
  const end = String(1 + nights).padStart(2, '0');
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults, children, teens, kind)
              VALUES (?, 900, 900, '2099-03-01', ?, ?, ?, 0, 'reservation')`).run(id, `2099-03-${end}`, adults, children);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, soldeContribTtc)
              VALUES (?, ?, ?, 8, ?, ?, ?, 1, 12)`).run(id, optionId, quantity, billedUnits, priceType, totalPrice);
  return id;
}
const stored = (id) => db.prepare('SELECT quantity, cardPersons, cardNights, billedUnits, unitPrice, totalPrice, inComplement, soldeContribTtc FROM reservation_options WHERE reservationId = ?').get(id);

const fromSas = line(909, { adults: 12, nights: 3, quantity: 0.4167, billedUnits: 5, totalPrice: 40 });
const drifted = line(909, { adults: 9, children: 2, quantity: 1.1, billedUnits: 12.1, totalPrice: 96.8 });
const wholeParty = line(908, { adults: 5, quantity: 2, billedUnits: 5, totalPrice: 35 });
const aboveCeiling = line(909, { adults: 2, quantity: 10, billedUnits: 20, totalPrice: 160 });
const ppn = line(910, { adults: 4, nights: 3, quantity: 0.5, billedUnits: 6, priceType: 'per_person_per_night', totalPrice: 60 });
const perNight = line(911, { adults: 4, nights: 2, quantity: 1.5, billedUnits: 3, priceType: 'per_night', totalPrice: 15 });
const insurance = line(912, { adults: 4, nights: 2, quantity: 2, billedUnits: 4, priceType: 'per_night', totalPrice: 20 });
const card = line(913, { adults: 4, quantity: 2, billedUnits: 8, totalPrice: 40 });
const untouched = line(909, { adults: 4, quantity: 1, billedUnits: 4, totalPrice: 32 });

test('rules 14-16 — a dry run reports without writing', () => {
  const before = stored(fromSas);
  const report = runServedPersonsOptionMigration(db, { dryRun: true });
  assert.deepEqual(stored(fromSas), before);
  assert.ok(report.migrated.some((m) => m.reservationId === fromSas));
});

test('rules 14-16 — migrates what is whole, leaves the rest, moves no amount', () => {
  const money = (id) => { const { unitPrice, billedUnits, totalPrice, inComplement, soldeContribTtc } = stored(id); return { unitPrice, billedUnits, totalPrice, inComplement, soldeContribTtc }; };
  const ids = [fromSas, drifted, wholeParty, aboveCeiling, ppn, perNight, insurance, card, untouched];
  const before = new Map(ids.map((id) => [id, money(id)]));

  const { skipped } = runServedPersonsOptionMigration(db);

  for (const id of ids) assert.deepEqual(money(id), before.get(id), `reservation ${id}`);
  assert.deepEqual([stored(fromSas).quantity, stored(fromSas).cardPersons], [1, 5]);
  assert.deepEqual([stored(wholeParty).quantity, stored(wholeParty).cardPersons], [1, null], 'equal to the party: follows it');
  assert.deepEqual([stored(ppn).quantity, stored(ppn).cardPersons], [1, 2]);
  assert.deepEqual([stored(perNight).quantity, stored(perNight).cardNights], [1, 3]);

  assert.equal(stored(drifted).quantity, 1.1, 'rule 15: drifted, left as it is');
  assert.equal(stored(aboveCeiling).quantity, 10, 'rule 16: above the ceiling, left as it is');
  assert.equal(skipped.find((s) => s.reservationId === drifted).reason, 'not-a-whole-number');
  assert.equal(skipped.find((s) => s.reservationId === aboveCeiling).reason, 'above-the-ceiling');

  assert.equal(stored(insurance).quantity, 2, 'rule 1: the insurance is out of scope');
  assert.equal(stored(card).quantity, 2, 'rule 1: a card option is out of scope');
  assert.equal(stored(untouched).cardPersons, null);
});

test('rule 14 — running it again changes nothing', () => {
  const snapshot = () => JSON.stringify([fromSas, wholeParty, ppn, perNight].map(stored));
  const before = snapshot();
  const { migrated } = runServedPersonsOptionMigration(db);
  assert.equal(snapshot(), before);
  assert.equal(migrated.length, 0);
});

test('rule 14 — the boot runs it once, behind its flag', () => {
  assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'non_card_served_persons_v1'").get());
});

test('rule 6 — the laundry and the breakfast count the people served, and a line nobody typed the party', () => {
  db.prepare("INSERT INTO options (id, title, price, priceType, countsAsBathroomLinen, towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson) VALUES (920, 'Serviettes', 8, 'per_person', 1, 1, 0, 0)").run();
  db.prepare("INSERT INTO options (id, title, price, priceType, autoOptionType) VALUES (921, 'Petit-déjeuner', 8, 'per_person', 'breakfast')").run();
  const stay = (id, start, end, cardPersons) => {
    db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults, children, teens, kind)
                VALUES (?, 900, 900, ?, ?, 5, 0, 0, 'reservation')`).run(id, start, end);
    for (const optionId of [920, 921]) {
      db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardPersons)
                  VALUES (?, ?, 1, 8, ?, 'per_person', 0, ?)`).run(id, optionId, cardPersons ?? 5, cardPersons);
    }
  };
  stay(9901, '2098-06-01', '2098-06-03', 3);
  assert.equal(laundryModel.dropOffBathroomForWindow('2098-06-01', '2098-06-05').largeTowels, 3);
  assert.equal(breakfastModel.breakfastByDate({ from: '2098-06-01', to: '2098-06-04' })['2098-06-02'].items[0].persons, 3);

  stay(9902, '2098-07-01', '2098-07-03', null);
  assert.equal(laundryModel.dropOffBathroomForWindow('2098-07-01', '2098-07-05').largeTowels, 5);
  assert.equal(breakfastModel.breakfastByDate({ from: '2098-07-01', to: '2098-07-04' })['2098-07-02'].items[0].persons, 5);
});
