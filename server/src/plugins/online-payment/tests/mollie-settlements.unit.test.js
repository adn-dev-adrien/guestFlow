// specs/mollie-rolling-reserve-and-incoming-payments.md rules 10 and 14-17 — what Mollie says about a settlement, read-only,
// and what the reconciliation does when Mollie cannot be read. No network: the client takes an injected `fetch`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMollieClient, explainError, readSettlement, centsOf } = require('../mollieClient');
const { settlementReferenceOf, pairPayment, createSettlementsModel, syncSettlements, isMollieCredit } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createMollieConnection } = require('../mollieConnection');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const TOKEN = 'access_FAKE_TOKEN_FOR_TESTS';
const SETTLED_AT = `${dayAt(-7)}T05:00:00+00:00`;
const PAID_AT = `${dayAt(-11)}T17:10:00+00:00`;
const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), headers: { get: () => null } });

// A fetch that answers from a table of path → response, and remembers what it was asked.
function fakeFetch(table) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const path = String(url).replace('https://mollie.test', '');
    const hit = Object.entries(table).find(([k]) => path.startsWith(k));
    return hit ? hit[1] : json(404, { detail: 'not found' });
  };
  return { fetchImpl, calls };
}
const client = (table) => {
  const f = fakeFetch(table);
  process.env.MOLLIE_API_BASE = 'https://mollie.test';
  return { calls: f.calls, client: buildMollieClient({ token: TOKEN, fetchImpl: f.fetchImpl, retry: { maxAttempts: 1 } }) };
};
test.afterEach(() => { delete process.env.MOLLIE_API_BASE; });

const SETTLEMENT = {
  id: 'stl_a1', reference: 'T19274230.2611.01', settledAt: SETTLED_AT, amount: { value: '11.20', currency: 'EUR' },
  periods: { 2026: { '11': { revenue: [{ description: 'Cartes', method: 'creditcard', amountGross: { value: '14.00' } }], costs: [
    { description: 'Frais', method: 'creditcard', amountGross: { value: '0.45' } },
    { description: 'Retenue', method: 'rollingreserve', amountGross: { value: '-2.80' } },
    { description: 'Libération', method: 'rollingreserve', amountGross: { value: '39.36' } },
  ] } } },
};

test('rule 16 — the reference of a Qonto credit names the settlement: « REF T… » without its prefix', () => {
  assert.equal(settlementReferenceOf({ reference: 'REF T19274230.2611.01' }), 'T19274230.2611.01');
  assert.equal(settlementReferenceOf({ reference: 'T19274230.2512.01' }), 'T19274230.2512.01');
  assert.equal(settlementReferenceOf({ reference: 'Paiements-En-Personne-12-10-2026' }), null);
  assert.equal(isMollieCredit({ counterpartyName: 'Stichting Mollie Payments' }), true);
});

test('rule 16 — the read-only client asks Mollie for the settlement by reference, its payments, its costs and its reserve lines', async () => {
  const { client: mollie, calls } = client({
    '/v2/settlements/T19274230.2611.01': json(200, SETTLEMENT),
    '/v2/settlements/stl_a1/payments': json(200, { _embedded: { payments: [
      { id: 'tr_1', amount: { value: '14.00' }, amountRefunded: { value: '0.00' }, description: 'F-2026-013', paidAt: PAID_AT, settlementId: 'stl_a1', metadata: null },
    ] }, _links: { next: null } }),
  });
  const settlement = await mollie.getSettlement('T19274230.2611.01');
  assert.deepEqual(settlement, { id: 'stl_a1', reference: 'T19274230.2611.01', settledAt: SETTLED_AT, amountCents: 1120, costsCents: 45, reserveHeldCents: 280, reserveReleasedCents: 3936 });
  const payments = await mollie.listSettlementPayments('stl_a1', { profileId: 'pfl_x' });
  assert.deepEqual(payments, [{ id: 'tr_1', amountCents: 1400, refundedCents: 0, description: 'F-2026-013', paidAt: PAID_AT, settlementId: 'stl_a1', paymentLinkId: null }]);
  assert.ok(calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}`));
  assert.ok(calls.every((c) => !String(c.url).includes(TOKEN)), 'the token travels in a header only');
  assert.match(calls[1].url, /profileId=pfl_x/);
});

test('rule 16 — Mollie\'s payment is attached to GuestFlow, first match wins: payment id, link id, invoice number, then amount and time', () => {
  const links = [
    { id: 1, providerPaymentId: 'a1b2c3', providerLinkId: 'LINK-1', amountCents: 73240, paidAt: `${dayAt(-21)} 16:00:00` },
    { id: 2, providerPaymentId: 'zz', providerLinkId: 'LINK-2', amountCents: 19680, paidAt: `${dayAt(-330)} 10:00:00` },
    { id: 3, providerPaymentId: 'yy', providerLinkId: 'LINK-3', amountCents: 5000, paidAt: `${dayAt(-15)} 10:00:00` },
  ];
  const payment = (over) => ({ id: 'tr_x', amountCents: 100, description: '', paidAt: null, paymentLinkId: null, ...over });
  assert.deepEqual(pairPayment(payment({ description: 'a1b2c3' }), links), { kind: 'link', paymentLinkId: '1' });
  assert.deepEqual(pairPayment(payment({ description: 'F-2025-016', paymentLinkId: 'LINK-2' }), links), { kind: 'link', paymentLinkId: '2' }, 'the 2025 link carried metadata.payment_link_id');
  assert.deepEqual(pairPayment(payment({ description: 'a1b2c3', paymentLinkId: 'LINK-2' }), links), { kind: 'link', paymentLinkId: '1' }, 'the description wins over the metadata');
  assert.deepEqual(pairPayment(payment({ description: 'F-2026-013' }), links, new Set(['F-2026-013'])), { kind: 'sale' });
  assert.deepEqual(pairPayment(payment({ amountCents: 5000, paidAt: `${dayAt(-15)}T10:05:00Z` }), links), { kind: 'link', paymentLinkId: '3' }, 'same amount, within 10 minutes');
  assert.equal(pairPayment(payment({ amountCents: 5000, paidAt: `${dayAt(-15)}T11:05:00Z` }), links), null, 'an hour away is no match');
  assert.equal(pairPayment(payment({ amountCents: 5000, paidAt: `${dayAt(-15)}T10:05:00Z` }), [...links, { ...links[2], id: 4, providerPaymentId: 'ww', providerLinkId: 'LINK-4' }]), null, 'two links at that moment: no guess');
});

test('rule 16 — a settlement is read once: its payments are attached to their links and stored, a second read finds nothing new', async () => {
  const { link } = paidStay({ cents: 1400, daysAgo: 8, providerPaymentId: 'qonto-pay-1' });
  const settlements = createSettlementsModel(db);
  const splits = createSplitsModel(db);
  splits.sync({ settings: { get: (k) => ({ reconciliationStartDate: dayAt(-60) }[k] || '') } });
  const { client: mollie, calls } = client({
    '/v2/settlements/T19274230.2611.01': json(200, SETTLEMENT),
    '/v2/settlements/stl_a1/payments': json(200, { _embedded: { payments: [
      { id: 'tr_9', amount: { value: '14.00' }, amountRefunded: { value: '2.00' }, description: 'qonto-pay-1', paidAt: PAID_AT },
    ] } }),
  });
  const credits = [mollieCredit('c1', 1120, 4, { reference: 'REF T19274230.2611.01' })];
  const links = db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all();
  const first = await syncSettlements({ client: mollie, model: settlements, splits, credits, links });
  assert.deepEqual(first, { read: 1, unknownPayments: 0 });
  assert.equal(splits.forLink(link.id).molliePaymentId, 'tr_9');
  assert.equal(splits.forLink(link.id).refundedCents, 200, 'what Mollie says was refunded');
  const detail = settlements.byReference().get('T19274230.2611.01');
  assert.equal(detail.costsCents, 45);
  assert.equal(detail.payments[0].paymentLinkId, String(link.id));
  const callsAfterFirst = calls.length;
  assert.deepEqual(await syncSettlements({ client: mollie, model: settlements, splits, credits, links }), { read: 0, unknownPayments: 0 });
  assert.equal(calls.length, callsAfterFirst, 'nothing is asked twice');
});

test('rule 16 — a payment paired with a Qonto invoice number is known (stored as a sale), a payment nobody knows is counted', async () => {
  const settlements = createSettlementsModel(db);
  const { client: mollie } = client({
    '/v2/settlements/T19274230.2611.07': json(200, { id: 'stl_b2', reference: 'T19274230.2611.07', amount: { value: '25.00' } }),
    '/v2/settlements/stl_b2/payments': json(200, { _embedded: { payments: [
      { id: 'tr_sale', amount: { value: '14.00' }, description: 'F-2026-013' },
      { id: 'tr_who', amount: { value: '11.00' }, description: 'unknown' },
    ] } }),
  });
  const credits = [mollieCredit('c1', 2000, 4, { reference: 'REF T19274230.2611.07' })];
  const result = await syncSettlements({ client: mollie, model: settlements, splits: createSplitsModel(db), credits, links: [], invoiceNumbers: new Set(['F-2026-013']) });
  assert.deepEqual(result, { read: 1, unknownPayments: 1 });
  assert.deepEqual(settlements.byReference().get('T19274230.2611.07').payments.map((p) => p.paymentLinkId).sort(), [null, 'sale:F-2026-013']);
});

test('rule 17 — a Mollie failure never blocks the reconciliation: the error is kept in words, the amounts rule still applies', async () => {
  paidStay({ cents: 10000, daysAgo: 6 });
  const store = new Map([['mollieAccessToken', TOKEN]]);
  const settings = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  const connection = createMollieConnection({
    settings, db, settlements: createSettlementsModel(db),
    buildClient: () => ({ getSettlement: async () => { const err = new Error('boom'); err.status = 403; err.body = { detail: 'This API endpoint is only available with an access token not restricted to a specific profile' }; throw err; } }),
  });
  const { controller, transactions } = build({ startDate: dayAt(-60), mollie: connection });
  transactions.upsertMany([mollieCredit('c1', 8000, 1)], { bankAccountId: 'acc-1' });
  const answer = await controller.readNow();
  assert.equal(answer.status, 200, 'the page is still answered');
  const reconciled = controller.list({ view: 'done' }).body.items.find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(reconciled.state, 'reconciled', 'rule 9 applied: the certain match confirmed itself');
  assert.equal(reconciled.bank[0].auto, true);
  assert.equal(JSON.parse(store.get('mollieLastError')).message, 'Ce jeton est limité à un profil : le recréer sans restriction de profil pour lire les règlements');
  assert.equal(answer.body.mollie.lastError.message, 'Ce jeton est limité à un profil : le recréer sans restriction de profil pour lire les règlements');
  assert.ok(!JSON.stringify(answer.body).includes(TOKEN));
});

test('rule 15 — Mollie\'s failures are worded: refused token, restricted profile, missing right, down, slow', () => {
  const failure = (status, detail = '', code) => explainError({ status, body: { detail }, code });
  assert.match(failure(401), /invalide ou révoqué/);
  assert.equal(failure(403, 'This API endpoint is only available with an access token not restricted to a specific profile'), 'Ce jeton est limité à un profil : le recréer sans restriction de profil pour lire les règlements');
  assert.match(failure(403, 'Missing scope'), /droits de lecture/);
  assert.match(failure(429), /limite les appels/);
  assert.match(failure(503), /ne répond pas correctement/);
  assert.match(explainError({ code: 'ETIMEDOUT' }), /ne répond pas/);
  assert.match(explainError(new Error(TOKEN)), /injoignable/);
  assert.ok(!explainError(new Error(TOKEN)).includes(TOKEN), 'the token never reaches a message');
});

test('rule 16 — amounts are read to the cent from Mollie\'s decimal strings', () => {
  assert.equal(centsOf({ value: '732.40' }), 73240);
  assert.equal(centsOf({ value: '0.446' }), 45);
  assert.equal(centsOf(null), 0);
  assert.deepEqual(readSettlement({ id: 's', reference: 'r', amount: { value: '1.00' } }), { id: 's', reference: 'r', settledAt: null, amountCents: 100, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0 });
});
