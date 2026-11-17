// specs/mollie-settlement-receipts.md rules 1-12 — the statement of a Mollie settlement, joined to its Qonto credit. No
// network: the Qonto upload is a recording fake, and the Mollie API is never reachable (rule 12). Names and ids are fictitious.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');
const { upV4 } = require('../reconciliation/schema');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createBankTransactionsModel } = require('../reconciliation/bankTransactionsModel');
const { createMollieStatements, MAX_PER_RUN, MAX_ATTEMPTS } = require('../reconciliation/mollieStatements');
const { createMollieStatementsModel } = require('../reconciliation/mollieStatementsModel');
const { shapeStatement, renderStatementPdf } = require('../reconciliation/mollieStatementPdf');
const { uuidKey } = require('../invoiceIssuer');
const { mollieDeclared } = require('../settingsStore');

upV4(db);
test.beforeEach(() => { reset(); db.prepare('DELETE FROM mollie_settlement_statements').run(); });

const settlements = createSettlementsModel(db);
const splits = createSplitsModel(db);
const transactions = createBankTransactionsModel(db);
const splitSettings = { get: (k) => ({ reconciliationStartDate: dayAt(-140) }[k] || '') };
const amount = (value) => ({ value, currency: 'EUR' });
const cents = (value) => Math.round(Number(value) * 100);

// What Mollie's balance transactions look like once read (the stored shape), `daysAgo` days before today.
const balanceTx = (id, type, daysAgo, time, { result, initial = result, deductions = 0, settlementId = null, paymentId = null, description = '' }) => ({
  id, type, createdAt: `${dayAt(-daysAgo)}T${time}+00:00`, resultCents: result, initialCents: initial, deductionsCents: deductions, settlementId, paymentId, description,
});

/**
 * A settlement and its Qonto credit: `rows` are the composition ({ paymentId, gross, deductions, release }), the credit is
 * `creditCents` (the sum of the nets unless told otherwise).
 */
function seedSettlement(n, daysAgo, rows, { creditCents = null, withComposition = true, reference = `19274230.26${String(n).padStart(2, '0')}.01` } = {}) {
  const id = `stl_${n}`;
  const nets = rows.map((r) => (r.release ? r.gross : r.gross - (r.deductions || 0)));
  const total = nets.reduce((t, v) => t + v, 0);
  settlements.store({
    id, reference, settledAt: `${dayAt(-daysAgo)}T05:00:00+00:00`, amountCents: total, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0,
  }, []);
  if (withComposition) {
    settlements.storeBalanceTransactions([
      ...rows.map((r, i) => balanceTx(`bt_${n}_${i}`, r.release ? 'api-payment-rolling-reserve-release' : 'payment', daysAgo + 1, `10:0${i}:00`, {
        result: nets[i], initial: r.gross, deductions: r.deductions || 0, paymentId: r.paymentId, description: r.description || `desc-${r.paymentId}`,
      })),
      balanceTx(`bt_${n}_out`, 'outgoing-transfer', daysAgo, '05:00:00', { result: -total, initial: -total, settlementId: id }),
    ]);
  }
  const credit = mollieCredit(`tx${n}`, creditCents == null ? total : creditCents, daysAgo, { reference: `REF T${reference}` });
  transactions.upsertMany([credit], { bankAccountId: 'acc-1' });
  return { id, reference, credit, total };
}

function harness({ qonto = true, token = true, since = dayAt(-30), attach } = {}) {
  const values = new Map([['mollieStatementsSince', since]]);
  if (token) values.set('mollieAccessToken', 'access_FAKE_TOKEN_FOR_TESTS');
  const uploads = [];
  let behaviour = attach || (async () => ({ attachmentId: 'att_1' }));
  const statements = createMollieStatements({
    db, settings: { get: (k) => values.get(k) || '' }, qontoConnected: () => qonto, settlements, splits,
    attachPdf: async (request) => { uploads.push(request); return behaviour(request); },
    companyName: () => 'Gîte des Tilleuls',
  });
  return { statements, uploads, values, behave: (fn) => { behaviour = fn; } };
}
const httpError = (status, body = {}) => Object.assign(new Error(`HTTP ${status}`), { status, body });

test('rule 1 — the statement is built from the composition of the settlement, one line per balance transaction', () => {
  const { id } = seedSettlement(1, 6, [
    { paymentId: 'tr_a', gross: 10000, deductions: 2000 },
    { paymentId: 'tr_old', gross: 3936, release: true },
  ]);
  const composition = settlements.compositionOf(id);
  const shape = shapeStatement({ composition, lookup: () => null, ratePercent: 20 });
  assert.deepEqual(shape.lines.map((l) => [l.kind, l.paymentId, l.netCents]), [['payment', 'tr_a', 8000], ['release', 'tr_old', 3936]]);
});

test('rule 1 — a settlement whose composition is unknown gets no statement, and nothing is sent', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }], { withComposition: false });
  const h = harness();
  await h.statements.runJob();
  assert.equal(h.uploads.length, 0);
  assert.equal((await h.statements.pdf('tx1')).status, 404);
  assert.deepEqual(h.statements.status().counts, { attached: 0, pending: 0, toReview: 0 }, 'it is no candidate until the composition is read');
  assert.equal(h.statements.lineOf(transactions.get('tx1')), null, 'and its line carries no chip');
});

test('rule 1 — credits without a composition take no job slot: 20 of them and one known, the known one is uploaded in one run', async () => {
  for (let n = 1; n <= MAX_PER_RUN; n += 1) seedSettlement(n, 30 + n, [{ paymentId: `tr_${n}`, gross: 1000 }], { withComposition: false });
  seedSettlement(30, 3, [{ paymentId: 'tr_known', gross: 5000 }]);
  const h = harness({ since: dayAt(-90) });
  const result = await h.statements.runJob();
  assert.deepEqual(h.uploads.map((u) => u.transactionId), ['tx30']);
  assert.equal(result.attached, 1);
});

test('rule 2 — without a Qonto connection nothing exists: no job, no endpoint, no status', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  const h = harness({ qonto: false });
  assert.deepEqual(await h.statements.runJob(), { skipped: true, attached: 0 });
  assert.equal(h.uploads.length, 0);
  assert.equal((await h.statements.pdf('tx1')).status, 404);
  assert.equal((await h.statements.retry('tx1')).status, 404);
  assert.deepEqual(h.statements.status(), { available: false, since: '', counts: { attached: 0, pending: 0, toReview: 0 }, reauth: false });
  assert.equal(h.statements.lineOf(transactions.get('tx1')), null);
});

test('rule 2 — without a Mollie token there is no composition to write: the same silence', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  const h = harness({ token: false });
  assert.equal((await h.statements.runJob()).skipped, true);
  assert.equal(h.statements.status().available, false);
  assert.equal((await h.statements.retry('tx1')).status, 404);
});

test('rule 3 — an empty date is off (available, nothing sent); only credits settled on or after the date get a statement', async () => {
  seedSettlement(1, 20, [{ paymentId: 'tr_old', gross: 5000 }]);
  seedSettlement(2, 6, [{ paymentId: 'tr_new', gross: 7000 }]);
  const off = harness({ since: '' });
  assert.equal((await off.statements.runJob()).skipped, true);
  assert.deepEqual(off.statements.status(), { available: true, since: '', counts: { attached: 0, pending: 0, toReview: 0 }, reauth: false });

  const h = harness({ since: dayAt(-10) });
  await h.statements.runJob();
  assert.deepEqual(h.uploads.map((u) => u.transactionId), ['tx2']);
  assert.equal(h.statements.lineOf(transactions.get('tx1')), null, 'a credit before the date carries no statement line');
});

test('rule 3 — the date is refused when it is in the future or not a day; empty is accepted', () => {
  const declared = mollieDeclared().find((d) => d.key === 'mollieStatementsSince');
  assert.equal(declared.validate(''), null);
  assert.equal(declared.validate(dayAt(-1)), null);
  assert.equal(declared.validate(dayAt(0)), null);
  assert.equal(declared.validate(dayAt(3)), 'La date ne peut pas être dans le futur.');
  assert.ok(declared.validate('demain'));
  assert.ok(declared.validate(`${dayAt(-1).slice(0, 4)}-13-45`));
});

test('rule 13 — a start date more than 2 years back is refused, one within 2 years is accepted', () => {
  const declared = mollieDeclared().find((d) => d.key === 'mollieStatementsSince');
  assert.equal(declared.validate(dayAt(-700)), null);
  assert.equal(declared.validate(dayAt(-800)), 'La date ne peut pas remonter à plus de 2 ans.');
  assert.equal(declared.validate('0002-11-17'), 'La date ne peut pas remonter à plus de 2 ans.'); // date-literal-ok: the typed-year slip the rule exists for
});

test('rule 4 — only credited Mollie credits whose reference names a stored settlement are candidates; the others wait or are ignored', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  transactions.upsertMany([
    mollieCredit('debit', -500, 5, { reference: 'REF T19274230.2611.77' }),
    mollieCredit('other', 9900, 5, { label: 'ACME', counterpartyName: 'ACME', reference: 'REF T19274230.2611.88' }),
    mollieCredit('unknown', 4200, 4, { reference: 'REF T19274230.2611.99' }),
  ], { bankAccountId: 'acc-1' });
  const h = harness();
  await h.statements.runJob();
  assert.deepEqual(h.uploads.map((u) => u.transactionId), ['tx1']);
  assert.equal(h.statements.lineOf(transactions.get('unknown')).state, 'pending', 'a Mollie credit with no settlement yet waits');
  assert.equal(h.statements.lineOf(transactions.get('debit')), null);
  assert.equal(h.statements.lineOf(transactions.get('other')), null);
});

test('rule 5 — a sum that is not the credit to the cent is a mismatch with both amounts, and nothing is sent to Qonto', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000, deductions: 2000 }], { creditCents: 7999 });
  const h = harness();
  await h.statements.runJob();
  assert.equal(h.uploads.length, 0);
  const line = h.statements.lineOf(transactions.get('tx1'));
  assert.equal(line.state, 'mismatch');
  assert.match(line.error, /80,00 €.*79,99 €/);
  assert.equal(line.gapCents, 1);
  assert.deepEqual(h.statements.status().counts, { attached: 0, pending: 0, toReview: 1 });
});

test('rule 6 — fees are the deductions less the reserve held; a release has no gross and no fees; the totals add up', () => {
  seedSettlement(1, 6, [
    { paymentId: 'tr_a', gross: 10000, deductions: 2000 },
    { paymentId: 'tr_b', gross: 20000, deductions: 4100 },
    { paymentId: 'tr_old', gross: 3936, release: true },
  ]);
  const composition = settlements.compositionOf('stl_1');
  const shape = shapeStatement({ composition, lookup: () => null, ratePercent: 20 });
  const [a, b, release] = shape.lines;
  assert.deepEqual([a.grossCents, a.reserveCents, a.feeCents, a.netCents], [10000, 2000, 0, 8000], 'a Fee Discount leaves no fee');
  assert.deepEqual([b.grossCents, b.reserveCents, b.feeCents, b.netCents], [20000, 4000, 100, 15900]);
  assert.deepEqual([release.grossCents, release.reserveCents, release.feeCents, release.netCents], [null, null, null, 3936]);
  assert.deepEqual(shape.totals, { grossCents: 30000, reserveHeldCents: 6000, reserveReleasedCents: 3936, feeCents: 100, netCents: 27836 });
  const withSplit = shapeStatement({ composition, lookup: (id) => (id === 'tr_a' ? { reserveCents: 1500 } : null), ratePercent: 20 });
  assert.equal(withSplit.lines[0].reserveCents, 1500, 'the reserve Mollie really held wins over the rate');
  assert.equal(withSplit.lines[0].feeCents, 500);
});

test('rule 6 — the guest and the reservation number come from the split; the PDF is A4, starts with %PDF and names the settlement', async () => {
  const stay = paidStay({ cents: 10000, daysAgo: 6, providerPaymentId: 'qonto-a' });
  db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?').run('202611001', stay.reservationId);
  splits.sync({ settings: splitSettings });
  splits.setMolliePayment('link', stay.link.id, 'tr_a');
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000, deductions: 2000 }]);
  const h = harness();
  const pdf = await h.statements.pdf('tx1');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.fileName, /19274230\.2601\.01/);
  const title = Buffer.from('Relevé de versement Mollie 19274230.2601.01', 'utf16le').swap16();
  assert.ok(pdf.bytes.includes(title), 'the document title names the settlement reference');

  const shape = shapeStatement({ composition: settlements.compositionOf('stl_1'), lookup: (id) => ({ ...(id === 'tr_a' ? { guest: 'Jean Dupont', reservationNumber: '202611001' } : {}) }), ratePercent: 20 });
  assert.deepEqual([shape.lines[0].guest, shape.lines[0].reservationNumber], ['Jean Dupont', '202611001']);
  const bytes = await renderStatementPdf({ shape, settlement: { id: 'stl_1', reference: '19274230.2601.01' }, credit: transactions.get('tx1'), companyName: 'Gîte des Tilleuls' });
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
});

test('rule 6 — a statement of more lines than a page holds still renders', async () => {
  const rows = Array.from({ length: 90 }, (_, i) => ({ paymentId: `tr_${i}`, gross: 1000, deductions: 200 }));
  seedSettlement(1, 6, rows);
  const shape = shapeStatement({ composition: settlements.compositionOf('stl_1'), lookup: () => null, ratePercent: 20 });
  const bytes = await renderStatementPdf({ shape, settlement: { id: 'stl_1', reference: 'r' }, credit: transactions.get('tx1') });
  assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2);
});

test('rule 7 — the statement is uploaded once, with a UUID key made of the settlement and the transaction; a rerun or a retry never sends it again', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000, deductions: 2000 }]);
  const h = harness();
  await h.statements.runJob();
  await h.statements.runJob();
  await h.statements.retry('tx1');
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].transactionId, 'tx1');
  assert.equal(h.uploads[0].idempotencyKey, uuidKey('mollie-statement:stl_1:tx1'));
  assert.match(h.uploads[0].idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(h.uploads[0].bytes.subarray(0, 5).toString(), '%PDF-');
  const line = h.statements.lineOf(transactions.get('tx1'));
  assert.equal(line.state, 'attached');
  assert.ok(line.attachedAt);
  assert.equal(db.prepare('SELECT attachmentId FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1').attachmentId, 'att_1');
});

test('rule 8 — a run treats at most 20 credits, the oldest first; the next run takes the others', async () => {
  for (let n = 1; n <= 22; n += 1) seedSettlement(n, 2 + n, [{ paymentId: `tr_${n}`, gross: 1000 + n }]);
  const h = harness({ since: dayAt(-60) });
  await h.statements.runJob();
  assert.equal(h.uploads.length, MAX_PER_RUN);
  assert.equal(h.uploads[0].transactionId, 'tx22', 'the oldest credit first');
  assert.ok(!h.uploads.some((u) => u.transactionId === 'tx1' || u.transactionId === 'tx2'));
  await h.statements.runJob();
  assert.equal(h.uploads.length, 22);
});

test('rule 9 — a network or Qonto 5xx error keeps the credit pending with its message and a count; after 24 attempts it is failed', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  const h = harness({ attach: async () => { throw httpError(503); } });
  await h.statements.runJob();
  let row = db.prepare('SELECT * FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1');
  assert.deepEqual([row.state, row.attempts, row.lastError], ['pending', 1, 'HTTP 503']);
  for (let i = 1; i < MAX_ATTEMPTS; i += 1) await h.statements.runJob();
  row = db.prepare('SELECT * FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1');
  assert.deepEqual([row.state, row.attempts], ['failed', MAX_ATTEMPTS]);
  const before = h.uploads.length;
  await h.statements.runJob();
  assert.equal(h.uploads.length, before, 'a failed statement is not retried by the job');
});

test('rule 9 — a Qonto 403 makes every pending statement reauth and stops the run; the card asks to reconnect', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  seedSettlement(2, 9, [{ paymentId: 'tr_b', gross: 6000 }]);
  const h = harness({ attach: async () => { throw httpError(403, { errors: [{ code: 'insufficient_scope' }] }); } });
  const result = await h.statements.runJob();
  assert.equal(result.reauth, true);
  assert.equal(h.uploads.length, 1, 'the run stops at the first refusal');
  assert.deepEqual(['tx1', 'tx2'].map((id) => h.statements.lineOf(transactions.get(id)).state), ['reauth', 'reauth']);
  const status = h.statements.status();
  assert.equal(status.reauth, true);
  assert.equal(status.counts.toReview, 2);

  h.behave(async () => ({ attachmentId: 'att_2' }));
  await h.statements.runJob();
  assert.equal(h.statements.status().counts.attached, 2, 'once Qonto is reconnected the credits are joined');
});

test('rule 9 — 429 and network errors stay pending; 401, invalid_grant or missing Qonto credentials is reauth; any other 4xx is failed at once with its message', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  const h = harness();
  const stateAfter = async (error) => {
    db.prepare('DELETE FROM mollie_settlement_statements').run();
    h.behave(async () => { throw error; });
    await h.statements.runJob();
    return db.prepare('SELECT state, attempts, lastError FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1');
  };
  assert.equal((await stateAfter(httpError(429))).state, 'pending');
  assert.equal((await stateAfter(new Error('socket hang up'))).state, 'pending');
  assert.equal((await stateAfter(httpError(401))).state, 'reauth');
  assert.equal((await stateAfter(httpError(400, { error: 'invalid_grant' }))).state, 'reauth');
  assert.equal((await stateAfter(Object.assign(new Error('Identifiants Qonto manquants'), { code: 'QONTO_NOT_CONFIGURED' }))).state, 'reauth');
  const refused = await stateAfter(httpError(422, { errors: [{ code: 'invalid_file' }] }));
  assert.deepEqual([refused.state, refused.lastError], ['failed', 'HTTP 422']);
});

test('rule 9 — a 403 marks only pending or rowless statements: a mismatch stays a mismatch; reconnected, the reauth ones are attached and the flag clears', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  seedSettlement(2, 9, [{ paymentId: 'tr_b', gross: 6000 }], { creditCents: 5999 });
  const h = harness({ attach: async () => { throw httpError(403, { errors: [{ code: 'insufficient_scope' }] }); } });
  await h.statements.runJob();
  assert.deepEqual(['tx1', 'tx2'].map((id) => h.statements.lineOf(transactions.get(id)).state), ['reauth', 'mismatch']);
  h.behave(async () => ({ attachmentId: 'att_3' }));
  await h.statements.runJob();
  assert.equal(h.statements.lineOf(transactions.get('tx1')).state, 'attached');
  assert.equal(h.statements.status().reauth, false);
  assert.equal(h.statements.lineOf(transactions.get('tx2')).state, 'mismatch');
});

test('rule 9 — a reauth row whose composition is unknown is no candidate: it keeps the card from asking to reconnect', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }], { withComposition: false });
  db.prepare("INSERT INTO mollie_settlement_statements (transactionId, settlementId, state, attempts, updatedAt) VALUES ('tx1', 'stl_1', 'reauth', 0, 'x')").run();
  assert.equal(harness().statements.status().reauth, false);
});

test('rule 7 — the job and « Réessayer » never upload the same credit twice at once, and a late error never reverts an attached row', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ attach: async () => { await gate; return { attachmentId: 'att_slow' }; } });
  const running = h.statements.runJob();
  await new Promise((resolve) => setImmediate(resolve));
  const duringJob = await h.statements.retry('tx1');
  assert.equal(duringJob.body.statement.state, 'pending', 'the retry of a credit being handled answers its current line');
  assert.equal(h.uploads.length, 1);
  const second = h.statements.runJob();
  release();
  await Promise.all([running, second]);
  assert.equal(h.uploads.length, 1, 'the second run skipped the credit in flight');
  assert.equal(h.statements.lineOf(transactions.get('tx1')).state, 'attached');

  createMollieStatementsModel(db).save('tx1', 'stl_1', { state: 'pending', attempts: 3, lastError: 'late' });
  const row = db.prepare('SELECT state, attachmentId FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1');
  assert.deepEqual([row.state, row.attachmentId], ['attached', 'att_slow']);
});

test('rule 7 — a « Réessayer » started on a credit the job has not reached yet is not repeated by the job: uploaded once', async () => {
  seedSettlement(1, 7, [{ paymentId: 'tr_a', gross: 10000 }]);
  seedSettlement(2, 6, [{ paymentId: 'tr_b', gross: 20000 }]);
  const gates = {};
  const open = (id) => new Promise((resolve) => { gates[id] = resolve; });
  const waits = { tx1: open('tx1'), tx2: open('tx2') };
  const h = harness({ attach: async ({ transactionId }) => { await waits[transactionId]; return { attachmentId: `att_${transactionId}` }; } });
  const running = h.statements.runJob();
  await new Promise((resolve) => setImmediate(resolve));
  const retrying = h.statements.retry('tx2');
  await new Promise((resolve) => setImmediate(resolve));
  gates.tx1();
  gates.tx2();
  await Promise.all([running, retrying]);
  assert.equal(h.uploads.filter((u) => u.transactionId === 'tx2').length, 1);
  assert.equal(h.uploads.filter((u) => u.transactionId === 'tx1').length, 1);
});

test('rule 9 — an error from a concurrent token refresh (overtaken) is transient: the credit stays pending, never reauth', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  const overtaken = Object.assign(new Error('Qonto is not connected'), { code: 'QONTO_NOT_CONNECTED', overtaken: true });
  const h = harness({ attach: async () => { throw overtaken; } });
  const result = await h.statements.runJob();
  assert.equal(result.reauth, undefined);
  const row = db.prepare('SELECT state, attempts FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1');
  assert.deepEqual([row.state, row.attempts], ['pending', 1]);
});

test('rule 7 — two renders of the same statement are byte-identical, and the date is the first attempt\'s', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000, deductions: 2000 }]);
  let tick = 0;
  const values = new Map([['mollieStatementsSince', dayAt(-30)], ['mollieAccessToken', 'access_FAKE_TOKEN_FOR_TESTS']]);
  const uploads = [];
  const statements = createMollieStatements({
    db, settings: { get: (k) => values.get(k) || '' }, qontoConnected: () => true, settlements, splits,
    attachPdf: async (request) => { uploads.push(request); throw httpError(503); },
    now: () => new Date(Date.UTC(2026, 10, 17, 8, 0, 0) + (tick += 61000)), // date-literal-ok: an advancing fake clock, the point is that it moves
  });
  await statements.runJob();
  await statements.retry('tx1');
  assert.equal(uploads.length, 2);
  assert.ok(uploads[0].bytes.equals(uploads[1].bytes), 'the retry sends the very same bytes');
  assert.ok((await statements.pdf('tx1')).bytes.equals(uploads[0].bytes), 'so does « Voir le relevé »');
  assert.ok(db.prepare('SELECT firstAttemptAt FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1').firstAttemptAt);
});

test('rule 10 — « Réessayer » resets the attempts and handles the credit at once (failed, mismatch)', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  seedSettlement(2, 9, [{ paymentId: 'tr_b', gross: 6000 }], { creditCents: 5999 });
  const h = harness({ attach: async () => { throw httpError(500); } });
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) await h.statements.runJob();
  assert.equal(h.statements.lineOf(transactions.get('tx1')).state, 'failed');
  h.behave(async () => ({ attachmentId: 'att_9' }));
  const answer = await h.statements.retry('tx1');
  assert.equal(answer.status, 200);
  assert.equal(answer.body.statement.state, 'attached');
  assert.equal(db.prepare('SELECT attempts FROM mollie_settlement_statements WHERE transactionId = ?').get('tx1').attempts, 0);

  assert.equal(h.statements.lineOf(transactions.get('tx2')).state, 'mismatch');
  transactions.upsertMany([{ ...transactions.get('tx2'), amountCents: 6000, bankAccountId: 'acc-1' }], { bankAccountId: 'acc-1' });
  assert.equal((await h.statements.retry('tx2')).body.statement.state, 'attached', 'the amount was corrected: the retry joins it');
  assert.equal((await h.statements.retry('unknown')).status, 404);
});

test('rule 11 — the reconciliation list gives a Mollie credit its statement, and the PDF is built on the fly', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000, deductions: 2000 }]);
  const h = harness();
  await h.statements.runJob();
  const { controller } = build({ mollieStatements: h.statements, startDate: dayAt(-30) });
  const credit = controller.list({ view: 'todo' }).body.credits.find((c) => c.transactionId === 'tx1');
  assert.ok(credit, 'the Mollie credit is listed');
  assert.deepEqual([credit.statement.state, credit.statement.error], ['attached', null]);
  assert.ok(credit.statement.attachedAt);
  assert.equal(credit.refs.mollieSettlement, 'T19274230.2601.01');

  const pdf = await h.statements.pdf('tx1');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
  const files = fs.readdirSync(path.join(__dirname, '..', '..', '..', '..')).filter((f) => f.endsWith('.pdf'));
  assert.deepEqual(files, [], 'nothing is stored on disk');
});

test('rule 12 — the feature calls no Mollie endpoint: it reads the stored balance transactions only', async () => {
  seedSettlement(1, 6, [{ paymentId: 'tr_a', gross: 10000 }]);
  const realFetch = global.fetch;
  const asked = [];
  global.fetch = async (url) => { asked.push(String(url)); throw new Error('no network expected'); };
  try {
    const h = harness();
    await h.statements.runJob();
    assert.equal(h.statements.lineOf(transactions.get('tx1')).state, 'attached');
    assert.deepEqual(asked, []);
  } finally {
    global.fetch = realFetch;
  }
  const source = ['mollieStatements.js', 'mollieStatementsModel.js', 'mollieStatementPdf.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'reconciliation', f), 'utf8')).join('\n');
  assert.ok(!/mollieClient|fetch\(/.test(source));
});

test('the migration reconciliation_v4 is additive and idempotent', () => {
  upV4(db);
  upV4(db);
  const columns = db.prepare('PRAGMA table_info(mollie_settlement_statements)').all().map((c) => c.name);
  assert.deepEqual(columns, ['transactionId', 'settlementId', 'state', 'attempts', 'lastError', 'attachmentId', 'attachedAt', 'firstAttemptAt', 'updatedAt']);
});

test('rule 6 — what Mollie kept is gross less net, whatever sign the deductions were stored with', () => {
  const { shapeStatement } = require('../reconciliation/mollieStatementPdf');
  const row = (deductionsCents) => ({ type: 'payment', paymentId: 'tr_kept1', createdAt: '2030-01-02T05:00:00Z', initialCents: 73240, resultCents: 58592, deductionsCents }); // date-literal-ok: ordering only, nothing compares it with today
  for (const deductionsCents of [14648, -14648, 0]) {
    const { lines } = shapeStatement({ composition: [row(deductionsCents)], lookup: () => ({ reserveCents: 14648 }), ratePercent: 20 });
    assert.equal(lines[0].reserveCents + lines[0].feeCents, 73240 - 58592, `deductions stored as ${deductionsCents}`);
    assert.equal(lines[0].reserveCents, 14648);
  }
});
