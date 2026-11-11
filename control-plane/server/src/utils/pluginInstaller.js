/**
 * Pushing a plugin version from the console's registry to an instance (specs/hosting-h1-fleet-runtime.md
 * rule 11). The fleet updater calls it with the instance stopped and its database snapshotted:
 *
 *   install(inst, id, version)  runs the instance's own `server/scripts/switch-plugin-package.js`, of
 *                               the release the instance runs, on the registry's package file and its
 *                               SHA-256 — the instance's own checks, then its row and `current`.
 *   rollback(inst, id)          after the snapshot's database is back: `current` follows the row
 *                               again (`--sync`).
 *
 * A version withdrawn from the registry is never pushed. `runScript` is injected for the unit suites.
 */

const { execFile } = require('child_process');
const path = require('path');
const { semver } = require('./gf');

function defaultRunScript({ script, args, dbPath, timeout = 120000 }) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...args], { cwd: path.dirname(path.dirname(script)), env: { PATH: process.env.PATH, DB_PATH: dbPath }, timeout },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((String(stderr || '').trim().split('\n').pop()) || err.message));
        try {
          const lines = String(stdout).trim().split('\n');
          return resolve(JSON.parse(lines[lines.length - 1]));
        } catch {
          return reject(new Error('Réponse illisible du script de l’instance.'));
        }
      });
  });
}

function createPluginInstaller({ registry, releases, runScript = defaultRunScript }) {
  function scriptOf(inst) {
    if (!inst.version || !releases.has(inst.version)) throw new Error(`Version ${inst.version || 'inconnue'} absente de l’hôte.`);
    return path.join(releases.dirOf(inst.version), 'server', 'scripts', 'switch-plugin-package.js');
  }

  // The published, not withdrawn, versions of a plugin, newest first.
  function published(id) {
    return registry.list().filter((r) => r.id === id && !r.withdrawnAt).map((r) => r.version)
      .sort((a, b) => (semver.isNewerVersion(a, b) ? -1 : semver.isNewerVersion(b, a) ? 1 : 0));
  }

  async function install(inst, id, version) {
    const row = registry.list().find((r) => r.id === id && r.version === version && !r.withdrawnAt);
    const file = row ? registry.packageFile(`${id}-${version}.tgz`) : null;
    if (!file) throw new Error(`${id} ${version} n’est pas publié dans le registre.`);
    return runScript({ script: scriptOf(inst), args: ['--id', id, '--version', version, '--file', file, '--sha256', row.sha256], dbPath: inst.dbPath });
  }

  async function rollback(inst, id) {
    return runScript({ script: scriptOf(inst), args: ['--sync', '--id', id], dbPath: inst.dbPath });
  }

  return { install, rollback, published };
}

module.exports = { createPluginInstaller, defaultRunScript };
