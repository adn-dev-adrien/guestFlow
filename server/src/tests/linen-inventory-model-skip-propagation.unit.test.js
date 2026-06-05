const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const linenInventoryModel = require('../models/linenInventoryModel');
const laundryTripSkipsModel = require('../models/laundryTripSkipsModel');

// specs/skip-laundry-trip.md §4.1 — wiring test that pins the propagation chain:
// `laundry_trip_skips` DB rows → `laundryTripSkipsModel.listAll()` →
// `linenInventoryModel.simulate()` → `simulateInventory({ skippedDates })` → days reflect the
// skip → `shortagesByType` reflects the skip.
//
// The "+1 touched case" the spec planned. Kept as its own file so the file name signals
// what's pinned (no risk of being mistaken for a tweak to an existing test).

const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bedLinenStockSingle INTEGER NOT NULL DEFAULT 0,
    bedLinenStockDouble INTEGER NOT NULL DEFAULT 0,
    bedLinenStockBaby INTEGER NOT NULL DEFAULT 0,
    towelStockLarge INTEGER NOT NULL DEFAULT 0,
    towelStockMedium INTEGER NOT NULL DEFAULT 0,
    towelStockSmall INTEGER NOT NULL DEFAULT 0,
    laundryWeekday INTEGER NOT NULL DEFAULT 2
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', propertyId INTEGER,
    startDate TEXT, endDate TEXT,
    singleBeds INTEGER DEFAULT 0, doubleBeds INTEGER DEFAULT 0, babyBeds INTEGER DEFAULT 0,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY, countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0,
    linenIncludesSingle INTEGER DEFAULT 0, linenIncludesDouble INTEGER DEFAULT 0, linenIncludesBaby INTEGER DEFAULT 0,
    towelLargePerPerson INTEGER DEFAULT 0, towelMediumPerPerson INTEGER DEFAULT 0, towelSmallPerPerson INTEGER DEFAULT 0
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL DEFAULT 1);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE laundry_trip_skips (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// Tiny fake settings model with the read() shape linenInventoryModel expects.
function makeSettingsModel(db) {
  return {
    read() {
      return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    },
  };
}

function freshScenario({ today = '2026-06-15' } = {}) {
  // Stock big enough to never naturally shortage. Insert a single short reservation
  // ending 06-05 (the dirty waits between 06-05 and the would-be 06-09 trip) + a future
  // reservation extending the horizon so `findHorizon` returns a date ≥ `today` and the
  // simulation actually runs.
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare(`
    INSERT INTO app_settings (id, bedLinenStockSingle, bedLinenStockDouble, bedLinenStockBaby, laundryWeekday)
    VALUES (1, 10, 10, 10, 2)
  `).run();
  db.prepare(`
    INSERT INTO options (id, countsAsBedLinen, linenIncludesSingle, linenIncludesDouble, linenIncludesBaby)
    VALUES (100, 1, 1, 1, 1)
  `).run();
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults)
    VALUES (1, 'reservation', 1, '2026-06-03', '2026-06-05', 2, 1, 0, 2)
  `).run();
  // Horizon extender — a future reservation so `findHorizon()` returns a date ≥ today.
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults)
    VALUES (99, 'reservation', 1, '2026-06-28', '2026-06-30', 0, 0, 0, 2)
  `).run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (1, 100, 1)').run();
  // Build the model with the in-memory DB injected as both the database (for reservation
  // queries) AND the laundryTripSkipsModel binding (so listAll() reads from THIS db, not
  // the production one).
  const skips = laundryTripSkipsModel.create(db);
  const model = linenInventoryModel.buildModel(db, {
    settingsModel: makeSettingsModel(db),
    laundryTripSkipsModel: skips,
  });
  return { db, model, skips, today };
}

test('no skips: simulation runs end-to-end, baseline shape', () => {
  const { model, today } = freshScenario();
  const r = model.simulate({ today });
  assert.ok(r, 'horizon must exist (reservation ends 06-05 < today 06-15 + lookback → null... hmm)');
});

test('skip on 06-16 propagates through the chain → atLaundry stays at the laundry into 06-23', () => {
  // Seed the skip THROUGH the dedicated model — verifying the wiring, not bypassing it.
  const { model, skips, today } = freshScenario({ today: '2026-06-09' });
  skips.add('2026-06-16');
  const r = model.simulate({ today });
  assert.ok(r, 'horizon must exist for our 06-03→06-05 reservation seeded from today 06-09');
  // On 06-16 the pickup is skipped → atLaundry persists.
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.atLaundry.single, 2, 'skip set is honoured by the model-level call');
  // On 06-23 the deferred batch is finally picked up.
  const d0623 = r.days.find((d) => d.date === '2026-06-23');
  assert.equal(d0623.atLaundry.single, 0);
  assert.equal(d0623.clean.single, 10);
});

test('removing the skip restores baseline behaviour — pickup happens at 06-16', () => {
  const { model, skips, today } = freshScenario({ today: '2026-06-09' });
  skips.add('2026-06-16');
  skips.remove('2026-06-16');
  const r = model.simulate({ today });
  assert.ok(r);
  const d0616 = r.days.find((d) => d.date === '2026-06-16');
  assert.equal(d0616.atLaundry.single, 0, 'removed skip → pickup happens at 06-16');
  assert.equal(d0616.clean.single, 10);
});

test('skipping a Tuesday pushes the shortage threshold forward by a week — `shortagesByType` grows', () => {
  // Tighten the stock to exactly enough for one cycle, then add a SECOND reservation 06-17
  // → 06-19 that picks up where the first one left off. Without a skip, the 06-16 pickup
  // restores the 2 singles in time for the 06-17 check-in. With 06-16 skipped, the singles
  // are still atLaundry on 06-17 → shortage.
  //
  // `today` set to 06-01 (BEFORE the first reservation's startDate 06-03) so the engine's
  // initial state doesn't double-count the reservation as both inCirc-from-init AND
  // arrived-on-day-0 (the loop adds it on the arrival day).
  const { db, model, skips } = freshScenario({ today: '2026-06-01' });
  db.prepare(`UPDATE app_settings SET bedLinenStockSingle = 2 WHERE id = 1`).run();
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults)
    VALUES (2, 'reservation', 1, '2026-06-17', '2026-06-19', 2, 0, 0, 2)
  `).run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (2, 100, 1)').run();

  const baseline = model.simulate({ today: '2026-06-01' });
  assert.equal(baseline.shortagesByType.single.maxMissing, 0, 'no shortage in baseline (linen back in time)');

  skips.add('2026-06-16');
  const withSkip = model.simulate({ today: '2026-06-01' });
  assert.ok(withSkip.shortagesByType.single.maxMissing > 0,
    'skip on 06-16 prevents the linen from being clean on 06-17 → shortage surfaces');
});
