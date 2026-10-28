// specs/vat-optional-mode.md rules 12 and 20, and specs/accountant-accounting-export.md rule 37 — the
// journal books each entry under its reservation's regime: no 4457x line for a « Sans TVA » stay, its
// revenue lines carry the whole TTC share, its platform commission is booked TTC with no 44566 line
// (whatever hasVatOnCommission says), a cancellation compensation and a refund carry 0 %, a month may
// mix both, every entry stays balanced, and the plugin being on or off changes no VAT.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('../../../tests/vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const { create: createAccountingModel } = require('../accountingModel');
const { buildRows } = require('../accountingExport');
const { createAccountSettings } = require('../settings');
const vatRegimeModel = require('../../../models/vatRegimeModel');

const COL = { compte: 6, debit: 7, credit: 8, libelle: 5 };
const NOT_SUBJECT = Number(db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run().lastInsertRowid);
const toggle = (id, notSubject) => db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = ?').run(notSubject ? NOT_SUBJECT : 1, id);
db.prepare("UPDATE reservations SET balancePaidDate = '2027-06-21' WHERE id = 104").run();

const accounting = (rate = 20) => {
  const settings = createAccountSettings(db);
  return createAccountingModel(db, { settings: { ...settings, read: () => ({ ...settings.read(), vatRateCancellationCompensation: rate }) } });
};
const month = (model, m, id) => {
  const entries = [...model.encaissementsByMonth({ month: m, year: 2027 }), ...model.refundsByMonth({ month: m, year: 2027 }),
    ...model.compensationsByMonth({ month: m, year: 2027 })].filter((e) => id == null || e.reservationId === id);
  return { entries, rows: buildRows(entries) };
};
const accountsOf = (rows) => rows.map((r) => String(r[COL.compte]));
const sum = (rows, col) => Math.round(rows.reduce((s, r) => s + Number(String(r[col] || 0).replace(',', '.')), 0) * 100) / 100;

test('rule 12 (g): under VAT the same stay books its VAT and the deductible VAT of its commission (the control)', () => {
  const { rows } = month(accounting(), 6, 104);
  assert.ok(accountsOf(rows).some((a) => a.startsWith('44571')));
  assert.ok(accountsOf(rows).includes('44566000'));
});

test('rule 12 (g): a « Sans TVA » stay books no 4457x line and no 44566 line, whatever hasVatOnCommission says', () => {
  toggle(104, true);
  const { rows } = month(accounting(), 6, 104);
  toggle(104, false);
  assert.ok(rows.length > 0);
  assert.deepEqual(accountsOf(rows).filter((a) => a.startsWith('44571') || a === '44566000'), []);
});

test('rule 12 (g): its revenue lines take the whole TTC share, its commission is booked TTC', () => {
  const entryOf = () => month(accounting(), 6, 104).entries[0];
  const withVat = entryOf();
  toggle(104, true);
  const withoutVat = entryOf();
  toggle(104, false);
  const revenue = (e) => Math.round(e.buckets.reduce((s, b) => s + b.ht + b.vat, 0) * 100) / 100;
  assert.equal(revenue(withoutVat), revenue(withVat), 'same TTC share');
  assert.deepEqual(withoutVat.buckets.map((b) => [b.ratePercent, b.vat]), withoutVat.buckets.map(() => [0, 0]));
  assert.equal(withoutVat.commission.hasVat, false);
  assert.equal(withoutVat.commission.vat, 0);
  assert.equal(withoutVat.commission.ht, withoutVat.commission.ttc);
  assert.equal(withVat.commission.hasVat, true);
});

test('rule 12 (g): a cancellation compensation of a « Sans TVA » stay carries 0 %, whatever rate the plan names', () => {
  const credits = (m) => month(accounting(20), m, 109).entries.filter((e) => e.kind === 'compensation').map((e) => e.compensation.ratePercent);
  assert.deepEqual(credits(5), [20]);
  toggle(109, true);
  assert.deepEqual(credits(5), [0]);
  const { rows } = month(accounting(20), 5, 109);
  toggle(109, false);
  assert.deepEqual(accountsOf(rows).filter((a) => a.startsWith('44571')), []);
});

test('rule 12 (g): a refund of a « Sans TVA » stay is an avoir at 0 % (its lines were re-rated with the stay)', () => {
  toggle(101, true);
  db.prepare("UPDATE reservation_refund_lines SET vatRate = 0 WHERE refundId IN (SELECT id FROM reservation_refunds WHERE reservationId = 101)").run();
  const { rows, entries } = month(accounting(), 6, 101);
  assert.ok(entries.some((e) => e.kind === 'refund'));
  assert.deepEqual(accountsOf(rows).filter((a) => a.startsWith('44571')), []);
  toggle(101, false);
});

test('rule 13: a month may mix both kinds of entries, and each stays balanced', () => {
  toggle(104, true);
  const { rows, entries } = month(accounting(), 6);
  toggle(104, false);
  assert.ok(entries.some((e) => e.reservationId === 101) && entries.some((e) => e.reservationId === 104));
  const accounts = accountsOf(rows);
  assert.ok(accounts.some((a) => a.startsWith('44571')), 'the stay under VAT still books its VAT');
  assert.equal(sum(rows, COL.debit), sum(rows, COL.credit), 'the month balances');
  for (const e of entries) {
    const own = buildRows([e]);
    assert.equal(sum(own, COL.debit), sum(own, COL.credit), `entry of ${e.reservationId} balances`);
  }
});

test('rule 20: the VAT of an entry follows the regime of its reservation, not the plugin\'s state', () => {
  assert.equal(vatRegimeModel.forRow(db, { id: 104 }).regime, 'subject');
  toggle(104, true);
  assert.equal(vatRegimeModel.forRow(db, { id: 104 }).regime, 'not_subject');
  const entry = month(accounting(), 6, 104).entries[0];
  toggle(104, false);
  assert.equal(entry.buckets[0].ratePercent, 0);
});

test('rule 12 (g): the Plan comptable payload tells which sales VAT regime is in force, so the page hides the rates that cannot apply', () => {
  const { create } = require('../platformAccountsController');
  const { create: createModel } = require('../platformAccountsModel');
  const read = (controller) => { let body; controller.getAll({}, { json: (b) => { body = b; } }); return body.salesVatRegime; };
  assert.equal(read(create(createModel(db))), 'subject', 'no regime reader: the historical default');
  assert.equal(read(create(createModel(db), { regimeInForce: () => vatRegimeModel.inForceBlock(db) })), 'not_subject');
});
