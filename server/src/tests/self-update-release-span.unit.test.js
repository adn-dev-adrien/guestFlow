const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fetchReleaseFeed, RELEASES_PER_PAGE } = require('../utils/releaseClient');
const { createUpdateStateModel, notesForVersion } = require('../models/updateStateModel');
const { resolvePaths } = require('../utils/deploymentPaths');
const { getAppVersion } = require('../utils/appVersion');
const { buildVersionInfo } = require('../controllers/systemController').__test;

// specs/self-update-and-releases.md rules 12b + 20d: the dialog shows every version between the one
// installed and the one on offer, not just the target.

function releasePayload(version, overrides = {}) {
  const base = `https://github.com/adn-dev-adrien/guestFlow/releases/download/v${version}`;
  return {
    tag_name: `v${version}`,
    published_at: '2026-08-20T10:00:00Z',
    body: `### Summary\n- Ce que fait la ${version}\n\n### Fixed\n- Un correctif de la ${version}`,
    assets: [
      { name: `guestflow-${version}.tar.gz`, size: 10, browser_download_url: `${base}/guestflow-${version}.tar.gz` },
      { name: 'SHA256SUMS', size: 10, browser_download_url: `${base}/SHA256SUMS` },
    ],
    ...overrides,
  };
}

function feedOf(payload) {
  return fetchReleaseFeed({ fetchImpl: async () => ({ ok: true, json: async () => payload }) });
}

function freshModel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-span-'));
  const model = createUpdateStateModel(resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') }));
  return { model, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Versions around whatever this tree currently is, so the span filter has something to filter. */
function versionsAroundCurrent() {
  const [major, minor, patch] = getAppVersion().split('.').map(Number);
  return {
    older: '0.0.1',
    plusOne: `${major}.${minor + 1}.${patch}`,
    plusTwo: `${major}.${minor + 2}.${patch}`,
    plusThree: `${major}.${minor + 3}.${patch}`,
  };
}

// ----- what the poll brings back -----

test('the feed carries the target and the notes of every version behind it', async () => {
  const feed = await feedOf([releasePayload('2.3.0'), releasePayload('2.2.0'), releasePayload('2.1.0')]);
  assert.equal(feed.release.version, '2.3.0');
  assert.deepEqual(feed.releases.map((entry) => entry.version), ['2.3.0', '2.2.0', '2.1.0']);
  assert.equal(feed.releases[1].notes[0].key, 'summary');
  assert.deepEqual(feed.releases[1].notes[0].items, ['Ce que fait la 2.2.0']);
});

test('the feed orders by version, not by the order GitHub happened to answer in', async () => {
  const feed = await feedOf([releasePayload('2.10.0'), releasePayload('2.9.0'), releasePayload('2.11.0')]);
  assert.deepEqual(feed.releases.map((entry) => entry.version), ['2.11.0', '2.10.0', '2.9.0']);
  assert.equal(feed.release.version, '2.11.0');
});

test('drafts, pre-releases and foreign tags are not part of the span', async () => {
  const feed = await feedOf([
    releasePayload('2.4.0', { draft: true }),
    releasePayload('2.3.0', { prerelease: true }),
    { tag_name: 'nightly', body: '- rien' },
    releasePayload('2.2.0'),
  ]);
  assert.equal(feed.release.version, '2.2.0');
  assert.deepEqual(feed.releases.map((entry) => entry.version), ['2.2.0']);
});

test('a newest release with broken assets offers nothing rather than the one below it', async () => {
  const feed = await feedOf([
    releasePayload('2.3.0', { assets: [] }),
    releasePayload('2.2.0'),
  ]);
  assert.equal(feed.release, null);
  // Its changelog survives even though its archive does not: notes never depend on assets.
  assert.deepEqual(feed.releases.map((entry) => entry.version), ['2.3.0', '2.2.0']);
});

test('a full page means older releases exist behind the window', async () => {
  const full = Array.from({ length: RELEASES_PER_PAGE }, (unused, index) => releasePayload(`2.${index}.0`));
  assert.equal((await feedOf(full)).truncated, true);
  assert.equal((await feedOf(full.slice(0, 3))).truncated, false);
});

// ----- what the dialog is handed -----

test('buildVersionInfo lists every version between the installed one and the target', async () => {
  const { model, cleanup } = freshModel();
  const { older, plusOne, plusTwo, plusThree } = versionsAroundCurrent();
  const feed = await feedOf([plusTwo, plusOne, older].map((version) => releasePayload(version)));
  model.recordCheck(feed);

  const info = buildVersionInfo(model);
  assert.equal(info.latest, plusTwo);
  assert.deepEqual(info.versions.map((entry) => entry.version), [plusTwo, plusOne]);
  assert.deepEqual(info.versions[0].summary, [`Ce que fait la ${plusTwo}`]);
  assert.deepEqual(info.versions[0].notes.map((section) => section.title), ['Corrections']);
  assert.equal(info.versionsTruncated, false);

  // A version published after the target is not part of what this update installs.
  model.recordCheck(await feedOf([plusThree, plusTwo, plusOne].map((v) => releasePayload(v))));
  model.writeState({ latestVersion: plusTwo });
  assert.deepEqual(buildVersionInfo(model).versions.map((entry) => entry.version), [plusTwo, plusOne]);
  cleanup();
});

test('a window that never reaches the installed version says so', async () => {
  const { model, cleanup } = freshModel();
  const { plusOne, plusTwo } = versionsAroundCurrent();
  const feed = await feedOf([releasePayload(plusTwo), releasePayload(plusOne)]);
  model.recordCheck({ ...feed, truncated: true });

  const info = buildVersionInfo(model);
  assert.deepEqual(info.versions.map((entry) => entry.version), [plusTwo, plusOne]);
  assert.equal(info.versionsTruncated, true);
  cleanup();
});

test('a window whose oldest entries are already installed is complete, not truncated', async () => {
  const { model, cleanup } = freshModel();
  const { older, plusOne } = versionsAroundCurrent();
  const feed = await feedOf([releasePayload(plusOne), releasePayload(older)]);
  model.recordCheck({ ...feed, truncated: true });

  const info = buildVersionInfo(model);
  assert.deepEqual(info.versions.map((entry) => entry.version), [plusOne]);
  assert.equal(info.versionsTruncated, false);
  cleanup();
});

test('a state file written by the previous shape reads as an empty span', () => {
  const { model, cleanup } = freshModel();
  fs.mkdirSync(path.dirname(model.paths.stateFile), { recursive: true });
  fs.writeFileSync(model.paths.stateFile, JSON.stringify({
    latestVersion: '9.9.9',
    latestPublishedAt: '2026-08-20T10:00:00Z',
    latestNotes: [{ key: 'summary', title: 'En bref', items: ['Une nouveauté'] }],
  }));

  const info = buildVersionInfo(model);
  assert.equal(info.latest, '9.9.9');
  assert.equal(info.updateAvailable, true);
  assert.deepEqual(info.versions, []);
  assert.equal(notesForVersion(model.readState(), '9.9.9'), null);
  cleanup();
});
