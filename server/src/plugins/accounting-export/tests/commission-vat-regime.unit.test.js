// specs/platforms/platform-host-statement-and-commission-vat.md rules 13-18 — each platform carries the VAT regime of its commission: the entry the
// cabinet writes by hand (account of the regime, deductible or self-assessed VAT, VAT code on each line) comes out of the export with no
// correction. The stays are the October ones of the review, entered as the cabinet's statements give them (figures measured in production).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  db, createStay, inDays, rowOf, mark, seed,
} = require('../../../tests/ledgerFixture');
const { create: createAccountingModel } = require('../accountingModel');
const { create: createAccountingController } = require('../controller');
const { createAccountSettings } = require('../settings');
const { buildRows, CSV_HEADERS } = require('../accountingExport');
const { todayIso } = require('../../../utils/localDate');

const TODAY = todayIso();
seed();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, defaultCautionAmount, depositEnabled)
  VALUES (5, 'Gîte', 20, 'per_day_per_person', 1.2, 0, 0)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (5, 'Standard', 100)").run();
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (50, 'Ménage', 'per_stay', 80)").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (5, 50)').run();
const PLATFORM = db.prepare(`INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, commissionPercent,
  commissionAccountNumber, commissionVatRegime, hasVatOnCommission) VALUES (?, ?, ?, ?, ?, ?, ?)`);
PLATFORM.run('Airbnb', 1, 0, 15.5, '62260300', 'eu_reverse_charge', 0);
PLATFORM.run('GitesDeFrance', 1, 1, 10, '62260500', 'fr_vat', 1);

function paid(over) {
  const id = createStay({ propertyId: 5, startDate: inDays(100), endDate: inDays(102), ...over });
  const res = mark(id, { balancePaid: true, balancePaidDate: TODAY });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return id;
}

function journal(plan) {
  let month = null;
  const res = { setHeader() {}, status() { return res; }, json(b) { month = b; return res; } };
  const settings = createAccountSettings(db);
  createAccountingController(createAccountingModel(db, { settings: { ...settings, read: () => ({ ...settings.read(), ...(plan || {}) }) } }))
    .salesJson({ query: { year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) } }, res);
  return month;
}

const FRAISSE = {
  platform: 'Airbnb', adults: 10, selectedOptions: [{ optionId: 50, quantity: 1, inComplement: 0 }], options: [{ optionId: 50, quantity: 1, inComplement: 0 }],
  platformGrossAmount: 805, platformOptionsAmount: 80, platformTouristTaxAmount: 24, platformPayoutAmount: 704.22, platformCommissionAmount: 124.78,
};

const accountsOf = (entry) => entry.lines.map((l) => [l.compte, l.debit, l.credit]);
const DAUSQUE = {
  platform: 'GitesDeFrance', adults: 6, selectedOptions: [{ optionId: 50, quantity: 1, inComplement: 0 }], offeredOptionIds: [50],
  options: [{ optionId: 50, quantity: 1, inComplement: 0 }],
  platformGrossAmount: 864, platformOptionsAmount: 80, platformTouristTaxAmount: 36, platformPayoutAmount: 786, platformCommissionAmount: 78,
};

test('rules 13, 15, 16 — Fraisse (Airbnb, EU): the cabinet\'s entry to the cent, the commission on 62260300 and its VAT self-assessed', () => {
  const id = paid(FRAISSE);
  const month = journal();
  assert.equal(month.totals.allBalanced, true);
  const entry = month.entries.find((e) => e.reservationId === id);
  assert.deepEqual(accountsOf(entry), [
    ['CREGIST', 704.22, null], // the transfer
    ['62260300', 124.78, null], // the commission, whole: an EU platform bills no VAT
    ['44566200', 24.96, null], // VAT deductible, self-assessed
    ['44520000', null, 24.96], // VAT due, intra-community
    ['70600000', null, 659.09],
    ['70600010', null, 72.73],
    ['44571100', null, 73.18],
    ['46710000', null, 24], // GuestFlow's own tax
  ]);
  assert.equal(entry.platform.commissionRegime, 'eu_reverse_charge');
});

test('rules 13, 14, 16 — Dausque (Gîtes de France, French): HT + VAT deductible on 44566000, the ménage the statement bills on 70600010', () => {
  const id = paid({ ...DAUSQUE, startDate: inDays(110), endDate: inDays(112) });
  assert.equal(rowOf(id).platformOptionsAmount, 80);
  const month = journal();
  const entry = month.entries.find((e) => e.reservationId === id);
  assert.deepEqual(accountsOf(entry), [
    ['CREGIST', 786, null],
    ['62260500', 65, null],
    ['44566000', 13, null],
    ['70600000', null, 712.73],
    ['70600010', null, 72.73],
    ['44571100', null, 78.54],
  ]);
});

test('rule 16 — the CSV carries the VAT code of each line in its LAST column, and no other column moves', () => {
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) });
  const rows = buildRows(entries.filter((e) => e.platform === 'Airbnb'));
  const code = CSV_HEADERS.indexOf('Code TVA');
  assert.equal(code, CSV_HEADERS.length - 1, 'appended after the last existing column');
  const byAccount = Object.fromEntries(rows.map((row) => [String(row[6]), row[code]]));
  assert.equal(byAccount['62260300'], 'INTRACOM');
  assert.equal(byAccount['70600000'], 'TI');
  assert.equal(byAccount['70600010'], 'TI');
  for (const account of ['CREGIST', '44566200', '44520000', '44571100', '46710000']) assert.equal(byAccount[account], '', account);
  const french = buildRows(entries.filter((e) => e.platform === 'GitesDeFrance'));
  assert.equal(french.find((row) => row[6] === '62260500')[code], '', 'vatCodeDeductible20 is empty until the cabinet names it');
  const withCode = buildRows(entries.filter((e) => e.platform === 'GitesDeFrance'), { vatCodeDeductible20: 'AN', vatCodeRate10: 'T1' });
  assert.equal(withCode.find((row) => row[6] === '62260500')[code], 'AN');
  assert.equal(withCode.find((row) => row[6] === '70600000')[code], 'T1');
});

test('rule 15 (Q9) — reverseChargeLines = 0 leaves the two self-assessment lines out, the entry stays balanced', () => {
  const month = journal({ reverseChargeLines: '0' });
  assert.equal(month.totals.allBalanced, true);
  const entry = month.entries.find((e) => e.platform.platform === 'Airbnb');
  assert.ok(!entry.lines.some((l) => l.compte === '44566200' || l.compte === '44520000'));
  assert.equal(entry.lines.find((l) => l.compte === '62260300').debit, 124.78);
});

test('rule 15 — the self-assessment accounts are plan roles: a renamed plan renames them', () => {
  const settings = createAccountSettings(db);
  const model = createAccountingModel(db);
  const entries = model.encaissementsByMonth({ year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) });
  const rows = buildRows(entries.filter((e) => e.platform === 'Airbnb'), { ...settings.read(), reverseChargeDeductibleAccount: '445662', reverseChargeDueAccount: '445200' });
  assert.ok(rows.some((row) => String(row[6]) === '445662' && row[7] === 24.96));
  assert.ok(rows.some((row) => String(row[6]) === '445200' && row[8] === 24.96));
});

// --- rules 13-14: the regime of a platform, and the account it proposes ------------------------------------------------------------------

const Database = require('better-sqlite3');
const platformsModel = require('../../../models/platformsModel');
const platformAccountsModel = require('../platformAccountsModel');
const { ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');
const { buildEntry } = require('../accountingModel').__test;

function regimeModel({ withColumn = true } = {}) {
  const own = new Database(':memory:');
  own.exec(`
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, platformLabel TEXT NOT NULL DEFAULT '');
    CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, commissionAccountNumber TEXT,
      hasVatOnCommission INTEGER NOT NULL DEFAULT 0, commissionPercent REAL NOT NULL DEFAULT 0, color TEXT
      ${withColumn ? ", commissionVatRegime TEXT NOT NULL DEFAULT 'no_vat'" : ''});
  `);
  ensurePluginSettingsTable(own);
  own.prepare("INSERT INTO platforms (name) VALUES ('direct'), ('Airbnb'), ('Gîtes de France'), ('Booking')").run();
  const platforms = platformsModel.create(own);
  return { own, platforms, model: platformAccountsModel.create(own, { platforms }) };
}
const idOf = (own, name) => own.prepare('SELECT id FROM platforms WHERE name = ?').get(name).id;

test('rule 13 — a database that predates the column reads the old box: ticked → France, else no VAT; writes keep both in step', () => {
  const { own, platforms } = regimeModel({ withColumn: false });
  own.prepare("UPDATE platforms SET hasVatOnCommission = 1 WHERE name = 'Gîtes de France'").run();
  const regimes = Object.fromEntries(platforms.listAll().map((p) => [p.name, p.commissionVatRegime]));
  assert.deepEqual(regimes, { direct: 'no_vat', Airbnb: 'no_vat', 'Gîtes de France': 'fr_vat', Booking: 'no_vat' });
  const { own: full, platforms: fullPlatforms } = regimeModel();
  fullPlatforms.update({ id: idOf(full, 'Airbnb'), commissionAccountNumber: '62260300', commissionVatRegime: 'eu_reverse_charge' });
  fullPlatforms.update({ id: idOf(full, 'Gîtes de France'), commissionAccountNumber: null, hasVatOnCommission: true });
  const row = (name) => full.prepare('SELECT commissionVatRegime, hasVatOnCommission FROM platforms WHERE name = ?').get(name);
  assert.deepEqual(row('Airbnb'), { commissionVatRegime: 'eu_reverse_charge', hasVatOnCommission: 0 });
  assert.deepEqual(row('Gîtes de France'), { commissionVatRegime: 'fr_vat', hasVatOnCommission: 1 }, 'the old box alone: true → fr_vat, for one release');
  fullPlatforms.update({ id: idOf(full, 'Airbnb'), hasVatOnCommission: false });
  assert.equal(row('Airbnb').commissionVatRegime, 'eu_reverse_charge', 'the old box unticked never leaves the EU regime');
});

test('rule 14 — choosing a regime proposes its account when the platform has none or holds the previous regime\'s proposal; a typed account stays', () => {
  const { own, model } = regimeModel();
  const save = (platforms) => model.saveAll({ defaultAccount: '622600', platforms });
  const airbnb = idOf(own, 'Airbnb');
  const gdf = idOf(own, 'Gîtes de France');
  const booking = idOf(own, 'Booking');
  const accountOf = (id) => own.prepare('SELECT commissionAccountNumber AS a, commissionVatRegime AS r FROM platforms WHERE id = ?').get(id);
  assert.equal(save([{ id: airbnb, account: '', regime: 'eu_reverse_charge' }, { id: gdf, account: '', regime: 'fr_vat' }, { id: booking, account: '62269999', regime: 'eu_reverse_charge' }]).ok, true);
  assert.deepEqual(accountOf(airbnb), { a: '62260300', r: 'eu_reverse_charge' });
  assert.deepEqual(accountOf(gdf), { a: '62260500', r: 'fr_vat' });
  assert.deepEqual(accountOf(booking), { a: '62269999', r: 'eu_reverse_charge' }, 'a typed account is never overwritten');
  // Airbnb still holds the proposal of its regime: moving it follows; Booking's typed account stays through a second change.
  save([{ id: airbnb, account: '62260300', regime: 'no_vat' }, { id: booking, account: '62269999', regime: 'no_vat' }]);
  assert.deepEqual(accountOf(airbnb), { a: '62260600', r: 'no_vat' });
  assert.deepEqual(accountOf(booking), { a: '62269999', r: 'no_vat' });
  // The three roles are the plan's: a re-assigned role is what the next choice proposes.
  save([{ id: gdf, account: '62260500', regime: 'fr_vat' }]);
  model.saveAll({ defaultAccount: '622600', plan: { commissionEuAccount: '62260301' }, platforms: [{ id: gdf, account: '62260500', regime: 'eu_reverse_charge' }] });
  assert.equal(accountOf(gdf).a, '62260301');
  assert.deepEqual(model.getAll().regimes.map((r) => [r.key, r.account]), [['fr_vat', '62260500'], ['eu_reverse_charge', '62260301'], ['no_vat', '62260600']]);
});

test('rule 13 — a regime the page does not know is refused on its row', () => {
  const { own, model } = regimeModel();
  const result = model.saveAll({ defaultAccount: '622600', platforms: [{ id: idOf(own, 'Airbnb'), account: '', regime: 'moon' }] });
  assert.equal(result.status, 400);
  assert.deepEqual(result.error.platforms, [{ id: idOf(own, 'Airbnb'), regime: 'Régime de TVA inconnu.' }]);
});

test('rule 13 — under the « Sans TVA » sales regime every regime books TTC and assesses no VAT', () => {
  const row = {
    id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Villa A', platform: 'Airbnb', finalPrice: 626, totalPrice: 626, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: 687, depositAmount: 0, depositPaid: 0, depositPaidDate: null, balanceAmount: 626, balancePaid: 1, balancePaidDate: '2026-06-04',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
  };
  const context = (salesRegime) => ({
    defaultAccount: '622600', vatRateCommission: 20, salesRegime,
    platformByName: new Map([['airbnb', { name: 'Airbnb', commissionAccountNumber: '62260300', commissionVatRegime: 'eu_reverse_charge', hasVatOnCommission: 0 }]]),
  });
  const registered = buildEntry(row, 'balance', null, context('subject'));
  assert.equal(registered.commission.regime, 'eu_reverse_charge');
  assert.equal(registered.commission.selfAssessed, 12.2);
  const notSubject = buildEntry(row, 'balance', null, context('not_subject'));
  assert.equal(notSubject.commission.regime, 'no_vat');
  assert.equal(notSubject.commission.selfAssessed, 0);
  assert.equal(notSubject.commission.hasVat, false);
});

test('rule 15 — Synthèse › TVA shows the due and the deductible VAT self-assessed on the EU commissions of the period', () => {
  const { ventilate, vatReturn } = require('../synthesis');
  const entries = createAccountingModel(db).encaissementsByMonth({ year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) });
  const vat = vatReturn(ventilate(entries.filter((e) => e.platform === 'Airbnb')), undefined);
  assert.deepEqual(vat.selfAssessed, { due: 24.96, deductible: 24.96 });
  assert.equal(vat.deductibleOnCommissions, 0, 'the French deductible VAT stays its own line');
});
