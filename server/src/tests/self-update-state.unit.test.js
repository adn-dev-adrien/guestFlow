const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createUpdateStateModel } = require('../models/updateStateModel');
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

test('recordCheck stores the release and clears it again when GitHub reports none', () => {
  const { model, cleanup } = freshModel();
  model.recordCheck({ version: '1.2.0', publishedAt: '2026-08-20T10:00:00Z', notes: [{ title: 'Ajouts', items: ['x'] }] });
  let state = model.readState();
  assert.equal(state.latestVersion, '1.2.0');
  assert.equal(state.latestNotes[0].items[0], 'x');
  assert.ok(state.lastCheckAt);

  model.recordCheck(null);
  state = model.readState();
  assert.equal(state.latestVersion, null);
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
