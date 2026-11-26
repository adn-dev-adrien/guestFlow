// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 6, 16 and 17 — the read of Mollie's settlements survives one
// bad reference, reads again what it could not name, refreshes refunds, sums costs without rounding drift and never
// follows a link off Mollie's own origin. No network: fakes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMollieClient, readSettlement } = require('../mollieClient');
const { createSettlementsModel, syncSettlements } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createMollieConnection } = require('../mollieConnection');
const { db, dayAt, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });
test.afterEach(() => { delete process.env.MOLLIE_API_BASE; });

const START = dayAt(-140);
const settings = { get: (k) => ({ reconciliationStartDate: START }[k] || '') };
const amount = (value) => ({ value, currency: 'EUR' });
const found = (id, reference) => ({ id, reference, settledAt: null, amountCents: 0, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0 });
const notFound = () => { const err = new Error('nope'); err.status = 404; return err; };
const linksNow = () => db.prepare("SELECT * FROM payment_links WHERE status = 'paid'").all();

test('rule 17 — a reference Mollie does not know does not stop the others: it is kept, with a delay before it is asked again', async () => {
  const asked = [];
  const mollie = {
    getSettlement: async (reference) => { asked.push(reference); if (reference.endsWith('.01')) throw notFound(); return found('stl_ok', reference); },
    listSettlementPayments: async () => [],
  };
  const model = createSettlementsModel(db);
  const credits = [mollieCredit('c1', 100, 5, { reference: 'REF T19274230.2611.01' }), mollieCredit('c2', 200, 4, { reference: 'REF T19274230.2611.02' })];
  const splits = createSplitsModel(db);
  const now = new Date();
  const first = await syncSettlements({ client: mollie, model, splits, credits, links: [], now });
  assert.equal(first.read, 1, 'the good reference after the bad one is read');
  assert.deepEqual(first.failed, [{ reference: '19274230.2611.01', message: 'Mollie ne trouve pas cet élément.' }]);
  assert.equal(model.hasReference('19274230.2611.02'), true);
  assert.equal(model.failures().length, 1);

  asked.length = 0;
  await syncSettlements({ client: mollie, model, splits, credits, links: [], now: new Date(now.getTime() + 30 * 60 * 1000) });
  assert.deepEqual(asked, [], 'within the hour nothing is asked again, the failed reference included');
  await syncSettlements({ client: mollie, model, splits, credits, links: [], now: new Date(now.getTime() + 25 * 3600 * 1000) });
  assert.ok(asked.includes('19274230.2611.01'), 'after 24 h the failed reference is asked again');
});

test('rule 17 — the card says how many settlements could not be read, and the readable ones are kept', async () => {
  const store = new Map([['mollieAccessToken', 'access_FAKE']]);
  const connection = createMollieConnection({
    settings: { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) }, db, settlements: createSettlementsModel(db),
    buildClient: () => ({
      getSettlement: async (reference) => { if (!reference.endsWith('.02')) throw notFound(); return found('stl_ok', reference); },
      listSettlementPayments: async () => [],
    }),
  });
  const credits = [mollieCredit('c1', 100, 5, { reference: 'REF T19274230.2611.01' }), mollieCredit('c2', 200, 4, { reference: 'REF T19274230.2611.02' })];
  const answer = await connection.sync({ credits, splits: createSplitsModel(db) });
  assert.equal(answer.ok, false);
  assert.equal(answer.read, 1);
  assert.match(JSON.parse(store.get('mollieLastError')).message, /^Règlement 19274230\.2611\.01 : Mollie ne trouve pas cet élément\.$/);
  assert.equal(connection.status().settlements, 1);
});

test('rule 16 — a payment GuestFlow could not name is read again once its source exists: the sale typed later is paired', async () => {
  const model = createSettlementsModel(db);
  const splits = createSplitsModel(db);
  const mollie = {
    getSettlement: async (reference) => found('stl_late', reference),
    listSettlementPayments: async () => [{ id: 'tr_late', amountCents: 5000, refundedCents: 0, description: 'qonto-late', paidAt: null, paymentLinkId: null }],
  };
  const credits = [mollieCredit('c1', 4000, 3, { reference: 'REF T19274230.2611.03' })];
  const now = new Date();
  const first = await syncSettlements({ client: mollie, model, splits, credits, links: linksNow(), now });
  assert.equal(first.unknownPayments, 1);

  const { link } = paidStay({ cents: 5000, daysAgo: 3, providerPaymentId: 'qonto-late' });
  splits.sync({ settings });
  const second = await syncSettlements({ client: mollie, model, splits, credits, links: linksNow(), now: new Date(now.getTime() + 2 * 3600 * 1000) });
  assert.equal(second.read, 1, 'the stored settlement is read again');
  assert.equal(second.unknownPayments, 0);
  assert.equal(model.byReference().get('19274230.2611.03').payments[0].splitId, `link:${link.id}`);
  assert.equal(splits.forLink(link.id).molliePaymentId, 'tr_late');
});

test('rule 6 — the refund Mollie records after the first read reaches a split whose reserve is still held', async () => {
  const { link } = paidStay({ cents: 10000, daysAgo: 10, providerPaymentId: 'qonto-ref' });
  const splits = createSplitsModel(db);
  splits.sync({ settings });
  splits.setMolliePayment('link', String(link.id), 'tr_ref');
  const mollie = { getSettlement: async () => { throw new Error('unused'); }, getPayment: async () => ({ id: 'tr_ref', refundedCents: 700 }) };
  await syncSettlements({ client: mollie, model: createSettlementsModel(db), splits, credits: [], links: linksNow() });
  assert.equal(splits.forLink(link.id).refundedCents, 700);
});

test('rule 5 — settlement costs are summed as Mollie writes them and rounded once: 0,125 and −0,125 are nothing', () => {
  const card = (value) => ({ description: 'Cards', method: 'creditcard', amountGross: amount(value) });
  const read = (costs) => readSettlement({ id: 's', reference: 'r', amount: amount('1.00'), periods: { 2026: { 11: { revenue: [], costs } } } });
  assert.equal(read([card('0.125'), { description: 'Fee Discount', method: null, amountGross: amount('-0.125') }]).costsCents, 0);
  assert.equal(read([card('0.125'), card('0.125')]).costsCents, 25);
  assert.equal(Object.is(read([card('0.125'), card('-0.125')]).costsCents, 0), true, 'a plain zero');
});

test('rule 16 — a next page is followed only on Mollie\'s own origin: the token never goes to another host', async () => {
  process.env.MOLLIE_API_BASE = 'https://mollie.test';
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const body = String(url).startsWith('https://mollie.test/v2/profiles')
      ? { _embedded: { profiles: [{ id: 'pfl_1', name: 'A', mode: 'live' }] }, _links: { next: { href: 'https://evil.test/v2/profiles?from=2' } } }
      : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => null } };
  };
  const client = buildMollieClient({ token: 'access_FAKE', fetchImpl, retry: { maxAttempts: 1 } });
  const profiles = await client.listProfiles();
  assert.equal(profiles.length, 1);
  assert.deepEqual(urls.filter((u) => !u.startsWith('https://mollie.test')), [], 'nothing was sent off the Mollie origin');
});

test('rule 15 — « Tester » with a token typed but not saved never stores the profile it found', async () => {
  const store = new Map();
  const connection = createMollieConnection({
    settings: { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) }, db, settlements: createSettlementsModel(db),
    buildClient: () => ({ listSettlements: async () => [{ id: 'stl_1' }], listProfiles: async () => [{ id: 'pfl_typed', mode: 'live' }] }),
  });
  const typed = await connection.test({ token: 'access_TYPED' });
  assert.equal(typed.body.profileId, 'pfl_typed', 'the answer tells it');
  assert.equal(store.get('mollieProfileId'), undefined, 'but a token that is not the saved one stores nothing');
  store.set('mollieAccessToken', 'access_SAVED');
  await connection.test({});
  assert.equal(store.get('mollieProfileId'), 'pfl_typed', 'the saved token fills the profile');
});
