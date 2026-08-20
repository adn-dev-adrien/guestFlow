/**
 * Spawning the detached swap helper (specs/self-update-and-releases.md §3.E rule 28).
 *
 * The helper must survive the PM2 restart it triggers, and a new *session* is not enough for that.
 * PM2 stops a process with `treekill` (its default): it walks the descendants of the process it is
 * about to kill, by PPID, and signals all of them. `detached: true` calls `setsid(2)`, which changes
 * the session and the process group — it does NOT change the parent. The helper therefore stayed a
 * child of the very process PM2 was restarting, and was killed in the middle of the restart it had
 * just asked for: observed in production on 2026-08-20, where the 2.0.0 → 2.1.0 swap completed but
 * its log stopped at `[PM2] Applying action restartProcessId` and the status file was left on
 * `restarting` forever — with no rollback left standing had the new version failed to boot.
 *
 * The fix is to leave the tree entirely: the helper is launched through `setsid --fork`, which forks
 * and exits, so the shell running the swap is re-parented to PID 1 before PM2 ever looks. Hosts
 * without util-linux fall back to the plain spawn — degraded, but no worse than before.
 *
 * `buildHelperArgs` and `buildSpawnCommand` are pure and exported for tests: the first is the
 * boundary where a version string stops being data and starts being part of a command line, so it is
 * also where the validation lives. Both produce an argv array — never a shell string — so nothing
 * here is interpolated by a shell at any point.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isValidVersion } = require('./semver');

const HELPER_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'apply-update.sh');
const DEFAULT_TIMEOUT_SECONDS = 120;

// Absolute paths only: this is the one command spawned right before the application is restarted,
// and a PATH lookup is not a decision to leave to whatever environment PM2 happens to pass down.
const SETSID_CANDIDATES = ['/usr/bin/setsid', '/bin/setsid'];

// Versions reach a printf format string inside the shell helper; keep them to characters that
// cannot break out of a JSON string.
const SAFE_VERSION_RE = /^[A-Za-z0-9._-]+$/;

function buildHelperArgs({
  paths,
  targetVersion,
  fromVersion,
  previousDir,
  pm2Binary,
  healthUrl,
  logFile,
  startedAt,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
}) {
  if (!isValidVersion(targetVersion)) throw new Error('INVALID_TARGET_VERSION');
  if (!SAFE_VERSION_RE.test(String(fromVersion))) throw new Error('INVALID_FROM_VERSION');
  if (!pm2Binary) throw new Error('PM2_NOT_FOUND');
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 1800) {
    throw new Error('INVALID_TIMEOUT');
  }

  return [
    '--root', paths.deployRoot,
    '--target', targetVersion,
    '--from', String(fromVersion),
    '--previous-dir', previousDir || '',
    '--pm2', pm2Binary,
    '--ecosystem', paths.ecosystemFile,
    '--status', paths.statusFile,
    '--runtime', paths.runtimeStateFile,
    '--log', logFile,
    '--health', healthUrl,
    '--started-at', startedAt,
    '--timeout', String(timeoutSeconds),
  ];
}

/**
 * Resolve the helper through its real path before spawning: the update is about to repoint the
 * `current` symlink under our feet, and bash reads a script incrementally. Opening the concrete
 * file in `releases/<running>/` keeps the running helper on the inode it started with.
 */
function resolveHelperScript(scriptPath = HELPER_SCRIPT) {
  try {
    return fs.realpathSync(scriptPath);
  } catch {
    return scriptPath;
  }
}

/** The `setsid` binary, or null when the host has none (macOS dev machines, minimal images). */
function resolveSetsid(candidates = SETSID_CANDIDATES, existsImpl = fs.existsSync) {
  return candidates.find((candidate) => existsImpl(candidate)) || null;
}

/**
 * What to spawn, as `{ command, argv }`.
 *
 * `setsid --fork` always forks and lets the parent exit, so the helper ends up owned by PID 1 and is
 * no longer a descendant of the process PM2 is restarting. `--fork` is what makes that guaranteed:
 * without it `setsid` only forks when it already leads its process group, which — because Node's
 * `detached: true` has just made it one — would be the case here, but relying on that would make the
 * whole rollback path depend on a coincidence of two flags.
 */
function buildSpawnCommand({ script, args, setsidPath = resolveSetsid() }) {
  if (setsidPath) return { command: setsidPath, argv: ['--fork', 'bash', script, ...args] };
  return { command: 'bash', argv: [script, ...args] };
}

function spawnHelper(args, { scriptPath = HELPER_SCRIPT, spawnImpl = spawn, setsidPath = resolveSetsid() } = {}) {
  const script = resolveHelperScript(scriptPath);
  const { command, argv } = buildSpawnCommand({ script, args, setsidPath });
  const child = spawnImpl(command, argv, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child;
}

module.exports = {
  HELPER_SCRIPT,
  DEFAULT_TIMEOUT_SECONDS,
  SETSID_CANDIDATES,
  buildHelperArgs,
  buildSpawnCommand,
  resolveSetsid,
  resolveHelperScript,
  spawnHelper,
};
