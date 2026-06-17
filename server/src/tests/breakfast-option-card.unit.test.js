const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/breakfastModel');
const optionCardsModel = require('../models/planningOptionCardsModel');
const { ensureDefaultBreakfastOption } = require('../utils/breakfastSeed');

// specs/breakfast-option-planning-card.md — the breakfast option gains the per-day occurrence
// selection: its dedicated card is driven by the CHECKED cardOccurrences (not the auto morning
// window), it never gets a generic card, and the seed flags it once_per_day.

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    breakfastTime TEXT, breakfastCoffee INTEGER DEFAULT 0, breakfastTea INTEGER DEFAULT 0,
    breakfastChocolate INTEGER DEFAULT 0, breakfastNote TEXT, icalOriginalSummary TEXT
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, breakfastTime TEXT,
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT NOT NULL DEFAULT 'once',
    planningCardDate TEXT, planningCardTimes TEXT,
    priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]',
    autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0,
    linenIncludesSingle INTEGER DEFAULT 1, linenIncludesDouble INTEGER DEFAULT 1, linenIncludesBaby INTEGER DEFAULT 1,
    towelLargePerPerson INTEGER DEFAULT 1, towelMediumPerPerson INTEGER DEFAULT 0, towelSmallPerPerson INTEGER DEFAULT 1,
    archivedAt TEXT, titleEn TEXT DEFAULT ''
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 1,
    cardOccurrences TEXT, PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO options (id, title, autoOptionType, breakfastTime) VALUES (1, 'Petit déjeuner', 'breakfast', '08:00')").run();
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults) VALUES (1, 1, 1, '2026-07-10', '2026-07-13', 2)").run();
  return db;
}

test('breakfastByDate is driven by cardOccurrences (the checked days × their hour), not the auto window', () => {
  const db = freshDb();
  // Only 2 of the 3 served mornings selected, at 08:30.
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, cardOccurrences) VALUES (1, 1, 1, ?)")
    .run(JSON.stringify([{ date: '2026-07-11', time: '08:30' }, { date: '2026-07-13', time: '08:30' }]));
  const byDate = buildModel(db).breakfastByDate({ from: '2026-07-09', to: '2026-07-20' });
  assert.deepEqual(Object.keys(byDate).sort(), ['2026-07-11', '2026-07-13'], 'only the checked mornings');
  assert.equal(byDate['2026-07-11'].items[0].breakfastTime, '08:30');
  assert.equal(byDate['2026-07-11'].items[0].persons, 2);
  assert.ok(!byDate['2026-07-12'], 'unchecked morning excluded');
});

test('breakfastByDate falls back to the served-morning window when no cardOccurrences', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (1, 1, 1)").run(); // no occurrences
  const byDate = buildModel(db).breakfastByDate({ from: '2026-07-09', to: '2026-07-20' });
  // served mornings = (10, 13] = 11,12,13
  assert.deepEqual(Object.keys(byDate).sort(), ['2026-07-11', '2026-07-12', '2026-07-13']);
});

test('planningOptionCardsModel never emits a generic card for a breakfast option', () => {
  const db = freshDb();
  db.prepare("UPDATE options SET showsPlanningCard = 1, cardRepeat = 'once_per_day', planningCardTimes = '[\"08:00\"]' WHERE id = 1").run();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, cardOccurrences) VALUES (1, 1, ?)")
    .run(JSON.stringify([{ date: '2026-07-11', time: '08:00' }]));
  const cards = optionCardsModel.buildModel(db).cardsInRange({ from: '2026-07-09', to: '2026-07-20' });
  assert.deepEqual(cards, {}, 'breakfast excluded from the generic cards (it has its own)');
});

test('ensureDefaultBreakfastOption flags the breakfast option showsPlanningCard / once_per_day', () => {
  const db = freshDb();
  ensureDefaultBreakfastOption(db, { logger: { log() {}, error() {} } });
  const o = db.prepare("SELECT showsPlanningCard, cardRepeat, planningCardTimes FROM options WHERE autoOptionType = 'breakfast'").get();
  assert.equal(o.showsPlanningCard, 1);
  assert.equal(o.cardRepeat, 'once_per_day');
  assert.deepEqual(JSON.parse(o.planningCardTimes), ['08:00'], 'slot initialised from the breakfast hour');
});
