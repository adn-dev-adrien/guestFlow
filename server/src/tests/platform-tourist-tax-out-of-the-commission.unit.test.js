const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/platform-tourist-tax-out-of-the-commission.md — on a platform that collects the tourist tax
// from the guest AND remits it to the commune itself (mode `platform`), the operator may state, in
// euros, how much of the brut is that tax. The stated amount — the PLATFORM's figure, never our own
// estimate — comes back out of the brut, so the revenue, the VAT base, the declared tax base and the
// computed commission all land on the stay alone.
//
// The fil rouge is the reservation that produced the accountant's 2026-08-24 report and the
// operator's 2026-09-11 one alike — Gîtes de France, Grimaud #22225, 26-28 June 2026:
//
//   Prix location            653,00
//   Options / ménage          80,00
//   Taxe de séjour            14,40   ← collected AND remitted by the centrale
//   Payé par le client       747,40
//   Virement propriétaire    668,00   → the real commission is 65,00

function createDb({ sources = [], touristTaxMode = 'per_day_per_person', percentage = 0 } = {}) {
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
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      collectsTouristTax INTEGER NOT NULL DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE ical_sources (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL,
      platformKey TEXT NOT NULL, platformLabel TEXT
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPercentage, touristTaxPerDayPerPerson)
    VALUES (1, 'Gîte', ?, ?, 1.20)`).run(touristTaxMode, percentage);
  // 2 nights at 326.50 = 653.00, the GdF « prix location ».
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 326.50, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Forfait ménage', 'per_stay', 80)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)').run();
  const insPlatform = db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, ?, ?)');
  const insSource = db.prepare('INSERT INTO ical_sources (propertyId, platformKey, platformLabel) VALUES (1, ?, ?)');
  for (const s of sources) {
    const label = s.platformLabel || s.platformKey;
    insPlatform.run(label, s.collects, s.remitted);
    insSource.run(s.platformKey, label);
  }
  return db;
}

// 6 adults × 2 nights × 1.20 = 14.40 — the engine's own estimate, which happens to equal the GdF
// figure here. The whole point of the feature is that it does not have to.
const GRIMAUD = {
  propertyId: 1,
  startDate: '2026-06-26',
  endDate: '2026-06-28',
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 6, children: 0, teens: 0, babies: 0,
  selectedOptions: [{ optionId: 1, quantity: 1, inComplement: 0 }], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

const OFFERED = [{ platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', collects: 1, remitted: 1 }];
const REVERSED = [{ platformKey: 'lodgify', platformLabel: 'Lodgify', collects: 1, remitted: 0 }];
const OWNER = [{ platformKey: 'abracadaroom', platformLabel: 'Abracadaroom', collects: 0, remitted: 0 }];

const ACCOMMODATION = 653;
const OPTIONS = 80;
const TAX = 14.40;
const BRUT_TTC = 747.40;   // what the guest paid, tax included (rule 3)
const BRUT_HT_TAX = 733;   // the stay alone — the August convention (rule 2)
const VIREMENT = 668;

// ---------------------------------------------------------------------------
// rules 3 + 6 — a stated tax comes back out of the brut
// ---------------------------------------------------------------------------

test('rules 3 + 6 — Grimaud: brut 747,40 with 14,40 withheld → finalPrice 733, accommodation 653', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC,
    platformTouristTaxAmount: TAX,
  });

  assert.equal(q.finalPrice, BRUT_HT_TAX);
  assert.equal(q.accommodationAdjustedPrice, ACCOMMODATION);
  assert.equal(q.optionsTotal, OPTIONS);
  // The tax stays offered: zeroed in our schedule, absent from what we collect.
  assert.equal(q.touristTaxTotal, 0);
  assert.equal(q.totalStayPrice, BRUT_HT_TAX);
  db.close();
});

test('rule 2 — an empty box keeps the August reading of the brut, to the cent', () => {
  // The state of every reservation stored before this spec. Same fiche, brut typed tax-excluded:
  // nothing is subtracted and the numbers are the ones already exported to the accountant.
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX,
  });

  assert.equal(q.finalPrice, BRUT_HT_TAX);
  assert.equal(q.accommodationAdjustedPrice, ACCOMMODATION);
  assert.equal(q.platformTouristTaxWithheld, null);
  db.close();
});

test('rule 2 — both conventions land on the same revenue, which is what makes the migration unnecessary', () => {
  const db = createDb({ sources: OFFERED });
  const withBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });
  const withoutBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX,
  });

  assert.equal(withBox.finalPrice, withoutBox.finalPrice);
  assert.equal(withBox.accommodationAdjustedPrice, withoutBox.accommodationAdjustedPrice);
  assert.equal(withBox.totalNetPrice, withoutBox.totalNetPrice);
  db.close();
});

// ---------------------------------------------------------------------------
// rule 1 — scope: mode `platform` only
// ---------------------------------------------------------------------------

test('rule 1 — a direct booking ignores the withheld amount entirely', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'direct',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });

  assert.equal(q.platformTouristTaxWithheld, null);
  // No brut pin on direct: the tariff prices the stay.
  assert.equal(q.accommodationAdjustedPrice, ACCOMMODATION);
  db.close();
});

test('rule 1 — `platform_reversed` ignores it: the tax is in the brut AND in the virement', () => {
  const db = createDb({ sources: REVERSED });
  const withBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'Lodgify',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });
  const withoutBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'Lodgify',
    platformGrossAmount: BRUT_TTC,
  });

  assert.equal(withBox.platformTouristTaxWithheld, null);
  assert.equal(withBox.finalPrice, withoutBox.finalPrice);
  assert.equal(withBox.accommodationAdjustedPrice, withoutBox.accommodationAdjustedPrice);
  assert.equal(withBox.totalStayPrice, withoutBox.totalStayPrice);
  db.close();
});

test('rule 1 — `owner` ignores it: the tax never enters the platform flow', () => {
  const db = createDb({ sources: OWNER });
  const withBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'Abracadaroom',
    platformGrossAmount: BRUT_HT_TAX, platformTouristTaxAmount: TAX,
  });
  const withoutBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'Abracadaroom',
    platformGrossAmount: BRUT_HT_TAX,
  });

  assert.equal(withBox.platformTouristTaxWithheld, null);
  assert.equal(withBox.finalPrice, withoutBox.finalPrice);
  // Still collected at arrival, in the complement.
  assert.equal(withBox.touristTaxCollectedOnArrival, withoutBox.touristTaxCollectedOnArrival);
  assert.equal(withBox.complementAmount, withoutBox.complementAmount);
  db.close();
});

test('rule 1 — without a brut there is nothing to take the tax out of', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformTouristTaxAmount: TAX,
  });

  assert.equal(q.platformTouristTaxWithheld, null);
  assert.equal(q.accommodationAdjustedPrice, ACCOMMODATION);
  db.close();
});

// ---------------------------------------------------------------------------
// rules 6bis + 7 — the two bases that must not carry the tax
// ---------------------------------------------------------------------------

test('rule 6bis — the declared tax base drops the withheld tax (no tax on the tax)', () => {
  // A percentage_accommodation property — the Lodge's mode. Here the base DRIVES the amount, so a
  // tax-inclusive brut left in the base would tax the tax.
  const db = createDb({ sources: OFFERED, touristTaxMode: 'percentage_accommodation', percentage: 5 });
  const withBox = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });
  const reference = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX,
  });

  // Same stay, same declared base, whichever convention the operator typed it under.
  assert.equal(withBox.touristTaxOriginalTotal, reference.touristTaxOriginalTotal);
  assert.ok(withBox.touristTaxOriginalTotal > 0, 'the percentage mode must produce an amount at all');
  db.close();
});

test('rule 7 — the VAT base is the stay, never the tourist tax', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });

  // TTC 733 at 10 % → 66.64 of VAT, 666.36 net. The tax's 14.40 is nowhere in it.
  assert.equal(q.totalNetPrice + q.totalVatAmount, BRUT_HT_TAX);
  const vatOnBrut = Math.round(BRUT_TTC * (10 / 110) * 100) / 100;
  assert.notEqual(q.totalVatAmount, vatOnBrut);
  db.close();
});

// ---------------------------------------------------------------------------
// rules 9 + 11 — what the quote publishes, and the reconciliation
// ---------------------------------------------------------------------------

test('rule 9 — the quote publishes the withheld amount beside the untouched engine estimate', () => {
  const db = createDb({ sources: OFFERED });
  const OTHER = 16.02; // a platform figure that is NOT our per-person nightly estimate (Booking-style)
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: 749.02, platformTouristTaxAmount: OTHER,
  });

  assert.equal(q.platformTouristTaxWithheld, OTHER);
  // The engine's own estimate is untouched — it is what « Reprendre le calcul » offers.
  assert.equal(q.touristTaxOriginalTotal, TAX);
  assert.equal(q.finalPrice, BRUT_HT_TAX);
  db.close();
});

test('rule 11 — net perçu equals the virement: the écart closes on the statement’s own numbers', () => {
  const db = createDb({ sources: OFFERED });
  const COMMISSION = 65;
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
    platformCommissionAmount: COMMISSION,
  });

  assert.equal(q.preArrivalAmount, BRUT_HT_TAX);
  assert.equal(q.platformNetReceivedAmount, VIREMENT);
  const ecart = Math.round((q.platformNetReceivedAmount - VIREMENT) * 100) / 100;
  assert.equal(ecart, 0);
  db.close();
});

test('rule 10 — the commission the « Calculer » button writes is the real one', () => {
  // The button's formula lives in the client; this pins the arithmetic it must produce, and that the
  // engine then reconciles it. 747,40 − 668 − 14,40 = 65,00, where brut − virement alone gives 79,40.
  const commission = Math.max(0, Math.round((BRUT_TTC - VIREMENT - TAX) * 100) / 100);
  assert.equal(commission, 65);
  assert.notEqual(commission, Math.round((BRUT_TTC - VIREMENT) * 100) / 100);

  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
    platformCommissionAmount: commission,
  });
  assert.equal(q.platformNetReceivedAmount, VIREMENT);
  db.close();
});

test('rule 8 — the withheld tax stays out of our books and out of the declaration', () => {
  // In mode `platform` the tax never transits through our accounts: `touristTaxTotal` is 0 (so the
  // accounting writes no 46710000 line) and we are not the ones who remit (so « Suivi taxe de séjour »
  // excludes the stay). Stating the amount must not change either of those — it only says how much of
  // the brut is not revenue.
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
    platformCommissionAmount: 65,
  });

  assert.equal(q.touristTaxTotal, 0);
  assert.equal(q.touristTaxOfferedByPlatform, true);
  assert.equal(q.touristTaxRemittedByOwner, false);
  assert.equal(q.touristTaxCollectedOnArrival, false);
  assert.equal(q.complementAmount, 0);
  db.close();
});

// ---------------------------------------------------------------------------
// edge cases — rules 15, 16, 19, 20
// ---------------------------------------------------------------------------

test('rule 16 — a brut that does not cover the tax it claims to contain is flagged, not floored silently', () => {
  const db = createDb({ sources: OFFERED });
  // Brut 85 covers the 80 € option but not the option + the 14,40 it is supposed to include.
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: 85, platformTouristTaxAmount: TAX,
  });

  assert.equal(q.touristTaxBrutInconsistent, true);
  assert.equal(q.accommodationAdjustedPrice, 0); // clamped, never negative
  db.close();
});

test('rule 16 — the same brut without a withheld tax is consistent (the threshold really moved)', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: 85,
  });

  assert.equal(q.touristTaxBrutInconsistent, false);
  db.close();
});

test('rule 17 — a platform switched out of the offered mode makes a stored amount inert, not lost', () => {
  // The mode is a GLOBAL platform setting: flipping it must neither crash nor keep deducting. The
  // stored euros stay in the row and become live again if the mode comes back.
  const offered = createDb({ sources: OFFERED });
  const before = calculateReservationQuote({
    ...GRIMAUD, db: offered, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });
  assert.equal(before.finalPrice, BRUT_HT_TAX);
  assert.equal(before.platformTouristTaxWithheld, TAX);
  offered.close();

  // Same reservation, same stored amount, the platform now reverses the tax to us.
  const flipped = createDb({ sources: [{ platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', collects: 1, remitted: 0 }] });
  const after = calculateReservationQuote({
    ...GRIMAUD, db: flipped, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
  });
  assert.equal(after.platformTouristTaxWithheld, null); // inert
  const reference = calculateReservationQuote({
    ...GRIMAUD, db: flipped, platform: 'GitesDeFrance', platformGrossAmount: BRUT_TTC,
  });
  assert.equal(after.finalPrice, reference.finalPrice);
  flipped.close();
});

test('rule 15 — an explicit 0 computes like an empty box', () => {
  const db = createDb({ sources: OFFERED });
  const zero = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX, platformTouristTaxAmount: 0,
  });
  const empty = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX, platformTouristTaxAmount: '',
  });

  assert.equal(zero.finalPrice, empty.finalPrice);
  assert.equal(zero.platformTouristTaxWithheld, null);
  assert.equal(empty.platformTouristTaxWithheld, null);
  db.close();
});

test('rule 20 — a negative amount is clamped, never allowed to inflate the brut', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX, platformTouristTaxAmount: -14.40,
  });

  assert.equal(q.finalPrice, BRUT_HT_TAX);
  assert.equal(q.platformTouristTaxWithheld, null);
  db.close();
});

test('rule 20 — a non-numeric amount is ignored, leaving the August reading', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_HT_TAX, platformTouristTaxAmount: 'abc',
  });

  assert.equal(q.finalPrice, BRUT_HT_TAX);
  assert.equal(q.platformTouristTaxWithheld, null);
  db.close();
});

test('rule 19 — a frozen tax does not move the withheld amount, which is the platform’s', () => {
  const db = createDb({ sources: OFFERED });
  const q = calculateReservationQuote({
    ...GRIMAUD, db, platform: 'GitesDeFrance',
    platformGrossAmount: BRUT_TTC, platformTouristTaxAmount: TAX,
    freezeTouristTax: true, frozenTouristTaxTotal: 9.60, frozenTouristTaxRate: 0.80,
  });

  assert.equal(q.platformTouristTaxWithheld, TAX);
  assert.equal(q.finalPrice, BRUT_HT_TAX);
  // The frozen estimate is what « Reprendre le calcul » would offer, and it is left alone.
  assert.equal(q.touristTaxOriginalTotal, 9.60);
  db.close();
});
