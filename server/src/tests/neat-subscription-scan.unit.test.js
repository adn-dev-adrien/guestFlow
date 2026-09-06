/**
 * specs/neat-cancellation-insurance-subscription.md §3.2 rules 7-8, 12, 16 — the eligibility scan.
 *
 * Insured + deposit-paid direct reservations are enqueued; platform / cancelled / started / unpaid
 * ones are not; an « offert » insurance still insures; the single-payment schedule counts through
 * depositDisabled + balancePaid; a pending job whose reservation stops qualifying is dropped; an
 * unconfigured integration is a silent no-op.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildModel } = require('../models/neatSubscriptionsModel');
const { runNeatSubscriptionPass } = require('../utils/neatSubscriptionRunner');
const {
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
} = require('./neatFixtures');

const NOW = () => new Date('2027-06-01T10:00:00Z');

function runPass(db, { settings = fakeNeatSettings(), clientFactory = fakeNeatClientFactory(), push = fakePushService() } = {}) {
  const model = buildModel(db);
  return {
    model,
    push,
    clientFactory,
    result: runNeatSubscriptionPass({
      db, settingsModel: settings, model, buildClient: clientFactory, pushService: push, now: NOW, logger: silentLogger,
    }, 'test'),
  };
}

test('an insured, deposit-paid, direct, future reservation is enqueued and subscribed', async () => {
  const db = freshNeatDb();
  const id = insertReservation(db);
  const { model, result } = runPass(db);
  const summary = await result;
  assert.equal(summary.enqueued, 1);
  assert.equal(summary.subscribed, 1);
  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.status, 'active');
  assert.equal(job.externalId, `staging-guestflow-${id}`);
  db.close();
});

test('an « offert » insurance still insures the guest — enqueued like a billed one', async () => {
  const db = freshNeatDb();
  const id = insertReservation(db, { insuranceOffered: 1 });
  const { model, result } = runPass(db);
  await result;
  const job = model.getByReservationId(id, 'staging');
  assert.equal(job.status, 'active');
  assert.equal(job.billedAmount, 0, 'the guest paid nothing; the coverage exists anyway');
  db.close();
});

test('a single-payment schedule qualifies through depositDisabled + balancePaid', async () => {
  const db = freshNeatDb();
  const paid = insertReservation(db, { depositPaid: 0, depositDisabled: 1, balancePaid: 1 });
  const unpaid = insertReservation(db, { depositPaid: 0, depositDisabled: 1, balancePaid: 0 });
  const { model, result } = runPass(db);
  await result;
  assert.equal(model.getByReservationId(paid, 'staging').status, 'active');
  assert.equal(model.getByReservationId(unpaid, 'staging'), null);
  db.close();
});

test('platform, cancelled, already-started, unpaid and uninsured reservations are never enqueued', async () => {
  const db = freshNeatDb();
  insertReservation(db, { platform: 'Airbnb' });
  insertReservation(db, { kind: 'cancelled' });
  insertReservation(db, { kind: 'devis' });
  insertReservation(db, { startDate: '2027-05-30', endDate: '2027-06-03' }); // started (today = 2027-06-01)
  insertReservation(db, { depositPaid: 0 });
  insertReservation(db, { insured: false });
  const { result } = runPass(db);
  const summary = await result;
  assert.equal(summary.enqueued, 0);
  db.close();
});

test('Lodgify counts as a direct channel (isDirectChannel is the single authority)', async () => {
  const db = freshNeatDb();
  const id = insertReservation(db, { platform: 'lodgify' });
  const { model, result } = runPass(db);
  await result;
  assert.equal(model.getByReservationId(id, 'staging').status, 'active');
  db.close();
});

test('an insurance line added AFTER the deposit was paid is picked up by the next pass', async () => {
  const db = freshNeatDb();
  const id = insertReservation(db, { insured: false });
  const first = runPass(db);
  assert.equal((await first.result).enqueued, 0);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, 10, 1, 3, 3, 'per_night', 9)`).run(id);
  const second = runPass(db);
  assert.equal((await second.result).enqueued, 1);
  db.close();
});

test('a pending job whose reservation stops qualifying is dropped; an active one is left alone', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const dropped = insertReservation(db);
  const kept = insertReservation(db);
  model.enqueue(dropped, 'staging', `staging-guestflow-${dropped}`);
  model.enqueue(kept, 'staging', `staging-guestflow-${kept}`);
  model.markActive(model.getByReservationId(kept, 'staging').id, { neatSubscriptionId: 'sub-k', premiumAmount: 17.5, billedAmount: 9 });
  // Both reservations lose their insurance line; only the PENDING job may disappear (rule 16).
  db.prepare('DELETE FROM reservation_options WHERE reservationId IN (?, ?)').run(dropped, kept);
  const { result } = runPass(db);
  const summary = await result;
  assert.equal(summary.dropped, 1);
  assert.equal(model.getByReservationId(dropped, 'staging'), null);
  assert.equal(model.getByReservationId(kept, 'staging').status, 'active');
  db.close();
});

test('unconfigured integration → silent no-op, existing jobs untouched (rule 12)', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  for (const overrides of [{ clientId: '' }, { contractId: '' }, { paymentMethodId: '' }, { fieldMappingJson: '' }]) {
    const summary = await runNeatSubscriptionPass({
      db, settingsModel: fakeNeatSettings(overrides), model,
      buildClient: fakeNeatClientFactory(), pushService: fakePushService(), now: NOW, logger: silentLogger,
    }, 'test');
    assert.deepEqual(summary, { skipped: 'unconfigured' }, JSON.stringify(overrides));
  }
  assert.equal(model.getByReservationId(id, 'staging').status, 'pending');
  db.close();
});

test('environments are isolated: a staging job never blocks a production enqueue (rule: env switch)', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  model.enqueue(id, 'staging', `staging-guestflow-${id}`);
  const { result } = runPass(db, { settings: fakeNeatSettings({ environment: 'production' }) });
  const summary = await result;
  assert.equal(summary.enqueued, 1);
  const prodJob = model.getByReservationId(id, 'production');
  assert.equal(prodJob.externalId, `guestflow-${id}`, 'no staging- prefix in production');
  assert.equal(model.getByReservationId(id, 'staging').status, 'pending', 'the staging-era job stays dead, untouched');
  db.close();
});
