const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildHelperArgs, spawnHelper, HELPER_SCRIPT, DEFAULT_TIMEOUT_SECONDS } = require('../utils/updateHelper');

// specs/self-update-and-releases.md §3.E rule 28 + §4.1. This is the boundary where a version string
// stops being data and becomes part of a command line, so it is where the validation has to be.

const PATHS = {
  deployRoot: '/home/gf/guestflow',
  ecosystemFile: '/home/gf/guestflow/ecosystem.config.js',
  statusFile: '/home/gf/guestflow/data/update-status.json',
  runtimeStateFile: '/home/gf/guestflow/data/runtime-state.json',
};

function baseArgs(overrides = {}) {
  return {
    paths: PATHS,
    targetVersion: '1.1.0',
    fromVersion: '1.0.0',
    previousDir: '/home/gf/guestflow/releases/1.0.0',
    pm2Binary: '/usr/local/bin/pm2',
    healthUrl: 'http://127.0.0.1:4000/api/version',
    logFile: '/home/gf/guestflow/logs/update-1.1.0.log',
    startedAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

function asMap(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i]] = argv[i + 1];
  return out;
}

test('buildHelperArgs passes every path the helper needs', () => {
  const map = asMap(buildHelperArgs(baseArgs()));
  assert.equal(map['--root'], PATHS.deployRoot);
  assert.equal(map['--target'], '1.1.0');
  assert.equal(map['--from'], '1.0.0');
  assert.equal(map['--previous-dir'], '/home/gf/guestflow/releases/1.0.0');
  assert.equal(map['--pm2'], '/usr/local/bin/pm2');
  assert.equal(map['--ecosystem'], PATHS.ecosystemFile);
  assert.equal(map['--status'], PATHS.statusFile);
  assert.equal(map['--runtime'], PATHS.runtimeStateFile);
  assert.equal(map['--health'], 'http://127.0.0.1:4000/api/version');
  assert.equal(map['--timeout'], String(DEFAULT_TIMEOUT_SECONDS));
});

test('buildHelperArgs refuses a target version that is not a strict semver', () => {
  for (const bad of ['1.1', 'latest', '../../etc', '1.1.0; rm -rf /', '1.1.0 && curl evil', '', null]) {
    assert.throws(() => buildHelperArgs(baseArgs({ targetVersion: bad })), /INVALID_TARGET_VERSION/, String(bad));
  }
});

test('buildHelperArgs refuses a from-version that could break out of the status JSON', () => {
  for (const bad of ['1.0.0"', 'a\nb', '1.0.0 x', '{}']) {
    assert.throws(() => buildHelperArgs(baseArgs({ fromVersion: bad })), /INVALID_FROM_VERSION/, JSON.stringify(bad));
  }
  // The dev sentinel is a legitimate value.
  assert.doesNotThrow(() => buildHelperArgs(baseArgs({ fromVersion: '0.0.0-dev' })));
});

test('buildHelperArgs refuses to run without PM2 or with an absurd timeout', () => {
  assert.throws(() => buildHelperArgs(baseArgs({ pm2Binary: null })), /PM2_NOT_FOUND/);
  for (const bad of [0, 5, 3600, 1.5, '120']) {
    assert.throws(() => buildHelperArgs(baseArgs({ timeoutSeconds: bad })), /INVALID_TIMEOUT/, String(bad));
  }
});

test('spawnHelper detaches the child so it survives the restart that kills us', () => {
  const calls = [];
  const fakeChild = { unref() { calls.push('unref'); } };
  const spawnImpl = (cmd, argv, options) => {
    calls.push({ cmd, argv, options });
    return fakeChild;
  };
  spawnHelper(['--target', '1.1.0'], { spawnImpl });

  const [call] = calls;
  assert.equal(call.cmd, 'bash');
  assert.equal(call.options.detached, true, 'detached: own session, immune to the group signal');
  assert.equal(call.options.stdio, 'ignore');
  assert.equal(calls[1], 'unref');
  // argv array, never a shell string — nothing here is interpolated by a shell.
  assert.ok(Array.isArray(call.argv));
  assert.equal(call.argv[0], fs.realpathSync(HELPER_SCRIPT));
});

test('the helper script ships with the server and is executable', () => {
  const stat = fs.statSync(HELPER_SCRIPT);
  assert.ok(stat.isFile());
  assert.ok(stat.mode & 0o111, 'apply-update.sh must be executable');
  assert.equal(path.basename(HELPER_SCRIPT), 'apply-update.sh');
});
