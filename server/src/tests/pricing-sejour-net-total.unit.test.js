const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/fiche-total-sejour-net-of-commission.md — the engine exposes `sejourNetTotal` = the stay
// total NET of the platform commission = « net perçu + compléments ». Non-regression for the cases:
//   - direct / no commission        → sejourNetTotal === totalStayPrice (unchanged)
//   - platform with a commission     → sejourNetTotal === totalStayPrice − commission
//   - owner-collect tax (complement) → net perçu + complement reassembles totalStayPrice (no commission)
//   - platform commission + complement (owner tax) → (preArrival − commission) + complement

function createDb(sources = []) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1, touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, platformKey TEXT NOT NULL, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  const insP = db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, ?, ?)');
  const insS = db.prepare('INSERT INTO ical_sources (propertyId, platformKey, platformLabel) VALUES (1, ?, ?)');
  for (const s of sources) { insP.run(s.k, s.c, s.r); insS.run(s.k, s.k); }
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12', // 2 nights × 100 = 200
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false,
};

test('direct → sejourNetTotal === totalStayPrice (no commission)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'direct' });
  assert.equal(q.sejourNetTotal, q.totalStayPrice);
  assert.equal(q.sejourNetTotal, 204.80); // 200 accom + 4.80 tax (direct collects on solde)
  db.close();
});

test('platform with commission → sejourNetTotal === totalStayPrice − commission', () => {
  const db = createDb([{ k: 'airbnb', c: 1, r: 1 }]); // tax offered → 0; commission applies
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', platformCommissionAmount: 30 });
  assert.equal(q.touristTaxTotal, 0);
  assert.equal(q.totalStayPrice, 200);
  assert.equal(q.platformNetReceivedAmount, 170);
  assert.equal(q.complementAmount, 0);
  assert.equal(q.sejourNetTotal, 170); // = 200 − 30 = net perçu (no complement)
  db.close();
});

test('platform_reversed tax (case 1) + commission → sejourNetTotal === totalStayPrice − commission', () => {
  // The platform collects the tax then reverses it to us → tax is a real charge in the balance
  // (totalStayPrice includes it). No brut here, so no double-count. sejourNetTotal = total − commission.
  const db = createDb([{ k: 'expedia', c: 1, r: 0 }]); // reversed
  const q = calculateReservationQuote({ ...BASE, db, platform: 'expedia', platformCommissionAmount: 30 });
  assert.equal(q.touristTaxTotal, 4.80);                 // charged in our books
  assert.equal(q.totalStayPrice, 204.80);                // 200 accom + 4.80 tax
  assert.equal(q.platformNetReceivedAmount, 174.80);     // 204.80 − 30
  assert.equal(q.complementAmount, 0);
  assert.equal(q.sejourNetTotal, 174.80);                // = totalStayPrice − commission
  db.close();
});

test('offered tax, no commission → sejourNetTotal === totalStayPrice (= accommodation, tax out of books)', () => {
  const db = createDb([{ k: 'airbnb', c: 1, r: 1 }]); // offered
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb' }); // no commission, no brut
  assert.equal(q.touristTaxTotal, 0);                    // offered → 0 in the books
  assert.equal(q.finalPrice, 200);
  assert.equal(q.totalStayPrice, 200);
  assert.equal(q.platformNetReceivedAmount, null);       // no commission
  assert.equal(q.sejourNetTotal, 200);                   // = preArrival (no commission to deduct)
  db.close();
});

test('owner-collect tax → net perçu + complement reassembles the gross total (no commission)', () => {
  const db = createDb([{ k: 'booking', c: 0, r: 0 }]); // owner collects → tax in complement
  const q = calculateReservationQuote({ ...BASE, db, platform: 'booking' });
  assert.equal(q.touristTaxCollectedOnArrival, true);
  assert.equal(q.complementAmount, 4.80); // tax at arrival
  assert.equal(q.platformNetReceivedAmount, null); // no commission
  assert.equal(q.sejourNetTotal, q.totalStayPrice); // preArrival + complement = total
  assert.equal(q.sejourNetTotal, 204.80);
  db.close();
});

test('platform commission + on-arrival complement → (preArrival − commission) + complement', () => {
  const db = createDb([{ k: 'booking', c: 0, r: 0 }]); // owner-collect tax (complement) + commission
  const q = calculateReservationQuote({ ...BASE, db, platform: 'booking', platformCommissionAmount: 20 });
  // preArrival = 200 (accommodation; tax routed to complement), net perçu = 200 − 20 = 180,
  // complement = 4.80 tax → sejourNetTotal = 184.80 = totalStayPrice (204.80) − commission (20).
  assert.equal(q.platformNetReceivedAmount, 180);
  assert.equal(q.complementAmount, 4.80);
  assert.equal(q.sejourNetTotal, 184.80);
  assert.equal(q.sejourNetTotal, Math.round((q.totalStayPrice - 20) * 100) / 100);
  db.close();
});
