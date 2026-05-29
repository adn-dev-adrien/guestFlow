const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const pricingUtils = require('../utils/pricing');

const {
  timeToDecimalHour,
  computeAutoTimedOptionContext,
  computeTouristTaxBreakdown,
  normalizeOptionProgressiveTiers,
  calculateProgressiveParticipantOptionTotal,
  calculateReservationQuote,
} = pricingUtils.__test;

function createPricingTestDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30,
      balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00',
      defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0,
      touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0,
      touristTaxDepartmentPercentage REAL DEFAULT 0,
      touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0,
      extraGuestPrice REAL DEFAULT 0
    );

    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY,
      propertyId INTEGER NOT NULL,
      label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100,
      pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]',
      dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2',
      startDate TEXT,
      endDate TEXT,
      minNights INTEGER DEFAULT 1
    );

    CREATE TABLE options (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay',
      price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]',
      autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0,
      autoPricingMode TEXT NOT NULL DEFAULT 'fixed',
      autoFullNightThreshold TEXT
    );

    CREATE TABLE property_options (
      propertyId INTEGER NOT NULL,
      optionId INTEGER NOT NULL,
      PRIMARY KEY (propertyId, optionId)
    );

    CREATE TABLE resources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay',
      isComplex INTEGER NOT NULL DEFAULT 0,
      propertyIds TEXT DEFAULT '[]'
    );

    CREATE TABLE property_resource_prices (
      propertyId INTEGER NOT NULL,
      resourceId INTEGER NOT NULL,
      price REAL,
      freeMinutes INTEGER DEFAULT 0,
      PRIMARY KEY (propertyId, resourceId)
    );

    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL, vatRateStandard REAL);
  `);

  // Global VAT now drives the engine. These tests predate the 2-rate model and assume 20% everywhere,
  // so seed both rates to 20 to keep their (VAT-derived) expectations valid.
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 20, 20)').run();

  db.prepare(`
    INSERT INTO properties (
      id, name, depositPercent, depositDaysBefore, balanceDaysBefore,
      defaultCheckIn, defaultCheckOut,
      touristTaxPerDayPerPerson, touristTaxMode, touristTaxPercentage,
      touristTaxDepartmentPercentage, touristTaxFixedAmount,
      basePriceIncludedGuests, extraGuestPrice
    )
    VALUES (1, 'Maison test', 30, 30, 7, '15:00', '10:00', 0, 'per_day_per_person', 0, 0, 0, 0, 0)
  `).run();

  db.prepare(`
    INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (1, 1, 'Standard', 120, 'fixed', '[]', '[]', '#1976d2', NULL, NULL, 1)
  `).run();

  return db;
}

test('timeToDecimalHour converts half-hour values', () => {
  assert.equal(timeToDecimalHour('15:30'), 15.5);
  assert.equal(timeToDecimalHour('08:00'), 8);
});

test('computeAutoTimedOptionContext computes proportional early check-in hours and price', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 10,
      title: 'Arrivee anticipee',
      autoOptionType: 'early_check_in',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '10:00',
      price: 0,
    },
    checkInTime: '13:00',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 120 }],
  });

  assert.equal(line.optionId, 10);
  assert.equal(line.autoExtraHours, 2);
  assert.equal(line.autoFullNightApplied, false);
  assert.equal(line.totalPrice, 48);
});

test('computeAutoTimedOptionContext applies full-night price for late check-out beyond threshold', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 11,
      title: 'Depart tardif',
      autoOptionType: 'late_check_out',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '17:00',
      price: 0,
    },
    checkOutTime: '17:30',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 120 }, { price: 120 }],
  });

  assert.equal(line.autoExtraHours, 7.5);
  assert.equal(line.autoFullNightApplied, true);
  assert.equal(line.totalPrice, 120);
});

test('computeAutoTimedOptionContext late check-out proportional uses next-night price source', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 12,
      title: 'Depart tardif',
      autoOptionType: 'late_check_out',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '17:00',
      price: 0,
    },
    checkOutTime: '12:00',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 999 }],
    lateCheckoutNextNightPrice: 120,
  });

  // 2h / 7h (10:00 -> 17:00) of next-night price (120), never from total stay.
  assert.equal(line.autoExtraHours, 2);
  assert.equal(line.autoFullNightApplied, false);
  assert.equal(line.totalPrice, 34.29);
});

test('computeTouristTaxBreakdown percentage mode uses average HT per night divided by total occupants and taxes only adults', () => {
  const result = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_accommodation',
    touristTaxPercentage: 5,
    touristTaxDepartmentPercentage: 10,
    nights: 3,
    adults: 5,
    occupants: 10,
    accommodationAmountTtc: 360,
    accommodationVatRate: 20,
  });

  assert.equal(result.touristTaxPricePerNightHt, 100);
  assert.equal(result.touristTaxPerOccupantNightPriceHt, 10);
  assert.equal(result.touristTaxUnitAmount, 0.55);
  assert.equal(result.touristTaxTotal, 8.25);
});

test('calculateReservationQuote excludes extra-guest surcharge from percentage tourist-tax base', () => {
  const db = createPricingTestDb();
  db.prepare(`
    UPDATE properties
    SET touristTaxMode = 'percentage_accommodation',
        touristTaxPercentage = 5,
        touristTaxDepartmentPercentage = 10,
        basePriceIncludedGuests = 2,
        extraGuestPrice = 15
    WHERE id = 1
  `).run();
  // The accommodation VAT rate (20% here) is in app_settings — already seeded by createPricingTestDb.

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-13',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 1,
    teens: 1,
    babies: 1,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.baseAccommodationPrice, 360);
  assert.equal(quote.extraGuestSurcharge, 30);
  assert.equal(quote.totalPrice, 360);
  assert.equal(quote.baseAccommodationAdjustedPrice, 360);
  assert.equal(quote.touristTaxPricePerNightHt, 100);
  assert.equal(quote.touristTaxPerOccupantNightPriceHt, 20);
  assert.equal(quote.touristTaxAdultsCount, 2);
  assert.equal(quote.touristTaxOccupantsCount, 5);
  assert.equal(quote.touristTaxUnitAmount, 1.1);
  assert.equal(quote.touristTaxTotal, 6.6);

  db.close();
});

test('calculateReservationQuote includes extra-guest surcharge when custom price is set', () => {
  const db = createPricingTestDb();
  db.prepare(`
    UPDATE properties
    SET basePriceIncludedGuests = 2,
        extraGuestPrice = 15,
        touristTaxPerDayPerPerson = 0,
        touristTaxMode = 'per_day_per_person'
    WHERE id = 1
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-13',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 1,
    teens: 1,
    babies: 0,
    platform: 'direct',
    discountPercent: 0,
    customPrice: 300,
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.extraGuestSurchargeOriginal, 30);
  assert.equal(quote.extraGuestSurcharge, 30);
  assert.equal(quote.baseAccommodationAdjustedPrice, 300);
  assert.equal(quote.finalPrice, 330);
  assert.equal(quote.totalStayPrice, 330);

  db.close();
});

test('calculateReservationQuote keeps tourist tax for direct platform', () => {
  const db = createPricingTestDb();
  db.prepare("UPDATE properties SET touristTaxPerDayPerPerson = 2, touristTaxMode = 'per_day_per_person' WHERE id = 1").run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-13',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    babies: 0,
    platform: 'direct',
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.touristTaxTotal, 12);
  assert.equal(quote.totalStayPrice, 372);

  db.close();
});

test('calculateReservationQuote offers tourist tax for non-direct platform', () => {
  const db = createPricingTestDb();
  db.prepare("UPDATE properties SET touristTaxPerDayPerPerson = 2, touristTaxMode = 'per_day_per_person' WHERE id = 1").run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-13',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    babies: 0,
    platform: 'airbnb',
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.touristTaxTotal, 0);
  assert.equal(quote.totalStayPrice, 360);

  db.close();
});

test('computeTouristTaxBreakdown percentage_and_fixed stacks municipal, departmental and fixed parts', () => {
  const result = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_and_fixed',
    touristTaxPercentage: 5,
    touristTaxDepartmentPercentage: 10,
    touristTaxFixedAmount: 0.2,
    nights: 2,
    adults: 2,
    occupants: 4,
    accommodationAmountTtc: 240,
    accommodationVatRate: 20,
  });

  // 240 TTC / 2 nights = 120 TTC/night => 100 HT/night
  // 100 / 4 occupants = 25
  // municipal = 1.25 ; departmental = 0.13 ; + fixed 0.20 => 1.58 / adult / night
  // total = 1.58 * 2 nights * 2 adults = 6.32
  assert.equal(result.touristTaxUnitAmount, 1.58);
  assert.equal(result.touristTaxTotal, 6.32);
});

test('normalizeOptionProgressiveTiers sanitizes and sorts tiers', () => {
  const tiers = normalizeOptionProgressiveTiers([
    { participantNumber: 3, unitPrice: 10 },
    { participantNumber: 1, unitPrice: 20 },
    { participantNumber: 2, unitPrice: 15 },
    { participantNumber: 2, unitPrice: 12 },
  ]);

  assert.deepEqual(tiers, [
    { participantNumber: 1, unitPrice: 20 },
    { participantNumber: 2, unitPrice: 12 },
    { participantNumber: 3, unitPrice: 10 },
  ]);
});

test('calculateProgressiveParticipantOptionTotal applies last tier as fallback for extra participants', () => {
  const result = calculateProgressiveParticipantOptionTotal(
    5,
    [
      { participantNumber: 1, unitPrice: 20 },
      { participantNumber: 2, unitPrice: 15 },
      { participantNumber: 3, unitPrice: 10 },
      { participantNumber: 4, unitPrice: 5 },
    ],
    20
  );

  assert.equal(result.billedUnits, 5);
  assert.equal(result.totalPrice, 55);
  assert.equal(result.lastUnitPrice, 5);
});

test('calculateReservationQuote supports progressive participant options', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, optionProgressiveTiers)
    VALUES (30, 'Activite famille', 'per_participant_progressive', 20, ?)
  `).run(JSON.stringify([
    { participantNumber: 1, unitPrice: 20 },
    { participantNumber: 2, unitPrice: 20 },
    { participantNumber: 3, unitPrice: 5 },
  ]));
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 30)').run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [{ optionId: 30, quantity: 4 }],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  // 20 + 20 + 5 + 5
  assert.equal(quote.optionLines.length, 1);
  assert.equal(quote.optionLines[0].optionId, 30);
  assert.equal(quote.optionLines[0].billedUnits, 4);
  assert.equal(quote.optionLines[0].originalTotalPrice, 50);
  assert.equal(quote.optionLines[0].totalPrice, 50);
  assert.equal(quote.optionsTotal, 50);

  db.close();
});

test('calculateReservationQuote auto-adds proportional early check-in option with extra hours', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (10, 'Arrivee anticipee', 'per_stay', 0, 'early_check_in', 1, 'proportional', '10:00')
  `).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '13:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.optionLines.length, 1);
  assert.equal(quote.optionLines[0].optionId, 10);
  assert.equal(quote.optionLines[0].autoExtraHours, 2);
  assert.equal(quote.optionLines[0].autoFullNightApplied, false);
  assert.equal(quote.optionLines[0].totalPrice, 48);
  assert.equal(quote.optionsTotal, 48);

  db.close();
});

test('calculateReservationQuote does not add timed options when reservation uses default hours', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (10, 'Arrivee anticipee', 'per_stay', 0, 'early_check_in', 1, 'proportional', '10:00')
  `).run();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (11, 'Depart tardif', 'per_stay', 0, 'late_check_out', 1, 'proportional', '17:00')
  `).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 11)').run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.optionLines.length, 0);
  assert.equal(quote.optionsTotal, 0);

  db.close();
});

test('calculateReservationQuote late check-out uses progressive extra-night price as next-night reference', () => {
  const db = createPricingTestDb();
  db.prepare(`
    UPDATE pricing_rules
    SET pricingMode = 'progressive', progressiveTiers = '[]'
    WHERE id = 1
  `).run();
  db.prepare(`
    INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES (12, 'Depart tardif', 'per_stay', 0, 'late_check_out', 1, 'proportional', '17:00')
  `).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 12)').run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '12:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [],
    depositPaid: false,
    balancePaid: false,
  });

  // Progressive stay for 2 nights => extra night (n+1 = 3rd night) is 48.
  // Late checkout at 12:00 is 2h over default 10:00 with a 7h proportional window (10->17).
  // 48 * (2 / 7) = 13.71
  assert.equal(quote.optionLines.length, 1);
  assert.equal(quote.optionLines[0].optionId, 12);
  assert.equal(quote.optionLines[0].totalPrice, 13.71);
  assert.equal(quote.optionsTotal, 13.71);

  db.close();
});

test('calculateReservationQuote treats complex hourly resources as hourly and applies free minutes', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (20, 'Bain nordique', 1, 50, 'per_stay', 1, '[1]')
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 20, 50, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 20, quantity: 2, unitPrice: 50 }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].resourceId, 20);
  assert.equal(quote.resourceLines[0].billedUnits, 1);
  assert.equal(quote.resourceLines[0].totalPrice, 50);
  assert.equal(quote.resourcesTotal, 50);
  assert.equal(quote.finalPrice, 290);

  db.close();
});

test('calculateReservationQuote keeps an offered complex hourly resource at zero while preserving its original price', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (21, 'Bain nordique offert', 1, 50, 'per_stay', 1, '[1]')
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 21, 50, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 21, quantity: 2, unitPrice: 50, offered: true }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].resourceId, 21);
  assert.equal(quote.resourceLines[0].offered, true);
  assert.equal(quote.resourceLines[0].originalTotalPrice, 50);
  assert.equal(quote.resourceLines[0].totalPrice, 0);
  assert.equal(quote.resourcesTotal, 0);
  assert.equal(quote.finalPrice, 240);

  db.close();
});

test('calculateReservationQuote lets a previously offered complex resource be unoffered and reapplies free first hour', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (22, 'Bain nordique toggle', 1, 50, 'per_stay', 1, '[1]')
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 22, 50, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 22, quantity: 2, unitPrice: 50, offered: false }],
    lockedResourceLines: [{
      resourceId: 22,
      quantity: 2,
      unitPrice: 50,
      billedUnits: 2,
      priceType: 'per_stay',
      totalPrice: 0,
      offered: true,
    }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].resourceId, 22);
  assert.equal(quote.resourceLines[0].offered, false);
  assert.equal(quote.resourceLines[0].billedUnits, 1);
  assert.equal(quote.resourceLines[0].totalPrice, 50);
  assert.equal(quote.resourcesTotal, 50);

  db.close();
});

test('calculateReservationQuote keeps offered complex resource original total aligned with free first hour when locked snapshot was zeroed', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (23, 'Bain nordique locked offered', 1, 50, 'per_stay', 1, '[1]')
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 23, 50, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 23, quantity: 2, unitPrice: 50, offered: true }],
    lockedResourceLines: [{
      resourceId: 23,
      quantity: 2,
      unitPrice: 50,
      billedUnits: 2,
      priceType: 'per_stay',
      totalPrice: 0,
      offered: true,
    }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].resourceId, 23);
  assert.equal(quote.resourceLines[0].offered, true);
  assert.equal(quote.resourceLines[0].billedUnits, 1);
  assert.equal(quote.resourceLines[0].originalTotalPrice, 50);
  assert.equal(quote.resourceLines[0].totalPrice, 0);

  db.close();
});

test('calculateReservationQuote treats legacy boolean string isComplex as hourly for free first hour', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (24, 'Bain nordique legacy', 1, 50, 'per_stay', 0, '[1]')
  `).run();
  db.prepare(`
    UPDATE resources SET isComplex = 'true' WHERE id = 24
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 24, 50, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 24, quantity: 2, unitPrice: 50 }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].resourceId, 24);
  assert.equal(quote.resourceLines[0].billedUnits, 1);
  assert.equal(quote.resourceLines[0].totalPrice, 50);

  db.close();
});

test('calculateReservationQuote treats numeric-string isComplex as hourly for free first hour', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (25, 'Bain nordique legacy numeric', 1, 30, 'per_stay', 0, '[1]')
  `).run();
  db.prepare(`
    UPDATE resources SET isComplex = '1' WHERE id = 25
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 25, 30, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 25, quantity: 2, unitPrice: 30, offered: true }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].billedUnits, 1);
  assert.equal(quote.resourceLines[0].originalTotalPrice, 30);
  assert.equal(quote.resourceLines[0].totalPrice, 0);

  db.close();
});

test('calculateReservationQuote ignores non-hourly multipliers for complex resources and bills free-first-hour correctly', () => {
  const db = createPricingTestDb();
  db.prepare(`
    INSERT INTO resources (id, name, quantity, price, priceType, isComplex, propertyIds)
    VALUES (26, 'Bain nordique complex multiplier guard', 1, 30, 'per_person_per_night', 1, '[1]')
  `).run();
  db.prepare(`
    INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes)
    VALUES (1, 26, 30, 60)
  `).run();

  const quote = calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    adults: 2,
    children: 0,
    teens: 0,
    discountPercent: 0,
    customPrice: '',
    selectedOptions: [],
    selectedResources: [{ resourceId: 26, quantity: 2, unitPrice: 30, offered: true }],
    depositPaid: false,
    balancePaid: false,
  });

  assert.equal(quote.resourceLines.length, 1);
  assert.equal(quote.resourceLines[0].billedUnits, 1);
  assert.equal(quote.resourceLines[0].originalTotalPrice, 30);
  assert.equal(quote.resourceLines[0].totalPrice, 0);

  db.close();
});