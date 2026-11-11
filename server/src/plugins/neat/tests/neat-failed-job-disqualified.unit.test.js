/**
 * specs/neat-cancellation-insurance-subscription.md §3.2 rule 16 — a FAILED job (Neat was down,
 * the backoff ladder keeps retrying it) whose reservation stops qualifying is dropped like a
 * pending one, so its retry never prices and subscribes a paid policy for a stay that no longer
 * wants it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildModel } = require('../subscriptionsModel');
const { runNeatSubscriptionPass } = require('../subscriptionRunner');
const {
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
} = require('./neatFixtures');

const NOW = () => new Date('2027-06-01T10:00:00Z');

require('../../../utils/platformNameFormat').setDirectChannels(['lodgify']);

function failedJob(model, reservationId) {
  const job = model.enqueue(reservationId, 'staging', `staging-guestflow-${reservationId}`);
  // nextAttemptAt lands in the past: the job is due for its retry on this pass.
  model.markFailedAttempt(job.id, { error: 'Neat 503', errorKind: 'transient', nowMs: Date.parse('2027-05-01T00:00:00Z') });
  assert.equal(model.getByReservationId(reservationId, 'staging').status, 'failed');
}

function pass(db, model, clientFactory) {
  return runNeatSubscriptionPass({
    db, settingsModel: fakeNeatSettings(), model, buildClient: clientFactory,
    pushService: fakePushService(), now: NOW, logger: silentLogger,
  }, 'test');
}

const DISQUALIFIERS = [
  ['the guest cancelled', (db, id) => db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id)],
  ['the insurance line was removed', (db, id) => db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(id)],
  ['the stay has started', (db, id) => db.prepare("UPDATE reservations SET startDate = '2027-05-30' WHERE id = ?").run(id)],
  ['the deposit is no longer paid', (db, id) => db.prepare('UPDATE reservations SET depositPaid = 0 WHERE id = ?').run(id)],
];

for (const [label, disqualify] of DISQUALIFIERS) {
  test(`a failed job is dropped, never retried, when ${label}`, async () => {
    const db = freshNeatDb();
    const model = buildModel(db);
    const id = insertReservation(db);
    failedJob(model, id);
    disqualify(db, id);
    const clientFactory = fakeNeatClientFactory();
    const summary = await pass(db, model, clientFactory);
    assert.equal(summary.dropped, 1);
    assert.equal(summary.subscribed, 0);
    assert.equal(clientFactory.calls.price.length, 0, 'no price call');
    assert.equal(clientFactory.calls.subscribe.length, 0, 'no paid policy issued');
    assert.equal(model.getByReservationId(id, 'staging'), null);
    db.close();
  });
}

test('a failed job whose reservation still qualifies is retried and subscribed', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const id = insertReservation(db);
  failedJob(model, id);
  const clientFactory = fakeNeatClientFactory();
  const summary = await pass(db, model, clientFactory);
  assert.equal(summary.dropped, 0);
  assert.equal(summary.subscribed, 1);
  assert.equal(model.getByReservationId(id, 'staging').status, 'active');
  db.close();
});
