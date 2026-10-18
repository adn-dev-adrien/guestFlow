// specs/plugins-phase-2-hosts.md rules 31 and 32 (review follow-up of 2026-10-18): a key regenerated from
// Paramètres › Intégrations survives the next restart, even when the process manager hands the
// previous key back through the environment (pm2 saves the environment of `--update-env`).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LOCAL_ENV = path.resolve(__dirname, '../../../utils/localEnv.js');
const UPDATE_HELPER = path.resolve(__dirname, '../../../utils/updateHelper.js');

function tmpEnvFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-key-rotation-'));
  const file = path.join(dir, '.env.local');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

// One "boot" in a fresh process: the core loads .env.local, then the plugin ensures its key.
function bootAndReadKey({ envFile, inherited = {}, script }) {
  const body = script || `
    const env = require(${JSON.stringify(LOCAL_ENV)});
    env.loadLocalEnv();
    process.stdout.write(env.getOrCreateSecret('PUBLIC_API_KEY', 32, { rotatable: true }));`;
  return execFileSync(process.execPath, ['-e', body], {
    env: { PATH: process.env.PATH, GUESTFLOW_LOCAL_ENV: envFile, ...inherited },
    encoding: 'utf8',
  });
}

test('a rotated key is still served after a restart that inherits the previous key', () => {
  const envFile = tmpEnvFile('ENCRYPTION_KEY=enc\nPUBLIC_API_KEY=old-key\n');
  const rotated = bootAndReadKey({
    envFile,
    inherited: { PUBLIC_API_KEY: 'old-key' },
    script: `
      const env = require(${JSON.stringify(LOCAL_ENV)});
      env.loadLocalEnv();
      env.getOrCreateSecret('PUBLIC_API_KEY', 32, { rotatable: true });
      process.stdout.write(env.rotateSecret('PUBLIC_API_KEY', 32));`,
  });
  assert.notEqual(rotated, 'old-key');

  const afterRestart = bootAndReadKey({ envFile, inherited: { PUBLIC_API_KEY: 'old-key' } });
  assert.equal(afterRestart, rotated);
  assert.equal(fs.readFileSync(envFile, 'utf8').match(/^PUBLIC_API_KEY=/gm).length, 1);
});

test('a stale inherited key no longer blocks a second rotation', () => {
  const envFile = tmpEnvFile('PUBLIC_API_KEY=new-key\n');
  const out = bootAndReadKey({
    envFile,
    inherited: { PUBLIC_API_KEY: 'old-key' },
    script: `
      const env = require(${JSON.stringify(LOCAL_ENV)});
      env.loadLocalEnv();
      env.getOrCreateSecret('PUBLIC_API_KEY', 32, { rotatable: true });
      process.stdout.write(env.rotateSecret('PUBLIC_API_KEY', 32));`,
  });
  assert.ok(out && out !== 'old-key' && out !== 'new-key');
});

test('a key only the real environment sets is still refused rotation', () => {
  const envFile = tmpEnvFile('ENCRYPTION_KEY=enc\n');
  const out = bootAndReadKey({
    envFile,
    inherited: { PUBLIC_API_KEY: 'provisioned' },
    script: `
      const env = require(${JSON.stringify(LOCAL_ENV)});
      env.loadLocalEnv();
      try { env.rotateSecret('PUBLIC_API_KEY', 32); process.stdout.write('rotated'); }
      catch (e) { process.stdout.write(e.code); }`,
  });
  assert.equal(out, 'SECRET_FROM_ENVIRONMENT');
});

test('the self-update helper is spawned without the values .env.local holds', () => {
  const envFile = tmpEnvFile('ENCRYPTION_KEY=enc\nPUBLIC_API_KEY=file-key\n');
  const out = bootAndReadKey({
    envFile,
    inherited: { PUBLIC_API_KEY: 'stale-key', ENCRYPTION_KEY: 'enc', GF_KEEP: 'yes' },
    script: `
      const env = require(${JSON.stringify(LOCAL_ENV)});
      env.loadLocalEnv();
      env.getOrCreateSecret('PUBLIC_API_KEY', 32, { rotatable: true });
      const { spawnHelper } = require(${JSON.stringify(UPDATE_HELPER)});
      let seen;
      spawnHelper(['--x'], {
        scriptPath: __filename || '/bin/true',
        setsidPath: null,
        spawnImpl: (cmd, argv, opts) => { seen = opts.env; return { unref() {} }; },
      });
      process.stdout.write(JSON.stringify({
        key: 'PUBLIC_API_KEY' in seen, enc: 'ENCRYPTION_KEY' in seen, keep: seen.GF_KEEP,
      }));`,
  });
  assert.deepEqual(JSON.parse(out), { key: false, enc: false, keep: 'yes' });
});
