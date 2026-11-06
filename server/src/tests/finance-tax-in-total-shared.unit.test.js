const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md §3 rule 56 and specs/stay-profile.md §3 rule 28 — the dashboard's
// revenue of the nights and the stay profile's basket leave out the SAME tourist tax: the one
// financeModel.withTouristTaxInTotal places inside each stay's total (utils/stayTouristTaxInTotal.js).
// Integration of 2026-11-06: the two lots had each kept their own reading.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const stayProfileModel = require('../models/stayProfileModel');
const { addDays } = require('../utils/financeOccupancy');

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

const window = { period: 'custom', from: at(-3), to: at(-1) };
const round2 = (n) => Math.round(n * 100) / 100;

test('rules 56 / 28 — a reversing platform: both screens remove the whole tax from the netted solde', () => {
  const { db, finance, dashboard } = richDb();
  const id = insert(db, {
    platform: 'Booking', startDate: at(-3), endDate: TODAY, createdAt: stamp(-40),
    balanceAmount: 600, balancePaid: 1, balancePaidDate: TODAY, platformCommissionAmount: 113.44,
    finalPrice: 576, touristTaxTotal: 24, touristTaxSoldeContribTtc: 24, touristTaxAcompteContribTtc: 0,
  });
  const paced = finance.getPaceStays({ withTax: true }).find((s) => s.startDate === at(-3));
  const [placed] = finance.withTouristTaxInTotal(db.prepare('SELECT * FROM reservations WHERE id = ?').all(id));
  assert.equal(paced.taxInTotal, 24);
  assert.equal(paced.taxInTotal, placed.taxInTotal, 'one reading of the tax inside the total');
  const { hero } = dashboard.getDashboard(window).data;
  assert.equal(hero.revenuePerNight, round2(462.56 / 3), '(486,56 − 24) € over its 3 nights');
});

test('rules 56 / 28 — a tax collected at arrival in the caisse interne is not in the total: neither screen removes it', () => {
  const { db, finance, dashboard, profile } = richDb();
  insert(db, {
    platform: 'Abracadaroom', startDate: at(-3), endDate: TODAY, createdAt: stamp(-40),
    balanceAmount: 250.74, finalPrice: 250.74, touristTaxTotal: 11.96,
    complementAmount: 11.96, complementPaid: 1, complementPaidCash: 1, complementPaidDate: TODAY,
  });
  assert.equal(finance.getPaceStays({ withTax: true }).find((s) => s.startDate === at(-3)).taxInTotal, 0);
  assert.equal(dashboard.getDashboard(window).data.hero.revenuePerNight, round2(250.74 / 3));
  const month = profile.getStayProfile({}).data.basket.rows.find((r) => r.month === TODAY.slice(0, 7));
  assert.equal(month.current.revenue, 250.74);
});

test('rules 56 / 28 — a book larger than one statement\'s parameters is read in chunks, never a 500', () => {
  const { db, finance } = richDb();
  const insertMany = db.transaction((n) => {
    for (let i = 0; i < n; i += 1) {
      insert(db, { startDate: at(-3), endDate: TODAY, createdAt: stamp(-40), balanceAmount: 100, finalPrice: 90, touristTaxTotal: 10 });
    }
  });
  insertMany(1201);
  const rows = db.prepare('SELECT * FROM reservations').all();
  const placed = finance.withTouristTaxInTotal(rows);
  assert.equal(placed.length, rows.length);
  assert.equal(placed.filter((r) => r.taxInTotal === 10).length, 1201, 'every chunk read its facts');
});
