const test = require('node:test');
const assert = require('node:assert/strict');

const scheduler = require('../utils/emailAutoSendScheduler');

// specs/no-automatic-email-without-approval.md §3 rule 2b — while automatic sending is off, no timer
// is registered at all: the switch ships off, and a feature nobody turned on must not tick. Turning
// it on starts the timer AND runs the day's pass, without a restart.

function at(year, month, day, hour) {
  return new Date(year, month - 1, day, hour, 0, 0);
}

const settingsOn = { emailAutoSendEnabled: () => true };
const settingsOff = { emailAutoSendEnabled: () => false };

const SENT = { sentCount: 1, skippedCount: 0, failedCount: 0, results: [] };
const BLOCKED = { blocked: true, sentCount: 0, skippedCount: 0, failedCount: 0, results: [] };

function captureLog(fn) {
  const lines = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => lines.push(args.join(' '));
  console.warn = (...args) => lines.push(args.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.log = originalLog; console.warn = originalWarn; })
    .then(() => lines);
}

// Lets the tick's promise chain run to completion (start() fires it without awaiting).
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Each test uses its own fake day: the module's once-per-day guard is keyed by local date, so
// distinct dates keep the cases independent without reaching into the module's state.

test('switch off at boot: nothing is scheduled and no pass runs', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(SENT); };

  const changed = scheduler.syncWithSettings({
    boot: true, settingsModel: settingsOff, now: at(2026, 4, 1, 9), run,
  });
  await settle();

  assert.equal(changed, false, 'nothing to stop — there was no timer');
  assert.equal(scheduler.isRunning(), false);
  assert.equal(runs, 0);
});

test('switch on at boot: the timer is registered, the first pass waits for the boot delay', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(SENT); };

  try {
    const changed = scheduler.syncWithSettings({
      boot: true, settingsModel: settingsOn, now: at(2026, 4, 2, 9), run,
    });
    await settle();

    assert.equal(changed, true);
    assert.equal(scheduler.isRunning(), true);
    assert.equal(runs, 0, 'boot staggers the first tick — it must not run inside startScheduledTasks');
  } finally {
    scheduler.stop();
  }
});

test('authorising mid-day starts the timer and runs the day\'s pass straight away', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(SENT); };

  try {
    scheduler.syncWithSettings({ settingsModel: settingsOn, now: at(2026, 4, 3, 14), run });
    await settle();

    assert.equal(scheduler.isRunning(), true);
    assert.equal(runs, 1, 'today\'s templates no longer match tomorrow — the catch-up is the point');
  } finally {
    scheduler.stop();
  }
});

test('a second sync while already running neither duplicates the timer nor re-runs the pass', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(SENT); };

  try {
    scheduler.syncWithSettings({ settingsModel: settingsOn, now: at(2026, 4, 4, 14), run });
    await settle();
    const changed = scheduler.syncWithSettings({ settingsModel: settingsOn, now: at(2026, 4, 4, 15), run });
    await settle();

    assert.equal(changed, false, 'already running → no-op');
    assert.equal(runs, 1);
  } finally {
    scheduler.stop();
  }
});

test('revoking the authorisation clears the timer', async () => {
  const run = () => Promise.resolve(SENT);

  scheduler.syncWithSettings({ settingsModel: settingsOn, now: at(2026, 4, 5, 14), run });
  await settle();
  assert.equal(scheduler.isRunning(), true);

  const lines = await captureLog(async () => {
    const changed = scheduler.syncWithSettings({ settingsModel: settingsOff, now: at(2026, 4, 5, 15), run });
    await settle();
    assert.equal(changed, true);
  });

  assert.equal(scheduler.isRunning(), false);
  assert.equal(lines.filter((l) => l.includes('aucune passe planifiée')).length, 1);
});

test('the pass runs once per local day, and never before 08:00', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(SENT); };

  await scheduler.tick({ now: at(2026, 4, 6, 7), run });
  assert.equal(runs, 0, 'before 08:00 the tick does nothing at all');

  await scheduler.tick({ now: at(2026, 4, 6, 8), run });
  await scheduler.tick({ now: at(2026, 4, 6, 9), run });
  assert.equal(runs, 1, 'the day\'s slot is consumed by the first pass');

  await scheduler.tick({ now: at(2026, 4, 7, 8), run });
  assert.equal(runs, 2, 'the next local day runs again');
});

test('a blocked pass gives the day back and shuts the scheduler down', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(BLOCKED); };

  try {
    scheduler.syncWithSettings({ settingsModel: settingsOn, now: at(2026, 4, 8, 9), run });
    await settle();

    assert.equal(runs, 1);
    assert.equal(scheduler.isRunning(), false, 'the switch and the timer went out of step — resync by stopping');

    // The day was not consumed: re-authorising later the same day still runs today's pass.
    scheduler.syncWithSettings({ settingsModel: settingsOn, now: at(2026, 4, 8, 11), run: () => Promise.resolve(SENT) });
    await settle();
    assert.equal(scheduler.isRunning(), true);
  } finally {
    scheduler.stop();
  }
});
