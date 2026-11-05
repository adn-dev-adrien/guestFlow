// specs/pwa-push-notifications.md rule 17 — the VAPID keys are generated once, into the instance's local env file: a second
// boot reads the same pair. Child processes, so the test's own environment stays clean.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VAPID = path.join(__dirname, '..', 'utils', 'vapid.js');

function boot(envFile) {
  const env = { ...process.env, GUESTFLOW_LOCAL_ENV: envFile, DB_PATH: ':memory:' };
  for (const name of ['NODE_TEST_CONTEXT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) delete env[name];
  const script = `const v = require(${JSON.stringify(VAPID)}); console.log(JSON.stringify(v.ensureVapid({ companyEmail: 'a@b.fr' })));`;
  const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000, env });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.trim().split('\n').pop());
}

test('rule 17: first boot writes the pair, the next one reads it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, '.env.local');
  const first = boot(envFile);
  assert.ok(first.publicKey);
  assert.equal(first.configured, true);
  assert.match(fs.readFileSync(envFile, 'utf8'), /VAPID_PRIVATE_KEY=/);
  assert.equal(boot(envFile).publicKey, first.publicKey);
});
