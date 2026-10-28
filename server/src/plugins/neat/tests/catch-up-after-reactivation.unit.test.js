// specs/plugin-removal-resilience.md rule 17 — a stay that qualified for the insurance while the plugin was
// off (a deposit paid, a quote accepted) fired no event it could hear; the next pass subscribes it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildModel } = require('../subscriptionsModel');
const { runNeatSubscriptionPass } = require('../subscriptionRunner');
const {
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
} = require('./neatFixtures');

require('../../../utils/platformNameFormat').setDirectChannels(['lodgify']);

test('rule 17 — the pass after a reactivation subscribes the stays that qualified in the meantime', async () => {
  const db = freshNeatDb();
  const model = buildModel(db);
  const deps = {
    db, settingsModel: fakeNeatSettings(), model, buildClient: fakeNeatClientFactory(), pushService: fakePushService(), now: () => new Date('2027-06-01T10:00:00Z'), logger: silentLogger,
  };
  const id = insertReservation(db);
  assert.equal(model.getByReservationId(id, 'staging'), null, 'nothing ran while the plugin was off');
  const summary = await runNeatSubscriptionPass(deps, 'reactivation');
  assert.equal(summary.subscribed, 1);
  assert.equal(model.getByReservationId(id, 'staging').status, 'active');
  db.close();
});
