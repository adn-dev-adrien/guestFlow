// specs/gift-voucher-campaigns.md rules 39, 54 — « Annuler le bon »: within 14 days of the payment a withdrawal, after them only a goodwill cancellation forced with a reason;
// the holds go back, the voucher is cancelled, a refund line is opened for the paid amount (none for a voucher given away) and reaches the books as an avoir dated the
// cancellation day; the operator marks it settled once the transfer is made; every step is in the voucher's history with the operator's name.
const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../voucherRules');
const { createBooks } = require('../books');
const fx = require('./giftVoucherFixtures');

async function withAdmin(fn) {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    await fn({ ...fixture, server });
  } finally {
    await server.close();
  }
}

const cancel = (server, id, body = {}) => server.call('POST', `/api/gift-vouchers/${id}/cancel`, body);
const refundsOf = (db) => db.prepare('SELECT * FROM gift_voucher_refunds ORDER BY id').all();

test('rule 39: the withdrawal period is the day of the payment and the 14 days after it, on the Paris calendar', () => {
  assert.deepEqual(rules.withdrawalOf({ paidOn: '2026-11-01', today: '2026-11-15' }), { open: true, endsOn: '2026-11-15' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(rules.withdrawalOf({ paidOn: '2026-11-01', today: '2026-11-16' }), { open: false, endsOn: '2026-11-15' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(rules.withdrawalOf({ paidOn: '2026-12-25', today: '2026-12-25' }).open, true); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(rules.withdrawalOf({ paidOn: '2026-12-25', today: '2027-01-08' }).endsOn, '2027-01-08', 'across a year'); // date-literal-ok: the suite runs on its own clock, never the real today
});

test('rules 54, 58: within 14 days a cancellation needs nothing more — the voucher is cancelled, a refund line opens for the paid amount, the history names the operator', () => withAdmin(async ({ server, db }) => {
  const v = await fx.issueManual(server, { amountCents: 15000, date: '2026-11-01' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(v.withdrawal.open, true);
  const res = await cancel(server, v.id, { reason: 'Le client a changé d’avis' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.state, res.body.balanceCents, res.body.cancelReason, res.body.cancelForced], ['cancelled', 0, 'Le client a changé d’avis', false]);
  assert.deepEqual(refundsOf(db).map((r) => [r.voucherId, r.amountCents, r.settledAt]), [[v.id, 15000, null]]);
  assert.deepEqual(res.body.refunds.map((r) => [r.amountCents, r.openedOn, r.settledOn]), [[15000, '2026-11-15', null]]); // date-literal-ok: the suite runs on its own clock, never the real today
  const row = res.body.movements.find((m) => m.kind === 'cancel');
  assert.deepEqual([row.amountCents, row.label, row.actorName, row.note], [-15000, 'Annulé', 'Adrien Test', 'Le client a changé d’avis']);
  assert.equal((await cancel(server, v.id)).body.code, 'VOUCHER_CANCELLED');
  assert.equal(refundsOf(db).length, 1, 'no second refund');
}));

test('rule 54: after 14 days the cancellation is refused until the operator forces it with a reason — a goodwill gesture, remembered as such', () => withAdmin(async ({ server, db }) => {
  const v = await fx.issueManual(server, { amountCents: 15000, date: '2026-10-31' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(v.withdrawal.open, false);
  const plain = await cancel(server, v.id);
  assert.deepEqual([plain.status, plain.body.code], [409, 'CANCEL_FORCE_REQUIRED']);
  assert.match(plain.body.error, /14 jours/);
  assert.equal((await cancel(server, v.id, { reason: 'Geste' })).body.code, 'CANCEL_FORCE_REQUIRED', 'a reason alone does not force');
  assert.equal((await cancel(server, v.id, { force: true })).body.code, 'REASON_REQUIRED');
  assert.equal((await cancel(server, v.id, { force: true, reason: '   ' })).body.code, 'REASON_REQUIRED');
  assert.equal((await cancel(server, v.id, { force: 'yes', reason: 'x' })).body.code, 'FIELD_INVALID');
  assert.equal((await cancel(server, v.id, { force: true, reason: 'x'.repeat(201) })).body.code, 'FIELD_INVALID');
  assert.equal(refundsOf(db).length, 0, 'every refusal leaves no refund line');
  const done = await cancel(server, v.id, { force: true, reason: 'Décès dans la famille' });
  assert.equal(done.status, 200);
  assert.deepEqual([done.body.state, done.body.cancelForced, done.body.cancelReason], ['cancelled', true, 'Décès dans la famille']);
  assert.equal(refundsOf(db).length, 1);
}));

test('rule 54: a voucher given away opens no refund line and has no withdrawal period', () => withAdmin(async ({ server, db }) => {
  const given = await server.call('POST', '/api/gift-vouchers', { amountCents: 15000, outcome: 'offered', date: '2026-01-10', recipientFirstName: 'Marie', recipientLastName: 'Durand' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(given.status, 201, JSON.stringify(given.body));
  assert.equal(given.body.withdrawal, null);
  const res = await cancel(server, given.body.id);
  assert.deepEqual([res.status, res.body.state, res.body.refunds], [200, 'cancelled', []]);
  assert.equal(refundsOf(db).length, 0);
}));

test('rule 54: every hold is released first — the refund is what the voucher still owes, and the holds are given back in the history', () => withAdmin(async ({ server, api, db }) => {
  const v = await fx.issueManual(server, { amountCents: 15000 });
  api.movements.append({
    voucherId: v.id, kind: 'hold', amountCents: -4000, actor: 'public', devisId: 77, idempotencyKey: 'hold-1',
  });
  api.movements.append({
    voucherId: v.id, kind: 'hold', amountCents: -1000, actor: 'public', devisId: 78, idempotencyKey: 'hold-2',
  });
  const res = await cancel(server, v.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.movements.map((m) => m.kind), ['issue', 'hold', 'hold', 'release', 'release', 'cancel']);
  assert.deepEqual(refundsOf(db).map((r) => r.amountCents), [15000]);
  assert.equal(api.movements.balanceOf(v.id), 0);
}));

test('rule 54: a voucher already used, or expired, cannot be cancelled; nothing is opened', () => withAdmin(async ({ server, api, db, clock }) => {
  const used = await fx.issueManual(server);
  api.movements.append({
    voucherId: used.id, kind: 'redeem', amountCents: -1000, actor: 'system', reservationId: 5, idempotencyKey: 'redeemed',
  });
  assert.equal((await cancel(server, used.id)).body.code, 'VOUCHER_ALREADY_REDEEMED');
  const old = await fx.issueManual(server, { date: '2026-11-10' }); // date-literal-ok: the suite runs on its own clock, never the real today
  clock.at = new Date('2028-06-01T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  const expired = await cancel(server, old.id, { force: true, reason: 'x' });
  assert.deepEqual([expired.status, expired.body.code], [409, 'VOUCHER_EXPIRED']);
  assert.deepEqual(refundsOf(db), []);
}));

test('rule 54: the operator marks a refund settled once the transfer is made — with their name, once — and the voucher’s history says so', () => withAdmin(async ({ server, db }) => {
  const v = await fx.issueManual(server, { amountCents: 15000 });
  const refund = (await cancel(server, v.id)).body.refunds[0];
  const settle = (rid, id = v.id) => server.call('POST', `/api/gift-vouchers/${id}/refunds/${rid}/settle`, {});
  assert.equal((await settle(999)).body.code, 'REFUND_NOT_FOUND');
  const other = await fx.issueManual(server);
  assert.equal((await settle(refund.id, other.id)).body.code, 'REFUND_NOT_FOUND', 'a refund of another voucher');
  const done = await settle(refund.id);
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.refunds.map((r) => [r.settledOn, r.settledBy]), [['2026-11-15', 'Adrien Test']]); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(done.body.movements.at(-1), {
    id: `refund:${refund.id}`, kind: 'refundSettled', label: 'Remboursement effectué', amountCents: 15000, date: '2026-11-15', actorName: 'Adrien Test', reservationId: null, note: null, // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.equal((await settle(refund.id)).body.code, 'REFUND_ALREADY_SETTLED');
  assert.equal(db.prepare('SELECT settledBy FROM gift_voucher_refunds').get().settledBy, 'user:7');
}));

test('rule 54: the books carry the sale on its day and the refund as an avoir on the cancellation day, at the rate of the sale', () => withAdmin(async ({ server, api, clock }) => {
  const v = await fx.issueManual(server, { amountCents: 15000, date: '2026-11-10', senderName: 'Paul' }); // date-literal-ok: the suite runs on its own clock, never the real today
  clock.at = new Date('2026-11-14T09:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  await cancel(server, v.id);
  const entries = api.salesBetween({ from: '2026-11-01', to: '2026-11-30' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(entries.map((e) => [e.date, e.key, e.totalCents, e.booksCents, e.vatRate, e.role || null]), [
    ['2026-11-10', `giftVoucher:${v.id}`, 15000, 15000, 10, null], // date-literal-ok: the suite runs on its own clock, never the real today
    ['2026-11-14', `giftVoucher:${v.id}:refund`, 0, 15000, 10, 'refund'], // date-literal-ok: the suite runs on its own clock, never the real today
  ]);
  assert.equal(entries[1].label, 'Remboursement bon cadeau BC-2026-0001');
  assert.deepEqual(api.salesBetween({ from: '2026-11-11', to: '2026-11-13' }), []); // date-literal-ok: the suite runs on its own clock, never the real today
  const { buildStandaloneEntry } = require('../../../utils/accounting/accountingOutput');
  assert.deepEqual([buildStandaloneEntry(entries[1]).kind, buildStandaloneEntry(entries[1]).standaloneRole], ['standaloneRefund', 'refund']);
}));

test('rule 54: a voucher given away has no sale and no avoir in the books', () => withAdmin(async ({ server, api }) => {
  const given = await server.call('POST', '/api/gift-vouchers', { amountCents: 15000, outcome: 'offered', recipientFirstName: 'Marie', recipientLastName: 'Durand' });
  await cancel(server, given.body.id);
  assert.deepEqual(api.salesBetween({ from: '2026-11-01', to: '2026-11-30' }), []); // date-literal-ok: the suite runs on its own clock, never the real today
}));

test('rule 54: a refund below the amount is cut across the VAT rates in proportion, to the cent, the last rate taking the rounding', () => {
  const voucher = {
    id: 3, number: 'BC-2026-0003', amountCents: 10900, senderName: 'Paul', paymentMethod: 'card',
    vatLines: JSON.stringify([{ ratePercent: 10, htCents: 1273, vatCents: 127 }, { ratePercent: 20, htCents: 7917, vatCents: 1583 }]),
  };
  const books = createBooks({
    vouchers: { find: () => voucher, issuedBetween: () => [] },
    refunds: { openedBetween: () => [{ id: 1, voucherId: 3, amountCents: 5000, openedAt: '2026-11-14T09:00:00.000Z' }] }, // date-literal-ok: the suite runs on its own clock, never the real today
  });
  const [low, high] = books.salesBetween({ from: '2026-11-14', to: '2026-11-14' }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual([low.key, low.vatRate, low.booksCents, high.key, high.vatRate, high.booksCents], ['giftVoucher:3:refund:10', 10, 642, 'giftVoucher:3:refund:20', 20, 4358]);
  assert.equal(low.booksCents + high.booksCents, 5000);
});
