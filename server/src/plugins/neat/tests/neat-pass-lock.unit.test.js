/**
 * specs/plugins-phase-3b-neat.md rule 14 + specs/neat-cancellation-insurance-subscription.md rule 9 —
 * one subscription pass at a time, even across a purge. The purge drops the plugin's controller while
 * a pass may still be running; the controller rebuilt for the next kick must see that pass's lock,
 * or two passes would price and subscribe the same jobs concurrently.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNeatController } = require('../controller');
const { buildModel } = require('../subscriptionsModel');
const {
  freshNeatDb, fakeNeatSettings, insertReservation, fakeNeatClientFactory, fakePushService, silentLogger,
} = require('./neatFixtures');

require('../../../utils/platformNameFormat').setDirectChannels(['lodgify']);

// A Neat client whose first call hangs until `release()` — the pass stays in flight meanwhile.
function stalledClientFactory() {
  const inner = fakeNeatClientFactory();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const factory = (...args) => {
    const client = inner(...args);
    return {
      ...client,
      async getByExternalId(...callArgs) {
        await gate;
        return client.getByExternalId(...callArgs);
      },
    };
  };
  factory.calls = inner.calls;
  factory.release = () => release();
  return factory;
}

function controller(db, { passLock, clientFactory }) {
  return createNeatController({
    db, settingsModel: fakeNeatSettings(), model: buildModel(db), buildClient: clientFactory,
    pushService: fakePushService(), now: () => new Date('2027-06-01T10:00:00Z'), logger: silentLogger,
    passLock,
  });
}

test('a controller rebuilt after a purge skips its pass while the previous one still runs', async () => {
  const db = freshNeatDb();
  insertReservation(db);
  const passLock = { held: false };
  const clientFactory = stalledClientFactory();

  const before = controller(db, { passLock, clientFactory });
  const running = before.runPass('cron');
  assert.equal(passLock.held, true);

  const rebuilt = controller(db, { passLock, clientFactory });
  assert.deepEqual(await rebuilt.runPass('payment'), { skipped: 'in-progress' });

  clientFactory.release();
  const summary = await running;
  assert.equal(summary.subscribed, 1);
  assert.equal(clientFactory.calls.subscribe.length, 1, 'one policy, never two');
  assert.equal(passLock.held, false, 'the lock is released once the pass ends');

  const next = await rebuilt.runPass('cron');
  assert.notDeepEqual(next, { skipped: 'in-progress' });
  db.close();
});

test('the lock is released even when the pass throws', async () => {
  const db = freshNeatDb();
  const passLock = { held: false };
  const ctrl = createNeatController({
    db, settingsModel: fakeNeatSettings(), model: { findEligibleWithoutJob() { throw new Error('boom'); } },
    buildClient: fakeNeatClientFactory(), pushService: fakePushService(), logger: silentLogger, passLock,
  });
  await assert.rejects(ctrl.runPass('cron'));
  assert.equal(passLock.held, false);
  db.close();
});
