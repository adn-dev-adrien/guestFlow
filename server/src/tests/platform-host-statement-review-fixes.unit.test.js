// specs/platform-host-statement-and-commission-vat.md — the findings of the review and of the production-shadow replay (2026-11-26).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const storedTouristTax = require('../utils/pricing/steps/storedTouristTax');
const { touristTaxBasis } = require('../utils/pricing/storedSaleFigures');
const { grossOf, taxPaidWithPayout } = require('../utils/pricing/platformPayment');
const { runHostStatementBrutMigration, reversedTaxOfStoredStay } = require('../utils/hostStatementBrutMigration');
const { adjustOptionLines } = require('../utils/platformOptionsAdjustment');
const { settleStatementOptions } = require('../utils/platformStatementOptions');
const { statementReadout } = require('../utils/platformStatementReadout');
const { commissionBookingSentence } = require('../utils/commissionBooking');
const { calculateReservationQuote } = require('../utils/pricing').__test;
const {
  createDb, addPlatform, DAUSQUE, TOUSSAINT, MENAGE_PAID,
} = require('./platformHostStatementFixture');

test('item 1 — a sale on a stay whose record was written before the tax gap existed prices with no gap, never PIPELINE_MISSING_OUTPUT', () => {
  const ctx = { storedSaleFigures: { touristTax: { basis: touristTaxBasis({}), figures: { touristTaxTotal: 31.2, reversedTouristTaxInBrut: 24 } } } };
  const out = storedTouristTax.apply(ctx);
  assert.equal(out.touristTaxGap, 0);
  assert.equal(out.touristTaxTotal, 31.2);
});

// --- item 2: the migration never loses a box ------------------------------------------------------------------------------------------
function storedDb(rows) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE, collectsTouristTax INTEGER, touristTaxRemittedByPlatform INTEGER);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT, platformGrossAmount REAL, platformTouristTaxAmount REAL, touristTaxTotal REAL);
  `);
  db.exec("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Booking', 1, 0)");
  const insert = db.prepare('INSERT INTO reservations VALUES (?, ?, ?, ?, ?)');
  rows.forEach((r) => insert.run(r.id, 'Booking', r.brut, r.box, r.tax));
  return db;
}

test('item 2 — a reversed stay whose tax is frozen at 0 is left untouched, its box too (#22280: 27,03 kept)', () => {
  const db = storedDb([{ id: 22280, brut: 968.4, box: 27.03, tax: 0 }, { id: 2, brut: 700, box: 12, tax: 0 }]);
  const { migrated } = runHostStatementBrutMigration(db, { reversedTaxOf: () => 0, frozenAtZero: (row) => row.id === 22280 });
  const read = (id) => db.prepare('SELECT platformGrossAmount AS brut, platformTouristTaxAmount AS box FROM reservations WHERE id = ?').get(id);
  assert.deepEqual(read(22280), { brut: 968.4, box: 27.03 });
  assert.deepEqual(migrated, [2], 'only the stay that is not frozen loses its stale box (it never priced)');
});

test('item 5 — the reversed tax of a stored stay is computed with its box blanked: a percentage tax reads the box in its base', () => {
  const seen = [];
  const figures = { touristTaxFigureOfStoredReservation: (db, row) => { seen.push(row.platformTouristTaxAmount); return { reversedTouristTaxInBrut: 4 }; } };
  const Module = require('module');
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) { return id === './storedReservationQuote' ? figures : original.call(this, id); };
  try {
    assert.equal(reversedTaxOfStoredStay({})({ id: 1, platformTouristTaxAmount: 50 }), 4);
  } finally { Module.prototype.require = original; }
  assert.deepEqual(seen, [null]);
});

// --- item 6: the money a reversing platform settles -------------------------------------------------------------------------------------
test('item 6 — the expected gross of a reversing platform is the host amount plus the tax paid with the transfer', () => {
  const row = { platformGrossAmount: 805, platformTouristTaxAmount: 24, depositAmount: 0, balanceAmount: 829 };
  assert.equal(grossOf(row), 805);
  assert.equal(grossOf(row, taxPaidWithPayout({ mode: 'platform_reversed', box: 24 })), 829);
  assert.equal(grossOf(row, taxPaidWithPayout({ mode: 'platform', box: 24 })), 805);
  assert.equal(grossOf({ ...row, platformGrossAmount: null }, 24), 829, 'with no host amount the stored schedule already holds the tax');
});

// --- items 8, 9: the custom line ------------------------------------------------------------------------------------------------------
test('item 8 — the free line and the rate warning name the platform by its display name', () => {
  const db = createDb();
  addPlatform(db, 'GitesDeFrance', 'remits', 10);
  const input = { ...TOUSSAINT, db, platform: 'GitesDeFrance', selectedOptions: [], customOptions: [], offeredOptionIds: [] };
  settleStatementOptions(input, 37.5);
  assert.equal(input.customOptions[0].description, 'Options Gîtes de France');
  const { warnings } = statementReadout({
    figures: { platformGrossAmount: 1000, platformCommissionAmount: 175 }, mode: 'platform', platformLabel: 'Gîtes de France', commissionPercent: 10,
  });
  assert.match(warnings.commissionRate, /Gîtes de France est à 10/);
});

const quoteOf = (lines) => ({ optionLines: lines, resourceLines: [] });

test('item 9 — an OFFERED « platform_options » line is set to exactly the amount needed, not its old amount plus the gap', () => {
  const lines = { options: [], customOptions: [{ customKey: 'platform_options', description: 'Options Airbnb', amount: 50, offered: true, inComplement: 0 }], offeredOptionIds: [] };
  const quote = quoteOf([{ isCustom: true, customKey: 'platform_options', title: 'Options Airbnb', offered: true, totalPrice: 0, originalTotalPrice: 50 }]);
  const result = adjustOptionLines({ optionsAmount: 20, quote, lines, platformLabel: 'Airbnb' });
  assert.equal(result.lines.customOptions[0].amount, 20);
  assert.equal(result.lines.customOptions[0].offered, false);
});

test('item 9 — paying an article offers ONE line (by lineId), and the choice is re-verified by pricing', () => {
  const lines = { options: [{ optionId: 5, lineId: 1, quantity: 1 }, { optionId: 5, lineId: 2, quantity: 1 }], customOptions: [], offeredOptionIds: [] };
  const quote = quoteOf([
    { optionId: 5, lineId: 1, title: 'Bois', offered: false, totalPrice: 30, isCustom: false },
    { optionId: 5, lineId: 2, title: 'Bois', offered: false, totalPrice: 30, isCustom: false },
  ]);
  const verified = [];
  const result = adjustOptionLines({
    optionsAmount: 30, quote, lines, requote: (next) => { verified.push(next); return quoteOf([{ lineId: 1, offered: true, totalPrice: 0 }, { lineId: 2, offered: false, totalPrice: 30 }]); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines.options.map((o) => o.offered), [true, undefined], 'only the first line');
  assert.equal(result.lines.offeredOptionIds.length, 0, 'the article-wide list is not touched');
  assert.equal(verified.length, 1);
  const refused = adjustOptionLines({ optionsAmount: 30, quote, lines, requote: () => quoteOf([{ offered: false, totalPrice: 60 }]) });
  assert.equal(refused.ok, false, 'a choice pricing does not confirm is refused, not applied');
});

// --- items 12, 13: the readout -----------------------------------------------------------------------------------------------------------
test('item 12 — a box that is not booked (tax frozen at 0) is not counted in the closing line, and the block says why', () => {
  const figures = { platformGrossAmount: 805, platformTouristTaxAmount: 24, platformPayoutAmount: 704.22, platformCommissionAmount: 124.78 };
  const booked = statementReadout({ figures, mode: 'platform_reversed', platformLabel: 'Airbnb' });
  assert.equal(booked.lines[0].tone, 'done');
  const frozen = statementReadout({ figures, mode: 'platform_reversed', platformLabel: 'Airbnb', boxBooked: false });
  const closing = frozen.lines.find((l) => /Montant hôte/.test(l.label));
  assert.equal(closing.tone, 'warning');
  assert.match(closing.label, /= 680,22/);
  assert.ok(frozen.lines.some((l) => l.label === 'Taxe figée avant le passage en « nous reverse » : non comptée.'));
});

test('item 13 — the commission is told as it is booked: France HT + VAT, UE self-assessed, sans TVA', () => {
  const db = new Database(':memory:');
  const sentence = (regime, commission, account) => commissionBookingSentence({ db, platformRow: { commissionVatRegime: regime, commissionAccountNumber: account }, commission, live: true });
  assert.equal(sentence('fr_vat', 78, '62260500'), '78,00 € TTC = 65,00 € HT + 13,00 € de TVA déductible · compte 62260500');
  assert.equal(sentence('eu_reverse_charge', 124.78, '62260300'), '124,78 € · UE, TVA autoliquidée 24,96 € · compte 62260300');
  assert.equal(sentence('no_vat', 61, '62260600'), '61,00 € · sans TVA · compte 62260600');
  assert.equal(sentence('fr_vat', 0, '62260500'), null);
  assert.equal(commissionBookingSentence({ db, platformRow: { commissionVatRegime: 'no_vat' }, commission: 10, live: false }), null, 'without the accounting export nothing is booked');
  assert.match(commissionBookingSentence({ db, platformRow: { commissionVatRegime: 'no_vat' }, commission: 10, live: true }), /compte 622600$/, 'the default account');
});

test('rules 1, 8 — a quote of a Dausque-shaped stay still closes after the fixes', () => {
  const db = createDb();
  addPlatform(db, 'GitesDeFrance', 'remits');
  const q = calculateReservationQuote({ ...DAUSQUE, db, offeredOptionIds: [], selectedOptions: [MENAGE_PAID] });
  assert.equal(q.finalPrice, 864);
});

// Shadow replay 2026-11-26 — the booking sentence of a Gîtes de France stay set to « France — TVA 20 % » read « sans TVA »:
// the platform row a stay names came without its regime (rule 10 reads it from that row).
test('rule 10: the platform row a stay names carries its commission VAT regime', () => {
  const { create: createPlatformsModel } = require('../models/platformsModel');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT, hasVatOnCommission INTEGER NOT NULL DEFAULT 0,
    commissionPercent REAL NOT NULL DEFAULT 0, color TEXT, commissionVatRegime TEXT NOT NULL DEFAULT 'no_vat'
  );
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, platformLabel TEXT);
  CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT);`);
  db.prepare("INSERT INTO platforms (name, commissionAccountNumber, hasVatOnCommission, commissionVatRegime) VALUES ('GitesDeFrance', '62260500', 1, 'fr_vat')").run();
  const row = createPlatformsModel(db).findForStay('GitesDeFrance');
  assert.equal(row.commissionVatRegime, 'fr_vat');
  assert.equal(
    commissionBookingSentence({ db, platformRow: row, commission: 78, live: true }).replace(/\s/g, ' '),
    '78,00 € TTC = 65,00 € HT + 13,00 € de TVA déductible · compte 62260500',
  );
});
