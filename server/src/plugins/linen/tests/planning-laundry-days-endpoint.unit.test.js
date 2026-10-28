// specs/linen-laundry-days.md §3.2 rules 13 and 17 — `GET /api/planning/laundry/days`: the cards to draw
// for a window, any window, and their agreement with the stock projection. Real models on the real
// schema: the point is that the Planning cards and the engine tell the same story day by day.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SRC = path.join(__dirname, '..', '..', '..');
const { applyPluginSchema } = require('../../sdk/testing');
const { buildController } = require('../planningController');
const { buildModel: buildLaundryModel } = require('../laundryModel');
const { buildModel: buildLinenInventoryModel } = require('../linenInventoryModel');
const skipsModel = require('../skipsModel');
const manualAdditionsModel = require('../manualAdditionsModel');
const extraTripsModel = require('../extraTripsModel');
const laundryScheduleModel = require('../laundryScheduleModel');
const { ensurePluginsTable, ensurePluginSettingsTable } = require(path.join(SRC, 'utils/pluginsSchema'));

const SCHEMA = fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8');

// Calendar (June 2026): Tuesdays 02, 09, 16, 23, 30 — Thursdays 04, 11, 18, 25.
const TODAY = '2026-06-10';
const STOCK = { bedLinenStockSingle: 12, bedLinenStockDouble: 12, bedLinenStockBaby: 0, towelStockLarge: 0, towelStockMedium: 0, towelStockSmall: 0, towelStockBathMat: 0 };

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fresh({ today = TODAY, stock = STOCK } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('INSERT INTO app_settings (id) VALUES (1)');
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  db.prepare("INSERT INTO plugins (id) VALUES ('linen')").run();
  applyPluginSchema(db, 'linen');
  const property = Number(db.prepare("INSERT INTO properties (name) VALUES ('Gîte du Midi')").run().lastInsertRowid);
  const client = Number(db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Alice', 'Durand')").run().lastInsertRowid);
  const bedOption = Number(db.prepare(`
    INSERT INTO options (title, autoOptionType, countsAsBedLinen, linenIncludesSingle, linenIncludesDouble, linenIncludesBaby)
    VALUES ('Linge de lit', 'bed_linen', 1, 1, 1, 1)
  `).run().lastInsertRowid);

  const models = {
    laundryModel: buildLaundryModel(db),
    laundryScheduleModel: laundryScheduleModel.create(db),
    laundryTripSkipsModel: skipsModel.create(db),
    laundryManualAdditionsModel: manualAdditionsModel.create(db),
    laundryExtraTripsModel: extraTripsModel.create(db),
    settingsModel: { read: () => ({ ...stock }) },
  };
  const linenInventoryModel = buildLinenInventoryModel(db, {
    settingsModel: models.settingsModel,
    laundryScheduleModel: models.laundryScheduleModel,
    laundryTripSkipsModel: models.laundryTripSkipsModel,
    laundryManualAdditionsModel: models.laundryManualAdditionsModel,
    laundryExtraTripsModel: models.laundryExtraTripsModel,
  });
  const controller = buildController({ ...models, linenInventoryModel, today: () => today });

  const stay = (startDate, endDate, { singleBeds = 0, doubleBeds = 0, babyBeds = 0 } = {}) => {
    const id = Number(db.prepare(`
      INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, singleBeds, doubleBeds, babyBeds, adults, teens, children, babies)
      VALUES ('reservation', ?, ?, ?, ?, ?, ?, ?, 2, 0, 0, 0)
    `).run(property, client, startDate, endDate, singleBeds, doubleBeds, babyBeds).lastInsertRowid);
    db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (?, ?, 1)').run(id, bedOption);
    return id;
  };
  const setSchedule = (effectiveFrom, weekdays, turnaroundDays) => models.laundryScheduleModel.upsert(effectiveFrom, { weekdays, turnaroundDays });
  const days = (from, to) => {
    const res = makeRes();
    controller.laundryDays({ query: { from, to } }, res);
    return res;
  };
  return { db, models, linenInventoryModel, controller, stay, setSchedule, days, property, client, bedOption };
}

const TYPE_KEYS = { single: 'singleBeds', double: 'doubleBeds', baby: 'babyBeds', large: 'largeTowels', medium: 'mediumTowels', small: 'smallTowels', bathMat: 'bathMats' };

// --- Rule 13: bounds ----------------------------------------------------------------------------

test('specs/linen-laundry-days.md §3.2 rule 13: both bounds are required and well formed', () => {
  const { controller } = fresh();
  for (const query of [{}, { from: '2026-06-01' }, { to: '2026-06-30' }, { from: 'x', to: '2026-06-30' }, { from: '2026-06-01', to: '30/06/2026' }, { from: '2026-06-30', to: '2026-06-01' }]) {
    const res = makeRes();
    controller.laundryDays({ query }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.deepEqual(res.body, { error: 'INVALID_DATE_RANGE' });
  }
});

test('specs/linen-laundry-days.md §3.2 rule 13: a pathological span is refused before any model is read', () => {
  const trap = new Proxy({}, { get() { return () => { throw new Error('nothing should be read'); }; } });
  const controller = buildController({
    laundryModel: trap, settingsModel: trap, linenInventoryModel: trap, laundryScheduleModel: trap,
    laundryTripSkipsModel: trap, laundryManualAdditionsModel: trap, laundryExtraTripsModel: trap, today: () => TODAY,
  });
  const res = makeRes();
  controller.laundryDays({ query: { from: '0001-01-01', to: '9999-12-31' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'DATE_RANGE_TOO_WIDE' });
});

// --- Rule 13: which dates are drawn -------------------------------------------------------------

test('specs/linen-laundry-days.md §3.2 rule 13: a regular day with nothing to bring or collect is not drawn', () => {
  const { days } = fresh();
  const res = days('2026-06-01', '2026-06-30');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { days: {} });
});

test('specs/linen-laundry-days.md §3.2 rule 13: a regular day with linen to bring is drawn, the others of the schedule are not', () => {
  const { days, stay, setSchedule } = fresh();
  setSchedule('0001-01-01', [2, 4], 1);
  stay('2026-06-05', '2026-06-11', { doubleBeds: 2 });
  const res = days('2026-06-08', '2026-06-14');
  assert.deepEqual(Object.keys(res.body.days), ['2026-06-11']);
  const card = res.body.days['2026-06-11'];
  assert.equal(card.kind, 'regular');
  assert.equal(card.isSkipped, false);
  assert.equal(card.dropOff.doubleBeds, 2);
  assert.deepEqual(card.dropOff.incomplete, []);
  assert.deepEqual(card.pickUp.fromTrips, []);
  assert.equal(card.stillAtLaundry, null);
  assert.equal(card.manualAddition, null);
  assert.equal(card.extraTrip, null);
  assert.equal(card.leftAtLaundry, null);
});

test('specs/linen-laundry-days.md §3.2 rule 13: a day that only collects is drawn, and names where the linen was dropped', () => {
  const { days, stay, setSchedule } = fresh();
  setSchedule('0001-01-01', [2, 4], 2);
  stay('2026-06-05', '2026-06-09', { singleBeds: 3 });
  const card = days('2026-06-11', '2026-06-11').body.days['2026-06-11'];
  assert.equal(card.dropOff.singleBeds, 0);
  assert.equal(card.pickUp.singleBeds, 3);
  assert.deepEqual(card.pickUp.fromTrips, ['2026-06-09']);
});

test('specs/linen-laundry-days.md §3.2 rule 13: a day with only bath mats still counts as a day with linen', () => {
  const { days, db, setSchedule, property, client } = fresh();
  setSchedule('0001-01-01', [2], 1);
  const mat = Number(db.prepare("INSERT INTO options (title, countsAsBathMat) VALUES ('Tapis de bain', 1)").run().lastInsertRowid);
  db.exec('CREATE TABLE IF NOT EXISTS property_option_bath_mats (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (propertyId, optionId))');
  db.prepare('INSERT INTO property_option_bath_mats (propertyId, optionId, quantity) VALUES (?, ?, 2)').run(property, mat);
  const stayId = Number(db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults) VALUES ('reservation', ?, ?, '2026-06-05', '2026-06-09', 2)").run(property, client).lastInsertRowid);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (?, ?, 1)').run(stayId, mat);
  const card = days('2026-06-09', '2026-06-09').body.days['2026-06-09'];
  assert.ok(card, 'a bath-mat-only drop-off is drawn');
  assert.equal(card.dropOff.bathMats, 2);
});

test('specs/linen-laundry-days.md §3.2 rule 13: a skipped regular day is always drawn, with zeros, so it can be reverted', () => {
  const { days, models } = fresh();
  models.laundryTripSkipsModel.add('2026-06-09');
  const card = days('2026-06-08', '2026-06-10').body.days['2026-06-09'];
  assert.equal(card.kind, 'regular');
  assert.equal(card.isSkipped, true);
  assert.equal(card.dropOff.singleBeds, 0);
  assert.equal(card.stillAtLaundry, null);
});

test('specs/linen-laundry-days.md §3.2 rule 13: an extra trip is always drawn, with its record and, when partial, what it leaves', () => {
  const { days, models, stay } = fresh();
  stay('2026-06-05', '2026-06-08', { singleBeds: 4 });
  models.laundryExtraTripsModel.set('2026-06-12', { pickUpAll: false, pickUp: { singleBeds: 1 } });
  const card = days('2026-06-12', '2026-06-12').body.days['2026-06-12'];
  assert.equal(card.kind, 'extra');
  assert.equal(card.isSkipped, false);
  assert.equal(card.extraTrip.pickUpAll, false);
  assert.equal(card.extraTrip.pickUp.singleBeds, 1);
  // Tuesday 06-09 dropped the 4 singles (ready the next day): the extra trip declares 1 and leaves the other 3.
  assert.equal(card.pickUp.singleBeds, 1);
  assert.deepEqual(card.pickUp.fromTrips, ['2026-06-09']);
  assert.equal(card.leftAtLaundry.singleBeds, 3);
});

test('specs/linen-laundry-days.md §3.2 rule 13: an extra trip with nothing at all is still drawn', () => {
  const { days, models } = fresh();
  models.laundryExtraTripsModel.set('2026-06-12', { pickUpAll: true, pickUp: {} });
  const card = days('2026-06-12', '2026-06-12').body.days['2026-06-12'];
  assert.equal(card.kind, 'extra');
  assert.equal(card.extraTrip.pickUpAll, true);
  assert.equal(card.leftAtLaundry, null);
});

test('specs/linen-laundry-days.md §3.2 rule 13: a day whose drop-off has stays without a quantity yet is drawn, with them', () => {
  const { days, stay, setSchedule } = fresh();
  setSchedule('0001-01-01', [2], 1);
  // The stay carries the bed-linen option but no bed quantity yet: it contributes 0 and is flagged.
  const stayId = stay('2026-06-05', '2026-06-09');
  const card = days('2026-06-09', '2026-06-09').body.days['2026-06-09'];
  assert.ok(card, 'incomplete stays keep the card');
  assert.deepEqual(card.dropOff.incomplete.map((r) => r.id), [stayId]);
});

test('specs/linen-laundry-days.md §3.2 rule 11: a day with batches still at the laundry is drawn with stillAtLaundry and its readiness', () => {
  const { days, stay, setSchedule } = fresh();
  setSchedule('0001-01-01', [2, 4], 3);
  stay('2026-06-05', '2026-06-09', { doubleBeds: 2 });
  // Thursday 06-11: nothing to bring or collect, but Tuesday's batch (ready 06-12) is still there.
  const card = days('2026-06-11', '2026-06-11').body.days['2026-06-11'];
  assert.ok(card);
  assert.equal(card.dropOff.doubleBeds, 0);
  assert.equal(card.pickUp.doubleBeds, 0);
  assert.equal(card.stillAtLaundry.counts.doubleBeds, 2);
  assert.equal(card.stillAtLaundry.readyOn, '2026-06-12');
});

test('specs/linen-laundry-days.md §3.2 rule 13: the manual line of the date rides on the card, signed', () => {
  const { days, models, stay } = fresh();
  stay('2026-06-05', '2026-06-09', { singleBeds: 2 });
  models.laundryManualAdditionsModel.set('2026-06-09', { singleBeds: -1, doubleBeds: 3 });
  const card = days('2026-06-09', '2026-06-09').body.days['2026-06-09'];
  assert.equal(card.manualAddition.singleBeds, -1);
  assert.equal(card.manualAddition.doubleBeds, 3);
  assert.equal(card.dropOff.singleBeds, 1);
  assert.equal(card.dropOff.doubleBeds, 3);
});

// --- Rule 13: past and future windows, the projection -------------------------------------------

test('specs/linen-laundry-days.md §3.2 rule 13: a window entirely in the past is answered, without inventoryAfter', () => {
  const { days, stay } = fresh({ today: '2026-07-15' });
  stay('2026-06-05', '2026-06-09', { singleBeds: 2 });
  stay('2026-07-10', '2026-07-20', { singleBeds: 1 });
  const res = days('2026-06-01', '2026-06-14');
  assert.equal(res.statusCode, 200);
  const card = res.body.days['2026-06-09'];
  assert.equal(card.dropOff.singleBeds, 2);
  assert.equal(card.inventoryAfter, null);
});

test('specs/linen-laundry-days.md §3.2 rule 13: from today on a card carries inventoryAfter, for the tracked types only', () => {
  const { days, stay } = fresh();
  stay('2026-06-05', '2026-06-16', { singleBeds: 2, doubleBeds: 1 });
  const card = days('2026-06-16', '2026-06-16').body.days['2026-06-16'];
  assert.deepEqual(Object.keys(card.inventoryAfter).sort(), ['double', 'single']);   // baby, towels, mats: stock 0 → untracked
  assert.equal(typeof card.inventoryAfter.single, 'number');
});

test('specs/linen-laundry-days.md §3.2 rule 13: no horizon (no stay ahead) means no inventoryAfter, and the cards still come', () => {
  const { days, stay } = fresh({ today: '2026-06-30' });
  stay('2026-06-05', '2026-06-09', { singleBeds: 2 });
  const card = days('2026-06-09', '2026-06-09').body.days['2026-06-09'];
  assert.equal(card.dropOff.singleBeds, 2);
  assert.equal(card.inventoryAfter, null);
});

test('specs/linen-laundry-days.md §3.2 rule 13: a window straddling today answers the past without a projection and the future with one', () => {
  const { days, stay } = fresh();
  stay('2026-06-03', '2026-06-09', { singleBeds: 2 });
  stay('2026-06-12', '2026-06-16', { singleBeds: 2 });
  const body = days('2026-06-02', '2026-06-20').body.days;
  assert.equal(body['2026-06-09'].inventoryAfter, null);
  assert.ok(body['2026-06-16'].inventoryAfter);
});

// --- Rules 5 and 13: the past keeps its rhythm --------------------------------------------------

test('specs/linen-laundry-days.md §3.1 rule 5: after a change of schedule, the cards before it keep the old rhythm', () => {
  const { days, stay, setSchedule } = fresh({ today: '2026-06-01' });
  setSchedule('2026-06-10', [2, 4], 1);
  for (const [start, end] of [['2026-06-01', '2026-06-04'], ['2026-06-05', '2026-06-09'], ['2026-06-10', '2026-06-11'], ['2026-06-12', '2026-06-16']]) {
    stay(start, end, { singleBeds: 1 });
  }
  const dates = Object.keys(days('2026-06-01', '2026-06-20').body.days);
  assert.ok(!dates.includes('2026-06-04'), 'a Thursday before the change is not a laundry day');
  assert.ok(dates.includes('2026-06-09'));
  assert.ok(dates.includes('2026-06-11'), 'a Thursday after the change is');
});

// --- Rule 17: the cards and the projection agree -------------------------------------------------

test('specs/linen-laundry-days.md §3.2 rule 17: every trip date of a Tuesday + Thursday month — skip, extra trip, partial pick-up, manual lines and a turnaround change included — shows the engine\'s moves', () => {
  const { days, models, stay, setSchedule, linenInventoryModel } = fresh();
  setSchedule('0001-01-01', [2, 4], 2);
  setSchedule('2026-06-16', [2, 4], 3);          // the turnaround changes mid-month
  const stays = [
    ['2026-05-30', '2026-06-02', { singleBeds: 2, doubleBeds: 1 }], ['2026-06-01', '2026-06-04', { singleBeds: 1 }],
    ['2026-06-03', '2026-06-09', { doubleBeds: 2 }], ['2026-06-04', '2026-06-06', { singleBeds: 3 }],
    ['2026-06-08', '2026-06-11', { singleBeds: 2, babyBeds: 1 }], ['2026-06-09', '2026-06-13', { doubleBeds: 1 }],
    ['2026-06-10', '2026-06-16', { singleBeds: 2 }], ['2026-06-12', '2026-06-18', { doubleBeds: 2, singleBeds: 1 }],
    ['2026-06-15', '2026-06-20', { singleBeds: 4 }], ['2026-06-17', '2026-06-23', { doubleBeds: 3 }],
    ['2026-06-19', '2026-06-25', { singleBeds: 2 }], ['2026-06-22', '2026-06-30', { doubleBeds: 2, singleBeds: 2 }],
  ];
  stays.forEach(([start, end, beds]) => stay(start, end, beds));
  models.laundryTripSkipsModel.add('2026-06-23');                                                 // a skipped Tuesday
  models.laundryExtraTripsModel.set('2026-06-13', { pickUpAll: false, pickUp: { singleBeds: 2 } }); // a partial pick-up on a Saturday
  models.laundryExtraTripsModel.set('2026-06-27', { pickUpAll: true, pickUp: {} });               // a full one
  models.laundryManualAdditionsModel.set('2026-06-11', { singleBeds: 2 });
  models.laundryManualAdditionsModel.set('2026-06-18', { doubleBeds: -1 });
  models.laundryManualAdditionsModel.set('2026-06-13', { doubleBeds: 1 });

  const sim = linenInventoryModel.simulate({ today: TODAY });
  assert.ok(sim, 'a horizon exists');
  const cards = days(TODAY, sim.horizon).body.days;
  let comparedTripDays = 0;
  for (const engineDay of sim.days) {
    if (!engineDay.isTripDay) {
      // No card, except a skipped laundry day, always drawn (empty) so it can be reverted.
      const card = cards[engineDay.date];
      assert.ok(!card || card.isSkipped, `${engineDay.date} is not a trip day: no card`);
      continue;
    }
    comparedTripDays += 1;
    const card = cards[engineDay.date];
    const batchesBefore = engineDay.batches.filter((b) => b.dropDate !== engineDay.date);
    for (const [type, key] of Object.entries(TYPE_KEYS)) {
      assert.equal(card ? card.dropOff[key] : 0, engineDay.dropped[type], `${engineDay.date} drop-off ${key}`);
      assert.equal(card ? card.pickUp[key] : 0, engineDay.pickedUp[type], `${engineDay.date} pick-up ${key}`);
      const still = batchesBefore.reduce((s, b) => s + b.counts[type], 0);
      assert.equal(card && card.stillAtLaundry ? card.stillAtLaundry.counts[key] : 0, still, `${engineDay.date} still at the laundry ${key}`);
    }
    if (batchesBefore.length > 0) {
      assert.equal(card.stillAtLaundry.readyOn, batchesBefore.map((b) => b.readyFrom).sort()[0], `${engineDay.date} readyOn`);
    }
    if (card && card.inventoryAfter) {
      assert.equal(card.inventoryAfter.single, engineDay.clean.single, `${engineDay.date} inventoryAfter single`);
      assert.equal(card.inventoryAfter.double, engineDay.clean.double, `${engineDay.date} inventoryAfter double`);
    }
  }
  assert.ok(comparedTripDays >= 7, `the month had ${comparedTripDays} trip days`);
  assert.ok(Object.values(cards).some((c) => c.pickUp.fromTrips.length > 0));
  assert.ok(Object.values(cards).some((c) => c.stillAtLaundry), 'the turnaround of 3 leaves linen at the laundry on some Thursday');
});
