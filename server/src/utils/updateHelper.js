/**
 * Spawning the detached swap helper (specs/self-update-and-releases.md §3.E rule 28).
 *
 * The helper must survive the PM2 restart that kills us, so it is started with `detached: true`
 * (its own session, immune to a signal sent to our process group), no stdio, and `unref()` so our
 * event loop does not wait on it.
 *
 * `buildHelperArgs` is pure and exported for tests: it is the boundary where a version string stops
 * being data and starts being part of a command line, so it is also where the validation lives. The
 * spawn itself uses an argv array — never a shell string — so nothing here is interpolated by a
 * shell at any point.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isValidVersion } = require('./semver');

const HELPER_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'apply-update.sh');
const DEFAULT_TIMEOUT_SECONDS = 120;

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

function spawnHelper(args, { scriptPath = HELPER_SCRIPT, spawnImpl = spawn } = {}) {
  const script = resolveHelperScript(scriptPath);
  const child = spawnImpl('bash', [script, ...args], {
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
  buildHelperArgs,
  resolveHelperScript,
  spawnHelper,
};
