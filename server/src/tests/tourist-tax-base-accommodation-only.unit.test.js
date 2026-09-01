const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tourist-tax-base-accommodation-only.md — in percentage mode the tax base is the
// ACCOMMODATION CHARGED. Extras, their Complément routing and the platform brut are all inert; only
// the tariff nights, the discount and the manual « Prix hébergement ajusté » move it — plus, since
// specs/tourist-tax-included-services-deduction.md, the services included in that rate, which are
// deducted from it (they are sold inside the night, so they are not the dry night).

function createDb({ mode = 'percentage_accommodation', defaultOffered = true, optionPrice = 34.09 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER DEFAULT 1);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPercentage, touristTaxPerDayPerPerson)
    VALUES (1, 'Lodge', ?, ?, ?)`)
    .run(mode, mode === 'per_day_per_person' ? 0 : 5, mode === 'per_day_per_person' ? 1.5 : 0);
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Ménage et linge', 'per_stay', ?)").run(optionPrice);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, ?)').run(defaultOffered ? 1 : 0);
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (20, 'Plancha', 1, 25, 'per_stay')").run();
  // « Reversed » platform (collects from the guest, we remit): the tax stays visible and charged, so
  // a platform quote can be compared amount-for-amount with a direct one.
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (1, 'Lodgify', 1, 0)").run();
  return db;
}

// 2 nights × 100 €, 2 adults → the accommodation charged is 200 €, whatever is sold alongside it.
const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-03',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const INCLUDED_IN_RATE = { selectedOptions: [{ optionId: 10, quantity: 1, offered: 1 }], offeredOptionIds: [10] };

test('the base is the accommodation charged — 200 €, not the total', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(q.touristTaxBaseAccommodation, 200);
  assert.ok(q.touristTaxTotal > 0);
  db.close();
});

test('no BILLED extra moves the tax — paid, custom, resource, routed to Complément or not', () => {
  const db = createDb();
  const reference = calculateReservationQuote({ ...BASE, db });

  const variants = {
    'paid option': { selectedOptions: [{ optionId: 10, quantity: 1 }] },
    'paid option in Complément': { selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }] },
    'custom option': { customOptions: [{ title: 'Panier', price: 40, priceType: 'per_stay', quantity: 1 }] },
    'resource': { selectedResources: [{ resourceId: 20, quantity: 1 }] },
    'resource in Complément': { selectedResources: [{ resourceId: 20, quantity: 1, inComplement: 1 }] },
  };

  for (const [label, extra] of Object.entries(variants)) {
    const q = calculateReservationQuote({ ...BASE, ...extra, db });
    assert.equal(q.touristTaxBaseAccommodation, 200, `base moved with ${label}`);
    assert.equal(q.touristTaxTotal, reference.touristTaxTotal, `tax moved with ${label}`);
  }
  db.close();
});

// specs/tourist-tax-included-services-deduction.md rule 7 — the Complément routing is not a price
// lever: an included service leaves the base by the same amount wherever it is collected.
test('an included service leaves the base, and its Complément routing changes nothing', () => {
  const db = createDb();
  const inPreArrival = calculateReservationQuote({ ...BASE, ...INCLUDED_IN_RATE, db });
  const inComplement = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [{ optionId: 10, quantity: 1, offered: 1, inComplement: 1 }], offeredOptionIds: [10],
  });

  assert.equal(inPreArrival.touristTaxBaseAccommodation, 165.91); // 200 − 34,09
  assert.equal(inComplement.touristTaxBaseAccommodation, 165.91);
  assert.equal(inComplement.touristTaxTotal, inPreArrival.touristTaxTotal);
  db.close();
});

test('an includedInRate line is tagged « Comprise », billed 0 €, and deducted from the base', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...INCLUDED_IN_RATE, db });
  assert.equal(q.optionLines[0].includedInRate, true);
  assert.equal(q.optionLines[0].totalPrice, 0);
  assert.equal(q.touristTaxBaseBeforeDeduction, 200);
  assert.equal(q.touristTaxIncludedInRateDeduction, 34.09);
  assert.equal(q.touristTaxBaseAccommodation, 165.91);
  db.close();
});

test('an included value larger than the accommodation floors the base at 0', () => {
  const db = createDb({ optionPrice: 500 });
  const q = calculateReservationQuote({ ...BASE, ...INCLUDED_IN_RATE, db });
  assert.equal(q.touristTaxBaseAccommodation, 0);
  assert.equal(q.touristTaxTotal, 0);
  db.close();
});

test('the platform brut derives the base again, net of the extras billed through it', () => {
  const db = createDb();
  const direct = calculateReservationQuote({ ...BASE, db });
  const platformNoBrut = calculateReservationQuote({ ...BASE, db, platform: 'Lodgify' });
  const platformWithBrut = calculateReservationQuote({ ...BASE, db, platform: 'Lodgify', platformGrossAmount: 450 });
  const platformBrutAndExtra = calculateReservationQuote({
    ...BASE, db, platform: 'Lodgify', platformGrossAmount: 450,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
  });
  const platformBrutAndComplementExtra = calculateReservationQuote({
    ...BASE, db, platform: 'Lodgify', platformGrossAmount: 450,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }],
  });

  // specs/tourist-tax-matches-the-office-calculation.md rule 3 — no brut, no change: the tariff is
  // what the guest paid us.
  assert.equal(platformNoBrut.touristTaxBaseAccommodation, 200);
  assert.equal(platformNoBrut.touristTaxTotal, direct.touristTaxTotal);

  // Rule 2 — with a brut, the brut IS what the guest paid, so it is the base. This repeals the
  // decoupling of PR #470: declaring on the tariff declared on money nobody ever paid.
  assert.equal(platformWithBrut.touristTaxBaseAccommodation, 450);

  // An extra billed THROUGH the platform is inside the brut, so it comes out of the base…
  assert.equal(platformBrutAndExtra.optionLines.find((l) => Number(l.optionId) === 10).totalPrice, 34.09);
  assert.equal(platformBrutAndExtra.touristTaxBaseAccommodation, 415.91); // 450 − 34,09
  // …but one routed to « Complément » is collected by us at arrival and was never in the brut:
  // subtracting it would deduct it twice.
  assert.equal(platformBrutAndComplementExtra.touristTaxBaseAccommodation, 450);

  // The brut still pins the money: it holds the whole stay, the reversed tax included
  // (specs/platform-payment-tourist-tax-as-option.md).
  assert.equal(platformWithBrut.totalStayPrice, 450);
  db.close();
});

test('a brut that does not even cover its extras is flagged, and floors the base at 0', () => {
  const db = createDb();
  const quote = calculateReservationQuote({
    ...BASE, db, platform: 'Lodgify', platformGrossAmount: 5,
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
  });
  // Rule 7 + rule 16 — an inconsistent entry, not a negative base and not a silent zero.
  assert.equal(quote.touristTaxBaseAccommodation, 0);
  assert.equal(quote.touristTaxBrutInconsistent, true);
  assert.equal(quote.touristTaxTotal, 0);
  db.close();
});

test('the manual « Prix hébergement ajusté » IS the base, and the discount applies to it', () => {
  const db = createDb();
  const custom = calculateReservationQuote({ ...BASE, db, customPrice: 150 });
  assert.equal(custom.touristTaxBaseAccommodation, 150);

  const discounted = calculateReservationQuote({ ...BASE, db, discountPercent: 25 });
  assert.equal(discounted.touristTaxBaseAccommodation, 150);
  assert.equal(discounted.touristTaxTotal, custom.touristTaxTotal);
  db.close();
});

test('flat per-adult-per-night mode ignores every price', () => {
  const db = createDb({ mode: 'per_day_per_person' });
  const q = calculateReservationQuote({ ...BASE, ...INCLUDED_IN_RATE, db });
  assert.equal(q.touristTaxTotal, 6); // 1.50 × 2 adults × 2 nights
  db.close();
});

test('a frozen past tax keeps its stored amount', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...INCLUDED_IN_RATE, db,
    freezeTouristTax: true, frozenTouristTaxTotal: 12.34, frozenTouristTaxRate: 3.21,
  });
  assert.equal(q.touristTaxTotal, 12.34);
  assert.equal(q.touristTaxRate, 3.21);
  db.close();
});
