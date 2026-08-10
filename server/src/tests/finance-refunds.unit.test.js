// Remboursements dans les agrégats finance + le total de séjour du moteur.
// specs/reservation-refunds.md §3.3 (rules 16–19) : l'argent rendu sort du « total de séjour » et de
// l'« encaissé », mais ne touche JAMAIS le statut de règlement — une résa payée puis partiellement
// remboursée reste soldée.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const refundsModel = require('../models/refundsModel');
const { calculateReservationQuote } = require('../utils/pricing').__test;

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// Séjour à 480 €, acompte 144 € + solde 336 €, les deux encaissés. Départ le 17/08.
function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  // Columns added by a database.js migration after the schema.sql baseline (specs/migrations-baseline.md).
  db.exec('ALTER TABLE reservations ADD COLUMN midStaySettledNotes TEXT');
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du Pré')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
  db.prepare(`
    INSERT INTO reservations (
      id, propertyId, clientId, startDate, endDate, platform, finalPrice,
      depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate
    ) VALUES (1, 1, 1, '2026-08-10', '2026-08-17', 'direct', 480, 144, 1, '2026-07-01', 336, 1, '2026-08-10')
  `).run();
  return { db, model: financeModel.buildModel(db), refunds: refundsModel.createModel(db) };
}

const PERIOD = { from: '2026-08-01', to: '2026-08-31' };

const refund = (overrides = {}) => ({
  refundDate: '2026-08-18',
  method: 'transfer',
  reason: 'Départ anticipé',
  totalTtc: 24,
  lines: [{ lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 2, unitPrice: 12, amountTtc: 24, vatRate: 10 }],
  ...overrides,
});

test('rule 18 — un remboursement par virement sort du total de séjour et de l’encaissé', () => {
  const { model, refunds } = freshDb();
  const before = model.getSummary(PERIOD);
  assert.equal(before.revenueTotal, 480);
  assert.equal(before.totalCollected, 480);

  refunds.create(1, refund());
  const after = model.getSummary(PERIOD);
  assert.equal(after.revenueTotal, 456);
  assert.equal(after.totalCollected, 456);
  // Le HT suit le TTC (même ratio élément par élément).
  assert.ok(after.revenueTotalHt < before.revenueTotalHt);
});

test('rule 19 — un remboursement en caisse interne reste hors des agrégats comptables', () => {
  const { model, refunds } = freshDb();
  refunds.create(1, refund({ method: 'internal' }));
  const summary = model.getSummary(PERIOD);
  assert.equal(summary.revenueTotal, 480);
  assert.equal(summary.totalCollected, 480);
});

test('rule 19 — les espèces sont de l’argent comptable, comme le virement', () => {
  const { model, refunds } = freshDb();
  refunds.create(1, refund({ method: 'cash' }));
  assert.equal(model.getSummary(PERIOD).revenueTotal, 456);
});

test('rule 16 — le statut de règlement ignore les remboursements : la résa reste soldée', () => {
  const { model, refunds } = freshDb();
  refunds.create(1, refund());
  const summary = model.getSummary(PERIOD);
  assert.equal(summary.totalPending, 0, 'aucun reste à payer ne doit apparaître');

  const operational = model.getOperational();
  assert.equal(operational.pending.reservations.length, 0);
  assert.equal(operational.overdue.count, 0);
});

test('le revenu par logement et la projection suivent le même net', () => {
  const { model, refunds } = freshDb();
  refunds.create(1, refund());
  const summary = model.getSummary(PERIOD);
  assert.deepEqual(
    summary.revenueByProperty.map((p) => [p.propertyName, p.revenue]),
    [['Gîte du Pré', 456]],
  );
  assert.equal(model.getProjection({ date: '2026-08-31' }).total, 456);
});

test('le détail d’une carte finance affiche lui aussi le total net de remboursement', () => {
  const { model, refunds } = freshDb();
  refunds.create(1, refund());
  const breakdown = model.getBreakdown({ metric: 'revenueTotal', ...PERIOD });
  assert.equal(breakdown.data.total, 456);
  assert.equal(breakdown.data.rows[0].amount, 456);
});

// ── Moteur de prix : le « total de séjour » de la fiche ───────────────────────

function quoteDb() {
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
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const QUOTE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  platform: 'direct', depositAmount: 60, balanceAmount: 140,
  depositPaid: true, balancePaid: true,
};

test('rule 17 — le total de séjour de la fiche est net des remboursements, le reste du devis intact', () => {
  const plain = calculateReservationQuote({ ...QUOTE, db: quoteDb() });
  const refunded = calculateReservationQuote({ ...QUOTE, db: quoteDb(), refundsTotal: 24 });

  assert.equal(plain.refundsTotal, 0);
  assert.equal(refunded.refundsTotal, 24);
  assert.equal(refunded.sejourNetTotal, plain.sejourNetTotal - 24);
  // Aucune autre valeur du devis ne bouge : la vente n'est pas réécrite.
  assert.equal(refunded.finalPrice, plain.finalPrice);
  assert.equal(refunded.depositAmount, plain.depositAmount);
  assert.equal(refunded.balanceAmount, plain.balanceAmount);
  assert.equal(refunded.complementAmount, plain.complementAmount);
  assert.equal(refunded.totalStayPrice, plain.totalStayPrice);
});
