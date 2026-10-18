// specs/hosting-h1-fleet-runtime.md rules 26 and 27 — what the operator no longer types by hand:
// bootstrap generates the licence key pair (Ed25519, base64 DER, the format the console loads) once,
// and the object storage keys are typed once — rclone's remote and keys are derived from the
// console's own environment, so no `rclone config` and no second copy to keep in step.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadPrivateKey } = require('../utils/licenceIssuer');
const { createDrivers, rcloneTarget } = require('../utils/drivers');
const { createLitestreamBackupDriver } = require('../utils/drivers/backup-litestream');

const DEPLOY = path.join(__dirname, '..', '..', '..', '..', 'deploy', 'hosting');
const BOOTSTRAP = fs.readFileSync(path.join(DEPLOY, 'bootstrap-host.sh'), 'utf8');

// The script's own lines: env_get / env_set and the « Rule 26 » block, run on a scratch env file.
function runKeyBlock(envFile) {
  const start = BOOTSTRAP.indexOf('env_get() {');
  const end = BOOTSTRAP.indexOf('# Rule 27');
  assert.ok(start > 0 && end > start, 'the key block is where the test expects it');
  const snippet = `set -euo pipefail\nENVF=${JSON.stringify(envFile)}\nsay() { printf '%s\\n' "$*"; }\n${BOOTSTRAP.slice(start, end)}`;
  return execFileSync('bash', ['-c', snippet], { encoding: 'utf8' });
}

test('rule 26 — bootstrap generates the licence key the console loads, prints the public one, and never replaces it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-bootstrap-'));
  const envFile = path.join(dir, 'env');
  try {
    fs.writeFileSync(envFile, 'CP_DOMAIN=guestflow.test\nCP_LICENCE_PRIVATE_KEY=\nCP_SMTP_HOST=\n');
    const out = runKeyBlock(envFile);
    const value = /^CP_LICENCE_PRIVATE_KEY=(.+)$/m.exec(fs.readFileSync(envFile, 'utf8'))[1];
    const key = loadPrivateKey(value);
    assert.equal(key.asymmetricKeyType, 'ed25519');
    const spki = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
    assert.match(out, /clé de licence générée .* à copier hors ligne/);
    assert.ok(out.includes(`clé publique : ${spki}`));
    assert.match(fs.readFileSync(envFile, 'utf8'), /^CP_DOMAIN=guestflow\.test$/m, 'the other lines are kept');

    const again = runKeyBlock(envFile);
    assert.match(again, /clé de licence déjà en place/);
    assert.equal(/^CP_LICENCE_PRIVATE_KEY=(.+)$/m.exec(fs.readFileSync(envFile, 'utf8'))[1], value);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 27 — the rclone remote and its keys come from the console’s environment', () => {
  const env = {
    CP_BACKUP_URL: 's3://guestflow-backups/fleet/',
    CP_BACKUP_ENDPOINT: 'https://s3.fr-par.scw.cloud',
    CP_BACKUP_REGION: 'fr-par',
    LITESTREAM_ACCESS_KEY_ID: 'AK',
    LITESTREAM_SECRET_ACCESS_KEY: 'SK',
  };
  const t = rcloneTarget(env);
  assert.equal(t.remote, 'gfbackup:guestflow-backups/fleet');
  assert.deepEqual(t.env, {
    RCLONE_CONFIG_GFBACKUP_TYPE: 's3',
    RCLONE_CONFIG_GFBACKUP_PROVIDER: 'Other',
    RCLONE_CONFIG_GFBACKUP_ENV_AUTH: 'false',
    RCLONE_CONFIG_GFBACKUP_ACCESS_KEY_ID: 'AK',
    RCLONE_CONFIG_GFBACKUP_SECRET_ACCESS_KEY: 'SK',
    RCLONE_CONFIG_GFBACKUP_ENDPOINT: 'https://s3.fr-par.scw.cloud',
    RCLONE_CONFIG_GFBACKUP_REGION: 'fr-par',
  });
  assert.deepEqual(rcloneTarget({ ...env, CP_RCLONE_REMOTE: 'mine:bucket' }), { remote: 'mine:bucket', env: null }, 'a hand-made remote wins');
  assert.deepEqual(rcloneTarget({}), { remote: null, env: null });
  const drivers = createDrivers({ env: { ...env, CP_BACKUP_DRIVER: 'litestream' }, root: '/srv/i', releasesDir: '/srv/r', dataDir: os.tmpdir(), domain: 'guestflow.test' });
  assert.equal(drivers.backup.name, 'litestream');
});

test('rule 27 — rclone runs with that environment; no remote at all is a clear error', async () => {
  const calls = [];
  const exec = async (bin, args, opts) => { calls.push({ bin, args, env: opts && opts.env }); return { stdout: '' }; };
  const d = createLitestreamBackupDriver({ exec, listReplicas: () => [], url: 's3://b/f', rcloneRemote: 'gfbackup:b/f', rcloneEnv: { RCLONE_CONFIG_GFBACKUP_TYPE: 's3' } });
  await d.purge({ key: 'c3' });
  assert.deepEqual(calls[0].args, ['purge', 'gfbackup:b/f/c3']);
  assert.equal(calls[0].env.RCLONE_CONFIG_GFBACKUP_TYPE, 's3');
  const none = createLitestreamBackupDriver({ exec, listReplicas: () => [], url: 's3://b/f' });
  await assert.rejects(none.purge({ key: 'c3' }), /Stockage objet non configuré/);
});

test('rule 27 — bootstrap writes Litestream’s keys from the console’s env, and asks for no rclone config', () => {
  assert.match(BOOTSTRAP, /printf 'LITESTREAM_ACCESS_KEY_ID=%s\\nLITESTREAM_SECRET_ACCESS_KEY=%s\\n' "\$\(env_get LITESTREAM_ACCESS_KEY_ID\)" "\$\(env_get LITESTREAM_SECRET_ACCESS_KEY\)" > \/etc\/default\/litestream/);
  assert.doesNotMatch(BOOTSTRAP.replace(/^\s*#.*$/gm, ''), /rclone config/, 'no command runs it');
  const example = fs.readFileSync(path.join(DEPLOY, 'console.env.example'), 'utf8');
  assert.doesNotMatch(example, /^CP_RCLONE_REMOTE=/m);
});
