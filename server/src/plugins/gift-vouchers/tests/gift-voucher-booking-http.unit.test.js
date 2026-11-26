// specs/gift-vouchers/gift-vouchers.md rules 36-39, end to end over HTTP: the real `/public/v1` mounts (key, limiters, routing) with the real
// quote, booking-request and payment controllers, on the in-memory core database with the plugin live as a prepaid source.
// A stay of 268 € (4 nights at 67 €), acompte 30 % = 80,40 €, solde 187,60 €.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['gift-vouchers', 'website-booking'])) return;

const API_KEY = 'voucher-http-key';
process.env.PUBLIC_API_KEY = API_KEY;
const fx = require('./redemptionFixture');

// The suite's today is 2027-01-01, for the helper and for every clock the quote, the deposit rule and the payment read.
test.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-01T10:00:00Z').getTime() });
require('../../../utils/reservationHelpers').getTodayIsoDate = () => '2027-01-01';
require('../../website-booking/settings').termsSettings = () => ({ requireTermsAcceptance: false });
require('../../../utils/notificationService').notifyNewSiteDevis = async () => {};

const express = require('express');
const { buildPublicMounts } = require('../../website-booking/routes');
const devisModel = require('../../../models/devisModel');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const settlementsModel = require('../../../models/paymentSettlementsModel');
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const codes = require('../code');

const {
  db, api, goLive, issueVoucher, SOURCE,
} = fx;
const quotes = devisModel.buildModel(db);

const propertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests, depositEnabled, depositPercent) VALUES ('Gîte', 6, 1, 30)").run().lastInsertRowid);
db.prepare('INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, \'An\', 67, ?, 2)')
  .run(propertyId, JSON.stringify([{ startDate: '2027-01-01', endDate: '2027-12-31' }]));

let server;
let baseUrl;
let ipCounter = 0;
test.before(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  buildPublicMounts().forEach(({ path, router }) => app.use(path, router));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); });
test.beforeEach(() => goLive());

async function post(path, body) {
  ipCounter += 1;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}`, 'x-forwarded-for': `198.51.100.${ipCounter}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let month = 2; // stays start well after today (2027-01-01): the acompte is asked
function stay() {
  month += 1;
  const mm = String(month).padStart(2, '0');
  return { propertyId, startDate: `2027-${mm}-10`, endDate: `2027-${mm}-14`, adults: 2 };
}
const guest = { firstName: 'Marie', lastName: 'Durand', email: 'marie@example.fr', phone: '+33612345678' };
const request = (s, extra = {}) => post('/public/v1/booking-requests', { ...s, guest, ...extra });
const prepaid = (code) => ({ prepaid: { kind: SOURCE, code } });

async function linkPaid(linkId) {
  return processPaidLink({
    database: db,
    devisModel: quotes,
    paymentLinksModel,
    link: paymentLinksModel.findById(linkId),
    paidPayment: { paid: true, paymentId: `pay-${linkId}`, paidAt: '2027-01-02T10:30:00Z' },
    sendConfirmation: async () => {},
    emitPluginEvent: () => {},
    notifyPaidAfterCancel: async () => {},
  });
}

test('quote — a voucher code prices the amount applied and « À payer aujourd’hui » without holding anything', async () => {
  const { code } = issueVoucher(5000);
  const s = stay();
  const quoted = await post('/public/v1/quote', { ...s, ...prepaid(code) });
  assert.equal(quoted.status, 200);
  const { payment } = quoted.body.data;
  assert.equal(payment.prepaid.appliedCents, 5000);
  assert.equal(payment.prepaid.dueTodayCents, 3040);
  assert.deepEqual(payment.prepaidKinds.map((k) => k.kind), [SOURCE]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_voucher_movements WHERE kind = 'hold'").get().n, 0, 'a quote holds nothing');
});

test('(a) 50 € on an 80,40 € acompte: the link is minted for 30,40 €; once paid the stay has a 50 € « Bon cadeau » line and the voucher a redeem', async () => {
  const { voucherId, code } = issueVoucher(5000);
  const requested = await request(stay(), prepaid(code));
  assert.equal(requested.status, 201);
  const { requestId, publicToken, prepaid: held } = requested.body.data;
  assert.equal(held.appliedCents, 5000);
  assert.equal(held.dueTodayCents, 3040);

  const paid = await post(`/public/v1/booking-requests/${requestId}/pay`, { token: publicToken });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.amountCents, 3040);
  const link = paymentLinksModel.findOpenForReservation(requestId, 'deposit');
  assert.equal(link.amountCents, 3040);

  const out = await linkPaid(link.id);
  assert.equal(out.effect, 'converted');
  const lines = settlementsModel.listForTarget(out.reservationId, 'bucket', 'deposit')
    .flatMap((x) => x.tenders.map((t) => [t.method, t.amountCents, t.label || null]));
  assert.deepEqual(lines, [['prepaid', 5000, 'Bon cadeau'], ['card', 3040, null]]);
  assert.deepEqual(api.movements.list(voucherId).map((m) => m.kind), ['issue', 'hold', 'release', 'redeem']);
  assert.equal(api.vouchers.find(voucherId).balanceCents, 0);
});

test('(b) a voucher covering everything due now: no link, the booking is confirmed and the quote becomes a stay', async () => {
  const { voucherId, code } = issueVoucher(30000);
  const requested = await request(stay(), prepaid(code));
  assert.equal(requested.status, 201);
  assert.equal(requested.body.data.prepaid.dueTodayCents, 0);
  const { requestId, publicToken } = requested.body.data;

  const paid = await post(`/public/v1/booking-requests/${requestId}/pay`, { token: publicToken });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.paymentUrl, null);
  assert.equal(paid.body.data.confirmed, true);
  assert.equal(paymentLinksModel.listForReservation(requestId).length, 0);
  const converted = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(requestId).convertedReservationId;
  assert.ok(converted, 'the quote was converted');
  assert.equal(db.prepare('SELECT kind FROM reservations WHERE id = ?').get(converted).kind, 'reservation');
  assert.equal(api.vouchers.find(voucherId).balanceCents, 3200, '268 € used, 32 € left');
});

test('(c) a mistyped code is refused without counting a failed try, and the booking is still possible without it', async () => {
  const { code } = issueVoucher(5000);
  const mistyped = `${code.slice(0, 15)}${code[15] === '0' ? '1' : '0'}`;
  const s = stay();
  const refused = await request(s, prepaid(mistyped));
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'VOUCHER_CODE_MISTYPED');
  assert.equal(api.checks.failedSince(60 * 60 * 1000, null), 0, 'not counted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE startDate = ?').get(s.startDate).n, 0, 'nothing was created');

  const unknown = await request(s, prepaid(codes.generate()));
  assert.equal(unknown.status, 404);
  assert.equal(api.checks.failedSince(60 * 60 * 1000, null), 1, 'a well-formed unknown code is counted');

  const without = await request(s);
  assert.equal(without.status, 201);
  assert.equal(without.body.data.prepaid, undefined);
});
