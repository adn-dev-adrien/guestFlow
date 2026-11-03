// specs/non-card-option-served-persons.md rule 6 (audit R21-S5) — the stock projection counts the people typed on a
// bath-linen option: the reduce over the option's rows, and the model reading the column it needs.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildContractsByReservationId } = require('../linenInventory');
const linenInventoryModel = require('../linenInventoryModel');
const laundryTripSkipsModel = require('../skipsModel');
const laundryExtraTripsModel = require('../extraTripsModel');
const { fakeScheduleModel } = require('./laundry-schedule-fixtures');

const TOWEL = { id: 920, countsAsBathroomLinen: 1, countsAsBedLinen: 0, countsAsBathMat: 0, displayToClient: 1, towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 0 };

function contract(rows) {
  const reservation = { id: 1, kind: 'reservation', propertyId: 1, adults: 4, teens: 0, children: 1 };
  return buildContractsByReservationId({
    reservations: [reservation], options: [TOWEL], reservationOptions: rows, propertyDefaults: [],
  }).get(1);
}

test('rule 6 — the contract sums the people typed on the rows, and the whole party where nobody typed', () => {
  assert.equal(contract([{ reservationId: 1, optionId: 920, quantity: 1, cardPersons: 3 }]).large, 3);
  assert.equal(contract([{ reservationId: 1, optionId: 920, quantity: 1, cardPersons: null }]).large, 5);
  assert.equal(contract([{ reservationId: 1, optionId: 920, quantity: 2, cardPersons: 3 }]).large, 6);
});

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), towelStockLarge INTEGER NOT NULL DEFAULT 0, laundryWeekday INTEGER NOT NULL DEFAULT 2);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', propertyId INTEGER, startDate TEXT, endDate TEXT,
    singleBeds INTEGER DEFAULT 0, doubleBeds INTEGER DEFAULT 0, babyBeds INTEGER DEFAULT 0,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY, countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0,
    linenIncludesSingle INTEGER DEFAULT 0, linenIncludesDouble INTEGER DEFAULT 0, linenIncludesBaby INTEGER DEFAULT 0,
    towelLargePerPerson INTEGER DEFAULT 0, towelMediumPerPerson INTEGER DEFAULT 0, towelSmallPerPerson INTEGER DEFAULT 0
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL DEFAULT 1, cardPersons REAL);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE laundry_trip_skips (tripDate TEXT PRIMARY KEY NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE laundry_trip_manual_additions (
    tripDate TEXT PRIMARY KEY NOT NULL, singleBeds INTEGER NOT NULL DEFAULT 0, doubleBeds INTEGER NOT NULL DEFAULT 0, babyBeds INTEGER NOT NULL DEFAULT 0,
    largeTowels INTEGER NOT NULL DEFAULT 0, mediumTowels INTEGER NOT NULL DEFAULT 0, smallTowels INTEGER NOT NULL DEFAULT 0, bathMats INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE laundry_extra_trips (
    tripDate TEXT PRIMARY KEY NOT NULL, pickUpAll INTEGER NOT NULL DEFAULT 1,
    singleBeds INTEGER NOT NULL DEFAULT 0, doubleBeds INTEGER NOT NULL DEFAULT 0, babyBeds INTEGER NOT NULL DEFAULT 0,
    largeTowels INTEGER NOT NULL DEFAULT 0, mediumTowels INTEGER NOT NULL DEFAULT 0, smallTowels INTEGER NOT NULL DEFAULT 0, bathMats INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

test('rule 6 — the projection reads the typed count from the stored line', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, towelStockLarge) VALUES (1, 10)').run();
  db.prepare('INSERT INTO options (id, countsAsBathroomLinen, towelLargePerPerson) VALUES (920, 1, 1)').run();
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, adults) VALUES (9901, 900, '2099-06-02', '2099-06-04', 5)").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, cardPersons) VALUES (9901, 920, 1, 3)').run();

  const model = linenInventoryModel.buildModel(db, {
    settingsModel: { read: () => db.prepare('SELECT * FROM app_settings WHERE id = 1').get() },
    laundryScheduleModel: fakeScheduleModel(2),
    laundryTripSkipsModel: laundryTripSkipsModel.create(db),
    laundryExtraTripsModel: laundryExtraTripsModel.create(db),
  });
  const { days } = model.simulate({ today: '2099-06-01' });
  assert.equal(days.find((d) => d.date === '2099-06-02').inCirculation.large, 3);
});
