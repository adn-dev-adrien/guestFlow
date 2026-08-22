const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../controllers/public/pluginUpdateController');

const { buildManifest, notesToHtml, SLUG } = __test;

// specs/wordpress-plugin-self-update.md §3 rules 4-8. WordPress installs whatever `download_url`
// points at, so this manifest is a place where "usually fine" is not good enough.

const ASSET_URL = 'https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/guestflow-booking-1.5.0.zip';

function state(overrides = {}) {
  return {
    latestVersion: '1.1.0',
    latestPublishedAt: '2026-08-20T10:00:00Z',
    releases: [{ version: '1.1.0', publishedAt: '2026-08-20T10:00:00Z', notes: [{ title: 'Corrections', items: ['Un correctif'] }] }],
    latestPlugin: { name: 'guestflow-booking-1.5.0.zip', url: ASSET_URL, version: '1.5.0' },
    ...overrides,
  };
}

test('the manifest carries what the WordPress updater needs', () => {
  const manifest = buildManifest(state());
  assert.equal(manifest.slug, SLUG);
  assert.equal(manifest.version, '1.5.0');
  assert.equal(manifest.download_url, ASSET_URL);
  assert.equal(manifest.last_updated, '2026-08-20T10:00:00Z');
  assert.match(manifest.sections.changelog, /Un correctif/);
  assert.ok(manifest.requires && manifest.requires_php);
});

test('no published plugin asset means no manifest at all', () => {
  assert.equal(buildManifest(state({ latestPlugin: null })), null);
  assert.equal(buildManifest(state({ latestPlugin: { url: ASSET_URL } })), null, 'a version is required');
});

test('an asset hosted anywhere but GitHub is refused outright', () => {
  for (const url of [
    'https://evil.example/guestflow-booking-1.5.0.zip',
    'http://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/x.zip',
    'https://github.com.evil.tld/x.zip',
    'not-a-url',
  ]) {
    const manifest = buildManifest(state({ latestPlugin: { url, version: '1.5.0' } }));
    assert.equal(manifest, null, url);
  }
});

test('the changelog HTML escapes what it renders', () => {
  const html = notesToHtml([{ title: '<script>x</script>', items: ['a & b <img onerror=1>'] }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

test('no release notes yields an empty changelog rather than broken markup', () => {
  assert.equal(notesToHtml(null), '');
  assert.equal(notesToHtml([]), '');
  assert.equal(buildManifest(state({ releases: [] })).sections.changelog, '');
});
