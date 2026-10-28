const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { installDependencies } = require('../utils/updateStaging');

// specs/self-update-and-releases.md rule 39: the install of a release runs with --ignore-scripts and a
// minimal environment; only the allowlisted native modules get an explicit rebuild. The sentinels play
// the part of the console's licence private key, session secret and encryption key.

const SECRETS = {
  CP_LICENCE_PRIVATE_KEY: 'SENTINEL-LICENCE-KEY',
  CP_SESSION_SECRET: 'SENTINEL-SESSION',
  GUESTFLOW_ENCRYPTION_KEY: 'SENTINEL-ENCRYPTION',
};

function withSecrets(fn) {
  return async () => {
    const saved = {};
    for (const [k, v] of Object.entries(SECRETS)) { saved[k] = process.env[k]; process.env[k] = v; }
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}

// A release whose server/package.json, and a tarball dependency named like the native module, both
// dump their environment from install scripts into the release tree.
function buildHostileRelease() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hostile-'));
  const releaseDir = path.join(root, 'release');
  const serverDir = path.join(releaseDir, 'server');
  const pkgDir = path.join(root, 'better-sqlite3');
  fs.mkdirSync(serverDir, { recursive: true });
  fs.mkdirSync(pkgDir);
  const leakOf = (name) => `require('fs').writeFileSync(require('path').resolve(${JSON.stringify(releaseDir)},'${name}.json'),JSON.stringify(process.env))`;
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: 'better-sqlite3', version: '1.0.0', main: 'index.js',
    scripts: { install: `node -e "${leakOf('rebuild-env').replace(/"/g, '\\"')}"` },
  }));
  fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = {};\n');
  execFileSync('npm', ['pack', '--pack-destination', serverDir, '--silent'], { cwd: pkgDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify({
    name: 'hostile', version: '1.0.0',
    dependencies: { 'better-sqlite3': 'file:./better-sqlite3-1.0.0.tgz' },
    scripts: { postinstall: `node -e "${leakOf('postinstall-env').replace(/"/g, '\\"')}"`, preinstall: `node -e "${leakOf('preinstall-env').replace(/"/g, '\\"')}"` },
  }));
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--silent'], { cwd: serverDir, stdio: 'pipe', env: { ...process.env, npm_config_cache: path.join(root, 'cache') } });
  return { root, releaseDir };
}

test('install scripts of a release never see the installer secrets (rule 39)', withSecrets(async () => {
  const { root, releaseDir } = buildHostileRelease();
  try {
    await installDependencies({ releaseDir });
    // Root scripts are skipped altogether under --ignore-scripts.
    assert.equal(fs.existsSync(path.join(releaseDir, 'postinstall-env.json')), false);
    assert.equal(fs.existsSync(path.join(releaseDir, 'preinstall-env.json')), false);
    // The allowlisted native module is rebuilt, with a minimal environment.
    const env = JSON.parse(fs.readFileSync(path.join(releaseDir, 'rebuild-env.json'), 'utf8'));
    for (const name of Object.keys(SECRETS)) assert.equal(env[name], undefined, `${name} leaked`);
    assert.equal(JSON.stringify(env).includes('SENTINEL'), false);
    assert.equal(env.npm_config_build_from_source, 'true');
    assert.equal(fs.existsSync(path.join(releaseDir, '.install-home')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}));

test('every child of the install gets the minimal environment, and only allowlisted modules are rebuilt (rule 39)', withSecrets(async () => {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-install-calls-'));
  fs.mkdirSync(path.join(releaseDir, 'server', 'node_modules', 'sharp'), { recursive: true });
  fs.mkdirSync(path.join(releaseDir, 'server', 'node_modules', 'better-sqlite3'), { recursive: true });
  fs.mkdirSync(path.join(releaseDir, 'server', 'node_modules', 'evil-native'), { recursive: true });
  const calls = [];
  try {
    await installDependencies({ releaseDir, execFileImpl: async (cmd, args, options) => { calls.push({ cmd, args, options }); } });
    assert.deepEqual(calls[0].args, ['ci', '--omit=dev', '--ignore-scripts']);
    assert.deepEqual(calls.slice(1, -1).map((c) => c.args.join(' ')), ['rebuild better-sqlite3', 'rebuild sharp']);
    for (const call of calls) {
      assert.ok(call.options.env, 'explicit env');
      assert.equal(JSON.stringify(call.options.env).includes('SENTINEL'), false);
      assert.equal(call.options.env.CP_LICENCE_PRIVATE_KEY, undefined);
      assert.ok(call.options.env.HOME.startsWith(releaseDir));
      assert.ok(call.options.env.npm_config_cache.startsWith(releaseDir));
    }
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
}));
