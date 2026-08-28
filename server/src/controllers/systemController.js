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

const fs = require('fs');
const path = require('path');
const { getAppVersion } = require('../utils/appVersion');
const { isNewerVersion, isValidVersion } = require('../utils/semver');
const { fetchReleaseFeed, splitSummary } = require('../utils/releaseClient');
const { resolvePaths, selfUpdateSupported, resolvePm2Binary, currentReleaseDir, freeBytes, availableMemoryBytes } = require('../utils/deploymentPaths');
const { stageRelease, pruneReleases } = require('../utils/updateStaging');
const { buildHelperArgs, spawnHelper } = require('../utils/updateHelper');
const { createPreUpdateBackup, rotateBackups } = require('../utils/dbBackup');
const { shouldEnforceHttps } = require('../utils/securityConfig');
const { phaseLabel, isTerminal, errorMessage } = require('../constants/updatePhases');
const updateStateModel = require('../models/updateStateModel');

const CHECK_THROTTLE_MS = 10_000;
const REQUIRED_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB — archive + node_modules + headroom
// `npm ci` peaked at ~330 MB of anonymous RSS when the OOM killer took it on 2026-08-28; 512 MB of
// MemAvailable + SwapFree is that peak plus room for the running app to breathe. Below it the update
// is refused BY NAME, instead of dying under the OOM killer and reporting « Command failed ».
const REQUIRED_FREE_MEMORY_BYTES = 512 * 1024 * 1024;
const KEEP_RELEASES = 3;

let lastManualCheckAt = 0;

function healthUrl(env = process.env) {
  const protocol = shouldEnforceHttps(env) ? 'https' : 'http';
  return `${protocol}://127.0.0.1:${env.PORT || 4000}/api/version`;
}

/**
 * The versions the operator is about to cross: everything published strictly after the installed
 * version and no later than the target, newest first (rule 20d).
 *
 * Each entry is split into the digest the dialog leads with and the detail it keeps folded (rule
 * 20c). Both decisions are the server's — which releases make up "what is about to be installed",
 * and which part of each one is shown, are not renderings. A release published before the digest
 * convention has an empty `summary` and everything in `notes`, exactly what those releases have
 * always displayed.
 */
function buildVersionSpan(state, current, latest) {
  if (!latest) return [];
  return state.releases
    .filter((entry) => entry
      && isNewerVersion(entry.version, current)
      && !isNewerVersion(entry.version, latest))
    .map((entry) => {
      const { summary, details } = splitSummary(entry.notes || []);
      return {
        version: entry.version,
        publishedAt: entry.publishedAt || null,
        summary,
        notes: details,
      };
    });
}

/** The `GET /api/system/version` payload, built from local state only (no network call). */
function buildVersionInfo(model = updateStateModel) {
  const current = getAppVersion();
  const state = model.readState();
  const support = selfUpdateSupported();
  const latest = state.latestVersion;
  const versions = buildVersionSpan(state, current, latest);
  return {
    current,
    latest,
    updateAvailable: Boolean(latest) && isNewerVersion(latest, current),
    publishedAt: state.latestPublishedAt,
    versions,
    // The window stopped above the installed version: older versions exist and are not listed, and
    // the dialog says so rather than passing a partial list off as the whole span (rule 12b).
    versionsTruncated: Boolean(state.releasesTruncated) && versions.length === state.releases.length,
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

/**
 * Create the update log and write its header, so the file exists from the first second of the run.
 * Best-effort: a log that cannot be written must never abort an update that would otherwise work.
 */
function openUpdateLog(logFile, { current, targetVersion, startedAt, memory, free }) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, [
      `=== GuestFlow update ${current} → ${targetVersion} ===`,
      `started   ${startedAt}`,
      `memory    ${memory === null ? 'inconnue' : `${Math.round(memory / 1e6)} Mo disponibles`}`,
      `disk      ${free === null ? 'inconnu' : `${Math.round(free / 1e9)} Go libres`}`,
      '',
    ].join('\n'));
  } catch { /* a missing log is not a reason to refuse the update */ }
}

/** Append a line to the update log, best-effort. */
function appendUpdateLog(logFile, text) {
  try { fs.appendFileSync(logFile, `${text}\n`); } catch { /* best-effort */ }
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
    startedAt: status.startedAt || null,
    errorCode: errorCode || null,
    runningVersion: getAppVersion(),
  });
  model.releaseLock();
}

/**
 * Poll GitHub and store the result. Never throws: an unreachable GitHub leaves the last known state
 * in place (rule 14). Returns the normalised release, or null.
 *
 * A page that came back without a usable target — the newest publish missing an asset — counts as
 * a failed check, not as "there is nothing published any more". Wiping the known offer because the
 * next release was published badly would take the update away from an operator who could still
 * install the one they were already being offered.
 */
async function runVersionCheck({ model = updateStateModel, fetchImpl = fetch } = {}) {
  const feed = await fetchReleaseFeed({ fetchImpl });
  const previous = model.readState().latestVersion;
  if (!feed || !feed.release) {
    // Keep the previous answer; only stamp that we tried when we have never succeeded.
    if (!previous) model.writeState({ lastCheckAt: new Date().toISOString() });
    return null;
  }
  const { release } = feed;
  model.recordCheck(feed);
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

  const memory = availableMemoryBytes();
  if (memory !== null && memory < REQUIRED_FREE_MEMORY_BYTES) {
    model.releaseLock();
    return res.status(507).json({
      error: 'INSUFFICIENT_MEMORY',
      message: `Mémoire insuffisante (${Math.round(memory / 1e6)} Mo disponibles, `
        + `${Math.round(REQUIRED_FREE_MEMORY_BYTES / 1e6)} Mo requis). Ajoutez du swap ou de la RAM.`,
    });
  }

  const startedAt = new Date().toISOString();
  const logFile = path.join(paths.logsDir, `update-${targetVersion}-${startedAt.replace(/[:.]/g, '-')}.log`);
  // Open the log HERE, not in the helper. A staging failure never reaches the helper, and until this
  // line existed the operator was told « Voir le journal de mise à jour » about a file that had
  // never been created (2026-08-28).
  openUpdateLog(logFile, { current, targetVersion, startedAt, memory, free });
  model.startStatus({ fromVersion: current, targetVersion, logFile, startedAt });

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
    const feed = await fetchReleaseFeed({});
    const release = feed ? feed.release : null;
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
    // The staging errors encode their detail after a colon (`ARCHIVE_ABSOLUTE_MEMBER:<name>`), so the
    // prefix is the code — but ONLY when it is one we declared. A generic failure like
    // `Command failed: npm ci …` used to be truncated to « Command failed » and its cause thrown
    // away, which is exactly what hid an OOM kill on 2026-08-28. Keep the whole message.
    const raw = String(err.message || '');
    const prefix = raw.split(':')[0];
    const code = isKnownStagingCode(prefix) ? prefix : 'STAGING_FAILED';
    appendUpdateLog(logFile, `ÉCHEC (${code})`);
    appendUpdateLog(logFile, raw);
    if (err.stderr) appendUpdateLog(logFile, `--- stderr ---\n${String(err.stderr).trim()}`);
    finishInProcess(model, 'failed', code, stagingErrorMessage(code, raw));
  }
}

/** Staging failures the operator can act on, in French. */
const STAGING_MESSAGES = {
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

function isKnownStagingCode(code) {
  return Object.prototype.hasOwnProperty.call(STAGING_MESSAGES, code);
}

/**
 * `detail` is the raw error. For an unrecognised failure it is the only thing that says what went
 * wrong, so it goes in the message the operator reads rather than being dropped.
 */
function stagingErrorMessage(code, detail = '') {
  if (STAGING_MESSAGES[code]) return STAGING_MESSAGES[code];
  const trimmed = String(detail).trim().split('\n')[0].slice(0, 300);
  return trimmed
    ? `L'installation de la nouvelle version a échoué : ${trimmed}`
    : "L'installation de la nouvelle version a échoué. Voir le journal de mise à jour.";
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
  __test: {
    buildVersionInfo, buildStatus, healthUrl, stagingErrorMessage, isKnownStagingCode,
    CHECK_THROTTLE_MS, REQUIRED_FREE_BYTES, REQUIRED_FREE_MEMORY_BYTES,
  },
};
