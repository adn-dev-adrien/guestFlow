const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedDownloadUrl,
  parseReleaseNotes,
  parseSha256Sums,
  normaliseRelease,
  fetchLatestRelease,
} = require('../utils/releaseClient');

// specs/self-update-and-releases.md §3.B + §3.D rule 22.

const HASH = 'a'.repeat(64);

function releasePayload(overrides = {}) {
  return {
    tag_name: 'v1.1.0',
    published_at: '2026-08-20T10:00:00Z',
    html_url: 'https://github.com/adn-dev-adrien/guestFlow/releases/tag/v1.1.0',
    body: '### Added\n- Une nouveauté\n\n### Fixed\n- Un correctif',
    assets: [
      { name: 'guestflow-1.1.0.tar.gz', size: 1234, browser_download_url: 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/guestflow-1.1.0.tar.gz' },
      { name: 'SHA256SUMS', size: 100, browser_download_url: 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/SHA256SUMS' },
      { name: 'guestflow-booking-1.5.0.zip', size: 500, browser_download_url: 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/guestflow-booking-1.5.0.zip' },
    ],
    ...overrides,
  };
}

test('isAllowedDownloadUrl allows only https on the GitHub hosts', () => {
  for (const good of [
    'https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/guestflow-1.1.0.tar.gz',
    'https://api.github.com/repos/adn-dev-adrien/guestFlow/releases/latest',
    'https://objects.githubusercontent.com/whatever',
    'https://release-assets.githubusercontent.com/whatever',
  ]) assert.equal(isAllowedDownloadUrl(good), true, good);

  for (const bad of [
    'http://github.com/x',            // plain HTTP
    'https://github.com.evil.tld/x',  // lookalike host
    'https://raw.githubusercontent.com/x', // real GitHub host, not an allowed one
    'https://evil.example/x',
    'file:///etc/passwd',
    'not a url',
    null,
  ]) assert.equal(isAllowedDownloadUrl(bad), false, String(bad));
});

test('parseReleaseNotes maps CHANGELOG headings to French sections and rejoins wrapped bullets', () => {
  const sections = parseReleaseNotes('### Added\n- **Gras** et [lien](https://x)\n  suite\n\n### Migration\n- Une colonne');
  assert.deepEqual(sections, [
    { key: 'added', title: 'Ajouts', items: ['Gras et lien suite'] },
    { key: 'migration', title: 'Migration', items: ['Une colonne'] },
  ]);
});

test('parseReleaseNotes drops empty sections and survives an empty body', () => {
  assert.deepEqual(parseReleaseNotes('### Added\n\n### Fixed\n- x'), [{ key: 'fixed', title: 'Corrections', items: ['x'] }]);
  assert.deepEqual(parseReleaseNotes(''), []);
  assert.deepEqual(parseReleaseNotes(null), []);
});

test('parseSha256Sums reads the sha256sum output format', () => {
  const parsed = parseSha256Sums(`${HASH}  guestflow-1.1.0.tar.gz\n${'b'.repeat(64)} *SHA256SUMS\nrubbish\n`);
  assert.equal(parsed['guestflow-1.1.0.tar.gz'], HASH);
  assert.equal(parsed.SHA256SUMS, 'b'.repeat(64));
  assert.equal(Object.keys(parsed).length, 2);
});

test('normaliseRelease shapes a usable release', () => {
  const release = normaliseRelease(releasePayload());
  assert.equal(release.version, '1.1.0');
  assert.equal(release.archive.name, 'guestflow-1.1.0.tar.gz');
  assert.equal(release.checksums.name, 'SHA256SUMS');
  assert.equal(release.plugin.version, '1.5.0');
  assert.equal(release.notes.length, 2);
});

test('normaliseRelease refuses anything it cannot fully trust', () => {
  // Tag that is not a strict version.
  assert.equal(normaliseRelease(releasePayload({ tag_name: 'nightly' })), null);
  // Archive whose version does not match the tag.
  assert.equal(normaliseRelease(releasePayload({
    assets: [
      { name: 'guestflow-9.9.9.tar.gz', browser_download_url: 'https://github.com/x/guestflow-9.9.9.tar.gz' },
      { name: 'SHA256SUMS', browser_download_url: 'https://github.com/x/SHA256SUMS' },
    ],
  })), null);
  // No checksums asset → nothing to verify against → unusable.
  assert.equal(normaliseRelease(releasePayload({
    assets: [{ name: 'guestflow-1.1.0.tar.gz', browser_download_url: 'https://github.com/x/guestflow-1.1.0.tar.gz' }],
  })), null);
  // Asset hosted off-allowlist.
  assert.equal(normaliseRelease(releasePayload({
    assets: [
      { name: 'guestflow-1.1.0.tar.gz', browser_download_url: 'https://evil.example/guestflow-1.1.0.tar.gz' },
      { name: 'SHA256SUMS', browser_download_url: 'https://github.com/x/SHA256SUMS' },
    ],
  })), null);
  assert.equal(normaliseRelease(null), null);
});

test('fetchLatestRelease swallows every failure mode and returns null', async () => {
  const cases = [
    async () => ({ ok: false, status: 404 }),
    async () => ({ ok: true, json: async () => ({ tag_name: 'garbage' }) }),
    async () => { throw new Error('offline'); },
  ];
  for (const fetchImpl of cases) {
    assert.equal(await fetchLatestRelease({ fetchImpl }), null);
  }
});

test('fetchLatestRelease returns the normalised release on success', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://api.github.com/repos/adn-dev-adrien/guestFlow/releases/latest');
    return { ok: true, json: async () => releasePayload() };
  };
  const release = await fetchLatestRelease({ fetchImpl });
  assert.equal(release.version, '1.1.0');
});
