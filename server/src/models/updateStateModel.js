/**
 * Persistent state of the self-update engine (specs/self-update-and-releases.md §5).
 *
 * Unusually for a model, this one is backed by JSON files rather than SQLite, for two reasons that
 * the database cannot satisfy:
 *   1. the status has to survive the process being replaced mid-update, and be readable by the *new*
 *      process to report the outcome of the update that killed the previous one;
 *   2. `server/scripts/apply-update.sh` — a shell script running after we are dead — has to write to
 *      it, and shelling out to sqlite3 from there would add a dependency the VM may not have.
 *
 * Four files, each with a single writer:
 *   update-state.json   ← this process: last known release, last check, dismissal, history
 *   update-status.json  ← this process during staging, then the helper during the swap
 *   update.lock         ← this process: concurrency guard
 *   runtime-state.json  ← this process at boot: which version actually came up
 *
 * Every write is atomic (tmp file + rename) so a crash can never leave a half-written state that
 * would be read back as garbage.
 */

const fs = require('fs');
const path = require('path');
const { resolvePaths } = require('../utils/deploymentPaths');
const { isTerminal } = require('../constants/updatePhases');

const LOCK_STALE_MS = 30 * 60 * 1000;
const HISTORY_MAX = 5;

// Phases where the swap has physically happened and only its *outcome* is still unwritten.
const SWAP_PHASES = new Set(['swapping', 'restarting']);

/**
 * The verdict the swap helper would have written, had it lived long enough — or null when the
 * status is not one it abandoned.
 *
 * PM2 tree-kills every descendant of the process it restarts, and the helper was one of them, so a
 * helper that dies mid-restart is not a freak event: it is what happened on every update installed
 * by a version that spawns it without `setsid --fork` (§3.E rule 28). Left alone, the status file
 * stays non-terminal forever, and the client overlay spins on it — through reloads — with no way
 * out. The version that actually came up settles it: the target means the swap worked; the version
 * we were coming *from*, with a failure already recorded, means the rollback worked.
 */
function concludeAbandonedSwap(status, runningVersion) {
  if (!status || isTerminal(status.phase) || !SWAP_PHASES.has(status.phase)) return null;
  if (!runningVersion) return null;
  if (!status.errorCode && status.targetVersion === runningVersion) return 'done';
  if (status.errorCode && status.fromVersion === runningVersion) return 'rolled_back';
  return null;
}

const EMPTY_STATE = {
  latestVersion: null,
  latestPublishedAt: null,
  latestNotes: null,
  // The WordPress plugin asset published alongside that release — the plugin polls for it through
  // the public API (specs/wordpress-plugin-self-update.md).
  latestPlugin: null,
  lastCheckAt: null,
  dismissedVersion: null,
  history: [],
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function createUpdateStateModel(paths = resolvePaths()) {
  // ---- last known release + operator decisions -------------------------------------------------

  function readState() {
    const raw = readJson(paths.stateFile, null);
    if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
    return {
      ...EMPTY_STATE,
      ...raw,
      history: Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_MAX) : [],
    };
  }

  function writeState(patch) {
    const next = { ...readState(), ...patch };
    writeJsonAtomic(paths.stateFile, next);
    return next;
  }

  /** Store the result of a successful poll. `release` is a normalised release, or null. */
  function recordCheck(release, now = new Date()) {
    return writeState({
      lastCheckAt: now.toISOString(),
      latestVersion: release ? release.version : null,
      latestPublishedAt: release ? release.publishedAt : null,
      latestNotes: release ? release.notes : null,
      latestPlugin: release ? release.plugin : null,
    });
  }

  function dismissVersion(version) {
    return writeState({ dismissedVersion: version });
  }

  /**
   * Newest first, capped at HISTORY_MAX. Returns the entry when it changed the history, else null.
   *
   * One line per update *run*, keyed on its `startedAt`. The flag in the status file cannot carry
   * that on its own: the helper rewrites the whole document when it finishes, `historyRecorded`
   * included, so a boot that already concluded the update would otherwise log it a second time. A
   * later boot reporting a *different* outcome for the same run replaces the line rather than
   * adding one — a rollback must never leave a stale "done" standing next to it.
   */
  function recordHistory(entry) {
    const state = readState();
    const sameRun = entry.startedAt
      ? state.history.find((e) => e.startedAt === entry.startedAt)
      : null;
    if (sameRun && sameRun.result === entry.result) return null;
    const rest = sameRun ? state.history.filter((e) => e !== sameRun) : state.history;
    writeState({ history: [entry, ...rest].slice(0, HISTORY_MAX) });
    return entry;
  }

  // ---- live status -----------------------------------------------------------------------------

  function readStatus() {
    const raw = readJson(paths.statusFile, null);
    if (!raw || typeof raw !== 'object' || typeof raw.phase !== 'string') {
      return { phase: 'idle' };
    }
    return raw;
  }

  function writeStatus(patch) {
    const current = readStatus();
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    writeJsonAtomic(paths.statusFile, next);
    return next;
  }

  // `startedAt` identifies the run: the caller passes the same value to the helper, so the status
  // file and `apply-update.sh` agree on it and the history can be keyed on it.
  function startStatus({ fromVersion, targetVersion, logFile, startedAt }) {
    const next = {
      phase: 'checking',
      fromVersion,
      targetVersion,
      logFile: logFile || null,
      startedAt: startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      historyRecorded: false,
    };
    writeJsonAtomic(paths.statusFile, next);
    return next;
  }

  // ---- concurrency lock ------------------------------------------------------------------------

  function readLock() {
    return readJson(paths.lockFile, null);
  }

  function isLockStale(lock, now = Date.now()) {
    if (!lock || !lock.startedAt) return true;
    const startedAt = Date.parse(lock.startedAt);
    if (Number.isNaN(startedAt)) return true;
    return now - startedAt > LOCK_STALE_MS;
  }

  /** True when an update is genuinely running right now. */
  function isLocked(now = Date.now()) {
    const lock = readLock();
    return Boolean(lock) && !isLockStale(lock, now);
  }

  function acquireLock(targetVersion) {
    if (isLocked()) return false;
    writeJsonAtomic(paths.lockFile, {
      pid: process.pid,
      targetVersion,
      startedAt: new Date().toISOString(),
    });
    return true;
  }

  function releaseLock() {
    try {
      fs.rmSync(paths.lockFile, { force: true });
    } catch {
      // Nothing to do: a leftover lock goes stale on its own after LOCK_STALE_MS.
    }
  }

  // ---- boot -------------------------------------------------------------------------------------

  /** Stamp which version actually came up — how the helper proves the swap worked. */
  function writeRuntimeState(version, now = new Date()) {
    writeJsonAtomic(paths.runtimeStateFile, {
      version,
      pid: process.pid,
      bootedAt: now.toISOString(),
    });
  }

  /**
   * Called once at boot: conclude a swap the helper never reported, turn a finished update into a
   * history entry exactly once, and drop the lock the dead process could not release itself.
   */
  function reconcileOnBoot(runningVersion, now = new Date()) {
    let status = readStatus();

    // We are the proof the helper was waiting for. If it never got to write the outcome, write it.
    const verdict = concludeAbandonedSwap(status, runningVersion);
    if (verdict) status = writeStatus({ phase: verdict });

    if (!isTerminal(status.phase) || status.phase === 'idle') {
      // A non-terminal phase at boot means the process died mid-update: the helper is either still
      // working (it will overwrite this) or it died too. Either way the lock must not outlive us.
      if (status.phase !== 'idle') releaseLock();
      return null;
    }
    releaseLock();
    if (status.historyRecorded) return null;
    const entry = {
      from: status.fromVersion || null,
      to: status.targetVersion || null,
      result: status.phase,
      at: status.updatedAt || now.toISOString(),
      startedAt: status.startedAt || null,
      errorCode: status.errorCode || null,
      runningVersion,
    };
    const recorded = recordHistory(entry);
    writeStatus({ historyRecorded: true });
    return recorded;
  }

  /** Last lines of the helper log, for the failure card in the UI. */
  function readLogTail(logFile, maxLines = 50) {
    if (!logFile) return [];
    try {
      return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-maxLines);
    } catch {
      return [];
    }
  }

  return {
    paths,
    readState,
    writeState,
    recordCheck,
    dismissVersion,
    recordHistory,
    readStatus,
    writeStatus,
    startStatus,
    readLock,
    isLocked,
    isLockStale,
    acquireLock,
    releaseLock,
    writeRuntimeState,
    reconcileOnBoot,
    readLogTail,
    HISTORY_MAX,
    LOCK_STALE_MS,
  };
}

module.exports = createUpdateStateModel();
module.exports.createUpdateStateModel = createUpdateStateModel;
module.exports.concludeAbandonedSwap = concludeAbandonedSwap;
module.exports.SWAP_PHASES = SWAP_PHASES;
