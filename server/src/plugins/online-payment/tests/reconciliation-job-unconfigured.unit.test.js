// specs/qonto-bank-reconciliation.md rule 50 (audit R25 O1, 2026-11-06) — the 8-hour read stays quiet while the Qonto
// credentials are missing: a stored authorisation alone does not start it, so it records no « Dernier échec » beside the
// badge's own « Identifiants manquants ». No Qonto call anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { build, reset } = require('./reconciliationFixture');
const { freshSettings } = require('./qontoSettingsFixture');
const { withQonto, qontoStatusPayload } = require('../../../utils/qonto/qontoService');
const { resolveQontoConfig } = require('../../../utils/qonto/qontoConfig');

test.beforeEach(() => reset());

test('rule 50 — connected but without credentials: the job reads nothing and says it skipped', async () => {
  const { controller, calls } = build({ qontoConfigured: false });
  assert.deepEqual(await controller.runJob(), { skipped: true });
  assert.equal(calls.read, 0);
});

test('rule 50 — with credentials the job still reads', async () => {
  const { controller, calls } = build();
  await controller.runJob();
  assert.equal(calls.read, 1);
});

test('rule 50 — the job wiring asks the effective configuration, so a store with tokens and no credentials records no failure', async () => {
  const { settings } = freshSettings();
  settings.storeQontoTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(settings.qontoConnected(), true);
  assert.equal(resolveQontoConfig({ settings, env: {} }).configured, false);
  const { controller } = build({
    qontoConfigured: () => resolveQontoConfig({ settings, env: {} }).configured,
    read: () => withQonto({ settings, env: {}, origin: 'reconciliation' }, async () => ({ ok: true })),
  });
  assert.deepEqual(await controller.runJob(), { skipped: true });
  assert.equal(qontoStatusPayload({ settings, env: {} }).health.lastError, null);
  const source = fs.readFileSync(path.join(__dirname, '..', 'reconciliation', 'index.js'), 'utf8');
  assert.match(source, /qontoConfigured: \(\) => resolveQontoConfig\(\{ settings: store \}\)\.configured/);
});
