// specs/self-update-and-releases.md rule 50 (audit r4, console hardening) — the lockfile's `version` and
// package name are validated before they build the canonical tarball path: no `%2F..%2F` can ride in
// a path that is byte-for-byte what npm would fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { lockfileViolations } = require('../utils/lockfileProvenance');

function lock(key, entry) {
  return { packages: { '': {}, [key]: { integrity: 'sha512-x', ...entry } } };
}

test('rule 50: a version carrying an encoded path is refused even when the URL is canonical', () => {
  const version = '1.0.0%2F..%2F..%2Fevil%2F-%2Fevil-1.0.0';
  const resolved = `https://registry.npmjs.org/left-pad/-/left-pad-${version}.tgz`;
  assert.equal(new URL(resolved).href, resolved, 'the canonical-URL check alone lets it through');
  const out = lockfileViolations(lock('node_modules/left-pad', { version, resolved }));
  assert.equal(out.length, 1);
});

test('rule 50: a non-semver version and an odd package name are refused', () => {
  assert.equal(lockfileViolations(lock('node_modules/left-pad', { version: 'latest', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-latest.tgz' })).length, 1);
  assert.equal(lockfileViolations(lock('node_modules/Left%2Fpad', { version: '1.0.0', resolved: 'https://registry.npmjs.org/Left%2Fpad/-/Left%2Fpad-1.0.0.tgz' })).length, 1);
});

test('rule 50: ordinary, scoped and prerelease entries still pass', () => {
  assert.deepEqual(lockfileViolations(lock('node_modules/left-pad', { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz' })), []);
  assert.deepEqual(lockfileViolations(lock('node_modules/@scope/pkg.js', { version: '2.0.0-rc.1+build.5'.split('+')[0], resolved: 'https://registry.npmjs.org/@scope/pkg.js/-/pkg.js-2.0.0-rc.1.tgz' })), []);
});
