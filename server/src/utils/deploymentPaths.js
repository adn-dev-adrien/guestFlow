/**
 * Where the running deployment lives on disk, and whether it can update itself
 * (specs/self-update-and-releases.md §3.D rule 21, §4.6).
 *
 * Target layout, created by `scripts/bootstrap-vm.sh`:
 *
 *   ~/guestflow/
 *     current -> releases/1.3.0     ← atomic symlink swap
 *     releases/<version>/{server,client,package.json}
 *     ecosystem.config.js           ← PM2 process definition (env lives here)
 *     data/{guestflow.db, .env.local, backups/, update-*.json}
 *     logs/update-<version>-<ts>.log
 *
 * A dev checkout has none of that: `selfUpdateSupported()` returns false with a reason, the UI hides
 * the update action, and the endpoints refuse with 412. Nothing here throws — a missing directory is
 * an answer, not an error.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_DB_FILE = path.resolve(__dirname, '..', '..', 'guestflow.db');

/** Same resolution order as database.js, so the data directory always matches the live DB. */
function resolveDbPath(env = process.env) {
  return env.DB_PATH || env.PERSISTENT_DB || DEFAULT_DB_FILE;
}

/**
 * The directory the live database actually lives in — following the symlink when there is one.
 *
 * `DB_PATH` is the explicit answer, but a deployment can perfectly well leave it unset and rely on
 * the historical wiring instead: `current/server/guestflow.db` symlinked into `~/guestflow/data/`.
 * That is how the production host was set up, and taking the link at face value would put the data
 * directory *inside* the release — where the update state would be wiped by the very swap it is
 * supposed to survive, and where `selfUpdateSupported()` would go looking for `releases/` and
 * `ecosystem.config.js` that are one level up. Resolving the link answers the question the caller
 * is really asking: where does the data that outlives this release live?
 */
function resolveDataDir(dbPath) {
  try {
    return path.dirname(fs.realpathSync(dbPath));
  } catch {
    // The file may not exist yet (first boot); the declared path is then the best answer.
    return path.dirname(dbPath);
  }
}

function resolvePaths(env = process.env) {
  const dbPath = resolveDbPath(env);
  const dataDir = resolveDataDir(dbPath);
  // The deploy root is `data/`'s parent — unless the operator pins it (ecosystem.config.js does).
  const deployRoot = env.GUESTFLOW_DEPLOY_ROOT || path.dirname(dataDir);
  return {
    dbPath,
    dataDir,
    deployRoot,
    backupsDir: path.join(dataDir, 'backups'),
    releasesDir: path.join(deployRoot, 'releases'),
    currentLink: path.join(deployRoot, 'current'),
    ecosystemFile: path.join(deployRoot, 'ecosystem.config.js'),
    logsDir: path.join(deployRoot, 'logs'),
    tmpDir: path.join(dataDir, 'tmp'),
    stateFile: path.join(dataDir, 'update-state.json'),
    statusFile: path.join(dataDir, 'update-status.json'),
    lockFile: path.join(dataDir, 'update.lock'),
    runtimeStateFile: path.join(dataDir, 'runtime-state.json'),
  };
}

let pm2BinaryCache;

/** Absolute path to the `pm2` binary, or null when it is not on PATH. Resolved once. */
function resolvePm2Binary() {
  if (pm2BinaryCache !== undefined) return pm2BinaryCache;
  try {
    pm2BinaryCache = execFileSync('which', ['pm2'], { encoding: 'utf8' }).trim() || null;
  } catch {
    pm2BinaryCache = null;
  }
  return pm2BinaryCache;
}

function isSymlink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * Can this instance replace itself?
 *
 * Every condition is a hard requirement of the swap phase, checked here rather than discovered
 * halfway through an update. `reason` is a French sentence shown in the UI when the answer is no.
 */
function selfUpdateSupported(env = process.env, paths = resolvePaths(env)) {
  if (String(env.GUESTFLOW_SELF_UPDATE || '').toLowerCase() === 'off') {
    return { supported: false, reason: "La mise à jour depuis l'application est désactivée sur cette instance (GUESTFLOW_SELF_UPDATE=off)." };
  }
  if (!isSymlink(paths.currentLink)) {
    return { supported: false, reason: "Ce déploiement n'utilise pas le lien symbolique « current » : mise à jour manuelle requise." };
  }
  if (!isDirectory(paths.releasesDir)) {
    return { supported: false, reason: "Le dossier « releases » du déploiement est introuvable." };
  }
  if (!isFile(paths.ecosystemFile)) {
    return { supported: false, reason: "Le fichier PM2 « ecosystem.config.js » est introuvable à la racine du déploiement." };
  }
  if (!resolvePm2Binary()) {
    return { supported: false, reason: "PM2 est introuvable : le redémarrage automatique est impossible." };
  }
  return { supported: true, reason: null };
}

/** The release directory `current` currently points at, or null. */
function currentReleaseDir(paths = resolvePaths()) {
  try {
    return fs.realpathSync(paths.currentLink);
  } catch {
    return null;
  }
}

/** Free bytes on the deployment filesystem, or null when it cannot be measured. */
function freeBytes(target) {
  try {
    return fs.statfsSync(target).bavail * fs.statfsSync(target).bsize;
  } catch {
    return null;
  }
}

module.exports = {
  resolveDbPath,
  resolveDataDir,
  resolvePaths,
  resolvePm2Binary,
  selfUpdateSupported,
  currentReleaseDir,
  freeBytes,
  __test: { isSymlink, isDirectory, isFile },
};
