// specs/non-card-option-served-persons.md rule 25 — permanent non-regression for the quantities that
// turned decimal on a production reservation (24-26 December 2026). Driven through the real engine,
// controller and schema: if a typed number ever moves again, or a decimal comes back, this file fails.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { resolveNonCardUnits } = require('../utils/pricing');
const { typedCountAlerts } = require('../utils/typedCounts');

const BED = 108;
const TOWEL = 109;
const CLEANING = 107;
const FIREWOOD = 121;
// The tariff the incident's reservation was sold under: 10 people included, then 25 € per person per night.
const TARIFF = JSON.stringify({ includedGuests: 10, extraGuestPrice: 25, extraGuestPriceUnit: 'per_night', extraGuestTiers: [{ fromNight: 1, price: 25 }], freeUnitsByOption: {} });

db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
              basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
            VALUES (1, 'Granja', 13, 'per_day_per_person', 1.2, 0, 10, 25, 'per_night')`).run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Noel')").run();
db.prepare(`INSERT INTO options (id, title, price, priceType) VALUES
  (108, 'Linge de lit', 7, 'per_person'), (109, 'Linge de toilette', 8, 'per_person'), (107, 'Ménage', 80, 'per_stay'),
  (120, 'Panier', 10, 'per_person_per_night'), (121, 'Bois', 5, 'per_night')`).run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 108), (1, 109), (1, 107), (1, 120), (1, 121)').run();

// One property: each stay takes its own month of next year, so none overlaps another.
const SEED_YEAR = new Date().getFullYear() + 1;
let seedMonth = 0;
const seedDay = (day) => `${SEED_YEAR}-${String(seedMonth).padStart(2, '0')}-${day}`;

function seedStay() {
  seedMonth += 1;
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent,
       finalPrice, depositAmount, balanceAmount, touristTaxRate, touristTaxTotal, kind, checkInTime, checkOutTime, cautionAmount, tariffSnapshot)
      VALUES (1, 1, ?, ?, 8, 2, 0, 0, 'direct', 1423, 0, 1713, 0, 1732.2, 1.2, 19.2, 'reservation', '16:00', '10:00', 500, ?)`)
    .run(seedDay(24), seedDay(26), TARIFF).lastInsertRowid);
  const night = db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Noël', 'fixed', ?)");
  night.run(id, seedDay(24), 972);
  night.run(id, seedDay(25), 451);
  const line = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
                           VALUES (?, ?, 1, ?, ?, ?, ?, ?)`);
  line.run(id, BED, 7, 10, 'per_person', 0, 1);
  line.run(id, TOWEL, 8, 10, 'per_person', 80, 0);
  line.run(id, CLEANING, 80, 1, 'per_stay', 80, 0);
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered) VALUES (?, 'Chambre supplémentaire', 130, 0)").run(id);
  return id;
}

function bodyOf(id, patch = {}, lines = {}) {
  const body = toUpdateBody(model.getByIdWithDetails(id));
  delete body.forceTypedCounts;
  for (const line of body.options) Object.assign(line, lines[line.optionId] || {});
  return { ...body, ...patch };
}

const save = (id, body) => controller.performUpdate(String(id), body, {});
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const option = (id, optionId) => db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, optionId);

test('rule 25 — no combination of type, typed value, party and nights yields a decimal', () => {
  for (const priceType of ['per_person', 'per_person_per_night', 'per_night']) {
    for (let typed = 1; typed <= 15; typed += 1) {
      for (let persons = 1; persons <= 15; persons += 1) {
        for (let nights = 1; nights <= 14; nights += 1) {
          const line = resolveNonCardUnits({
            priceType, quantity: 1, persons, nights, cardPersons: typed, cardNights: typed, maxGuests: 15,
          });
          assert.ok(Number.isInteger(line.billedUnits), `${priceType} typed ${typed}, ${persons} p., ${nights} n. → ${line.billedUnits}`);
        }
      }
    }
  }
});

test('rules 2, 3, 4 — a count different from the party is stored and frozen; equal, it is stored NULL and follows', () => {
  const frozen = resolveNonCardUnits({ priceType: 'per_person', quantity: 1, persons: 4, nights: 2, cardPersons: 3, maxGuests: 13 });
  assert.deepEqual([frozen.cardPersons, frozen.billedUnits], [3, 3]);
  const equal = resolveNonCardUnits({ priceType: 'per_person', quantity: 1, persons: 4, nights: 2, cardPersons: 4, maxGuests: 13 });
  assert.deepEqual([equal.cardPersons, equal.billedUnits], [null, 4]);
  const ppn = resolveNonCardUnits({ priceType: 'per_person_per_night', quantity: 1, persons: 4, nights: 3, cardPersons: 2, maxGuests: 13 });
  assert.deepEqual([ppn.cardPersons, ppn.billedUnits], [2, 6]);
  // `quantity` stays the base of the other dimensions.
  assert.equal(resolveNonCardUnits({ priceType: 'per_person', quantity: 2, persons: 4, nights: 2, cardPersons: 3, maxGuests: 13 }).billedUnits, 6);
});

test('rule 7 — changing the party on a typed line never produces a decimal quantity', () => {
  const id = seedStay();
  save(id, bodyOf(id, {}, { [TOWEL]: { cardPersons: 3 } }));
  for (const adults of [5, 7, 9]) {
    save(id, bodyOf(id, { adults, forceTypedCounts: true }));
    assert.equal(option(id, TOWEL).quantity, 1);
    assert.equal(option(id, TOWEL).billedUnits, 3);
    assert.ok(Number.isInteger(option(id, BED).billedUnits));
  }
});

test('rule 25 — a typed number never moves when the party or the stay changes', () => {
  for (let typed = 1; typed <= 12; typed += 1) {
    for (let persons = 1; persons <= 15; persons += 1) {
      const perPerson = resolveNonCardUnits({ priceType: 'per_person', quantity: 1, persons, nights: 2, cardPersons: typed, maxGuests: 15 });
      assert.equal(perPerson.billedUnits, typed);
      const perPersonPerNight = resolveNonCardUnits({ priceType: 'per_person_per_night', quantity: 1, persons, nights: 3, cardPersons: typed, maxGuests: 15 });
      assert.equal(perPersonPerNight.billedUnits, typed * 3);
    }
    for (let nights = 1; nights <= 14; nights += 1) {
      assert.equal(resolveNonCardUnits({ priceType: 'per_night', quantity: 1, persons: 4, nights, cardNights: typed }).billedUnits, typed);
    }
  }
});

test('rule 25 — a line nobody touched follows the party and the nights', () => {
  assert.equal(resolveNonCardUnits({ priceType: 'per_person', quantity: 1, persons: 11, nights: 2 }).billedUnits, 11);
  assert.equal(resolveNonCardUnits({ priceType: 'per_person_per_night', quantity: 1, persons: 5, nights: 3 }).billedUnits, 15);
  assert.equal(resolveNonCardUnits({ priceType: 'per_night', quantity: 1, persons: 5, nights: 3 }).billedUnits, 3);
});

test('rule 25 — the reservation of the incident: 11 towels typed for 10, then 11 people, stay 88 € and 60.40 € on site', () => {
  const id = seedStay();

  save(id, bodyOf(id, {}, { [TOWEL]: { cardPersons: 11 } }));
  assert.equal(option(id, TOWEL).cardPersons, 11);
  assert.equal(option(id, TOWEL).quantity, 1);
  assert.equal(option(id, TOWEL).billedUnits, 11);

  const refused = save(id, bodyOf(id, { adults: 9 }, { [TOWEL]: { cardPersons: 11 } }));
  // 11 typed, party now 11: equal, so the line follows and nothing is asked.
  assert.notEqual(refused?.status, 409);
  assert.equal(option(id, TOWEL).billedUnits, 11);
  assert.equal(option(id, TOWEL).totalPrice, 88);
  assert.equal(option(id, TOWEL).cardPersons, null);
  assert.equal(option(id, BED).billedUnits, 11);
  for (const optionId of [BED, TOWEL, CLEANING]) {
    assert.ok(Number.isInteger(option(id, optionId).billedUnits), `option ${optionId}`);
  }
});

test('rule 25 — the money of that reservation: 1,732.20 € paid at 10 people leaves 60.40 € to settle on site', () => {
  const id = seedStay();
  save(id, bodyOf(id));
  assert.equal(row(id).balanceAmount, 1732.2);
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2099-01-01', balancePaid = 1, balancePaidDate = '2099-01-01' WHERE id = ?").run(id);

  save(id, bodyOf(id, { adults: 9 }));

  const stay = row(id);
  assert.equal(stay.finalPrice, 1771);
  assert.equal(stay.balanceAmount, 1732.2);
  assert.equal(stay.complementAmount, 60.4);
  assert.equal(option(id, TOWEL).totalPrice, 88);
});

test('rule 22 — the save refuses a typed number left behind by the party, and a forced save keeps it', () => {
  const id = seedStay();
  save(id, bodyOf(id, {}, { [TOWEL]: { cardPersons: 3 } }));
  assert.equal(option(id, TOWEL).billedUnits, 3);

  const refused = save(id, bodyOf(id, { adults: 9 }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'TYPED_COUNTS_STALE');
  assert.equal(refused.body.lines[0].title, 'Linge de toilette');
  assert.equal(row(id).adults, 8, 'nothing written');

  save(id, bodyOf(id, { adults: 9, forceTypedCounts: true }));
  assert.equal(row(id).adults, 9);
  assert.equal(option(id, TOWEL).billedUnits, 3);
  assert.equal(option(id, TOWEL).totalPrice, 24);

  // Forcing was the decision: the next save asks nothing.
  assert.notEqual(save(id, bodyOf(id))?.status, 409);
});

test('rule 19 — a typed number of nights is frozen, asks when the stay changes, and never turns decimal', () => {
  const id = seedStay();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, 121, 1, 5, 2, 'per_night', 10, 0)").run(id);
  save(id, bodyOf(id, {}, { [FIREWOOD]: { cardNights: 3 } }));
  assert.equal(option(id, FIREWOOD).billedUnits, 3);
  assert.equal(option(id, FIREWOOD).quantity, 1);

  const refused = save(id, bodyOf(id, { endDate: seedDay(28) }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.lines[0].kind, 'nights');

  save(id, bodyOf(id, { endDate: seedDay(28), forceTypedCounts: true }));
  assert.equal(option(id, FIREWOOD).billedUnits, 3);
});

test('rules 20, 23 — alerts: typed against the party, flagged only when it changed since', () => {
  const quoteLines = [{ optionId: 9, title: 'Linge', cardPersons: 3 }];
  const flagged = typedCountAlerts({ quoteLines, requestLines: [], persons: 5, nights: 2, storedPersons: 4, storedNights: 2 });
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].label, 'Saisi pour 4 personnes, groupe : 5');
  assert.equal(flagged[0].applyLabel, 'Appliquer 5 personnes');

  const typedAfter = typedCountAlerts({ quoteLines, requestLines: [{ optionId: 9, typedAtParty: 5 }], persons: 5, nights: 2, storedPersons: 4, storedNights: 2 });
  assert.equal(typedAfter.length, 0);

  // Retyped while flagged: the reference stays, so it stays red whatever wrong number is typed.
  const retyped = typedCountAlerts({ quoteLines: [{ optionId: 9, title: 'Linge', cardPersons: 2 }], requestLines: [{ optionId: 9 }], persons: 5, nights: 2, storedPersons: 4, storedNights: 2 });
  assert.equal(retyped.length, 1);

  const back = typedCountAlerts({ quoteLines, requestLines: [], persons: 4, nights: 2, storedPersons: 4, storedNights: 2 });
  assert.equal(back.length, 0);
});

test('rule 24 — a server caller is never asked', () => {
  assert.equal(toUpdateBody({ options: [] }).forceTypedCounts, true);
});
