// specs/deposit-blocks-the-dates.md rule 18 and specs/payment-links-vat.md rule 10 (audit 2026-10-27,
// finding 3) — a `full` payment link charges exactly what its payment marks paid: the acompte plus the
// solde, i.e. the pre-arrival amount, tourist tax included and the arrival complement excluded.
//
// It used to charge `finalPrice` — tourist tax left out, complement lines kept in — and then tick the
// whole solde paid: 3 nights × 100 + ménage 80 with 6 € of tax charged 380 € and booked 386 € as
// received; with the ménage routed to the Complément the guest paid 380 € for a 306 € solde and was
// asked for the 80 € ménage again on arrival.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');
const { __test: { resolveAmountCents, resolveVatComponents } } = require('../controllers/paymentsController');
const { storedLinkComponents } = require('../utils/storedLinkComponents');
const { linkAmountCents } = require('../utils/ledgerLinks');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { LINK_TITLES } = require('../utils/paymentRequestService');

const CLEANING = 20;

function engineDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 30,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00', touristTaxPerDayPerPerson REAL DEFAULT 1,
      touristTaxMode TEXT DEFAULT 'per_day_per_person', touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0,
      touristTaxFixedAmount REAL DEFAULT 0, basePriceIncludedGuests INTEGER DEFAULT 2, extraGuestPrice REAL DEFAULT 20,
      extraGuestPriceUnit TEXT DEFAULT 'per_night');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', startDate TEXT, endDate TEXT,
      minNights INTEGER DEFAULT 1, maxNights INTEGER, extraGuestPrice REAL, extraGuestTiers TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed',
      autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT, isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, pricePerNight, dateRanges) VALUES (1, 100, '[{\"startDate\":\"2026-01-01\",\"endDate\":\"2026-12-31\"}]')").run();
  db.prepare(`INSERT INTO options (id, title, price) VALUES (${CLEANING}, 'Ménage', 80)`).run();
  db.prepare(`INSERT INTO property_options VALUES (1, ${CLEANING})`).run();
  return db;
}

// The audit scenario: 3 nights × 100 + ménage 80, 2 adults, tax 1 €/adult/night, arrival in 3 days
// (last-minute → no acompte, one full payment).
function quote({ cleaningInComplement = false } = {}) {
  const db = engineDb();
  return calculateReservationQuote({
    db, propertyId: 1, adults: 2, children: 0, teens: 0, startDate: '2026-05-01', endDate: '2026-05-04',
    platform: 'direct', bookingDate: '2026-04-28', customOptions: [], selectedResources: [],
    selectedOptions: [{ optionId: CLEANING, quantity: 1, ...(cleaningInComplement ? { inComplement: 1 } : {}) }],
  });
}

test('audit scenario: the full link charges the solde 386 €, tourist tax included', () => {
  const q = quote();
  assert.equal(q.finalPrice, 380);
  assert.equal(q.touristTaxTotal, 6);
  assert.equal(q.depositAmount, 0, 'last-minute: no acompte');
  assert.equal(q.balanceAmount, 386);
  assert.equal(resolveAmountCents(1, 'full', {}, () => q), 38600, 'never finalPrice (380)');
  const basket = resolveVatComponents(1, 'full', () => q);
  assert.deepEqual(basket.components.map((c) => [c.grossCents, c.taxable]), [[38000, true], [600, false]],
    'the tax rides on a 0 % line, like the solde');
});

test('a line routed to the Complément is not charged by the full link', () => {
  const q = quote({ cleaningInComplement: true });
  assert.equal(q.complementAmount, 80);
  assert.equal(q.preArrivalAmount, 306);
  assert.equal(resolveAmountCents(1, 'full', {}, () => q), 30600, 'the guest no longer pays the ménage twice');
  const basket = resolveVatComponents(1, 'full', () => q);
  assert.deepEqual(basket.components.map((c) => c.grossCents), [30000, 600]);
});

test('a reservation (stored columns): full = acompte + solde, basket split like the solde', () => {
  const lastMinute = { depositAmount: 0, balanceAmount: 386, finalPrice: 380, touristTaxTotal: 6 };
  assert.equal(resolveAmountCents(1, 'full', lastMinute, () => null), 38600);
  const withDeposit = { depositAmount: 114, balanceAmount: 272, finalPrice: 380, touristTaxTotal: 6 };
  assert.equal(resolveAmountCents(1, 'full', withDeposit, () => null), 38600);
  assert.equal(linkAmountCents('full', withDeposit), 38600, 'the stale-link check reads the same figure');

  const opts = { vatRatePercent: 10, taxOnArrival: false, titles: LINK_TITLES };
  assert.deepEqual(storedLinkComponents(withDeposit, 'full', opts).components.map((c) => [c.grossCents, c.taxable]),
    [[38000, true], [600, false]]);
  assert.deepEqual(storedLinkComponents(withDeposit, 'full', { ...opts, taxOnArrival: true }).components.map((c) => c.grossCents),
    [38600], 'tax paid on arrival: no tax line');
});

// ── What the paid link records ────────────────────────────────────────────────────────────────

function pollDb(row) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, convertedReservationId INTEGER,
    depositAmount REAL, balanceAmount REAL, finalPrice REAL, depositPaid INTEGER DEFAULT 0, balancePaid INTEGER DEFAULT 0,
    complementAmount REAL DEFAULT 0, platform TEXT DEFAULT 'direct')`);
  db.exec('CREATE TABLE payment_links (id INTEGER PRIMARY KEY, reservationId INTEGER, type TEXT, amountCents INTEGER, status TEXT)');
  db.prepare(`INSERT INTO reservations (id, kind, depositAmount, balanceAmount, finalPrice)
    VALUES (1, 'reservation', @depositAmount, @balanceAmount, @finalPrice)`).run(row);
  return db;
}

async function payFullLink(row, amountCents) {
  const database = pollDb(row);
  const recorded = [];
  const result = await processPaidLink({
    database, devisModel: {},
    paymentLinksModel: { markPaid: () => ({ flipped: true }) },
    link: { id: 9, reservationId: 1, type: 'full', amountCents },
    paidPayment: { paidAt: '2026-04-28T10:00:00Z' },
    recordPayment: (p) => recorded.push(p.bucket),
    emitPluginEvent: () => {},
  });
  return { result, recorded };
}

test('a paid 386 € full link marks the solde paid — no « amount changed » rebooking', async () => {
  const { result, recorded } = await payFullLink({ depositAmount: 0, balanceAmount: 386, finalPrice: 380 }, 38600);
  assert.equal(result.effect, 'balance-marked', 'the link charged what the row asks for');
  assert.deepEqual(recorded, ['balance']);
});

test('a full link over an acompte records both the acompte and the solde', async () => {
  const { result, recorded } = await payFullLink({ depositAmount: 114, balanceAmount: 272, finalPrice: 380 }, 38600);
  assert.equal(result.effect, 'balance-marked');
  assert.deepEqual(recorded, ['full'], 'acompte then solde — the acompte is never left open');
});
