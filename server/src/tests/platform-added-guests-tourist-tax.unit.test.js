// Tourist tax of guests added after a platform booking — specs/platform-added-guests-tourist-tax.md.
// On a platform that reverses the tax to us, what the added guests owe is collected in the complement.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote, resolveAddedGuestsTouristTax } = require('../utils/pricing').__test;
const { resolvePlatformPaidAdults, resolvePlatformPaidOccupants } = require('../utils/platformPaidGuests');

const MODES = { reversed: [1, 0], remits: [1, 1], owner: [0, 0] };

// 2 nights × 300 = 600 ; 2 guests free ; 20 €/guest/night ; 1,20 €/adult/night or 5 %.
function createDb({ mode = 'reversed', taxMode = 'per_day_per_person' } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 300, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER, touristTaxRemittedByPlatform INTEGER);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, touristTaxPerDayPerPerson, touristTaxMode, touristTaxPercentage) VALUES (1, 'Gite', 2, 20, 'per_night', 1.2, ?, 5)").run(taxMode);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 300, 1)').run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', ?, ?)").run(...MODES[mode]);
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2027-05-01', endDate: '2027-05-03', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '', platform: 'Canal', platformGrossAmount: 600,
  platformPaidGuests: 2, platformPaidAdults: 2,
};

function quote(input = {}, dbOptions) {
  const db = createDb(dbOptions);
  try { return calculateReservationQuote({ ...BASE, db, ...input }); } finally { db.close(); }
}

test('rule 1: the paid adults follow the brut, and the body is never read', () => {
  const body = { platform: 'Canal', platformGrossAmount: 600, adults: 3, platformPaidAdults: 9 };
  assert.equal(resolvePlatformPaidAdults(null, body), 3);
  const stored = { platform: 'Canal', platformGrossAmount: 600, platformPaidAdults: 2 };
  assert.equal(resolvePlatformPaidAdults(stored, { ...body, platformGrossAmount: 610 }), 2);
  assert.equal(resolvePlatformPaidAdults(stored, { ...body, platformGrossAmount: '' }), null);
  assert.equal(resolvePlatformPaidAdults(stored, { ...body, platform: 'direct' }), null);
  assert.equal(resolvePlatformPaidAdults({ ...stored, platformGrossAmount: null }, body), 3);
});

// specs/platform-added-guests-tourist-tax.md rules 8-9.
test('§1: 2 → 3 adults, the added tax rides the complement and the accommodation stays', () => {
  const q = quote({ adults: 3 });
  assert.equal(q.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(q.touristTaxTotal, 7.2);
  assert.equal(q.accommodationAdjustedPrice, 595.2);
  assert.equal(q.complementAmount, 42.4);
  assert.equal(q.balanceAmount, 600);
  assert.equal(q.totalStayPrice, 642.4);
  assert.ok(q.complementDetailLines.some((l) => l.kind === 'tax' && l.amount === 2.4));
});

test('rule 2: an unchanged party has no added tax, and the accommodation matches', () => {
  const q = quote();
  assert.equal(q.touristTaxAddedGuestsAmount, 0);
  assert.equal(q.accommodationAdjustedPrice, 595.2);
  assert.equal(q.complementAmount, 0);
  assert.equal(q.totalStayPrice, 600);
});

test('rule 3: the other modes, and direct, are unchanged', () => {
  const remits = quote({ adults: 3 }, { mode: 'remits' });
  assert.equal(remits.touristTaxAddedGuestsAmount, 0);
  assert.equal(remits.touristTaxTotal, 0);
  assert.equal(remits.complementAmount, 40);
  const owner = quote({ adults: 3 }, { mode: 'owner' });
  assert.equal(owner.touristTaxAddedGuestsAmount, 0);
  assert.equal(owner.touristTaxTotal, 7.2);
  assert.equal(owner.complementAmount, 47.2);
  const direct = quote({ adults: 3, platform: 'direct', platformGrossAmount: '', platformPaidGuests: null, platformPaidAdults: null });
  assert.equal(direct.touristTaxAddedGuestsAmount, 0);
});

test('rule 3: no brut or no paid base → no added tax', () => {
  assert.equal(quote({ adults: 3, platformGrossAmount: '' }).touristTaxAddedGuestsAmount, 0);
  assert.equal(quote({ adults: 3, platformPaidAdults: null }).touristTaxAddedGuestsAmount, 0);
});

test('rule 4: a rounding gap on a percentage property is not a sale', () => {
  const q = quote({ adults: 3 }, { taxMode: 'percentage_accommodation' });
  assert.equal(q.touristTaxAddedGuestsAmount, 0);
  assert.equal(q.touristTaxTotal, 27.3);
});

test('rule 4: a real gap on a percentage property is billed', () => {
  const q = quote({ adults: 3, children: 2, platformPaidGuests: 4, platformPaidAdults: 2 }, { taxMode: 'percentage_accommodation' });
  assert.equal(q.touristTaxTotal, 14.16);
  assert.equal(q.touristTaxAddedGuestsAmount, 2.36);
  const pure = resolveAddedGuestsTouristTax({
    touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, nights: 2, accommodationAmountTtc: 520,
    accommodationVatRate: 10, adults: 3, occupants: 5, paidAdults: 2, paidOccupants: 4,
  });
  assert.deepEqual(pure, { paidTotal: 11.8, added: 2.36 });
});

test('rule 5: a minor adds no tax; an adult replacing a minor does, with no supplement', () => {
  assert.equal(quote({ children: 1 }).touristTaxAddedGuestsAmount, 0);
  assert.equal(quote({ teens: 1 }).touristTaxAddedGuestsAmount, 0);
  const swapped = quote({ adults: 3, children: 0, platformPaidGuests: 3, platformPaidAdults: 2 });
  assert.equal(swapped.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(swapped.extraGuestComplementSurcharge, 0);
  assert.equal(swapped.complementAmount, 2.4);
});

test('rule 6: it rises and falls with the party', () => {
  assert.equal(quote({ adults: 4 }).touristTaxAddedGuestsAmount, 4.8);
  assert.equal(quote({ adults: 3 }).touristTaxAddedGuestsAmount, 2.4);
  assert.equal(quote({ adults: 2 }).touristTaxAddedGuestsAmount, 0);
  assert.equal(quote({ adults: 1 }).touristTaxAddedGuestsAmount, 0);
});

test('rule 7: a collected complement stops moving, and neither tax nor accommodation follows', () => {
  const q = quote({ adults: 4, complementPaid: 1, complementAmount: 42.4, storedTouristTaxAddedGuests: 2.4 });
  assert.equal(q.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(q.touristTaxTotal, 7.2);
  assert.equal(q.accommodationAdjustedPrice, 595.2);
  assert.equal(q.complementAmount, 42.4);
});

const FROZEN = { freezeTouristTax: true, frozenTouristTaxRate: 1.2, frozenTouristTaxOccupants: 2, frozenTouristTaxBaseHt: 0 };

test('rule 7bis: a frozen tax does not stop the line, and its part does not move', () => {
  const q = quote({ ...FROZEN, adults: 3, frozenTouristTaxTotal: 4.8, storedTouristTaxAddedGuests: 0 });
  assert.equal(q.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(q.touristTaxTotal, 7.2);
  assert.equal(q.accommodationAdjustedPrice, 595.2);
  assert.equal(q.complementAmount, 42.4);
});

test('rule 7bis: saving again does not count the added tax twice', () => {
  const q = quote({ ...FROZEN, adults: 3, frozenTouristTaxTotal: 7.2, storedTouristTaxAddedGuests: 2.4 });
  assert.equal(q.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(q.touristTaxTotal, 7.2);
  assert.equal(q.accommodationAdjustedPrice, 595.2);
});

test('edge: a tax forced to the complement is whole there, nothing is counted twice', () => {
  const q = quote({ adults: 3, touristTaxInComplement: true });
  assert.equal(q.touristTaxAddedGuestsAmount, 0);
  assert.equal(q.touristTaxTotal, 7.2);
  assert.equal(q.complementAmount, 47.2);
});

test('rule 10: offering the supplement leaves the tax line in place', () => {
  const q = quote({ adults: 3, extraGuestSurchargeOffered: true });
  assert.equal(q.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(q.complementAmount, 2.4);
});

test('rule 16: the solde\'s accommodation leaves out what the complement collects', () => {
  const { computeAccommodationTtc } = require('../utils/forceItemContribsCapture');
  const q = quote({ adults: 3 });
  assert.equal(computeAccommodationTtc(q), 595.2);
  assert.equal(computeAccommodationTtc(q) + (q.touristTaxTotal - q.touristTaxAddedGuestsAmount), q.balanceAmount);
});

// R22-DB-3 — the old head count is not the party the backfill read, and a percentage tax depends on occupants.
test('rule 19: the occupants follow the brut like the persons, and the body is never read', () => {
  const body = { platform: 'Canal', platformGrossAmount: 600, adults: 3, children: 1, platformPaidOccupants: 9 };
  assert.equal(resolvePlatformPaidOccupants(null, body), 4);
  const stored = { platform: 'Canal', platformGrossAmount: 600, platformPaidOccupants: 2, platformPaidGuests: 7 };
  assert.equal(resolvePlatformPaidOccupants(stored, { ...body, platformGrossAmount: 610 }), 2);
  assert.equal(resolvePlatformPaidOccupants(stored, { ...body, platformGrossAmount: '' }), null);
  assert.equal(resolvePlatformPaidOccupants(stored, { ...body, platform: 'direct' }), null);
  assert.equal(resolvePlatformPaidOccupants({ ...stored, platformGrossAmount: null }, body), 4);
  assert.equal(resolvePlatformPaidOccupants({ ...stored, platformPaidOccupants: null }, body), 7, 'a row written by an older release reads the persons');
});

test('rule 19: a party that differs from the old head count bills nothing on a percentage property', () => {
  const percentage = { taxMode: 'percentage_accommodation' };
  for (const party of [{ adults: 2, children: 1 }, { adults: 3, children: 0 }, { adults: 3, children: 1 }]) {
    const occupants = party.adults + party.children;
    const q = quote({ ...party, platformPaidGuests: 4, platformPaidAdults: party.adults, platformPaidOccupants: occupants }, percentage);
    assert.equal(q.touristTaxAddedGuestsAmount, 0, JSON.stringify(party));
    assert.equal(q.touristTaxAddedGuestsAdults, 0);
    assert.equal(q.platformPaidOccupants, occupants);
    assert.equal(q.platformPaidGuests, 4);
  }
});

test('rule 19: a collected complement keeps the tax of the party, not of the old head count', () => {
  const q = quote(
    { adults: 2, children: 1, platformPaidGuests: 4, platformPaidAdults: 2, platformPaidOccupants: 3, complementPaid: true },
    { taxMode: 'percentage_accommodation' },
  );
  const live = quote({ adults: 2, children: 1, platformPaidGuests: 3, platformPaidAdults: 2 }, { taxMode: 'percentage_accommodation' });
  assert.equal(q.touristTaxTotal, live.touristTaxTotal);
});

test('rule 19: the supplement keeps the persons the platform billed', () => {
  const q = quote({ adults: 3, platformPaidGuests: 2, platformPaidAdults: 3, platformPaidOccupants: 3 });
  assert.equal(q.extraGuestComplementSurcharge, 40);
  assert.equal(q.touristTaxAddedGuestsAmount, 0);
});

test('D12, rule 5: a child removed raises the per-occupant base: the gap is billed, nobody is added', () => {
  const q = quote(
    { adults: 2, children: 1, platformPaidGuests: 4, platformPaidAdults: 2, platformPaidOccupants: 4 },
    { taxMode: 'percentage_accommodation' },
  );
  assert.ok(q.touristTaxAddedGuestsAmount > 0);
  assert.equal(q.touristTaxAddedGuestsAdults, 0);
  assert.equal(q.complementDetailLines.find((l) => l.kind === 'tax').label, 'Complément de taxe de séjour');
  assert.equal(q.complementDetailLines.find((l) => l.kind === 'tax').addedGuests, true);
});

test('rule 21: the added adults go with the amount, frozen with it once collected', () => {
  const added = quote({ adults: 4 });
  assert.equal(added.touristTaxAddedGuestsAdults, 2);
  assert.equal(quote({ adults: 2 }).touristTaxAddedGuestsAdults, 0);
  const noise = quote({ adults: 3 }, { taxMode: 'percentage_accommodation' });
  assert.equal(noise.touristTaxAddedGuestsAmount, 0);
  assert.equal(noise.touristTaxAddedGuestsAdults, 0, 'no amount, nobody it is for');
  const collected = quote({ adults: 2, complementPaid: true, storedTouristTaxAddedGuests: 2.4, storedTouristTaxAddedGuestsAdults: 1 });
  assert.equal(collected.touristTaxAddedGuestsAmount, 2.4);
  assert.equal(collected.touristTaxAddedGuestsAdults, 1);
});

test('rule 23: a tax whole in the complement keeps its name on the live detail', () => {
  const q = quote({ adults: 3, touristTaxInComplement: 1 });
  const line = q.complementDetailLines.find((l) => l.kind === 'tax');
  assert.equal(line.label, 'Taxe de séjour');
  assert.equal(line.addedGuests, undefined);
});
