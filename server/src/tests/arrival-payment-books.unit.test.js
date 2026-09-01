// specs/arrival-payment-detail-and-adjustment.md §3.3-§3.4 — what a réduction accordée (or a
// pourboire) on the single arrival payment does to the money.
//
// The design under test: the réduction is modelled on the REFUND, not on the price. No bucket amount
// and no quote is rewritten — the readers subtract it. Two things must therefore hold, and both are
// the reason this file exists:
//   - `comptaCollected` and `totalSejour` move TOGETHER, so the invariant
//     `comptaCollected + remainingToPay === totalSejour` survives an adjustment;
//   - the journal still balances, with the rebate on its own `70900000` debit rather than a quietly
//     smaller accommodation credit.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const { create: createAccountingModel } = require('../models/accountingModel');
const { entryToStructured } = require('../utils/accountingExport');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Le schéma minimal contre lequel `encaissementsByMonth` tourne déjà (cf.
// accounting-encaissements-integration), plus les deux colonnes de cette spec.
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
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, price REAL, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER, price REAL, priceType TEXT, isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER, kind TEXT DEFAULT 'reservation',
      startDate TEXT, endDate TEXT, checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      platform TEXT DEFAULT 'direct', discountPercent REAL DEFAULT 0, customPrice REAL,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT,
      complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
      complementPaidCash INTEGER DEFAULT 0, depositDueDate TEXT, balanceDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
      depositPaidCash INTEGER NOT NULL DEFAULT 0, balancePaidCash INTEGER NOT NULL DEFAULT 0,
      arrivalPaymentGroup TEXT,
      endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
      endOfStayComplementDetail TEXT, arrivalExtrasBaseline TEXT, midStaySettledNotes TEXT,
      finalPrice REAL DEFAULT 0, clientGrossAmount REAL, platformCommissionAmount REAL, acompteCommissionAmount REAL,
      totalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0,
      touristTaxInComplement INTEGER DEFAULT 0, extraGuestSurchargeOffered INTEGER DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL,
      arrivalPaymentReduction REAL, arrivalPaymentTip REAL
    );
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, optionId));
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId));
    CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL, PRIMARY KEY (reservationId, date));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, collectsTouristTax INTEGER DEFAULT 1);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId) VALUES (1, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return db;
}

// A stay collected in one gesture on the 12th: solde 400 € (hébergement) + complément 100 €.
const GROUP = JSON.stringify({ at: '2026-08-12', cash: 0, total: 500, buckets: ['balance', 'complement'] });
const CASH_GROUP = JSON.stringify({ at: '2026-08-12', cash: 1, total: 500, buckets: ['balance', 'complement'] });

const freshDb = createDb;

function insertPayment(db, overrides = {}) {
  const r = {
    id: 1,
    clientId: 1,
    propertyId: 1,
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    finalPrice: 500,
    totalPrice: 500,
    balanceAmount: 400,
    balancePaid: 1,
    balancePaidDate: '2026-08-12',
    balancePaidCash: 0,
    complementAmount: 100,
    complementPaid: 1,
    complementPaidDate: '2026-08-12',
    complementPaidCash: 0,
    accommodationSoldeContribTtc: 400,
    touristTaxSoldeContribTtc: 0,
    arrivalPaymentGroup: GROUP,
    arrivalPaymentReduction: null,
    arrivalPaymentTip: null,
    ...overrides,
  };
  const cols = Object.keys(r);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(r);
  return db;
}

const summaryOf = (db) => financeModel.buildModel(db).getSummary({ from: '2026-08-01', to: '2026-08-31' });
const entriesOf = (db) => createAccountingModel(db).encaissementsByMonth({ month: 8, year: 2026 });

// ── What the operator earns, and what the operator received ──────────────────

test('no adjustment: the books are exactly what the buckets say', () => {
  const s = summaryOf(insertPayment(freshDb()));
  assert.equal(s.revenueTotal, 500);
  assert.equal(s.totalCollected, 500);
});

// specs/arrival-payment-detail-and-adjustment.md rule 20
test('a réduction accordée lowers BOTH the total du séjour and the encaissé', () => {
  // 500 € annoncés, 450 € remis : l'opérateur a gagné 450 €, et c'est ce que la banque montre.
  const s = summaryOf(insertPayment(freshDb(), { arrivalPaymentReduction: 50 }));
  assert.equal(s.revenueTotal, 450);
  assert.equal(s.totalCollected, 450);
});

// specs/arrival-payment-detail-and-adjustment.md rule 21
test('a pourboire raises both', () => {
  const s = summaryOf(insertPayment(freshDb(), { arrivalPaymentTip: 20 }));
  assert.equal(s.revenueTotal, 520);
  assert.equal(s.totalCollected, 520);
});

// specs/arrival-payment-detail-and-adjustment.md rule 19
test('the invariant holds: encaissé + reste à payer = total du séjour', () => {
  // Le séjour est soldé, donc reste = 0 : les deux figures doivent rester égales APRÈS la réduction.
  // C'est tout l'intérêt de ne toucher aucun seau — `remainingToPay` n'a rien à apprendre.
  const s = summaryOf(insertPayment(freshDb(), { arrivalPaymentReduction: 50 }));
  assert.equal(round2(s.totalCollected + 0), s.revenueTotal);
});

// specs/arrival-payment-detail-and-adjustment.md rule 27
test('a caisse-interne group is off the books WHOLE — réduction included', () => {
  // Ses seaux ne comptent déjà pour rien ; soustraire la réduction rendrait l'encaissé négatif sur de
  // l'argent qui n'est jamais entré dans les livres.
  const db = insertPayment(freshDb(), {
    arrivalPaymentGroup: CASH_GROUP,
    balancePaidCash: 1,
    complementPaidCash: 1,
    arrivalPaymentReduction: 50,
  });
  const s = summaryOf(db);
  assert.equal(s.revenueTotal, 0);
  assert.equal(s.totalCollected, 0);
});

// ── The journal ──────────────────────────────────────────────────────────────

// specs/arrival-payment-detail-and-adjustment.md rule 24
test('the réduction is its own balanced entry, debited on 70900000', () => {
  const entries = entriesOf(insertPayment(freshDb(), { arrivalPaymentReduction: 50 }));
  const discount = entries.find((e) => e.kind === 'discount');
  assert.ok(discount, 'une écriture de rabais est émise');
  assert.equal(discount.paidDate, '2026-08-12', "datée du jour de la collecte, pas de la saisie");
  const card = entryToStructured(discount);
  assert.equal(card.direction, 'discount');
  assert.equal(card.balanced, true);
  const rebate = card.lines.find((l) => l.compte === '70900000');
  assert.ok(rebate, 'la remise porte sa propre ligne');
  assert.equal(rebate.debit, 45.45, 'le HT de la remise (TVA 10 %)');
  assert.equal(card.lines.find((l) => l.compte === '44571100').debit, 4.55, 'la TVA due baisse d’autant');
  assert.equal(card.lines.find((l) => l.compte.startsWith('C')).credit, 50, 'le débit client revient au réellement encaissé');
});

test('the sale entries keep their GROSS credits — the rebate is a line, not a smaller price', () => {
  const entries = entriesOf(insertPayment(freshDb(), { arrivalPaymentReduction: 50 }));
  const balance = entries.find((e) => e.kind === 'balance');
  const card = entryToStructured(balance);
  assert.equal(card.lines.find((l) => l.compte === '70600000').credit, 363.64, 'hébergement au brut');
  assert.equal(card.balanced, true);
});

// specs/arrival-payment-detail-and-adjustment.md rule 25
test('the pourboire is its own entry, hors TVA, on the produit divers', () => {
  const entries = entriesOf(insertPayment(freshDb(), { arrivalPaymentTip: 20 }));
  const tip = entries.find((e) => e.kind === 'tip');
  assert.ok(tip);
  const card = entryToStructured(tip);
  assert.equal(card.direction, 'tip');
  assert.equal(card.balanced, true);
  const produit = card.lines.find((l) => l.compte === '75880000');
  assert.equal(produit.credit, 20);
  assert.equal(produit.accountLabel, 'Pourboire', "le compte est partagé avec l'indemnité : l'écriture dit lequel des deux");
  assert.equal(card.lines.filter((l) => l.compte.startsWith('44571')).length, 0, 'un don n’est pas taxable');
});

// specs/arrival-payment-detail-and-adjustment.md rule 26
test('both are stamped with the payment group, so the Comptabilité shows ONE card', () => {
  const entries = entriesOf(insertPayment(freshDb(), { arrivalPaymentReduction: 50 }));
  const ids = new Set(entries.map((e) => e.paymentGroup?.id));
  assert.equal(ids.size, 1);
  assert.equal([...ids][0], '1:2026-08-12');
  assert.equal(entries.length, 3, 'solde + complément + rabais');
});

test('a caisse-interne group emits neither entry', () => {
  const entries = entriesOf(insertPayment(freshDb(), {
    arrivalPaymentGroup: CASH_GROUP,
    balancePaidCash: 1,
    complementPaidCash: 1,
    arrivalPaymentReduction: 50,
    arrivalPaymentTip: null,
  }));
  assert.equal(entries.length, 0);
});

test('an adjustment whose group is dated in another month does not leak into this one', () => {
  const db = insertPayment(freshDb(), {
    arrivalPaymentGroup: JSON.stringify({ at: '2026-07-30', cash: 0, total: 500, buckets: ['balance', 'complement'] }),
    arrivalPaymentReduction: 50,
  });
  assert.equal(entriesOf(db).filter((e) => e.kind === 'discount').length, 0);
});

// ── L'ajustement ne touche NI les seaux NI le prix (règles 18, 22) ────────────

// specs/arrival-payment-detail-and-adjustment.md rule 18 — aucun montant de seau, aucun prix ne
// bouge : c'est ce qui distingue cette réduction d'un re-calcul, et ce qui la rend applicable à un
// échéancier déjà gelé.
test('une réduction ne réécrit aucun montant : les seaux et le prix sont intacts', () => {
  const db = insertPayment(freshDb(), { arrivalPaymentReduction: 50 });
  const r = db.prepare(`SELECT balanceAmount, complementAmount, finalPrice, totalPrice
                        FROM reservations WHERE id = 1`).get();
  assert.deepEqual(r, { balanceAmount: 400, complementAmount: 100, finalPrice: 500, totalPrice: 500 });
});

// specs/arrival-payment-detail-and-adjustment.md rule 22 — le total est ce que le client a remis :
// Σ seaux − réduction + pourboire.
test('le total remis est la somme des seaux, moins la réduction, plus le pourboire', () => {
  const bucketsTotal = 500;
  for (const [reduction, tip, attendu] of [[50, null, 450], [null, 20, 520], [null, null, 500]]) {
    const s = summaryOf(insertPayment(freshDb(), { arrivalPaymentReduction: reduction, arrivalPaymentTip: tip }));
    assert.equal(s.totalCollected, attendu, `${bucketsTotal} − ${reduction || 0} + ${tip || 0}`);
  }
});

// specs/arrival-payment-detail-and-adjustment.md rule 28 — l'export du comptable gagne les deux
// écritures. C'est le changement de forme qu'il faut lui annoncer : le vérifier ici, c'est vérifier
// ce qui atterrit réellement dans son fichier.
test('le CSV du comptable porte la remise et le pourboire', async () => {
  const { buildRows, CSV_HEADERS } = require('../utils/accountingExport');
  const db = insertPayment(freshDb(), { arrivalPaymentReduction: 50 });
  const rows = buildRows(createAccountingModel(db).encaissementsByMonth({ month: 8, year: 2026 }));
  const compte = CSV_HEADERS.indexOf('Compte');
  assert.ok(rows.some((r) => String(r[compte]) === '70900000'), 'le rabais accordé a sa ligne');

  const dbTip = insertPayment(freshDb(), { arrivalPaymentTip: 20 });
  const rowsTip = buildRows(createAccountingModel(dbTip).encaissementsByMonth({ month: 8, year: 2026 }));
  assert.ok(rowsTip.some((r) => String(r[compte]) === '75880000'), 'le pourboire a la sienne');
});
