const test = require('node:test');
const assert = require('node:assert/strict');

const { tickEmailAutoSend } = require('../scheduledTasks');

// specs/no-automatic-email-without-approval.md §3 rule 2 — while automatic sending is off, the
// per-minute tick keeps retrying the pass (so a mid-day authorisation takes effect the same day)
// but says so in the log only once per local day. Before this guard the line was printed on every
// retry: ~960 a day on a default installation, where the switch ships off.

function at(year, month, day, hour) {
  return new Date(year, month - 1, day, hour, 0, 0);
}

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.log = original; })
    .then(() => lines);
}

const BLOCKED = { blocked: true, sentCount: 0, skippedCount: 0, failedCount: 0, results: [] };

// Each test uses its own fake day: the module-level guards are keyed by local date, so distinct
// dates keep the cases independent without reaching into the module's state.

test('a blocked pass is announced once, however many times the tick retries it', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(BLOCKED); };

  const lines = await captureLog(async () => {
    for (const hour of [8, 9, 10, 17, 23]) {
      await tickEmailAutoSend({ now: at(2026, 3, 1, hour), run });
    }
  });

  assert.equal(runs, 5, 'the pass still runs on every tick — a mid-day authorisation must take effect');
  const announcements = lines.filter((l) => l.includes('envoi automatique désactivé'));
  assert.equal(announcements.length, 1, 'but the operator reads it once, not once per retry');
  assert.match(announcements[0], /^\[email-auto-send\] daily 08:00 pass: /);
});

test('the next local day announces again', async () => {
  const run = () => Promise.resolve(BLOCKED);

  const day1 = await captureLog(() => tickEmailAutoSend({ now: at(2026, 3, 2, 9), run }));
  const day2 = await captureLog(() => tickEmailAutoSend({ now: at(2026, 3, 3, 9), run }));

  assert.equal(day1.filter((l) => l.includes('envoi automatique désactivé')).length, 1);
  assert.equal(day2.filter((l) => l.includes('envoi automatique désactivé')).length, 1);
});

test('an authorised pass consumes the day: it runs once and prints no blocked line', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve({ sentCount: 0, skippedCount: 2, failedCount: 0, results: [] }); };

  const lines = await captureLog(async () => {
    await tickEmailAutoSend({ now: at(2026, 3, 4, 9), run });
    await tickEmailAutoSend({ now: at(2026, 3, 4, 10), run });
  });

  assert.equal(runs, 1, 'the slot is consumed by a pass that was allowed to run');
  assert.equal(lines.filter((l) => l.includes('envoi automatique désactivé')).length, 0);
});

test('before 08:00 the tick does nothing at all', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve(BLOCKED); };

  const lines = await captureLog(() => tickEmailAutoSend({ now: at(2026, 3, 5, 7), run }));

  assert.equal(runs, 0);
  assert.equal(lines.length, 0);
});
