/**
 * System / self-update endpoints (specs/self-update-and-releases.md §4.3).
 *
 * Everything the client needs is computed here and shipped ready to render: whether an update
 * exists, its release notes already parsed into sections, the French label of the current phase,
 * the history. The client polls and renders — it never compares a version or maps a status code.
 *
 * The whole surface is admin-only: `enforceRoleAccess` is deny-by-default for every other role, so
 * mounting under `/api/system` is enough — no allowlist entry to add, nothing to weaken.
 */

const path = require('path');
const { getAppVersion } = require('../utils/appVersion');
const { isNewerVersion, isValidVersion } = require('../utils/semver');
const { fetchLatestRelease } = require('../utils/releaseClient');
const { resolvePaths, selfUpdateSupported, resolvePm2Binary, currentReleaseDir, freeBytes } = require('../utils/deploymentPaths');
const { stageRelease, pruneReleases } = require('../utils/updateStaging');
const { buildHelperArgs, spawnHelper } = require('../utils/updateHelper');
const { createPreUpdateBackup, rotateBackups } = require('../utils/dbBackup');
const { shouldEnforceHttps } = require('../utils/securityConfig');
const { phaseLabel, isTerminal, errorMessage } = require('../constants/updatePhases');
const updateStateModel = require('../models/updateStateModel');

const CHECK_THROTTLE_MS = 10_000;
const REQUIRED_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB — archive + node_modules + headroom
const KEEP_RELEASES = 3;

let lastManualCheckAt = 0;

function healthUrl(env = process.env) {
  const protocol = shouldEnforceHttps(env) ? 'https' : 'http';
  return `${protocol}://127.0.0.1:${env.PORT || 4000}/api/version`;
}

/** The `GET /api/system/version` payload, built from local state only (no network call). */
function buildVersionInfo(model = updateStateModel) {
  const current = getAppVersion();
  const state = model.readState();
  const support = selfUpdateSupported();
  const latest = state.latestVersion;
  return {
    current,
    latest,
    updateAvailable: Boolean(latest) && isNewerVersion(latest, current),
    publishedAt: state.latestPublishedAt,
    notes: state.latestNotes || [],
    lastCheckAt: state.lastCheckAt,
    dismissedVersion: state.dismissedVersion,
    selfUpdateSupported: support.supported,
    selfUpdateReason: support.reason,
    updateInProgress: model.isLocked(),
    // The last few outcomes travel with the version payload: the settings card shows them next to
    // the installed version, and that spares the client a second call for one list.
    history: state.history,
  };
}

/** The `GET /api/system/update/status` payload. */
function buildStatus(model = updateStateModel) {
  const status = model.readStatus();
  return {
    phase: status.phase,
    label: phaseLabel(status.phase),
    terminal: isTerminal(status.phase),
    fromVersion: status.fromVersion || null,
    targetVersion: status.targetVersion || null,
    startedAt: status.startedAt || null,
    updatedAt: status.updatedAt || null,
    errorCode: status.errorCode || null,
    error: errorMessage(status.errorCode, status.errorMessage || null),
    logTail: status.phase === 'failed' || status.phase === 'rolled_back'
      ? model.readLogTail(status.logFile)
      : [],
  };
}

/** Terminal outcome reached inside this process (a staging failure): record it here and now. */
function finishInProcess(model, phase, errorCode, message) {
  const status = model.readStatus();
  model.writeStatus({ phase, errorCode: errorCode || null, errorMessage: message || null, historyRecorded: true });
  model.recordHistory({
    from: status.fromVersion || null,
    to: status.targetVersion || null,
    result: phase,
    at: new Date().toISOString(),
    errorCode: errorCode || null,
    runningVersion: getAppVersion(),
  });
  model.releaseLock();
}

/**
 * Poll GitHub and store the result. Never throws: an unreachable GitHub leaves the last known state
 * in place (rule 14). Returns the normalised release, or null.
 */
async function runVersionCheck({ model = updateStateModel, fetchImpl = fetch } = {}) {
  const release = await fetchLatestRelease({ fetchImpl });
  const previous = model.readState().latestVersion;
  if (!release) {
    // Keep the previous answer; only stamp that we tried when we have never succeeded.
    if (!previous) model.writeState({ lastCheckAt: new Date().toISOString() });
    return null;
  }
  model.recordCheck(release);
  if (release.version !== previous && isNewerVersion(release.version, getAppVersion())) {
    console.log(`[update] nouvelle version disponible : ${getAppVersion()} → ${release.version}`);
  }
  return release;
}

/**
 * Boot hook: stamp the running version (this is how the swap helper proves the right code came up),
 * turn a finished update into a history entry, and prune old releases.
 */
function initOnBoot({ model = updateStateModel } = {}) {
  const version = getAppVersion();
  try {
    model.writeRuntimeState(version);
    const recorded = model.reconcileOnBoot(version);
    if (recorded) {
      console.log(`[update] mise à jour ${recorded.from} → ${recorded.to} : ${recorded.result}`);
    }
    if (selfUpdateSupported().supported) {
      const paths = resolvePaths();
      const deleted = pruneReleases({
        releasesDir: paths.releasesDir,
        keep: KEEP_RELEASES,
        protectDirs: [currentReleaseDir(paths)].filter(Boolean),
      });
      if (deleted.length) console.log(`[update] anciennes versions supprimées : ${deleted.join(', ')}`);
    }
  } catch (err) {
    // The update engine must never keep the application from booting.
    console.error('[update] initialisation impossible:', err.message);
  }
}

// ---------------------------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------------------------

function getVersion(req, res) {
  res.json(buildVersionInfo());
}

async function checkNow(req, res) {
  const now = Date.now();
  const elapsed = now - lastManualCheckAt;
  if (elapsed < CHECK_THROTTLE_MS) {
    const retryAfter = Math.ceil((CHECK_THROTTLE_MS - elapsed) / 1000);
    return res.status(429).set('Retry-After', String(retryAfter)).json({
      error: 'TOO_MANY_REQUESTS',
      message: `Patientez ${retryAfter} s avant de relancer une vérification.`,
    });
  }
  lastManualCheckAt = now;
  await runVersionCheck();
  return res.json(buildVersionInfo());
}

function getUpdateStatus(req, res) {
  res.json(buildStatus());
}

function dismissUpdate(req, res) {
  const version = req.body?.version;
  if (!isValidVersion(version)) {
    return res.status(400).json({ error: 'INVALID_VERSION', message: 'Version invalide.' });
  }
  const state = updateStateModel.dismissVersion(version);
  return res.json({ dismissedVersion: state.dismissedVersion });
}

async function startUpdate(req, res) {
  const model = updateStateModel;
  const current = getAppVersion();
  const targetVersion = req.body?.targetVersion;

  const support = selfUpdateSupported();
  if (!support.supported) {
    return res.status(412).json({ error: 'SELF_UPDATE_UNSUPPORTED', message: support.reason });
  }
  if (!isValidVersion(targetVersion) || !isNewerVersion(targetVersion, current)) {
    return res.status(400).json({ error: 'INVALID_TARGET', message: 'Cette version ne peut pas être installée.' });
  }
  const known = model.readState().latestVersion;
  if (known !== targetVersion) {
    return res.status(400).json({
      error: 'UNKNOWN_TARGET',
      message: "Cette version n'est pas celle publiée : relancez une vérification.",
    });
  }
  if (!model.acquireLock(targetVersion)) {
    return res.status(409).json({ error: 'UPDATE_IN_PROGRESS', message: 'Une mise à jour est déjà en cours.' });
  }

  const paths = resolvePaths();
  const free = freeBytes(paths.deployRoot);
  if (free !== null && free < REQUIRED_FREE_BYTES) {
    model.releaseLock();
    return res.status(507).json({
      error: 'INSUFFICIENT_STORAGE',
      message: `Espace disque insuffisant (${Math.round(free / 1e9)} Go libres, 2 Go requis).`,
    });
  }

  const startedAt = new Date().toISOString();
  const logFile = path.join(paths.logsDir, `update-${targetVersion}-${startedAt.replace(/[:.]/g, '-')}.log`);
  model.startStatus({ fromVersion: current, targetVersion, logFile });

  // Answer immediately; the work continues in the background and is followed through the status
  // endpoint — the response would not survive the restart anyway.
  res.status(202).json({ started: true, targetVersion });

  runUpdate({ model, paths, current, targetVersion, startedAt, logFile }).catch((err) => {
    console.error('[update] échec inattendu:', err);
    finishInProcess(model, 'failed', 'UNEXPECTED', err.message);
  });
  return undefined;
}

/** Staging, backup, then hand over to the detached helper. Runs after the HTTP response. */
async function runUpdate({ model, paths, current, targetVersion, startedAt, logFile }) {
  try {
    // Re-fetch: the cached notes are for display, but the asset URLs must be fresh.
    model.writeStatus({ phase: 'checking' });
    const release = await fetchLatestRelease({});
    if (!release || release.version !== targetVersion) {
      finishInProcess(model, 'failed', 'RELEASE_UNAVAILABLE', "La release demandée n'est plus disponible sur GitHub.");
      return;
    }

    await stageRelease({
      release,
      paths,
      onPhase: (phase) => model.writeStatus({ phase }),
    });

    model.writeStatus({ phase: 'backup' });
    await createPreUpdateBackup({ backupsDir: paths.backupsDir, targetVersion });
    rotateBackups(paths.backupsDir);

    const args = buildHelperArgs({
      paths,
      targetVersion,
      fromVersion: current,
      previousDir: currentReleaseDir(paths),
      pm2Binary: resolvePm2Binary(),
      healthUrl: healthUrl(),
      logFile,
      startedAt,
    });
    model.writeStatus({ phase: 'swapping' });
    spawnHelper(args);
    // From here the helper owns the status file. We keep the lock: the restart is imminent, and a
    // second trigger in that window must be refused.
  } catch (err) {
    const code = String(err.message || '').split(':')[0] || 'STAGING_FAILED';
    finishInProcess(model, 'failed', code, stagingErrorMessage(code));
  }
}

/** Staging failures the operator can act on, in French. */
function stagingErrorMessage(code) {
  const messages = {
    FORBIDDEN_HOST: "Le téléchargement pointait vers un hôte non autorisé : mise à jour refusée.",
    ARCHIVE_TOO_LARGE: "L'archive dépasse la taille maximale autorisée.",
    CHECKSUM_MISSING: "L'empreinte SHA-256 de l'archive est absente de la release.",
    CHECKSUM_MISMATCH: "L'archive téléchargée ne correspond pas à son empreinte SHA-256 : mise à jour refusée.",
    ARCHIVE_LINK_MEMBER: "L'archive contient un lien symbolique : mise à jour refusée.",
    ARCHIVE_ABSOLUTE_MEMBER: "L'archive contient un chemin absolu : mise à jour refusée.",
    ARCHIVE_TRAVERSAL_MEMBER: "L'archive contient un chemin remontant (« .. ») : mise à jour refusée.",
    ARCHIVE_UNEXPECTED_ROOT: "L'archive n'a pas la structure attendue : mise à jour refusée.",
    RELEASE_LAYOUT_MISSING: "L'archive ne contient pas une version complète de GuestFlow.",
    RELEASE_VERSION_MISMATCH: "L'archive ne correspond pas à la version annoncée.",
    EMPTY_ARCHIVE: "L'archive téléchargée est vide.",
  };
  return messages[code] || "L'installation de la nouvelle version a échoué. Voir le journal de mise à jour.";
}

module.exports = {
  getVersion,
  checkNow,
  getUpdateStatus,
  startUpdate,
  dismissUpdate,
  runVersionCheck,
  initOnBoot,
  // Exposed for tests.
  __test: { buildVersionInfo, buildStatus, healthUrl, stagingErrorMessage, CHECK_THROTTLE_MS, REQUIRED_FREE_BYTES },
};
