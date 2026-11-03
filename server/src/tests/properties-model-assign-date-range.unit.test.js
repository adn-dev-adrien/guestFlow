const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const propertiesModel = require('../models/propertiesModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

/** `YYYY-MM-DD`, `days` after today: the dates of this suite hang on it (specs/server-test-isolation.md rule 6). */
const inDays = (days) => addDaysToIsoDate(todayIso(), days);
const { computeDateRangeAssignment } = propertiesModel.__test;

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// specs/pricing-min-nights-per-range.md — calendar season painting. `computeDateRangeAssignment`
// carves a selected period out of every season and (re)attaches it to a target season (existing/new)
// with its own minimum-nights, splitting the covering season and deleting one emptied by the carve.

function ruleRow(id, label, minNights, ranges) {
  return { id, label, minNights, dateRanges: JSON.stringify(ranges) };
}

test('period in the middle of a season splits it into two ranges + the pont range', () => {
  const rules = [ruleRow(1, 'Mai', 1, [{ startDate: inDays(-186), endDate: inDays(-156) }])];
  const plan = computeDateRangeAssignment(rules, {
    startDate: inDays(-179), endDate: inDays(-178), minNights: 3, target: { mode: 'existing', ruleId: 1 },
  });

  assert.equal(plan.deletedRuleIds.length, 0);
  assert.equal(plan.updatedRules.length, 1);
  assert.deepEqual(plan.updatedRules[0].dateRanges, [
    { startDate: inDays(-186), endDate: inDays(-180) },
    { startDate: inDays(-179), endDate: inDays(-178), minNights: 3 },
    { startDate: inDays(-177), endDate: inDays(-156) },
  ]);
  assert.equal(plan.updatedRules[0].startDate, inDays(-186));
  assert.equal(plan.updatedRules[0].endDate, inDays(-156));
});

test('period at the start of a range leaves a single leftover part', () => {
  const rules = [ruleRow(1, 'Ete', 1, [{ startDate: inDays(-125), endDate: inDays(-95) }])];
  const plan = computeDateRangeAssignment(rules, {
    startDate: inDays(-125), endDate: inDays(-123), minNights: 2, target: { mode: 'existing', ruleId: 1 },
  });
  assert.deepEqual(plan.updatedRules[0].dateRanges, [
    { startDate: inDays(-125), endDate: inDays(-123), minNights: 2 },
    { startDate: inDays(-122), endDate: inDays(-95) },
  ]);
});

test('assigning a period to another season carves the covering one (cross-season)', () => {
  const rules = [
    ruleRow(1, 'A', 1, [{ startDate: inDays(-186), endDate: inDays(-156) }]),
    ruleRow(2, 'B', 1, [{ startDate: inDays(-155), endDate: inDays(-126) }]),
  ];
  const plan = computeDateRangeAssignment(rules, {
    startDate: inDays(-177), endDate: inDays(-175), minNights: 2, target: { mode: 'existing', ruleId: 2 },
  });
  const a = plan.updatedRules.find((r) => r.id === 1);
  const b = plan.updatedRules.find((r) => r.id === 2);
  assert.deepEqual(a.dateRanges, [
    { startDate: inDays(-186), endDate: inDays(-178) },
    { startDate: inDays(-174), endDate: inDays(-156) },
  ]);
  assert.deepEqual(b.dateRanges, [
    { startDate: inDays(-177), endDate: inDays(-175), minNights: 2 },
    { startDate: inDays(-155), endDate: inDays(-126) },
  ]);
});

test('a season fully absorbed by the carve is flagged for deletion; a new season is created', () => {
  const rules = [
    ruleRow(1, 'Juin', 1, [{ startDate: inDays(-155), endDate: inDays(-146) }]),
    ruleRow(2, 'Autre', 1, [{ startDate: inDays(-125), endDate: inDays(-116) }]),
  ];
  const plan = computeDateRangeAssignment(rules, {
    startDate: inDays(-155), endDate: inDays(-146), minNights: 3,
    target: { mode: 'new', label: 'Pont', color: '#123456', pricePerNight: 150, pricingMode: 'fixed' },
  });
  assert.deepEqual(plan.deletedRuleIds, [1]);
  assert.equal(plan.updatedRules.length, 0); // rule 2 untouched (no overlap)
  assert.ok(plan.newRule);
  assert.equal(plan.newRule.minNights, 3);
  assert.deepEqual(plan.newRule.dateRanges, [{ startDate: inDays(-155), endDate: inDays(-146) }]);
});

test('an attached period with min == season default merges with an adjacent inherited range', () => {
  const rules = [ruleRow(1, 'A', 1, [{ startDate: inDays(-94), endDate: inDays(-85) }])];
  const plan = computeDateRangeAssignment(rules, {
    startDate: inDays(-84), endDate: inDays(-80), minNights: 1, target: { mode: 'existing', ruleId: 1 },
  });
  // min 1 == season default → no per-range override stored → merges into one range.
  assert.deepEqual(plan.updatedRules[0].dateRanges, [{ startDate: inDays(-94), endDate: inDays(-80) }]);
});

// ---- Model method (DB-backed): validation + persistence ----

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  return db;
}

test('assignDateRangeToSeason persists the carve + per-range min (existing season)', () => {
  const db = freshDb();
  const model = propertiesModel.buildModel(db);
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, minNights, dateRanges, startDate, endDate) VALUES (1, 1, 'Mai', 100, 1, ?, '${inDays(-186)}', '${inDays(-156)}')`)
    .run(JSON.stringify([{ startDate: inDays(-186), endDate: inDays(-156) }]));

  const res = model.assignDateRangeToSeason(1, {
    startDate: inDays(-179), endDate: inDays(-178), minNights: 3, target: { mode: 'existing', ruleId: 1 },
  });
  assert.ok(res.data && res.data.ok);

  const row = db.prepare('SELECT dateRanges, startDate, endDate FROM pricing_rules WHERE id = 1').get();
  assert.deepEqual(JSON.parse(row.dateRanges), [
    { startDate: inDays(-186), endDate: inDays(-180) },
    { startDate: inDays(-179), endDate: inDays(-178), minNights: 3 },
    { startDate: inDays(-177), endDate: inDays(-156) },
  ]);
  assert.equal(row.startDate, inDays(-186));
  assert.equal(row.endDate, inDays(-156));
});

test('assignDateRangeToSeason creates a new season and deletes the emptied one', () => {
  const db = freshDb();
  const model = propertiesModel.buildModel(db);
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, minNights, dateRanges, startDate, endDate) VALUES (1, 1, 'Juin', 100, 1, ?, '${inDays(-155)}', '${inDays(-146)}')`)
    .run(JSON.stringify([{ startDate: inDays(-155), endDate: inDays(-146) }]));

  const res = model.assignDateRangeToSeason(1, {
    startDate: inDays(-155), endDate: inDays(-146), minNights: 3,
    target: { mode: 'new', label: 'Pont', color: '#123456', pricePerNight: 150, pricingMode: 'fixed' },
  });
  assert.ok(res.data.ok);
  assert.deepEqual(res.data.deletedLabels, ['Juin']);

  const rows = db.prepare('SELECT label, minNights, dateRanges FROM pricing_rules WHERE propertyId = 1').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Pont');
  assert.equal(rows[0].minNights, 3);
  assert.deepEqual(JSON.parse(rows[0].dateRanges), [{ startDate: inDays(-155), endDate: inDays(-146) }]);
});

test('assignDateRangeToSeason rejects invalid input', () => {
  const db = freshDb();
  const model = propertiesModel.buildModel(db);
  db.prepare("INSERT INTO pricing_rules (id, propertyId, label, minNights, dateRanges) VALUES (1, 1, 'X', 1, ?)")
    .run(JSON.stringify([{ startDate: inDays(-186), endDate: inDays(-156) }]));
  const ok = { mode: 'existing', ruleId: 1 };

  assert.equal(model.assignDateRangeToSeason(1, { startDate: 'bad', endDate: inDays(-178), minNights: 3, target: ok }).status, 400);
  assert.equal(model.assignDateRangeToSeason(1, { startDate: inDays(-177), endDate: inDays(-178), minNights: 3, target: ok }).status, 400);
  assert.equal(model.assignDateRangeToSeason(1, { startDate: inDays(-179), endDate: inDays(-178), minNights: 0, target: ok }).status, 400);
  assert.equal(model.assignDateRangeToSeason(1, { startDate: inDays(-179), endDate: inDays(-178), minNights: 3, target: { mode: 'existing', ruleId: 999 } }).status, 404);
});
