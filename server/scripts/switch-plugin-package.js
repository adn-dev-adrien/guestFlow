#!/usr/bin/env node
/**
 * Switches one installed plugin of a hosted instance to a package the console pushes from its
 * registry (specs/hosting-h1-fleet-runtime.md rule 11). Run by the console, from the release the
 * instance runs, while the instance is stopped — the console snapshots the database first and starts
 * the instance after:
 *
 *   DB_PATH=<instance>/data/guestflow.db node scripts/switch-plugin-package.js \
 *     --id linen --version 1.0.2 --file <registry>/linen-1.0.2.tgz --sha256 <hex>
 *
 * The package gets the same checks as a download from the registry (size, SHA-256, members,
 * manifest), and must suit this release (its `guestflow` and `sdk` ranges). It is unpacked to
 * `<data>/plugins/<id>/<version>/`, `current` points at it, and the row records the update with the
 * previous package kept for the rollback window — what « Mettre à jour » does on the instance.
 *
 *   DB_PATH=… node scripts/switch-plugin-package.js --sync --id linen
 *
 * After a rollback (the console put the snapshot's database back): `current` follows the row again,
 * and goes when the row is back to the package its release ships.
 *
 * Like « Mettre à jour » on the instance, only a newer version is accepted — an older one only when
 * the installed package cannot run on this release (rule 14): a plugin's migrations only move forward.
 *
 * Prints one JSON line: { switched, from: { version, source }, to } or { synced, version }.
 * Exit codes: 2 usage, 4 plugin not installed, 5 package refused.
 */

const fs = require('fs');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const ROLLBACK_DAYS = 7;
const id = arg('id');
const sync = process.argv.includes('--sync');
if (!process.env.DB_PATH || !/^[a-z][a-z0-9-]{1,40}$/.test(String(id || '')) || (!sync && (!arg('version') || !arg('file') || !arg('sha256')))) {
  console.error('usage: DB_PATH=… node scripts/switch-plugin-package.js --id <id> (--version <x.y.z> --file <tgz> --sha256 <hex> | --sync)');
  process.exit(2);
}

async function main() {
  // The console runs this script as its own user, in the instance's directory: what it unpacks must
  // stay writable by the instance (its group, through the setgid directory) for its own pruning.
  process.umask(0o007);
  require('../src/database');
  const model = require('../src/models/pluginsModel');
  const { createPackageStore, resolveDistDir } = require('../src/plugins/packageStore');
  const { resolvePaths } = require('../src/utils/deploymentPaths');
  const store = createPackageStore({ dataDir: resolvePaths(process.env).dataDir, distDir: resolveDistDir(process.env) });
  const row = model.get(id);
  if (!row) {
    console.error(`Plugin ${id} non installé sur cette instance.`);
    process.exit(4);
  }
  if (sync) {
    if (row.source === 'registry') store.setCurrent(id, row.version);
    else store.clearCurrent(id);
    process.stdout.write(`${JSON.stringify({ synced: true, version: row.version })}\n`);
    return;
  }
  const version = arg('version');
  const { rangeRefusal } = require('../src/utils/pluginOffers');
  const { getAppVersion } = require('../src/utils/appVersion');
  const { SDK_VERSION } = require('../src/plugins/sdk/version');
  const { isNewerVersion, isValidVersion } = require('../src/utils/semver');
  let hostExports = null;
  try { hostExports = JSON.parse(fs.readFileSync(path.join(store.distDir, 'hostModules.json'), 'utf8')); } catch { hostExports = null; }
  const ranges = { coreVersion: getAppVersion(), sdkVersion: SDK_VERSION, hostExports };
  if (isValidVersion(row.version) && !isNewerVersion(version, row.version)) {
    const incompatible = Boolean(row.manifest && rangeRefusal(row.manifest, ranges));
    if (version === row.version || !incompatible) {
      console.error(`${id} ${version} : version antérieure ou égale à ${row.version}, refusée.`);
      process.exit(5);
    }
  }
  let pkg;
  try {
    pkg = await store.installFile({ id, version, file: arg('file'), sha256: arg('sha256') });
  } catch (err) {
    console.error(`Paquet refusé : ${err.message}`);
    process.exit(5);
  }
  const refusal = rangeRefusal(pkg.manifest, ranges);
  if (refusal) {
    store.prune(id, [row.version, row.previousVersion].filter(Boolean));
    console.error(`${id} ${version} : ${refusal.message}`);
    process.exit(5);
  }
  store.setCurrent(id, version);
  model.switchVersion(id, { version, source: 'registry', manifest: pkg.manifest, sha256: pkg.sha256 }, {
    rollbackUntil: new Date(Date.now() + ROLLBACK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  const keep = [version];
  if (row.source === 'registry' && row.version) keep.push(row.version);
  store.prune(id, keep);
  process.stdout.write(`${JSON.stringify({ switched: true, from: { version: row.version, source: row.source }, to: version })}\n`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
