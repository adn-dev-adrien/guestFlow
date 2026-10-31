// specs/security-hardening.md rule 13 — a dev dependency's advisory is closed in the existing lockfile.
// Audit R10 L-1: nodemon 3.1.14 pins `minimatch ^10.2.1`, and every 10.x matches GHSA-g3hv-75wg-m249
// (fixed in 11.0.1). `npm audit fix` would only solve it by downgrading nodemon to 1.0.2.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverDir = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(serverDir, 'package-lock.json'), 'utf8'));

const lockedVersions = (name) => Object.entries(lock.packages)
  .filter(([at]) => at === `node_modules/${name}` || at.endsWith(`/node_modules/${name}`))
  .map(([at, entry]) => ({ at, version: entry.version }));

const atLeast = (version, floor) => {
  const [a, b] = [version, floor].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test('rule 13: every locked minimatch is 11.0.1 or later', () => {
  const found = lockedVersions('minimatch');
  assert.ok(found.length > 0, 'minimatch is no longer in the server lockfile: drop the override and this test');
  for (const { at, version } of found) {
    assert.ok(atLeast(version, '11.0.1'), `${at} is ${version}, inside GHSA-g3hv-75wg-m249`);
  }
});

test('rule 13: the fix is an override scoped to nodemon, nodemon itself is not downgraded', () => {
  assert.equal(manifest.overrides?.nodemon?.minimatch, '^11.0.1');
  assert.match(manifest.devDependencies.nodemon, /^\^3\./);
  const [nodemon] = lockedVersions('nodemon');
  assert.ok(atLeast(nodemon.version, '3.1.14'), `nodemon locked at ${nodemon.version}`);
  assert.equal(lock.packages[''].devDependencies.nodemon, manifest.devDependencies.nodemon);
});
