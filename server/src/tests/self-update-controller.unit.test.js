const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const controller = require('../controllers/systemController');
const { createUpdateStateModel } = require('../models/updateStateModel');
const { resolvePaths } = require('../utils/deploymentPaths');
const { getAppVersion } = require('../utils/appVersion');
const { phaseLabel, errorMessage } = require('../constants/updatePhases');

const { buildVersionInfo, buildStatus, healthUrl, stagingErrorMessage } = controller.__test;

// specs/self-update-and-releases.md §4.3. The client renders these payloads as-is: no version
// comparison, no status mapping, no French string built in React.

function freshModel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ctrl-'));
  const model = createUpdateStateModel(resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') }));
  return { model, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A version strictly newer than whatever this tree currently is. */
function newerThanCurrent() {
  const [major, minor, patch] = getAppVersion().split('.').map(Number);
  return Number.isFinite(major) ? `${major}.${minor + 1}.${patch}` : '99.0.0';
}

function olderThanCurrent() {
  const [major] = getAppVersion().split('.').map(Number);
  return Number.isFinite(major) ? '0.0.1' : '0.0.1';
}

// ----- version payload -----

test('buildVersionInfo answers "no update" when nothing has been published yet', () => {
  const { model, cleanup } = freshModel();
  const info = buildVersionInfo(model);
  assert.equal(info.current, getAppVersion());
  assert.equal(info.latest, null);
  assert.equal(info.updateAvailable, false);
  assert.deepEqual(info.notes, []);
  cleanup();
});

test('buildVersionInfo flags an update and carries the notes the dialog renders', () => {
  const { model, cleanup } = freshModel();
  const latest = newerThanCurrent();
  model.recordCheck({
    version: latest,
    publishedAt: '2026-08-20T10:00:00Z',
    notes: [{ title: 'Ajouts', items: ['Une nouveauté'] }],
  });
  const info = buildVersionInfo(model);
  assert.equal(info.latest, latest);
  assert.equal(info.updateAvailable, true);
  assert.equal(info.publishedAt, '2026-08-20T10:00:00Z');
  assert.equal(info.notes[0].items[0], 'Une nouveauté');
  cleanup();
});

test('buildVersionInfo never advertises an older published version as an update', () => {
  const { model, cleanup } = freshModel();
  model.recordCheck({ version: olderThanCurrent(), publishedAt: null, notes: [] });
  assert.equal(buildVersionInfo(model).updateAvailable, false);
  cleanup();
});

test('buildVersionInfo reports the dismissal and the in-progress flag', () => {
  const { model, cleanup } = freshModel();
  const latest = newerThanCurrent();
  model.recordCheck({ version: latest, publishedAt: null, notes: [] });
  model.dismissVersion(latest);
  let info = buildVersionInfo(model);
  assert.equal(info.dismissedVersion, latest);
  assert.equal(info.updateAvailable, true, 'a dismissal hides the alert, it does not erase the update');

  model.acquireLock(latest);
  info = buildVersionInfo(model);
  assert.equal(info.updateInProgress, true);
  cleanup();
});

test('buildVersionInfo says why self-update is unavailable on a dev tree', () => {
  const { model, cleanup } = freshModel();
  const info = buildVersionInfo(model);
  // The dev checkout has no `current` symlink, so the engine must refuse — with a reason.
  assert.equal(info.selfUpdateSupported, false);
  assert.match(info.selfUpdateReason, /manuelle|current|PM2|releases/);
  cleanup();
});

// ----- status payload -----

test('buildStatus reports idle before anything happened', () => {
  const { model, cleanup } = freshModel();
  const status = buildStatus(model);
  assert.equal(status.phase, 'idle');
  assert.equal(status.label, phaseLabel('idle'));
  assert.equal(status.terminal, true);
  assert.deepEqual(status.logTail, []);
  cleanup();
});

test('buildStatus labels a running phase in French and marks it non-terminal', () => {
  const { model, cleanup } = freshModel();
  model.startStatus({ fromVersion: '1.0.0', targetVersion: '1.1.0', logFile: null });
  model.writeStatus({ phase: 'installing' });
  const status = buildStatus(model);
  assert.equal(status.phase, 'installing');
  assert.equal(status.label, 'Installation des dépendances…');
  assert.equal(status.terminal, false);
  assert.equal(status.targetVersion, '1.1.0');
  cleanup();
});

test('buildStatus surfaces the failure cause and the log tail only when it failed', () => {
  const { model, cleanup } = freshModel();
  const log = path.join(path.dirname(model.paths.statusFile), 'update.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'ligne 1\nligne 2\n');

  model.startStatus({ fromVersion: '1.0.0', targetVersion: '1.1.0', logFile: log });
  model.writeStatus({ phase: 'installing' });
  assert.deepEqual(buildStatus(model).logTail, [], 'no log noise while it is still running');

  model.writeStatus({ phase: 'rolled_back', errorCode: 'HEALTHCHECK_TIMEOUT' });
  const status = buildStatus(model);
  assert.equal(status.error, errorMessage('HEALTHCHECK_TIMEOUT'));
  assert.deepEqual(status.logTail, ['ligne 1', 'ligne 2']);
  cleanup();
});

// ----- health URL handed to the swap helper -----

test('healthUrl targets the loopback interface, matching the configured scheme and port', () => {
  assert.equal(healthUrl({}), 'http://127.0.0.1:4000/api/version');
  assert.equal(healthUrl({ PORT: '4100' }), 'http://127.0.0.1:4100/api/version');
  assert.equal(healthUrl({ HTTPS_ENABLED: 'true' }), 'https://127.0.0.1:4000/api/version');
});

// ----- failure messages -----

test('stagingErrorMessage names the integrity refusals explicitly', () => {
  assert.match(stagingErrorMessage('CHECKSUM_MISMATCH'), /SHA-256/);
  assert.match(stagingErrorMessage('FORBIDDEN_HOST'), /non autorisé/);
  assert.match(stagingErrorMessage('ARCHIVE_TRAVERSAL_MEMBER'), /refusée/);
  // An unknown code still produces something actionable rather than a raw code.
  assert.match(stagingErrorMessage('SOMETHING_ELSE'), /journal/);
});

// ----- the hourly check -----

test('runVersionCheck stores what GitHub published', async () => {
  const { model, cleanup } = freshModel();
  const latest = newerThanCurrent();
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      tag_name: `v${latest}`,
      published_at: '2026-08-20T10:00:00Z',
      body: '### Fixed\n- Un correctif',
      assets: [
        { name: `guestflow-${latest}.tar.gz`, browser_download_url: `https://github.com/adn-dev-adrien/guestFlow/releases/download/v${latest}/guestflow-${latest}.tar.gz` },
        { name: 'SHA256SUMS', browser_download_url: `https://github.com/adn-dev-adrien/guestFlow/releases/download/v${latest}/SHA256SUMS` },
      ],
    }),
  });

  const release = await controller.runVersionCheck({ model, fetchImpl });
  assert.equal(release.version, latest);
  assert.equal(model.readState().latestVersion, latest);
  assert.equal(model.readState().latestNotes[0].title, 'Corrections');
  cleanup();
});

test('runVersionCheck keeps the last known answer when GitHub is unreachable', async () => {
  const { model, cleanup } = freshModel();
  const latest = newerThanCurrent();
  model.recordCheck({ version: latest, publishedAt: null, notes: [] });

  const result = await controller.runVersionCheck({ model, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(result, null);
  assert.equal(model.readState().latestVersion, latest, 'an offline check must not erase what we knew');
  cleanup();
});
