const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { installDependencies } = require('../utils/updateStaging');
const { lockfileViolations, assertLockfileProvenance } = require('../utils/lockfileProvenance');

// specs/self-update-and-releases.md rule 39: before an install, the release's lockfile must resolve every
// package from the npm registry with an integrity hash; the install then runs with --ignore-scripts and a
// minimal environment. The sentinels play the part of the console's licence key, session secret and
// encryption key.

const SECRETS = {
  CP_LICENCE_PRIVATE_KEY: 'SENTINEL-LICENCE-KEY',
  CP_SESSION_SECRET: 'SENTINEL-SESSION',
  GUESTFLOW_ENCRYPTION_KEY: 'SENTINEL-ENCRYPTION',
};

function withEnv(vars, fn) {
  return async () => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}

const REG = 'https://registry.npmjs.org/';
const clean = (extra = {}) => ({
  lockfileVersion: 3,
  packages: {
    '': { name: 'x' },
    'node_modules/ok': { version: '1.0.0', resolved: `${REG}ok/-/ok-1.0.0.tgz`, integrity: 'sha512-abc' },
    ...extra,
  },
});

test('the real lockfile of this repository passes the provenance check (rule 39)', () => {
  assert.deepEqual(lockfileViolations(require('../../package-lock.json')), []);
});

test('every lockfile entry that is not a registry package with an integrity hash is refused (rule 39)', () => {
  assert.deepEqual(lockfileViolations(clean()), []);
  assert.deepEqual(lockfileViolations(clean({ 'node_modules/b': { inBundle: true, version: '1.0.0' } })), [], 'a bundled copy has no URL of its own');
  const refused = {
    'git (prepare would run)': { version: '1.0.0', resolved: 'git+ssh://git@github.com/evil/repo.git#abcdef', integrity: 'sha512-x' },
    'git over https': { version: '1.0.0', resolved: 'git+https://github.com/evil/repo.git#abcdef' },
    'file dependency': { version: '1.0.0', resolved: 'file:../evil.tgz' },
    'link dependency': { resolved: '../evil', link: true },
    'http tarball': { version: '1.0.0', resolved: 'http://registry.npmjs.org/sharp/-/sharp-1.0.0.tgz', integrity: 'sha512-x' },
    'other registry': { version: '1.0.0', resolved: 'https://registry.evil.example/sharp/-/sharp-1.0.0.tgz', integrity: 'sha512-x' },
    'look-alike host': { version: '1.0.0', resolved: 'https://registry.npmjs.org.evil.example/sharp.tgz', integrity: 'sha512-x' },
    'no integrity': { version: '1.0.0', resolved: `${REG}sharp/-/sharp-1.0.0.tgz` },
    'no resolved': { version: '1.0.0', integrity: 'sha512-x' },
    'a package named like a native module, from a tarball': { version: '1.0.0', resolved: 'https://example.com/better-sqlite3.tgz', integrity: 'sha512-x' },
  };
  for (const [name, entry] of Object.entries(refused)) {
    assert.equal(lockfileViolations(clean({ 'node_modules/sharp': entry })).length, 1, name);
  }
  assert.equal(lockfileViolations({}).length, 1);
});

function writeRelease(lock) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-prov-'));
  const releaseDir = path.join(root, 'releases', '9.9.9.partial');
  const serverDir = path.join(releaseDir, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  const leak = (name) => `node -e "require('fs').writeFileSync(${JSON.stringify(path.join(root, name))}, JSON.stringify(process.env))"`;
  fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify({
    name: 'hostile', version: '1.0.0', scripts: { preinstall: leak('preinstall.json'), postinstall: leak('postinstall.json'), prepare: leak('prepare.json') },
  }));
  if (lock) fs.writeFileSync(path.join(serverDir, 'package-lock.json'), JSON.stringify(lock));
  return { root, releaseDir };
}

test('a release with an untrusted lockfile is refused before npm runs at all (rule 39)', async () => {
  for (const lock of [
    clean({ 'node_modules/sharp': { version: '1.0.0', resolved: 'git+ssh://git@github.com/evil/repo.git#abc', integrity: 'sha512-x' } }),
    clean({ 'node_modules/better-sqlite3': { version: '1.0.0', resolved: 'file:./better-sqlite3-1.0.0.tgz', integrity: 'sha512-x' } }),
    null,
  ]) {
    const { root, releaseDir } = writeRelease(lock);
    const calls = [];
    try {
      await assert.rejects(installDependencies({ releaseDir, execFileImpl: async (...a) => { calls.push(a); } }), /^Error: LOCKFILE_UNTRUSTED:/);
      assert.deepEqual(calls, []);
      assert.throws(() => assertLockfileProvenance(path.join(releaseDir, 'server')), /LOCKFILE_UNTRUSTED/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('npm ci of a clean release runs none of its lifecycle scripts, whatever the environment holds (rule 39)', withEnv(SECRETS, async () => {
  const { root, releaseDir } = writeRelease({ lockfileVersion: 3, name: 'hostile', version: '1.0.0', packages: { '': { name: 'hostile', version: '1.0.0' } } });
  try {
    await installDependencies({
      releaseDir,
      execFileImpl: async (cmd, args, options) => {
        if (cmd === 'npm') execFileSync(cmd, args, { cwd: options.cwd, env: options.env, stdio: 'pipe' });
      },
    });
    for (const name of ['preinstall.json', 'postinstall.json', 'prepare.json']) {
      assert.equal(fs.existsSync(path.join(root, name)), false, `${name} ran`);
    }
    assert.equal(fs.existsSync(path.join(releaseDir, '.install-home')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}));

test('every child of the install gets a minimal environment, the proxy settings and a cache outside the release (rule 39)', withEnv({ ...SECRETS, HTTPS_PROXY: 'http://proxy.test:3128', NO_PROXY: 'localhost' }, async () => {
  const { root, releaseDir } = writeRelease(clean());
  const calls = [];
  try {
    await installDependencies({ releaseDir, execFileImpl: async (cmd, args, options) => { calls.push({ cmd, args, options }); } });
    assert.deepEqual(calls.map((c) => c.args[0] === 'ci' ? c.args.join(' ') : '-e'), ['ci --omit=dev --ignore-scripts', '-e']);
    for (const { options } of calls) {
      assert.equal(JSON.stringify(options.env).includes('SENTINEL'), false);
      assert.equal(options.env.CP_LICENCE_PRIVATE_KEY, undefined);
      assert.equal(options.env.HTTPS_PROXY, 'http://proxy.test:3128');
      assert.equal(options.env.NO_PROXY, 'localhost');
      assert.equal(options.env.npm_config_cache, path.join(root, 'releases', '.npm-cache'));
      assert.ok(options.env.HOME.startsWith(releaseDir));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}));
