// specs/reservation-payment-ledger.md rule 46 — the stored-amount split (rule 37) is written only on a
// reservation that already carries a contribution. On one that has none (an older stay whose acompte
// was recorded before contributions existed), it would be the FIRST contribution: the export, which
// picks its path per reservation, would then read the earlier acompte entry as 0 and drop it — out of
// a month possibly already sent to the accountant.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createStay, rowOf, mark, respond, controller, ADMIN } = require('./ledgerFixture');
const { create: accountingModel } = require('../plugins/accounting-export/accountingModel');
const { create: accountingController } = require('../plugins/accounting-export/controller');
const { hasAnyContrib, captureBucketSplit } = require('../utils/forceItemContribsCapture');

const TODAY = new Date().toISOString().slice(0, 10);

// The whole month's CSV, byte for byte.
function csvOf(year, month) {
  let sent = '';
  const res = { setHeader() {}, status() { return res; }, send(b) { sent = Buffer.from(b).toString('latin1'); return res; } };
  accountingController(accountingModel(db)).salesCsv({ query: { year, month } }, res);
  return sent;
}
function journal(day) {
  let json = null;
  const res = { setHeader() {}, status() { return res; }, json(b) { json = b; return res; } };
  accountingController(accountingModel(db)).salesJson({ query: { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) } }, res);
  return json;
}

// An older stay: acompte ticked in May 2026, no contribution captured anywhere.
function olderStay() {
  const id = createStay();
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2026-05-10' WHERE id = ?").run(id);
  assert.equal(hasAnyContrib(db, id), false);
  return id;
}

test('rule 46 — a stay with no contribution stays wholly on the stored-money path when its solde is marked', () => {
  const id = olderStay();
  const mayBefore = csvOf(2026, 5);
  assert.match(mayBefore, /;90;0;/, 'the acompte entry of May');
  const res = mark(id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).balanceAmount * 100) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(hasAnyContrib(db, id), false, 'no first contribution written');
  assert.equal(csvOf(2026, 5), mayBefore, 'the earlier month is unchanged, the acompte entry still there');
  const balance = journal(TODAY).entries.find((e) => e.reservationId === id && e.kind === 'balance');
  assert.ok(balance.lines.some((l) => /^706/.test(l.compte) && Number(l.credit) > 0), 'the solde books revenue');
});

test('rule 46 — the single payment and the SAS keep a no-contribution stay on the stored-money path too', () => {
  const settled = olderStay();
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(settled);
  const mayBefore = csvOf(2026, 5);
  const res = respond();
  controller.settleArrivalPayment({ params: { id: String(settled) }, body: { mode: 'card', date: TODAY }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(hasAnyContrib(db, settled), false);
  assert.equal(csvOf(2026, 5), mayBefore);

  const sas = olderStay();
  const sasMay = csvOf(2026, 5);
  require('../models/reservationsModel').commitArrivalSas(sas, { stayPaid: true, stayPaidCash: false });
  assert.equal(rowOf(sas).balancePaid, 1);
  assert.equal(hasAnyContrib(db, sas), false);
  assert.equal(csvOf(2026, 5), sasMay);
});

test('rule 46 — an acompte that captured its split: the drifted solde still gets the stored split (rule 37 holds)', () => {
  const id = createStay();
  mark(id, { depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).depositAmount * 100) });
  assert.equal(hasAnyContrib(db, id), true);
  db.prepare('UPDATE reservations SET balanceAmount = round(balanceAmount + 30, 2), finalPrice = round(finalPrice + 30, 2), clientGrossAmount = NULL WHERE id = ?').run(id);
  const res = mark(id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: Math.round(rowOf(id).balanceAmount * 100) });
  assert.equal(res.statusCode, 200);
  assert.ok(rowOf(id).accommodationSoldeContribTtc > 0, 'stored split');
  const month = journal(TODAY);
  assert.deepEqual(month.totals.taxOnlyEntries, []);
  const balance = month.entries.find((e) => e.reservationId === id && e.kind === 'balance');
  assert.ok(balance.lines.some((l) => /^706/.test(l.compte) && Number(l.credit) > 0));
});

test('rule 46 — the outcome says which path the bucket took', () => {
  const id = olderStay();
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount + 30 WHERE id = ?').run(id);
  assert.equal(captureBucketSplit({ db, reservation: rowOf(id), bucket: 'balance', log: { error() {} } }), 'legacy');
});
