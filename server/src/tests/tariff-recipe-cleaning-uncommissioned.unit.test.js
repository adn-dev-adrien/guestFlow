// specs/tariff-recipe-platform-cleaning-fee.md rule 14 — a channel that passes options through
// untouched (Gîtes de France: 10 % of the rent only, measured on 13 settled files) takes no commission
// on its cleaning fee, so the grid shows the net itself: 80 €, not 89 €.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { validateRecipe } = require('../utils/tariffRecipe');
const { resolvePlatformCleaningFees, diffPlatformCleaningFees } = require('../utils/platformCleaningFee');
const { buildModel: buildPropertiesModel } = require('../models/propertiesModel');

const shipped = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes', file), 'utf8'));

const BASE = {
  id: 'uncommissioned-test', version: '1.0.0', label: 'Test', horizonYears: 2,
  seasons: [{ key: 'low', label: 'Basse saison', rank: 1, color: '#5B8C6E', pricePerNight: 179, netTargetPerNight: 160 }],
  calendar: { baseSeason: 'low', periods: [], modifiers: [] },
  closures: [],
};

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, commissionPercent REAL NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT,
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '',
      extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0,
      platformCleaningFees TEXT DEFAULT '[]', updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER,
      changeoverArrival INTEGER, changeoverDeparture INTEGER, extraGuestTiers TEXT);
  `);
  db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('direct', 5), ('Airbnb', 15.5), ('GitesDeFrance', 10)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  return db;
}

test('feeCommissioned must be a boolean when present', () => {
  const entry = (extra) => ({ ...BASE, cleaning: { netCost: 80, platformFees: [{ platform: 'GitesDeFrance', chargesCleaning: true, ...extra }] } });
  assert.equal(validateRecipe(entry({ feeCommissioned: false })).error, undefined);
  assert.equal(validateRecipe(entry({})).error, undefined, 'absent keeps today\'s behaviour');
  assert.match(validateRecipe(entry({ feeCommissioned: 'non' })).error, /cleaning\.platformFees\[0\]\.feeCommissioned/);
});

test('an uncommissioned fee is shown at its net; a commissioned one is still grossed up', () => {
  const db = createDb();
  const props = buildPropertiesModel(db);
  props.setPlatformCleaningFees(1, resolvePlatformCleaningFees(shipped('gite-2027.json').cleaning, ['Airbnb', 'GitesDeFrance']).fees);
  const platforms = props.platformPrices(1).platforms;
  assert.equal(platforms.find((p) => p.name === 'GitesDeFrance').cleaningFee, 80);
  assert.deepEqual(platforms.find((p) => p.name === 'GitesDeFrance').cleaningFeeDetail, { cleaningNet: 80, choresNet: 0, net: 80 });
  assert.equal(platforms.find((p) => p.name === 'Airbnb').cleaningFee, 122);
});

test('switching an entry to uncommissioned is a change even when its net is the same', () => {
  const stored = JSON.stringify([{ platform: 'GitesDeFrance', cleaningNet: 80, choresNet: 0, net: 80 }]);
  const desired = [{ platform: 'GitesDeFrance', cleaningNet: 80, choresNet: 0, net: 80, feeCommissioned: false }];
  assert.deepEqual(diffPlatformCleaningFees(stored, desired), [{ platform: 'GitesDeFrance', from: 80, to: 80 }]);
  assert.deepEqual(diffPlatformCleaningFees(JSON.stringify(desired), desired), []);
});
