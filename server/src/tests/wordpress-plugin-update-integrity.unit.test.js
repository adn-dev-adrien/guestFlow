// specs/wordpress-plugin-self-update.md rules 9-10 (2026-10-27 audit, WordPress plugin 1.17.1) — the
// archive WordPress installs is the one the release published: its file name carries the manifest's
// version, newer than the installed one, and its SHA-256 is the one the release's SHA256SUMS lists.
// The plugin has no PHP harness, so the rules are read from the source and its two patterns are run
// here with the same semantics.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const src = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gf-updater.php'), 'utf8');

const phpPattern = (fnName) => {
  const body = src.slice(src.indexOf(`function ${fnName}(`));
  const m = body.match(/preg_match\('([#/])(.+?)\1', /);
  return new RegExp(m[2]);
};

test('rule 9: the package file name must carry the manifest version', () => {
  const re = phpPattern('package_version');
  assert.equal('/adn-dev-adrien/guestFlow/releases/download/v3.19.0/guestflow-booking-1.17.1.zip'.match(re)[1], '1.17.1');
  assert.equal(re.test('/x/guestflow-booking-latest.zip'), false);
  assert.match(src, /\|\| \$this->package_version\(\$package\) !== \$version\)/, 'the manifest is refused otherwise');
});

test('rule 9: the download itself refuses a version that is not newer than the installed one', () => {
  assert.match(src, /add_filter\('upgrader_pre_download', \[\$this, 'verified_download'\], 10, 3\)/);
  assert.match(src, /version_compare\(\$version, GF_BOOKING_VERSION, '<='\)\) \{\n\s+return new WP_Error\('gf_package_version'/);
});

test('rule 10: the SHA256SUMS of the same release is read, and a mismatch installs nothing', () => {
  assert.match(src, /substr\(\$package, 0, strrpos\(\$package, '\/'\)\) \. '\/SHA256SUMS'/);
  assert.match(src, /if \(\$expected === ''\) \{\n\s+return new WP_Error\('gf_package_checksum'/, 'no listed checksum → refused');
  assert.match(src, /!hash_equals\(\$expected, strtolower\(\$actual\)\)\) \{\n\s+wp_delete_file\(\$file\);\n\s+return new WP_Error/);
  assert.match(src, /return \$reply;\n\s+\}\n\s+\$version = \$this->package_version/, 'other packages pass through');
});

test('rule 10: a sha256sum line is matched on the exact file name', () => {
  const re = phpPattern('checksum_for');
  const hash = 'a'.repeat(64);
  const line = (l) => l.trim().match(re);
  assert.equal(line(`${hash}  guestflow-booking-1.17.1.zip`)[2], 'guestflow-booking-1.17.1.zip');
  assert.equal(line(`${hash} *guestflow-booking-1.17.1.zip`)[2], 'guestflow-booking-1.17.1.zip');
  assert.equal(line(`${'a'.repeat(63)}  guestflow-booking-1.17.1.zip`), null);
  assert.match(src, /&& \$m\[2\] === \$name\)/);
});
