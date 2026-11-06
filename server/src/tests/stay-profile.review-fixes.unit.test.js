const test = require('node:test');
const assert = require('node:assert/strict');

// specs/stay-profile.md §3 rules 22, 23, 24 and 26 — review of 2026-11-06 (R4-2, R4-3, R4-9, R4-11):
// the basket removes the tourist tax actually inside the total, lead times read each logement's own
// tracking start, an exercise over before the history has no notice, and a unit never leaves its number.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const stayProfileModel = require('../models/stayProfileModel');
const { touristTaxInTotal } = require('../utils/stayTouristTaxInTotal');
const BUCKETS = require('../constants/stayProfileBuckets');
const { addDays } = require('../utils/financeOccupancy');
const fiscalYearUtil = require('../utils/fiscalYear');

const at = (n) => addDays(TODAY, n);
const stamp = (n) => `${at(n)} 12:00:00`;

function richDb() {
  const env = freshDb();
  env.db.exec(`
    ALTER TABLE reservations ADD COLUMN touristTaxInComplement INTEGER DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN touristTaxAddedGuestsAmount REAL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN touristTaxAcompteContribTtc REAL;
    ALTER TABLE reservations ADD COLUMN touristTaxSoldeContribTtc REAL;
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1, touristTaxRemittedByPlatform INTEGER DEFAULT 1);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformKey TEXT, platformLabel TEXT);
    INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Abracadaroom', 0, 0), ('Booking', 1, 0);
  `);
  insert(env.db, { startDate: at(-400), endDate: at(-398), createdAt: stamp(-400), balanceAmount: 100 });
  env.profile = stayProfileModel.buildModel(env.db);
  return env;
}
const thisMonth = (data) => data.basket.rows.find((r) => r.month === TODAY.slice(0, 7));

test('rule 22 — a tax collected at arrival in the caisse interne is not in the total: nothing removed', () => {
  const { db, profile } = richDb();
  // Platform in « we collect at arrival » mode: the tax rides the complement, paid in cash.
  insert(db, {
    platform: 'Abracadaroom', startDate: at(-3), endDate: TODAY, createdAt: stamp(-40),
    balanceAmount: 250.74, finalPrice: 250.74, touristTaxTotal: 11.96,
    complementAmount: 11.96, complementPaid: 1, complementPaidCash: 1, complementPaidDate: TODAY,
  });
  assert.deepEqual(thisMonth(profile.getStayProfile({}).data).current, { stays: 1, revenue: 250.74, average: 250.74 });
});

test('rule 22 — a reversing platform: the whole tax leaves the netted solde, not a proportion', () => {
  const { db, profile } = richDb();
  insert(db, {
    platform: 'Booking', startDate: at(-3), endDate: TODAY, createdAt: stamp(-40),
    balanceAmount: 600, balancePaid: 1, balancePaidDate: TODAY, platformCommissionAmount: 113.44,
    finalPrice: 576, touristTaxTotal: 24, touristTaxSoldeContribTtc: 24, touristTaxAcompteContribTtc: 0,
  });
  const data = profile.getStayProfile({}).data;
  assert.deepEqual(thisMonth(data).current, { stays: 1, revenue: 462.56, average: 462.56 });
  // The breakdowns keep the page's « total de séjour ».
  assert.equal(profile.getStayProfile({ period: 'custom', from: at(-30), to: at(10) }).data.totals.amount, 486.56);
});

test('rule 22 — a tax forced to the complement is removed with it; a solde paid in cash takes its tax away', () => {
  const { db, profile } = richDb();
  insert(db, {
    startDate: at(-3), endDate: TODAY, createdAt: stamp(-40), touristTaxInComplement: 1,
    balanceAmount: 300, finalPrice: 300, touristTaxTotal: 9, complementAmount: 9,
  });
  insert(db, {
    startDate: at(-6), endDate: TODAY, createdAt: stamp(-40),
    depositAmount: 100, balanceAmount: 220, balancePaid: 1, balancePaidCash: 1, balancePaidDate: TODAY,
    finalPrice: 300, touristTaxTotal: 20,
  });
  // 300 (9 € of tax removed from 309) + 100 (the cash solde and its tax are both out of the total).
  assert.deepEqual(thisMonth(profile.getStayProfile({}).data).current, { stays: 2, revenue: 400, average: 200 });
});

test('rule 22 — placement of the tax, bucket by bucket', () => {
  const base = { touristTaxTotal: 30 };
  assert.equal(touristTaxInTotal({ touristTaxTotal: 0 }), 0);
  assert.equal(touristTaxInTotal(base), 30);
  assert.equal(touristTaxInTotal({ ...base, balancePaidCash: 1 }), 0);
  // Added guests' share rides the complement.
  assert.equal(touristTaxInTotal({ ...base, touristTaxAddedGuestsAmount: 6, balancePaidCash: 1 }), 6);
  assert.equal(touristTaxInTotal({ ...base, touristTaxAddedGuestsAmount: 6, complementPaidCash: 1 }), 24);
  // A paid solde keeps its frozen tax; a later rise rides the complement.
  assert.equal(touristTaxInTotal({ ...base, balancePaid: 1, touristTaxSoldeContribTtc: 24, touristTaxAcompteContribTtc: 0, complementPaidCash: 1 }), 24);
  assert.equal(touristTaxInTotal({ ...base, balancePaid: 1, touristTaxSoldeContribTtc: 24, balancePaidCash: 1 }), 6);
  // Collected at arrival: the complement holds it all.
  assert.equal(touristTaxInTotal(base, { taxOnArrival: true }), 30);
  assert.equal(touristTaxInTotal({ ...base, complementPaidCash: 1 }, { taxOnArrival: true }), 0);
  assert.equal(touristTaxInTotal({ ...base, balancePaidCash: 1 }, { taxOnArrival: true }), 30);
  // A plan: the installments hold it (never cash), the added share stays with the complement.
  assert.equal(touristTaxInTotal({ ...base, touristTaxAddedGuestsAmount: 6, balancePaidCash: 1, complementPaidCash: 1 }, { hasPlan: true }), 24);
  // Book refunds of tax give it back; never below 0.
  assert.equal(touristTaxInTotal(base, { refundedTax: 10 }), 20);
  assert.equal(touristTaxInTotal(base, { refundedTax: 50 }), 0);
});

test('rule 23 — lead times read the logement\'s own tracking start: the logements add up to « Tous »', () => {
  const { db, profile } = richDb();
  // Logement 2 is imported later: its import-day stays are not leads, under any filter.
  insert(db, { propertyId: 2, startDate: at(-200), endDate: at(-198), createdAt: stamp(-250), balanceAmount: 100 });
  insert(db, { propertyId: 2, startDate: at(-20), endDate: at(-18), createdAt: stamp(-250), balanceAmount: 100 });
  insert(db, { propertyId: 2, startDate: at(-15), endDate: at(-13), createdAt: stamp(-25), balanceAmount: 100 });
  insert(db, { propertyId: 1, startDate: at(-10), endDate: at(-8), createdAt: stamp(-12), balanceAmount: 100 });
  const window = { period: 'custom', from: at(-60), to: at(10) };
  const lead = (propertyId) => Object.fromEntries(profile.getStayProfile({ ...window, propertyId }).data
    .dimensions.find((d) => d.key === 'lead').rows.map((r) => [r.key, r.count]));
  const all = lead('');
  const one = lead('1');
  const two = lead('2');
  for (const key of Object.keys(all)) assert.equal(all[key], (one[key] || 0) + (two[key] || 0), key);
  assert.equal(all.unknown, 1);
  assert.equal(two['d7-30'], 1);
});

test('rule 24 — an exercise over before the history starts carries no notice', () => {
  const { db } = freshDb();
  // The history starts this month (coverage = month of the earliest arrival), whatever today is.
  insert(db, { startDate: TODAY, endDate: at(1), createdAt: stamp(-30), balanceAmount: 400 });
  const profile = stayProfileModel.buildModel(db);
  const current = fiscalYearUtil.containing(12, TODAY);
  const old = profile.getStayProfile({ fiscalYear: current.key - 1 }).data.basket;
  assert.deepEqual([old.comparable, old.notice, old.rows.length], [false, null, 0]);
  assert.match(profile.getStayProfile({}).data.basket.notice, /^Historique depuis /);
});

test('rule 26 — every bucket label joins its number and its unit with a no-break space', () => {
  const labels = [...BUCKETS.LENGTH_BUCKETS, ...BUCKETS.LEAD_BUCKETS, ...BUCKETS.PRICE_BUCKETS].map((b) => b.label);
  for (const label of labels) assert.doesNotMatch(label, /\d \S|\d [€j]/, label);
  assert.equal(BUCKETS.PRICE_BUCKETS[0].label, 'Moins de 300 €');
  assert.equal(BUCKETS.LEAD_BUCKETS[1].label, '7–30 j');
});
