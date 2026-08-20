const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidVersion, parseVersion, compareVersions, isNewerVersion, stripLeadingV } = require('../utils/semver');

// specs/self-update-and-releases.md §3.A rule 2 + §3.B rule 13. These comparisons decide whether a
// remote archive gets downloaded and installed over the running application, so "roughly right" is
// not an option: anything unparseable must answer "no update".

test('isValidVersion accepts only strict MAJOR.MINOR.PATCH', () => {
  for (const good of ['0.0.0', '1.2.3', '10.20.30']) assert.equal(isValidVersion(good), true, good);
  for (const bad of ['1.2', '1.2.3.4', 'v1.2.3', '1.2.3-rc1', '1.2.3+build', '', ' 1.2.3', null, undefined, 123]) {
    assert.equal(isValidVersion(bad), false, JSON.stringify(bad));
  }
});

test('stripLeadingV normalises a git tag', () => {
  assert.equal(stripLeadingV('v1.2.3'), '1.2.3');
  assert.equal(stripLeadingV('1.2.3'), '1.2.3');
});

test('parseVersion returns numeric components, null when unparseable', () => {
  assert.deepEqual(parseVersion('1.20.3'), [1, 20, 3]);
  assert.equal(parseVersion('1.2.3-rc1'), null);
});

test('compareVersions orders by major, then minor, then patch', () => {
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1); // not a string comparison
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('nope', '1.2.3'), null);
});

test('isNewerVersion is strict and fails closed', () => {
  assert.equal(isNewerVersion('1.1.0', '1.0.9'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  // A rolled-back remote version must never be advertised as an update.
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), false);
  // Garbage in, "no update" out — never an exception, never a true.
  for (const bad of ['', 'latest', 'v1.2.3', null, undefined]) {
    assert.equal(isNewerVersion(bad, '1.0.0'), false, JSON.stringify(bad));
    assert.equal(isNewerVersion('1.0.0', bad), false, JSON.stringify(bad));
  }
});
