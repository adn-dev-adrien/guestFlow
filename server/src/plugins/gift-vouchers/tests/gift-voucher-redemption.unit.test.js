// specs/gift-vouchers/gift-vouchers.md rules 36-42 and the edge cases of §3.G — a voucher on a booking, on the real core database: the hold a
// quote takes, what the public payment then asks, the quote becoming a stay with the voucher as money received, the fiche's
// payment and its undo, the re-credit of a cancelled stay, an expired voucher refunded, and the books that count it once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins, skipWithout, optionalPlugin } = require('../../sdk/testing');

if (!requirePlugins(['gift-vouchers'])) return;

const fx = require('./redemptionFixture');
const devisModel = require('../../../models/devisModel');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const settlementsModel = require('../../../models/paymentSettlementsModel');
const publicPayment = require('../../../controllers/public/publicPaymentController');
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { settlementFigures } = require('../../../utils/paymentTenders');
const { buildLedger } = require('../../../utils/reservationLedger');
const prepaidReceipts = require('../../../utils/prepaidReceipts');
const codes = require('../code');

const {
  db, api, clock, goLive, issueVoucher, seedQuote, hold, SOURCE,
} = fx;

const quotes = devisModel.buildModel(db);
const reservations = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const movementsOf = (voucherId) => api.movements.list(voucherId).map((m) => [m.kind, m.amountCents]);
const balanceOf = (voucherId) => api.vouchers.find(voucherId).balanceCents;
const setClock = (iso) => { clock.at = new Date(iso); };

function fakeRes() {
  const res = {
    code: 200, body: null, headers: {},
    status(code) { res.code = code; return res; },
    json(body) { res.body = body; return res; },
    set(name, value) { res.headers[name] = value; return res; },
  };
  return res;
}

async function pay(quote) {
  const res = fakeRes();
  await publicPayment.pay({
    params: { id: String(quote.id) }, body: { token: quote.token }, query: {}, headers: {}, get: () => '',
  }, res);
  return res;
}

const confirmations = [];
async function linkPaid(linkId) {
  return processPaidLink({
    database: db,
    devisModel: quotes,
    paymentLinksModel,
    link: paymentLinksModel.findById(linkId),
    paidPayment: { paid: true, paymentId: `pay-${linkId}`, paidAt: '2026-11-15T10:30:00Z' }, // date-literal-ok: the suite runs on its own clock, never the real today
    sendConfirmation: async (id) => confirmations.push(id),
    emitPluginEvent: () => {},
    notifyPaidAfterCancel: async () => {},
  });
}

const settlementLines = (stayId, bucket) => settlementsModel.listForTarget(stayId, 'bucket', bucket)
  .flatMap((s) => s.tenders.map((t) => [t.method, t.amountCents, t.label || null]));

test.beforeEach(() => {
  goLive();
  setClock('2026-11-15T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  confirmations.length = 0;
});

test('rule 36 — the hold is the balance or the stay, whichever is lower: 300 € on a 268 € stay holds 268 €, 32 € stay on the voucher', () => {
  const { voucherId, code } = issueVoucher(30000);
  const quote = seedQuote();
  const held = hold(quote.id, code, 26800);
  assert.equal(held.ok, true);
  assert.equal(held.heldCents, 26800);
  assert.deepEqual(movementsOf(voucherId), [['issue', 30000], ['hold', -26800]]);
  assert.equal(balanceOf(voucherId), 3200, 'a held amount is unavailable to any other request (rule 37)');
  assert.equal(api.redemption.held(quote.id).amountCents, 26800);
});

test('rule 37 — two requests for the last cents: one hold wins, the other is told the balance left', () => {
  const { voucherId, code } = issueVoucher(10000);
  const first = seedQuote();
  const second = seedQuote();
  const stale = api.vouchers.find(voucherId);
  assert.equal(hold(first.id, code, 10000).ok, true);
  // The second request read the voucher before the first one held it: the ledger refuses it inside its own transaction.
  const read = api.vouchers.findByCodeHash;
  api.vouchers.findByCodeHash = () => stale;
  try {
    const lost = hold(second.id, code, 10000);
    assert.equal(lost.ok, false);
    assert.deepEqual([lost.status, lost.code, lost.balanceCents], [409, 'VOUCHER_BALANCE_CHANGED', 0]);
  } finally {
    api.vouchers.findByCodeHash = read;
  }
  assert.equal(api.redemption.held(second.id), null);
  assert.deepEqual(movementsOf(voucherId), [['issue', 10000], ['hold', -10000]]);
});

test('rule 36 — a mistyped code is refused before any lookup and not counted; an unknown one is counted; an exhausted or expired voucher says so', () => {
  const { voucherId, code } = issueVoucher(5000);
  const quote = seedQuote();
  const mistyped = hold(quote.id, `${code.slice(0, 15)}${code[15] === '0' ? '1' : '0'}`, 5000);
  assert.deepEqual([mistyped.status, mistyped.code], [400, 'VOUCHER_CODE_MISTYPED']);
  assert.equal(api.checks.failedSince(60 * 60 * 1000, null), 0);
  const unknown = hold(quote.id, codes.generate(), 5000);
  assert.deepEqual([unknown.status, unknown.code], [404, 'VOUCHER_UNKNOWN']);
  assert.equal(api.checks.failedSince(60 * 60 * 1000, null), 1, 'a well-formed unknown code counts');
  db.prepare('UPDATE gift_vouchers SET expiresOn = ? WHERE id = ?').run('2026-11-01', voucherId); // date-literal-ok: the suite runs on its own clock, never the real today
  const expired = hold(quote.id, code, 5000);
  assert.deepEqual([expired.status, expired.code], [409, 'VOUCHER_EXPIRED']);
  db.prepare('UPDATE gift_vouchers SET expiresOn = ? WHERE id = ?').run('2028-11-01', voucherId); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(hold(quote.id, code, 5000).ok, true);
  const other = seedQuote();
  assert.equal(hold(other.id, code, 5000).code, 'VOUCHER_EXHAUSTED');
});

test('rule 38 — 50 € on an 80,40 € acompte: the card link is minted for 30,40 €, then the stay holds the acompte as 50 € voucher + 30,40 € card', async () => {
  const { voucherId, code } = issueVoucher(5000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  assert.equal(hold(quote.id, code, 26800).heldCents, 5000);

  const answered = await pay(quote);
  assert.equal(answered.code, 200);
  assert.equal(answered.body.data.amountCents, 3040, 'the link asks what the acompte still asks');
  const link = paymentLinksModel.findOpenForReservation(quote.id, 'deposit');
  assert.equal(link.amountCents, 3040);

  const out = await linkPaid(link.id);
  assert.equal(out.effect, 'converted');
  assert.equal(out.amountMismatch, undefined, 'a link minted for the amount due minus the voucher never trips the amount guard');
  const stay = reservations(out.reservationId);
  assert.deepEqual([stay.depositPaid, stay.depositPaidDate], [1, '2026-11-15']); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(Number(stay.balancePaid), 0, 'the solde is unchanged');

  assert.deepEqual(settlementLines(stay.id, 'deposit'), [['prepaid', 5000, 'Bon cadeau'], ['card', 3040, null]]);
  const [settlement] = settlementsModel.listForTarget(stay.id, 'bucket', 'deposit');
  assert.deepEqual(settlement.parts, [{ kind: 'deposit', key: 'deposit', amountCents: 8040 }]);
  assert.equal(settlement.shortfallCents, 0);
  const figures = settlementFigures(settlement);
  assert.deepEqual([figures.receivedCents, figures.bankCents, figures.prepaidCents, figures.collectedCents], [8040, 3040, 5000, 3040]);
  assert.deepEqual(movementsOf(voucherId), [['issue', 5000], ['hold', -5000], ['release', 5000], ['redeem', -5000]]);
  assert.equal(api.movements.list(voucherId).at(-1).reservationId, stay.id);
  assert.equal(api.redemption.held(quote.id), null, 'nothing is held any more');
  assert.deepEqual(confirmations, [stay.id]);
});

test('rule 39 — « Bon cadeau » is its own line in the fiche’s payments, dated that day', async () => {
  const { code } = issueVoucher(5000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(quote.id, code, 26800);
  await pay(quote);
  const out = await linkPaid(paymentLinksModel.findOpenForReservation(quote.id, 'deposit').id);
  const ledger = buildLedger({ row: reservations(out.reservationId), links: [], today: '2026-11-15', settlements: settlementsModel.listFor(out.reservationId) }); // date-literal-ok: the suite runs on its own clock, never the real today
  const deposit = ledger.rows.find((r) => r.key === 'deposit');
  assert.deepEqual(deposit.split.settlements[0].lines.map((l) => l.label.replace(/\s/g, ' ')), ['Bon cadeau 50,00 €', 'CB 30,40 €']);
  assert.equal(deposit.split.settlements[0].edit, null, 'the voucher is undone by the plugin, never by the split form');
  assert.equal(deposit.split.settlements[0].paidDate, '2026-11-15'); // date-literal-ok: the suite runs on its own clock, never the real today
});

test('rule 38 — a full-mode property: the link asks the whole pre-arrival amount less the voucher, and both buckets get their line', async () => {
  const { code } = issueVoucher(10000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6, depositEnabled: 0 });
  hold(quote.id, code, 26800);
  const answered = await pay(quote);
  assert.equal(answered.body.data.amountCents, 16800);
  const out = await linkPaid(paymentLinksModel.findOpenForReservation(quote.id, 'full').id);
  assert.equal(out.amountMismatch, undefined);
  const stay = reservations(out.reservationId);
  assert.deepEqual([stay.depositPaid, stay.balancePaid], [1, 1]);
  assert.deepEqual(settlementLines(stay.id, 'deposit'), [['prepaid', 8040, 'Bon cadeau']]);
  assert.deepEqual(settlementLines(stay.id, 'balance'), [['prepaid', 1960, 'Bon cadeau'], ['card', 16800, null]]);
});

test('rule 38 — nothing due now: 300 € on a 268 € stay confirms at once, no link, 268 € used and 32 € left on the voucher', async () => {
  const { voucherId, code } = issueVoucher(30000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(quote.id, code, 26800);
  const answered = await pay(quote);
  assert.deepEqual([answered.code, answered.body.data.paymentUrl, answered.body.data.amountCents, answered.body.data.confirmed], [200, null, 0, true]);
  assert.equal(paymentLinksModel.listForReservation(quote.id).length, 0, 'no link was minted');
  const converted = reservations(quote.id).convertedReservationId;
  assert.ok(converted, 'the quote became a stay through the effect a paid link has');
  const stay = reservations(converted);
  assert.deepEqual([stay.depositPaid, stay.balancePaid], [1, 1]);
  assert.deepEqual(settlementLines(stay.id, 'deposit'), [['prepaid', 8040, 'Bon cadeau']]);
  assert.deepEqual(settlementLines(stay.id, 'balance'), [['prepaid', 18760, 'Bon cadeau']]);
  assert.equal(balanceOf(voucherId), 3200);
  assert.deepEqual(movementsOf(voucherId), [['issue', 30000], ['hold', -26800], ['release', 26800], ['redeem', -26800]]);
  const status = fakeRes();
  await publicPayment.status({ params: { id: String(quote.id) }, query: { token: quote.token }, headers: {}, get: () => '' }, status);
  assert.equal(status.body.data.status, 'confirmed');
});

test('rule 38 — a voucher worth the acompte and part of the solde: the solde is paid in part, the reste stays to collect', async () => {
  const { voucherId, code } = issueVoucher(10000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(quote.id, code, 26800);
  const answered = await pay(quote);
  assert.equal(answered.body.data.confirmed, true);
  const stay = reservations(reservations(quote.id).convertedReservationId);
  const [balance] = settlementsModel.listForTarget(stay.id, 'bucket', 'balance');
  assert.deepEqual([balance.dueCents, balance.shortfallCents, balance.shortfallKind], [18760, 16800, 'due']);
  assert.equal(Number(stay.splitShortfallDue), 168, 'the reste is the stay’s, as for any partial payment');
  assert.equal(balanceOf(voucherId), 0);
});

test('rule 37 — the hold goes back when the quote is deleted, purged, or lapses unpaid; a converted quote keeps what it used', async () => {
  const { voucherId, code } = issueVoucher(20000);
  const deleted = seedQuote();
  hold(deleted.id, code, 5000);
  assert.equal(balanceOf(voucherId), 15000);
  assert.equal(quotes.remove(deleted.id).ok, true);
  assert.equal(balanceOf(voucherId), 20000, 'deleted: released');

  const purged = seedQuote();
  hold(purged.id, code, 5000);
  assert.equal(quotes.purgePublicRequest(purged.id).deleted, true);
  assert.equal(balanceOf(voucherId), 20000, 'purged: released');

  const lapsing = seedQuote();
  hold(lapsing.id, code, 5000);
  setClock('2026-11-16T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  api.releaseLapsedHolds();
  assert.equal(balanceOf(voucherId), 15000, 'a day is not enough: a link paid late still finds its hold');
  setClock('2026-11-19T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  api.releaseLapsedHolds();
  assert.equal(balanceOf(voucherId), 20000, 'lapsed unpaid: released');
  assert.deepEqual(movementsOf(voucherId).map(([kind]) => kind), ['issue', 'hold', 'release', 'hold', 'release', 'hold', 'release']);

  const paid = seedQuote({ deposit: 50, balance: 0 });
  hold(paid.id, code, 5000);
  await pay(paid);
  setClock('2026-11-30T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  api.releaseLapsedHolds();
  assert.equal(balanceOf(voucherId), 15000, 'a quote that became a stay is never released');
});

test('rule 39 — the voucher is a means of payment, not a discount: price, tourist tax and commission are those of the same stay paid by card', async () => {
  const { code } = issueVoucher(30000);
  const withVoucher = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(withVoucher.id, code, 26800);
  await pay(withVoucher);
  const byCard = seedQuote({ deposit: 80.4, balance: 187.6 });
  await pay(byCard);
  await linkPaid(paymentLinksModel.findOpenForReservation(byCard.id, 'deposit').id);
  const columns = [
    'finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'touristTaxTotal', 'platformCommissionAmount', 'acompteCommissionAmount', 'adults', 'platform',
  ];
  const pick = (id) => Object.fromEntries(columns.map((c) => [c, reservations(reservations(id).convertedReservationId)[c]]));
  assert.deepEqual(pick(withVoucher.id), pick(byCard.id));
});

test('edge — the stay’s price changes after a voucher was applied: the received amount is unchanged, what is owed moves around it', async () => {
  const { code } = issueVoucher(5000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(quote.id, code, 26800);
  await pay(quote);
  const out = await linkPaid(paymentLinksModel.findOpenForReservation(quote.id, 'deposit').id);
  db.prepare('UPDATE reservations SET depositAmount = 100 WHERE id = ?').run(out.reservationId);
  assert.deepEqual(settlementLines(out.reservationId, 'deposit'), [['prepaid', 5000, 'Bon cadeau'], ['card', 3040, null]]);
  settlementsModel.sync(out.reservationId);
  assert.equal(Number(reservations(out.reservationId).splitShortfallDue), 19.6, 'a rise is a reste à percevoir, never a second voucher use');
});

const call = (handler, params, body = {}) => {
  const res = fakeRes();
  handler({ params, body, user: { id: 7 } }, res);
  return res;
};

function openStay({ deposit = 50, balance = 200, start = '2027-07-10', end = '2027-07-14' } = {}) { // date-literal-ok: the suite runs on its own clock, never the real today
  return Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
    VALUES ('reservation', 1, 1, ?, ?, 2, ?, ?, ?)`).run(start, end, deposit + balance, deposit, balance).lastInsertRowid);
}

test('rule 40 — the fiche: « Payer par bon cadeau » redeems and records the received amount; the amount is bounded by the balance and by what the stay owes', () => {
  const { voucherId, code } = issueVoucher(30000);
  seedQuote();
  const stay = openStay();
  const tooMuch = call(api.stays.pay, { reservationId: String(stay) }, { code, amountCents: 30000 });
  assert.deepEqual([tooMuch.code, tooMuch.body.error], [400, 'RECORD_REFUSED']);
  assert.equal(balanceOf(voucherId), 30000, 'a refused payment writes nothing on the voucher');
  assert.equal(Number(reservations(stay).depositPaid), 0);

  const paid = call(api.stays.pay, { reservationId: String(stay) }, { code, amountCents: 12000 });
  assert.equal(paid.code, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.owedCents, 13000);
  assert.deepEqual(paid.body.lines.map((l) => [l.label.replace(/\d{4}$/, 'NNNN'), l.amountCents, l.undoable]), [['Bon cadeau BC-2026-NNNN', 12000, true]]);
  assert.equal(balanceOf(voucherId), 18000);
  assert.deepEqual(settlementLines(stay, 'deposit'), [['prepaid', 5000, 'Bon cadeau']]);
  assert.deepEqual(settlementLines(stay, 'balance'), [['prepaid', 7000, 'Bon cadeau']]);
  assert.equal(Number(reservations(stay).depositPaid), 1);

  const above = call(api.stays.pay, { reservationId: String(stay) }, { code, amountCents: 13001 });
  assert.equal(above.body.error, 'RECORD_REFUSED');
  const more = call(api.stays.pay, { reservationId: String(stay) }, { code, amountCents: 13000 });
  assert.equal(more.code, 200, JSON.stringify(more.body));
  assert.equal(more.body.owedCents, 0, 'a reste is collected by a second payment');
});

test('rule 40 — a typed code is judged on the fiche like anywhere: mistyped, unknown, expired, exhausted', () => {
  const { voucherId, code } = issueVoucher(5000);
  const stay = openStay({ deposit: 0, balance: 100 });
  const reservationId = String(stay);
  assert.equal(call(api.stays.pay, { reservationId }, { code: 'abc', amountCents: 1000 }).body.error, 'VOUCHER_CODE_MISTYPED');
  assert.equal(call(api.stays.pay, { reservationId }, { code: codes.generate(), amountCents: 1000 }).body.error, 'VOUCHER_UNKNOWN');
  assert.equal(call(api.stays.pay, { reservationId }, { code, amountCents: 5001 }).body.error, 'AMOUNT_ABOVE_BALANCE');
  assert.equal(call(api.stays.pay, { reservationId }, { code, amountCents: 0 }).body.error, 'AMOUNT_INVALID');
  db.prepare('UPDATE gift_vouchers SET expiresOn = ? WHERE id = ?').run('2026-11-01', voucherId); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(call(api.stays.pay, { reservationId }, { code, amountCents: 1000 }).body.error, 'VOUCHER_EXPIRED');
});

test('rule 40 — undoing a fiche payment writes a refund and removes the received amount', () => {
  const { voucherId, code } = issueVoucher(10000);
  seedQuote();
  const stayId = openStay({ deposit: 0, balance: 100, start: '2027-08-10', end: '2027-08-14' }); // date-literal-ok: the suite runs on its own clock, never the real today
  const paid = call(api.stays.pay, { reservationId: String(stayId) }, { code, amountCents: 4000 });
  assert.equal(paid.code, 200, JSON.stringify(paid.body));
  assert.equal(Number(reservations(stayId).balancePaid), 1);
  assert.equal(balanceOf(voucherId), 6000);

  const undone = call(api.stays.undo, { reservationId: String(stayId), ref: paid.body.lines[0].ref });
  assert.equal(undone.code, 200, JSON.stringify(undone.body));
  assert.deepEqual(undone.body.lines, []);
  assert.equal(Number(reservations(stayId).balancePaid), 0, 'the bucket is open again');
  assert.equal(settlementsModel.listFor(stayId).length, 0);
  assert.equal(balanceOf(voucherId), 10000);
  assert.deepEqual(movementsOf(voucherId).map(([kind]) => kind), ['issue', 'redeem', 'refund']);
});

async function cancelledStayWithVoucher() {
  const { voucherId, code } = issueVoucher(5000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(quote.id, code, 26800);
  await pay(quote);
  const out = await linkPaid(paymentLinksModel.findOpenForReservation(quote.id, 'deposit').id);
  return { voucherId, stayId: out.reservationId };
}

test('rule 40 — cancelling the stay offers « Recréditer le bon » for the voucher part; the indemnity is taken from the card first', async () => {
  const { voucherId, stayId } = await cancelledStayWithVoucher();
  const params = { reservationId: String(stayId) };
  db.prepare("UPDATE reservations SET kind = 'cancelled', cancellationKeptCents = 2000 WHERE id = ?").run(stayId);
  const offer = call(api.stays.read, params);
  assert.deepEqual(offer.body.recredit, { voucherCents: 5000, recreditCents: 5000, keptCents: 2000 }, '20 € kept come out of the 30,40 € of card first');
  assert.equal(call(api.stays.recredit, params).code, 200);
  assert.equal(balanceOf(voucherId), 5000);
  assert.equal(call(api.stays.recredit, params).body.error, 'NOTHING_TO_RECREDIT', 'once only, never money');
});

test('rule 40 — an indemnity above the card payments is taken from the voucher part: only the rest is re-credited', async () => {
  const { voucherId, stayId } = await cancelledStayWithVoucher();
  const params = { reservationId: String(stayId) };
  db.prepare("UPDATE reservations SET kind = 'cancelled', cancellationKeptCents = 6000 WHERE id = ?").run(stayId);
  assert.equal(call(api.stays.read, params).body.recredit.recreditCents, 2040, '60 € kept - 30,40 € of card = 29,60 € taken from the voucher');
  assert.equal(call(api.stays.recredit, params).code, 200);
  assert.equal(balanceOf(voucherId), 2040);
});

test('rule 41 — expiry stops new uses only: a refund on an expired voucher re-credits it and extends it by 3 months from that day', () => {
  const { voucherId } = issueVoucher(10000);
  api.movements.append({ voucherId, kind: 'redeem', amountCents: -4000, actor: 'user:1', reservationId: 5, idempotencyKey: 'redeem:expiry' });
  db.prepare('UPDATE gift_vouchers SET expiresOn = ? WHERE id = ?').run('2026-11-01', voucherId); // date-literal-ok: the suite runs on its own clock, never the real today
  api.redemption.refund({ voucherId, amountCents: 4000, actor: 'user:1', reservationId: 5, idempotencyKey: 'refund:expiry', note: null });
  assert.equal(balanceOf(voucherId), 10000, 'the redeemed amount came back');
  assert.equal(api.vouchers.find(voucherId).expiresOn, '2027-02-15', '3 months from 15/11/2026'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(movementsOf(voucherId).map(([kind]) => kind), ['issue', 'redeem', 'refund', 'extend']);

  const { voucherId: valid } = issueVoucher(10000);
  api.movements.append({ voucherId: valid, kind: 'redeem', amountCents: -4000, actor: 'user:1', reservationId: 6, idempotencyKey: 'redeem:valid' });
  const before = api.vouchers.find(valid).expiresOn;
  api.redemption.refund({ voucherId: valid, amountCents: 4000, actor: 'user:1', reservationId: 6, idempotencyKey: 'refund:valid', note: null });
  assert.equal(api.vouchers.find(valid).expiresOn, before, 'a voucher still valid keeps its date');
});

test('rule 41 — a voucher that expires while held is not taken back: the conversion still redeems it', async () => {
  const { voucherId, code } = issueVoucher(5000);
  const quote = seedQuote({ deposit: 50, balance: 0 });
  hold(quote.id, code, 5000);
  db.prepare('UPDATE gift_vouchers SET expiresOn = ? WHERE id = ?').run('2026-11-14', voucherId); // date-literal-ok: the suite runs on its own clock, never the real today
  const answered = await pay(quote);
  assert.equal(answered.body.data.confirmed, true);
  assert.equal(balanceOf(voucherId), 0);
});

test('rule 42 — the voucher’s money is counted once: never expected at the bank, never an encaissement of the books', { skip: skipWithout(['online-payment']) }, async () => {
  const { code } = issueVoucher(5000);
  const quote = seedQuote({ deposit: 80.4, balance: 187.6 });
  hold(quote.id, code, 26800);
  await pay(quote);
  const out = await linkPaid(paymentLinksModel.findOpenForReservation(quote.id, 'deposit').id);
  const [settlement] = settlementsModel.listForTarget(out.reservationId, 'bucket', 'deposit');
  const figures = settlementFigures(settlement);
  assert.equal(figures.bankCents, 3040, 'the bank reconciliation expects the card line only');
  assert.equal(figures.collectedCents, 3040, 'the journals book the card line only: the voucher’s sale was the encaissement');
  assert.equal(figures.booksCents, 8040, 'the stay still counts the whole acompte as received');

  const { receiptsOfReservation } = optionalPlugin(() => require('../../online-payment/reconciliation/expectedReceipts'));
  const row = reservations(out.reservationId);
  const receipts = receiptsOfReservation({ ...row, client: {}, firstName: 'Jean', lastName: 'Dupont' }, {
    buildLedger,
    parseGroup: () => null,
    links: paymentLinksModel.listForReservation(quote.id),
    settlements: settlementsModel.listFor(out.reservationId),
    settlementFigures,
    today: '2026-11-15', // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.deepEqual(receipts.filter((r) => r.ledgerKey.startsWith('settlement-')).map((r) => r.expectedCents), [3040]);
});
