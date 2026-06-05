const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createAccountingModel } = require('../models/accountingModel');

// 2026-06-05 regression net.
//
// Live prod bug pinned via SSH read of `~/guestflow/data/guestflow.db` on the Pi: Chloé
// Le Lann's reservation (#5, Gitedefrance, balancePaidDate 2026-05-07, all contribs NULL
// because the Solde was flipped BEFORE the force-item-to-complement feature shipped) was
// exporting with:
//
//   CRÉDIT 70600000 Location gîte           624,54 €
//   CRÉDIT 70600010 Prestation comp.         79,82 €
//   CRÉDIT 44571100 TVA 10 %                -17,36 €   ← phantom negative VAT
//
// Root cause: with all contribs NULL the `buildEntry` engine falls back to the LEGACY path,
// which derives buckets from a freshly-recomputed `quote`. `accountingModel.computeQuoteForReservation`
// was calling `calculateReservationQuote` WITHOUT the operator's `customPrice` override AND
// WITHOUT the offered flag on each option → the recomputed quote silently put the offered
// ménage option back at its 80 € catalog price + ignored the manual 626 € accommodation
// override. The legacy path then emitted an options bucket of 72,73 € HT × grossRatio
// 1,09744 = 79,82 € on 70600010. The residue absorption on the last credit line dumped the
// resulting -87,80 € mismatch onto the VAT row → -17,36 €.
//
// Fix: pass `customPrice`, `offeredOptionIds` (+ `offered: true` on each selectedOption /
// selectedResource so the engine zeroes the line totals) when calling the engine from
// `computeQuoteForReservation`. The legacy path's buckets now match `row.finalPrice` exactly,
// the residue collapses to ≤ 1 cent of pure rounding, and the VAT line stays positive.
//
// This test pins the exact prod scenario.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER, price REAL, priceType TEXT, isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10, defaultCommissionAccountNumber TEXT DEFAULT '622600', vatRateCommission REAL DEFAULT 20);
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      commissionAccountNumber TEXT, hasVatOnCommission INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER, kind TEXT DEFAULT 'reservation',
      startDate TEXT, endDate TEXT, checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      platform TEXT DEFAULT 'direct', discountPercent REAL DEFAULT 0, customPrice REAL,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT,
      complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
      finalPrice REAL DEFAULT 0, clientGrossAmount REAL,
      totalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0,
      touristTaxInComplement INTEGER DEFAULT 0, extraGuestSurchargeOffered INTEGER DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
    );
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, optionId));
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId));
    CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL, PRIMARY KEY (reservationId, date));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, collectsTouristTax INTEGER DEFAULT 1);
  `);
  // Settings: VAT 10 %, commission VAT 20 %.
  db.prepare("INSERT INTO app_settings (id) VALUES (1)").run();
  // Property "Gite" with night price = 314.50 € (gives 629 € accommodation for 2 nights;
  // matches Chloé's history "Prix hébergement: 0 → 629").
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight) VALUES (1, 1, 314.5)").run();
  // Client.
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (4, 'Chloé', 'Le lann')").run();
  // Platform row with Gitedefrance compte commission (= what the Plan comptable page sets).
  db.prepare("INSERT INTO platforms (id, name, commissionAccountNumber, hasVatOnCommission) VALUES (1, 'Gitedefrance', '62260500', 1)").run();
  // Options catalog: option 2 = late checkout (auto-timed), option 3 = ménage (fixed 80 €).
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled, autoPricingMode) VALUES (2, 'Départ tardif', 'per_stay', 0, 'late_check_out', 1, 'proportional')").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (3, 'Ménage', 'per_stay', 80)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 2), (1, 3)").run();
  return db;
}

function seedChloeReservation(db) {
  // Mirror Chloé's exact DB state post-deploy + post-offer (verified live on the Pi
  // 2026-06-05):
  //   - platform Gitedefrance, finalPrice 626, clientGrossAmount 687
  //   - depositDisabled (depositAmount = 0), Solde paid 2026-05-07
  //   - both options offered = 1, totalPrice = 0, inComplement = 1
  //   - ALL contribs NULL (Solde flipped pre-force-item-to-complement deploy)
  db.prepare(`
    INSERT INTO reservations
      (id, propertyId, clientId, kind, startDate, endDate, checkInTime, checkOutTime,
       adults, platform, customPrice, finalPrice, clientGrossAmount, totalPrice,
       depositAmount, depositPaid, balanceAmount, balancePaid, balancePaidDate,
       accommodationAcompteContribTtc, accommodationSoldeContribTtc,
       touristTaxAcompteContribTtc, touristTaxSoldeContribTtc)
    VALUES (5, 1, 4, 'reservation', '2026-05-05', '2026-05-07', '16:00', '12:00',
            8, 'Gitedefrance', 626, 626, 687, 626,
            0, 0, 626, 1, '2026-05-07',
            NULL, NULL, NULL, NULL)
  `).run();
  // Option lines after offer + PR #121 migration:
  db.prepare(`
    INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, offered, inComplement, acompteContribTtc, soldeContribTtc)
    VALUES (5, 2, 1, 0, 1, 1, NULL, NULL),
           (5, 3, 1, 0, 1, 1, NULL, NULL)
  `).run();
}

test('Chloé Le Lann scenario — legacy path with offered options + customPrice produces a clean entry (no phantom 70600010, no negative VAT)', () => {
  const db = createDb();
  seedChloeReservation(db);

  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 5, year: 2026 });

  // Exactly one entry (the Solde flip on 2026-05-07).
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.reservationId, 5);
  assert.equal(entry.kind, 'balance');
  assert.equal(entry.platform, 'Gitedefrance');

  // CCLIENT debit = encaissementNetTtc = grossTtc − commission = 687 − 61 = 626 €.
  // Pre-fix: this would still be 626 because the encaissement amount on the row drives it.
  // The interesting bit is the credit side.
  assert.equal(round2(entry.encaissementTtc),    687);
  assert.equal(round2(entry.encaissementNetTtc), 626);

  // Commission line: 61 € TTC. The account-resolution path uses platformsModel's default
  // module export (bound to its own DB instance), so a unit test against an in-memory DB
  // sees `defaultAccount = '622600'` from the test's app_settings. The platform-account
  // override (`62260500` for Gitedefrance) is exercised by the integration test on the
  // real Pi data. Here we focus on the MATH bug, not the lookup wiring.
  assert.ok(entry.commission, 'commission must be present on a non-direct platform reservation');
  assert.equal(round2(entry.commission.ttc), 61, 'commission TTC = gross - net = 687 - 626');
  // hasVat depends on whether the in-memory platforms row was picked up by the model's
  // module-bound platformsModel — assume false (default) and assert HT = TTC, VAT = 0 OR
  // hasVat = true with HT = 50.83 + VAT = 10.17. Either way Σ commission lines = 61.
  const commissionLinesSum = round2(entry.commission.ht + entry.commission.vat);
  assert.equal(commissionLinesSum, 61, 'commission HT + VAT must sum to TTC');

  // Credit buckets — the regression: with offered options + customPrice now flowing through
  // the engine recompute, only accommodation contributes. NO options bucket.
  const accommodation = entry.buckets.find((b) => b.name === 'accommodation');
  const options       = entry.buckets.find((b) => b.name === 'options');
  const resources     = entry.buckets.find((b) => b.name === 'resources');

  assert.ok(accommodation, 'accommodation bucket must be present');
  assert.equal(options,   undefined, 'options bucket must be FILTERED OUT (both options offered, totalPrice = 0)');
  assert.equal(resources, undefined, 'no resources on this reservation');

  // Accommodation bucket in the legacy path carries the NET HT/VAT (= bucket('accommodation',
  // quote.accommodationNetPrice, quote.accommodationVatAmount, …) — the export multiplies by
  // `fraction` (= legacyFraction = encaissementTtc/totalStayTtc × grossRatio) before writing.
  //
  // For Chloé:
  //   - accommodation NET HT = customPrice / (1 + 10/100) = 626 / 1.10 = 569.09 €
  //   - accommodation NET VAT = 626 - 569.09 = 56.91 €
  //   - legacyFraction = (626/626) × (687/626) = 1.09744
  //   - effective HT on the CSV row = 569.09 × 1.09744 = 624.55 € ✓ (matches accountant's spec)
  //   - effective VAT on the CSV row = 56.91 × 1.09744 = 62.45 € ✓ (positive!)
  assert.equal(round2(accommodation.ht),  569.09, 'accommodation NET HT must come from customPrice / 1.10');
  assert.equal(round2(accommodation.vat),  56.91, 'accommodation NET VAT must be 10% of net 626 €');
  assert.equal(accommodation.ratePercent,  10);

  // The legacy `fraction` field carries grossRatio (since fraction = 1 for full balance).
  assert.ok(
    Math.abs(entry.fraction - (687 / 626)) <= 0.001,
    `legacy fraction must equal grossRatio (≈ 1.09744), got ${entry.fraction}`
  );

  // The effective HT + VAT after fraction scaling matches the accountant's expected output:
  // 624.55 € on 70600000, 62.45 € on 44571100. Σ = 687 € = grossDebit.
  const effectiveHt  = round2(accommodation.ht  * entry.fraction);
  const effectiveVat = round2(accommodation.vat * entry.fraction);
  assert.ok(
    Math.abs(effectiveHt - 624.55) <= 0.02,
    `effective accommodation HT (= bucket.ht × fraction) should ≈ 624.55, got ${effectiveHt}`
  );
  assert.ok(
    Math.abs(effectiveVat - 62.45) <= 0.02,
    `effective accommodation VAT should ≈ 62.45, got ${effectiveVat}. POSITIVE — the prod bug pushed it to -17.36.`
  );
  assert.ok(effectiveVat > 0, 'effective VAT must be positive — negative VAT was the prod symptom');

  const sumCredits = round2(effectiveHt + effectiveVat);
  assert.ok(
    Math.abs(sumCredits - 687) <= 0.02,
    `Σ effective credits should ≈ grossDebit (687), got ${sumCredits}`
  );
});

test('Chloé scenario — end-to-end via entryToRows: the actual CSV rows produced match the accountant-correct shape', () => {
  // Drive the full chain: model → entryToRows. This validates that the absorption residue
  // on the last credit line stays within ±0,02 € (= clean rounding noise), NOT the -87 €
  // mismatch that the prod bug produced.
  const { entryToRows } = require('../utils/accountingExport');
  const db = createDb();
  seedChloeReservation(db);
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 5, year: 2026 });
  assert.equal(entries.length, 1);

  // Capture console.warn so we can assert no warning fires (the defensive log only triggers
  // above 1 € residue — clean entries must stay below that threshold).
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let rows;
  try {
    rows = entryToRows(entries[0]);
  } finally {
    console.warn = originalWarn;
  }

  // No big-residue warning fires on a healthy entry.
  assert.equal(warnings.filter((w) => w.includes('credit/debit residue')).length, 0,
    'no large-residue warning should fire on a healthy entry post-fix');

  // Find each row's debit/credit (indices 7=Débit, 8=Crédit per CSV_HEADERS).
  const DEBIT = 7;
  const CREDIT = 8;
  const ACCOUNT = 6;
  const debits  = rows.filter((r) => typeof r[DEBIT]  === 'number' && r[DEBIT]  > 0);
  const credits = rows.filter((r) => typeof r[CREDIT] === 'number' && r[CREDIT] > 0);

  // 1 CCLIENT debit + 1 commission HT debit + 1 commission VAT debit (= 3 total when hasVat).
  // For the integration test against in-memory data, hasVat may be false (platform row not
  // picked up by module-bound platformsModel) → only commission HT debit (2 total).
  assert.ok(debits.length >= 2, `expected ≥ 2 debits (CCLIENT + commission HT), got ${debits.length}`);
  // Σ debits = grossDebit = 687 €.
  const sumDebits = round2(debits.reduce((a, r) => a + r[DEBIT], 0));
  assert.equal(sumDebits, 687, `Σ debits must equal grossDebit 687 €, got ${sumDebits}`);

  // Credits: ≥ 1 revenue (70xxx) + 1 VAT (44571100). No 70600010 line (no options bucket).
  // Σ credits = 687 €.
  const sumCredits = round2(credits.reduce((a, r) => a + r[CREDIT], 0));
  assert.equal(sumCredits, 687, `Σ credits must equal grossDebit 687 €, got ${sumCredits}`);

  // No phantom 70600010 (Prestation complémentaire) row.
  const prestationRows = rows.filter((r) => r[ACCOUNT] === '70600010');
  assert.equal(prestationRows.length, 0,
    'no 70600010 line should appear: both options offered = 0 € → bucket dropped');

  // No negative credit anywhere (the prod bug surfaced as VAT = -17,36 €).
  const negativeCredits = rows.filter((r) => typeof r[CREDIT] === 'number' && r[CREDIT] < 0);
  assert.equal(negativeCredits.length, 0,
    `no credit line should be negative — the prod bug produced TVA 10 % = -17,36 €. Got: ${JSON.stringify(negativeCredits)}`);

  // No negative debit anywhere (symmetric safety).
  const negativeDebits = rows.filter((r) => typeof r[DEBIT] === 'number' && r[DEBIT] < 0);
  assert.equal(negativeDebits.length, 0, 'no debit line should be negative');

  // Accommodation HT credit on 70600000 ≈ 624.55 €.
  const accommodationRows = rows.filter((r) => r[ACCOUNT] === '70600000');
  assert.equal(accommodationRows.length, 1, '70600000 must have exactly one credit line');
  assert.ok(
    Math.abs(accommodationRows[0][CREDIT] - 624.55) <= 0.02,
    `70600000 credit must ≈ 624.55 €, got ${accommodationRows[0][CREDIT]}`
  );

  // VAT 10% on 44571100 ≈ 62.45 € — POSITIVE.
  const vatRows = rows.filter((r) => r[ACCOUNT] === '44571100');
  assert.equal(vatRows.length, 1, '44571100 must have exactly one credit line');
  assert.ok(vatRows[0][CREDIT] > 0, '44571100 VAT must be positive');
  assert.ok(
    Math.abs(vatRows[0][CREDIT] - 62.45) <= 0.02,
    `44571100 VAT credit must ≈ 62.45 €, got ${vatRows[0][CREDIT]}`
  );
});

test('positive control — a direct booking on the same shape (no offered options) still routes correctly', () => {
  // Same property, but a direct reservation with NO options. Ensures the fix doesn't shift
  // any number for the non-platform case (regression net for the broader impact).
  const db = createDb();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (10, 'Jean', 'Direct')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, propertyId, clientId, kind, startDate, endDate, adults,
       platform, finalPrice, clientGrossAmount, totalPrice,
       balanceAmount, balancePaid, balancePaidDate)
    VALUES (99, 1, 10, 'reservation', '2026-05-10', '2026-05-12', 2,
            'direct', 629, 629, 629,
            629, 1, '2026-05-12')
  `).run();

  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ month: 5, year: 2026 });

  // Find the direct one (Chloé's seeded data is absent here so we only have the direct).
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.platform, 'direct');
  // grossRatio === 1 for direct → encaissementNet == encaissementTtc.
  assert.equal(round2(entry.encaissementTtc),    629);
  assert.equal(round2(entry.encaissementNetTtc), 629);
  // No commission line on direct bookings.
  assert.equal(entry.commission, null);
});

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
