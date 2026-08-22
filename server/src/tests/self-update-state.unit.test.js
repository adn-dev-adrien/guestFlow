const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createUpdateStateModel, concludeAbandonedSwap, notesForVersion } = require('../models/updateStateModel');
const { resolvePaths } = require('../utils/deploymentPaths');

// specs/self-update-and-releases.md §3.F + §5. This state is the only thing that survives the
// process being replaced mid-update, so it is also the only way the new instance can tell the user
// what happened to the old one.

function freshModel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-state-'));
  const model = createUpdateStateModel(resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') }));
  return { dir, model, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a missing state file reads as empty, never as an error', () => {
  const { model, cleanup } = freshModel();
  const state = model.readState();
  assert.equal(state.latestVersion, null);
  assert.deepEqual(state.history, []);
  assert.equal(model.readStatus().phase, 'idle');
  assert.equal(model.isLocked(), false);
  cleanup();
});

test('a corrupted state file reads as empty rather than throwing', () => {
  const { model, cleanup } = freshModel();
  fs.mkdirSync(path.dirname(model.paths.stateFile), { recursive: true });
  fs.writeFileSync(model.paths.stateFile, '{ this is not json');
  assert.equal(model.readState().latestVersion, null);
  cleanup();
});

test('recordCheck stores the release, its window, and clears both when GitHub reports none', () => {
  const { model, cleanup } = freshModel();
  const notes = [{ title: 'Ajouts', items: ['x'] }];
  model.recordCheck({
    release: { version: '1.2.0', publishedAt: '2026-08-20T10:00:00Z', notes },
    releases: [
      { version: '1.2.0', publishedAt: '2026-08-20T10:00:00Z', notes },
      { version: '1.1.0', publishedAt: '2026-08-19T10:00:00Z', notes: [{ title: 'Corrections', items: ['y'] }] },
    ],
    truncated: true,
  });
  let state = model.readState();
  assert.equal(state.latestVersion, '1.2.0');
  assert.deepEqual(state.releases.map((entry) => entry.version), ['1.2.0', '1.1.0']);
  assert.equal(notesForVersion(state, '1.1.0')[0].items[0], 'y');
  assert.equal(state.releasesTruncated, true);
  assert.ok(state.lastCheckAt);

  model.recordCheck(null);
  state = model.readState();
  assert.equal(state.latestVersion, null);
  assert.deepEqual(state.releases, []);
  assert.equal(state.releasesTruncated, false);
  cleanup();
});

test('the window is capped, so a long-lived state file cannot grow without bound', () => {
  const { model, cleanup } = freshModel();
  const releases = Array.from({ length: model.RELEASES_MAX + 5 }, (unused, index) => ({
    version: `1.${index}.0`, publishedAt: null, notes: [],
  }));
  model.recordCheck({ release: null, releases, truncated: true });
  assert.equal(model.readState().releases.length, model.RELEASES_MAX);
  cleanup();
});

test('the lock refuses a second update and is released explicitly', () => {
  const { model, cleanup } = freshModel();
  assert.equal(model.acquireLock('1.2.0'), true);
  assert.equal(model.acquireLock('1.2.0'), false, 'a second acquire must fail');
  assert.equal(model.isLocked(), true);
  model.releaseLock();
  assert.equal(model.isLocked(), false);
  assert.equal(model.acquireLock('1.2.0'), true);
  cleanup();
});

test('a lock older than 30 minutes is stale and no longer blocks', () => {
  const { model, cleanup } = freshModel();
  const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  assert.equal(model.isLockStale({ startedAt: old }), true);
  assert.equal(model.isLockStale({ startedAt: new Date().toISOString() }), false);
  assert.equal(model.isLockStale({}), true);
  assert.equal(model.isLockStale({ startedAt: 'not-a-date' }), true);
  assert.equal(model.isLockStale(null), true);
  cleanup();
});

test('history is newest-first and capped', () => {
  const { model, cleanup } = freshModel();
  for (let i = 1; i <= 7; i += 1) model.recordHistory({ to: `1.0.${i}`, result: 'done' });
  const { history } = model.readState();
  assert.equal(history.length, model.HISTORY_MAX);
  assert.equal(history[0].to, '1.0.7');
  cleanup();
});

test('reconcileOnBoot turns a finished update into exactly one history entry', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '1.0.0', targetVersion: '1.1.0', logFile: null });
  model.acquireLock('1.1.0');
  model.writeStatus({ phase: 'done' });

  const entry = model.reconcileOnBoot('1.1.0');
  assert.equal(entry.result, 'done');
  assert.equal(entry.from, '1.0.0');
  assert.equal(entry.to, '1.1.0');
  assert.equal(model.isLocked(), false, 'the lock of the dead process must be released');

  // A second boot must not duplicate the entry.
  assert.equal(model.reconcileOnBoot('1.1.0'), null);
  assert.equal(model.readState().history.length, 1);
  cleanup();
});

test('reconcileOnBoot records a rollback with its cause', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '1.0.0', targetVersion: '1.1.0', logFile: null });
  model.writeStatus({ phase: 'rolled_back', errorCode: 'HEALTHCHECK_TIMEOUT' });
  const entry = model.reconcileOnBoot('1.0.0');
  assert.equal(entry.result, 'rolled_back');
  assert.equal(entry.errorCode, 'HEALTHCHECK_TIMEOUT');
  assert.equal(entry.runningVersion, '1.0.0');
  cleanup();
});

test('reconcileOnBoot on a half-finished update drops the lock without inventing history', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '1.0.0', targetVersion: '1.1.0', logFile: null });
  model.acquireLock('1.1.0');
  model.writeStatus({ phase: 'installing' });

  assert.equal(model.reconcileOnBoot('1.0.0'), null);
  assert.equal(model.isLocked(), false);
  assert.deepEqual(model.readState().history, []);
  cleanup();
});

// specs/self-update-and-releases.md §3.E rules 28 + 30b — the 2026-08-20 production incident. PM2
// tree-kills the descendants of the process it restarts, and the swap helper is one of them: it died
// the instant it asked for the restart, leaving `restarting` in the status file forever. The overlay
// spun on that through every reload. The version that came up is the verdict the helper never wrote.

test('a boot on the target version concludes a swap the helper never reported', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '2.0.0', targetVersion: '2.1.0', logFile: null });
  model.acquireLock('2.1.0');
  model.writeStatus({ phase: 'restarting' });

  const entry = model.reconcileOnBoot('2.1.0');
  assert.equal(model.readStatus().phase, 'done', 'a stuck status is what keeps the overlay spinning');
  assert.equal(entry.result, 'done');
  assert.equal(entry.to, '2.1.0');
  assert.equal(model.isLocked(), false);
  cleanup();
});

test('a boot on the previous version, after a recorded failure, concludes the rollback', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '2.0.0', targetVersion: '2.1.0', logFile: null });
  model.writeStatus({ phase: 'swapping', errorCode: 'HEALTHCHECK_TIMEOUT' });

  const entry = model.reconcileOnBoot('2.0.0');
  assert.equal(model.readStatus().phase, 'rolled_back');
  assert.equal(entry.result, 'rolled_back');
  assert.equal(entry.errorCode, 'HEALTHCHECK_TIMEOUT');
  cleanup();
});

test('concludeAbandonedSwap stays silent on everything it cannot prove', () => {
  const base = { phase: 'restarting', fromVersion: '2.0.0', targetVersion: '2.1.0', errorCode: null };
  // The old version came back up with no failure recorded: the helper may still be mid-restart.
  assert.equal(concludeAbandonedSwap(base, '2.0.0'), null);
  // Staging phases never swapped anything.
  assert.equal(concludeAbandonedSwap({ ...base, phase: 'installing' }, '2.1.0'), null);
  // Already terminal: nothing to conclude, and no overwriting of a verdict already given.
  assert.equal(concludeAbandonedSwap({ ...base, phase: 'rolled_back' }, '2.1.0'), null);
  // A failure was recorded, so the target booting is NOT a success to declare.
  assert.equal(concludeAbandonedSwap({ ...base, phase: 'swapping', errorCode: 'PM2_FAILED' }, '2.1.0'), null);
  assert.equal(concludeAbandonedSwap(base, null), null);
  assert.equal(concludeAbandonedSwap(null, '2.1.0'), null);
});

// The helper rewrites the whole status document when it finishes, `historyRecorded` included. Once
// the boot above has already concluded the same run, that reset must not produce a second line.
test('one history entry per update run, even when boot and helper both conclude it', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '2.0.0', targetVersion: '2.1.0', logFile: null, startedAt: '2026-08-20T14:35:32.496Z' });
  model.writeStatus({ phase: 'restarting' });
  assert.ok(model.reconcileOnBoot('2.1.0'));

  // What `apply-update.sh` writes when it survives: same run, same verdict, flag back to false.
  model.writeStatus({ phase: 'done', historyRecorded: false });
  assert.equal(model.reconcileOnBoot('2.1.0'), null, 'nothing new to report');
  assert.equal(model.readState().history.length, 1);
  cleanup();
});

test('a run that ends up rolled back replaces the success a boot had already logged', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '2.0.0', targetVersion: '2.1.0', logFile: null, startedAt: '2026-08-20T14:35:32.496Z' });
  model.writeStatus({ phase: 'restarting' });
  model.reconcileOnBoot('2.1.0');

  // The helper outlived us after all, judged the new version unhealthy and rolled back.
  model.writeStatus({ phase: 'rolled_back', errorCode: 'HEALTHCHECK_TIMEOUT', historyRecorded: false });
  const entry = model.reconcileOnBoot('2.0.0');
  const { history } = model.readState();
  assert.equal(history.length, 1, 'one run, one line');
  assert.equal(history[0].result, 'rolled_back');
  assert.equal(entry.result, 'rolled_back');
  cleanup();
});

test('writeRuntimeState stamps the version the swap helper checks for', () => {
  const { model, cleanup } = freshModel();
  model.writeRuntimeState('1.1.0');
  const written = JSON.parse(fs.readFileSync(model.paths.runtimeStateFile, 'utf8'));
  assert.equal(written.version, '1.1.0');
  assert.equal(written.pid, process.pid);
  cleanup();
});

test('readLogTail returns the last lines, and nothing at all when there is no log', () => {
  const { model, dir, cleanup } = freshModel();
  const log = path.join(dir, 'update.log');
  fs.writeFileSync(log, Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'));
  const tail = model.readLogTail(log, 10);
  assert.equal(tail.length, 10);
  assert.equal(tail[9], 'line 79');
  assert.deepEqual(model.readLogTail(null), []);
  assert.deepEqual(model.readLogTail(path.join(dir, 'missing.log')), []);
  cleanup();
});

test('dismissVersion is remembered across reads', () => {
  const { model, cleanup } = freshModel();
  model.dismissVersion('1.2.0');
  assert.equal(model.readState().dismissedVersion, '1.2.0');
  cleanup();
});

// specs/self-update-and-releases.md §4.6 — a deployment may leave DB_PATH unset and rely on the
// historical wiring instead: `current/server/guestflow.db` symlinked into `~/guestflow/data/`. That
// is how the production host was set up. Taking the link at face value would put the data directory
// inside the release, where the update state would be destroyed by the very swap it must survive.

test('the data directory follows the database symlink out of the release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-layout-'));
  const dataDir = path.join(root, 'data');
  const serverDir = path.join(root, 'releases', '1.0.0', 'server');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'guestflow.db'), 'SQLite format 3');
  const linked = path.join(serverDir, 'guestflow.db');
  fs.symlinkSync(path.join(dataDir, 'guestflow.db'), linked);

  const { resolvePaths: resolve } = require('../utils/deploymentPaths');
  const paths = resolve({ DB_PATH: linked });

  assert.equal(fs.realpathSync(paths.dataDir), fs.realpathSync(dataDir), 'data/ must be outside the release');
  assert.equal(fs.realpathSync(paths.deployRoot), fs.realpathSync(root));
  assert.equal(path.basename(paths.releasesDir), 'releases');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a plain database file keeps its own directory as the data directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-layout-'));
  const dbPath = path.join(root, 'guestflow.db');
  fs.writeFileSync(dbPath, 'SQLite format 3');
  const { resolvePaths: resolve } = require('../utils/deploymentPaths');
  assert.equal(fs.realpathSync(resolve({ DB_PATH: dbPath }).dataDir), fs.realpathSync(root));
  fs.rmSync(root, { recursive: true, force: true });
});
