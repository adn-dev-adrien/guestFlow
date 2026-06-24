const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildContractsByReservationId, simulateInventory, ALL_TYPES } = require('../utils/linenInventory');
const laundryModel = require('../models/laundryModel');

// specs/laundry-bath-mat.md — bath mat as a 7th linen type, driven by the "Tapis de bain" option
// (active = explicit selection OR property default), with a per-property flat per-stay quantity.

const BATH_MAT_OPTION = Object.freeze({
  id: 50, countsAsBedLinen: 0, countsAsBathroomLinen: 0, countsAsBathMat: 1,
});

function res(over = {}) {
  return {
    id: 1, kind: 'reservation', propertyId: 10,
    startDate: '2026-06-02', endDate: '2026-06-04',
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, adults: 2, teens: 0, children: 0, babies: 0,
    ...over,
  };
}

// --- Engine contract (buildContractsByReservationId) ---

test('bath mat: explicit option row ⇒ contract = property quantity (flat, ignores guests)', () => {
  const contracts = buildContractsByReservationId({
    reservations: [res({ adults: 5 })],
    options: [BATH_MAT_OPTION],
    reservationOptions: [{ reservationId: 1, optionId: 50, quantity: 1 }],
    propertyDefaults: [],
    bathMatByProperty: new Map([[10, 3]]),
  });
  assert.equal(contracts.get(1).bathMat, 3, 'flat 3, not 3×persons');
});

test('bath mat: property default ⇒ a reservation WITHOUT the option still contributes', () => {
  const contracts = buildContractsByReservationId({
    reservations: [res()],
    options: [BATH_MAT_OPTION],
    reservationOptions: [],
    propertyDefaults: [{ propertyId: 10, optionId: 50 }],
    bathMatByProperty: new Map([[10, 2]]),
  });
  assert.equal(contracts.get(1).bathMat, 2);
});

test('bath mat: option NOT active (no explicit row, no default) ⇒ no contract at all', () => {
  const contracts = buildContractsByReservationId({
    reservations: [res()],
    options: [BATH_MAT_OPTION],
    reservationOptions: [],
    propertyDefaults: [],
    bathMatByProperty: new Map([[10, 4]]),
  });
  assert.equal(contracts.has(1), false, 'zero contract → reservation excluded from the sim');
});

test('bath mat: active but property quantity 0 ⇒ no contribution', () => {
  const contracts = buildContractsByReservationId({
    reservations: [res()],
    options: [BATH_MAT_OPTION],
    reservationOptions: [{ reservationId: 1, optionId: 50, quantity: 1 }],
    propertyDefaults: [],
    bathMatByProperty: new Map([[10, 0]]),
  });
  assert.equal(contracts.has(1), false);
});

test('bath mat: per-property quantity is independent across properties', () => {
  const contracts = buildContractsByReservationId({
    reservations: [res({ id: 1, propertyId: 10 }), res({ id: 2, propertyId: 20 })],
    options: [BATH_MAT_OPTION],
    reservationOptions: [
      { reservationId: 1, optionId: 50, quantity: 1 },
      { reservationId: 2, optionId: 50, quantity: 1 },
    ],
    propertyDefaults: [],
    bathMatByProperty: new Map([[10, 1], [20, 5]]),
  });
  assert.equal(contracts.get(1).bathMat, 1);
  assert.equal(contracts.get(2).bathMat, 5);
});

test('bath mat: conservation invariant holds for the bathMat type through a full cycle', () => {
  const r = simulateInventory({
    stock: { single: 0, double: 0, baby: 0, large: 0, medium: 0, small: 0, bathMat: 10 },
    reservations: [
      res({ id: 1, startDate: '2026-06-03', endDate: '2026-06-05' }),
      res({ id: 99, startDate: '2026-06-25', endDate: '2026-06-27' }), // horizon extender
    ],
    options: [BATH_MAT_OPTION],
    reservationOptions: [{ reservationId: 1, optionId: 50, quantity: 1 }],
    propertyDefaults: [],
    laundryWeekday: 2,
    from: '2026-06-01', to: '2026-06-30',
    bathMatByProperty: new Map([[10, 2]]),
  });
  for (const day of r.days) {
    const sum = ALL_TYPES.reduce((s, t) => s
      + Number(day.clean[t]) + Number(day.inCirculation[t]) + Number(day.dirty[t]) + Number(day.atLaundry[t]), 0);
    // Only bathMat has stock here → the total across all buckets must equal 10 every day.
    assert.equal(sum, 10, `conservation broken on ${day.date}`);
  }
});

// --- laundryModel.dropOffBathMatForWindow ---

function makeLaundryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      propertyId INTEGER, startDate TEXT NOT NULL, endDate TEXT NOT NULL,
      singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
      adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT,
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
      countsAsBathMat INTEGER NOT NULL DEFAULT 0,
      linenIncludesSingle INTEGER NOT NULL DEFAULT 1, linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
      linenIncludesBaby INTEGER NOT NULL DEFAULT 1, towelLargePerPerson INTEGER NOT NULL DEFAULT 1,
      towelMediumPerPerson INTEGER NOT NULL DEFAULT 0, towelSmallPerPerson INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE reservation_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, offered INTEGER DEFAULT 0
    );
    CREATE TABLE property_option_defaults (
      propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, offered INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (propertyId, optionId)
    );
    CREATE TABLE property_option_bath_mats (
      propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (propertyId, optionId)
    );
  `);
  db.prepare("INSERT INTO options (id, title, countsAsBathMat) VALUES (50, 'Tapis de bain', 1)").run();
  return db;
}

function addRes(db, { id, propertyId = 10, endDate, adults = 2 }) {
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults)
    VALUES (?, 'reservation', ?, '2026-06-01', ?, 0, 0, 0, ?)`).run(id, propertyId, endDate, adults);
}

test('dropOffBathMatForWindow: explicit option row contributes the property quantity, half-open window', () => {
  const db = makeLaundryDb();
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (10, 50, 2)').run();
  addRes(db, { id: 1, endDate: '2026-06-04' }); // inside (2026-06-02, 2026-06-09]
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (1, 50, 1)').run();
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathMatForWindow('2026-06-02', '2026-06-09'), { bathMats: 2 });
  // Window excludes a checkout exactly on the left boundary.
  assert.deepEqual(model.dropOffBathMatForWindow('2026-06-04', '2026-06-09'), { bathMats: 0 });
});

test('dropOffBathMatForWindow: property default activates it without an explicit row', () => {
  const db = makeLaundryDb();
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (10, 50, 3)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (10, 50, 1)').run();
  addRes(db, { id: 1, endDate: '2026-06-04' });
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathMatForWindow('2026-06-02', '2026-06-09'), { bathMats: 3 });
});

test('dropOffBathMatForWindow: no active option ⇒ zero even when a quantity exists', () => {
  const db = makeLaundryDb();
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (10, 50, 4)').run();
  addRes(db, { id: 1, endDate: '2026-06-04' }); // option neither selected nor default
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathMatForWindow('2026-06-02', '2026-06-09'), { bathMats: 0 });
});

test('dropOffBathMatForWindow: sums per-property quantities across reservations; devis excluded', () => {
  const db = makeLaundryDb();
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (10, 50, 2)').run();
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (20, 50, 5)').run();
  addRes(db, { id: 1, propertyId: 10, endDate: '2026-06-04' });
  addRes(db, { id: 2, propertyId: 20, endDate: '2026-06-05' });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (1, 50, 1)').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (2, 50, 1)').run();
  // A devis on property 10 with the option must NOT contribute.
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, startDate, endDate, adults)
    VALUES (3, 'devis', 10, '2026-06-01', '2026-06-04', 2)`).run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (3, 50, 1)').run();
  const model = laundryModel.buildModel(db);
  assert.deepEqual(model.dropOffBathMatForWindow('2026-06-02', '2026-06-09'), { bathMats: 7 });
});
