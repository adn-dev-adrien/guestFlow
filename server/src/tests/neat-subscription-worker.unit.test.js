/**
 * specs/neat-cancellation-insurance-subscription.md §3.2 rules 9-11 — the subscription worker.
 *
 * price → subscribe flow and its dto, externalId idempotency (adoption), the backoff ladder, the
 * « à corriger » 400 label, the push on first failure + 24 h throttle, and staging/production
 * payload isolation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildModel, retryDelayMs } = require('../models/neatSubscriptionsModel');
const { runNeatSubscriptionPass, externalIdFor } = require('../utils/neatSubscriptionRunner');
const {
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
} = require('./neatFixtures');

const NOW_ISO = '2027-06-01T10:00:00Z';
const NOW = () => new Date(NOW_ISO);

async function pass(db, model, { settings = fakeNeatSettings(), clientFactory = fakeNeatClientFactory(), push = fakePushService(), now = NOW } = {}) {
  const summary = await runNeatSubscriptionPass({
    db, settingsModel: settings, model, buildClient: clientFactory, pushService: push, now, logger: silentLogger,
  }, 'test');
  return { summary, push, clientFactory };
}

test('the flow prices then subscribes with the mapped fields, the customer, the payment context and the externalId', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db); // 3 nights
  const clientFactory = fakeNeatClientFactory({ priceAmount: 17.5, subscribeId: 'sub-42' });
  await pass(db, model, { clientFactory });

  assert.deepEqual(clientFactory.calls.price[0].payload.serviceFieldValues, [{ id: 'f-nights', type: 'number', value: 3 }]);
  const dto = clientFactory.calls.subscribe[0].dto;
  assert.equal(dto.salesChannelId, 'ch-1');
  assert.equal(dto.totalAmount, 17.5, 'totalAmount is Neat’s own priced premium');
  assert.deepEqual(dto.paymentContext, { method: 'Cash', paymentMethodId: 'pm-1' });
  assert.equal(dto.externalId, `staging-guestflow-${id}`);
  assert.equal(dto.customers[0].firstName, 'Jeanne');
  assert.equal(dto.customers[0].email, 'jeanne@x.fr');

  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.status, 'active');
  assert.equal(job.neatSubscriptionId, 'sub-42');
  assert.equal(job.premiumAmount, 17.5);
  assert.equal(job.billedAmount, 9, 'the guest-side line (3 €/nuit × 3) rides along for the drift display');
  db.close();
});

test('externalId idempotency: a live Neat subscription is adopted, never duplicated', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  const clientFactory = fakeNeatClientFactory({ existing: { id: 'sub-old', status: 'active', amountInclTax: 16 } });
  await pass(db, model, { clientFactory });
  assert.equal(clientFactory.calls.subscribe.length, 0, 'no second subscription');
  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.status, 'active');
  assert.equal(job.neatSubscriptionId, 'sub-old');
  assert.equal(job.premiumAmount, 16);
  db.close();
});

test('a voided/refunded remote subscription is NOT adopted — a fresh one is created', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  const clientFactory = fakeNeatClientFactory({ existing: { id: 'sub-dead', status: 'voided' }, subscribeId: 'sub-new' });
  await pass(db, model, { clientFactory });
  assert.equal(model.getByReservationId(id, 'staging').neatSubscriptionId, 'sub-new');
  db.close();
});

test('a failure schedules the backoff ladder: 1 min, 5 min, 30 min, 2 h, then 6 h', async () => {
  assert.equal(retryDelayMs(1), 60 * 1000);
  assert.equal(retryDelayMs(2), 5 * 60 * 1000);
  assert.equal(retryDelayMs(3), 30 * 60 * 1000);
  assert.equal(retryDelayMs(4), 2 * 60 * 60 * 1000);
  assert.equal(retryDelayMs(5), 6 * 60 * 60 * 1000);
  assert.equal(retryDelayMs(12), 6 * 60 * 60 * 1000, 'the ladder flattens, it never gives up');

  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  const boom = Object.assign(new Error('Neat unreachable'), { status: 503 });
  await pass(db, model, { clientFactory: fakeNeatClientFactory({ failWith: boom }) });
  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);
  assert.equal(job.errorKind, 'unavailable');
  assert.equal(job.nextAttemptAt, new Date(NOW().getTime() + 60 * 1000).toISOString());
  assert.match(job.lastError, /Neat unreachable/);
  db.close();
});

test('a job is not retried before its nextAttemptAt, and is after it', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  const boom = Object.assign(new Error('down'), { status: 503 });
  await pass(db, model, { clientFactory: fakeNeatClientFactory({ failWith: boom }) });

  const tooSoon = fakeNeatClientFactory();
  await pass(db, model, { clientFactory: tooSoon, now: () => new Date(NOW().getTime() + 30 * 1000) });
  assert.equal(tooSoon.calls.subscribe.length, 0, '30 s < the 1 min ladder step');

  const due = fakeNeatClientFactory();
  await pass(db, model, { clientFactory: due, now: () => new Date(NOW().getTime() + 2 * 60 * 1000) });
  assert.equal(model.getByReservationId(id, 'staging').status, 'active');
  db.close();
});

test('a Neat 400 is labelled « validation » (à corriger) and still retried later', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  const rejected = Object.assign(new Error('customers: birthdate is required'), { status: 400 });
  await pass(db, model, { clientFactory: fakeNeatClientFactory({ failWith: rejected }) });
  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.errorKind, 'validation');
  assert.ok(job.nextAttemptAt, 'the retry ladder still runs — the fix is an operator act the next attempt picks up');
  db.close();
});

test('push on the first failure, throttled to once per 24 h, reset on a new failure after the window', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  insertReservation(db);
  const boom = Object.assign(new Error('down'), { status: 503 });

  const first = await pass(db, model, { clientFactory: fakeNeatClientFactory({ failWith: boom }) });
  assert.equal(first.push.sent.length, 1);
  assert.equal(first.push.sent[0].prefKey, 'neat');
  assert.match(first.push.sent[0].payload.title, /Souscription Neat en échec/);
  assert.match(first.push.sent[0].payload.body, /Jeanne Durand/);

  // 2 minutes later (job due again, still failing): no second push inside the 24 h window.
  const second = await pass(db, model, {
    clientFactory: fakeNeatClientFactory({ failWith: boom }),
    now: () => new Date(NOW().getTime() + 2 * 60 * 1000),
  });
  assert.equal(second.push.sent.length, 0);

  // 25 h later: the throttle re-opens.
  const third = await pass(db, model, {
    clientFactory: fakeNeatClientFactory({ failWith: boom }),
    now: () => new Date(NOW().getTime() + 25 * 60 * 60 * 1000),
  });
  assert.equal(third.push.sent.length, 1);
  db.close();
});

test('externalIdFor: staging is prefixed, production is not', () => {
  assert.equal(externalIdFor('staging', 42), 'staging-guestflow-42');
  assert.equal(externalIdFor('production', 42), 'guestflow-42');
});

test('a subscription success clears the failure state (lastError, errorKind, nextAttemptAt)', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  const boom = Object.assign(new Error('down'), { status: 503 });
  await pass(db, model, { clientFactory: fakeNeatClientFactory({ failWith: boom }) });
  await pass(db, model, { now: () => new Date(NOW().getTime() + 2 * 60 * 1000) });
  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.status, 'active');
  assert.equal(job.lastError, null);
  assert.equal(job.errorKind, null);
  assert.equal(job.nextAttemptAt, null);
  db.close();
});
