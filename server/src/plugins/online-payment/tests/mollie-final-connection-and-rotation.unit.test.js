// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 6, 16 and 17 — the card tells every settlement still cooling
// down; a network failure stops the pass instead of cooling every reference down; the refund refresh rotates; a stale
// settlement no credit names never blocks a re-read. No network: fakes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettlementsModel, syncSettlements } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createMollieConnection } = require('../mollieConnection');
const { db, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const found = (id, reference) => ({ id, reference, settledAt: null, amountCents: 0, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0 });
const status = (code) => { const err = new Error('x'); err.status = code; return err; };
const network = () => { const err = new Error('down'); err.code = 'ENETWORK'; return err; };

test('rule 17 — the card keeps telling a settlement still cooling down, on a pass that did not ask for it again', async () => {
  const store = new Map([['mollieAccessToken', 'access_FAKE']]);
  let clock = new Date();
  const connection = createMollieConnection({
    settings: { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) }, db, settlements: createSettlementsModel(db), now: () => clock,
    buildClient: () => ({ getSettlement: async (reference) => { if (reference.endsWith('.01')) throw status(404); return found('stl_ok', reference); }, listSettlementPayments: async () => [] }),
  });
  const credits = [mollieCredit('c1', 100, 5, { reference: 'REF T19274230.2611.01' })];
  const splits = createSplitsModel(db);
  await connection.sync({ credits, splits });
  assert.match(JSON.parse(store.get('mollieLastError')).message, /19274230\.2611\.01/);
  clock = new Date(clock.getTime() + 30 * 60 * 1000);
  const second = await connection.sync({ credits, splits });
  assert.equal(second.ok, false, 'nothing was asked, the settlement still cannot be read');
  assert.match(JSON.parse(store.get('mollieLastError')).message, /19274230\.2611\.01/);
});

test('rule 17 — a network failure stops the pass: no reference is put into a 24 h cooldown', async () => {
  const model = createSettlementsModel(db);
  const asked = [];
  const client = { getSettlement: async (reference) => { asked.push(reference); throw network(); }, listSettlementPayments: async () => [] };
  const credits = [mollieCredit('c1', 100, 5, { reference: 'REF T19274230.2611.01' }), mollieCredit('c2', 200, 4, { reference: 'REF T19274230.2611.02' })];
  const result = await syncSettlements({ client, model, splits: createSplitsModel(db), credits, links: [] });
  assert.equal(asked.length, 1, 'the second reference is not even asked');
  assert.deepEqual(model.failures(), []);
  assert.ok(result.interrupted);
});

test('rule 6 — the refund refresh rotates: payments not asked for the longest time go first', async () => {
  const splits = createSplitsModel(db);
  const stays = Array.from({ length: 12 }, (_, i) => paidStay({ cents: 10000, daysAgo: 30 - i, clientId: 1 }));
  splits.sync({ settings: { get: (k) => ({ reconciliationStartDate: '2020-01-01' }[k] || '') } });
  stays.forEach((s, i) => splits.setMolliePayment('link', s.link.id, `tr_${i}`));
  const asked = [];
  const client = { getSettlement: async (r) => found('s', r), listSettlementPayments: async () => [], getPayment: async (id) => { asked.push(id); return { refundedCents: 0 }; } };
  await syncSettlements({ client, model: createSettlementsModel(db), splits, credits: [], links: [] });
  assert.equal(asked.length, 10);
  asked.length = 0;
  await syncSettlements({ client, model: createSettlementsModel(db), splits, credits: [], links: [], now: new Date(Date.now() + 1000) });
  assert.ok(asked.includes('tr_10') && asked.includes('tr_11'), 'the two left out the first time come first');
});

test('rule 16 — a stale settlement no credit names does not take the place of one that can be read again', async () => {
  const model = createSettlementsModel(db);
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (let i = 0; i < 6; i += 1) model.store({ ...found(`stl_stale${i}`, `19274230.2601.0${i}`), source: 'payments' }, [], old);
  model.store({ ...found('stl_mine', '19274230.2611.09'), source: 'payments' }, [], new Date(old.getTime() + 1000));
  const asked = [];
  const client = { getSettlement: async (r) => { asked.push(r); return found('stl_mine', r); }, listSettlementPayments: async () => [] };
  await syncSettlements({ client, model, splits: createSplitsModel(db), credits: [mollieCredit('c1', 100, 5, { reference: 'REF T19274230.2611.09' })], links: [] });
  assert.deepEqual(asked, ['19274230.2611.09']);
});
