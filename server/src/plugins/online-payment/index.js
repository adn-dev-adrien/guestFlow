/**
 * Paiement en ligne (Qonto) — module per specs/plugins-phase-3a-online-payment.md §3.C.
 *
 * Qonto is the payment provider of the core's money path (rule 4): this module declares it, owns its
 * settings page endpoints, its OAuth flow, its webhook and the poll job. What a payment means — the link
 * record, the request email, the paid bucket, the devis conversion — stays core, and outlives the plugin.
 */

const express = require('express');
const sdk = require('../sdk');
const { DECLARED, RECONCILIATION_DECLARED, KEYS, createSettingsStore, bind } = require('./settingsStore');
const { mountReconciliation } = require('./reconciliation');
const { createQontoProvider } = require('./provider');
const { createWebhookController } = require('./webhookController');
const { resolvePaymentPollTickMs } = require('./paymentPollSchedule');
const { createPaymentJobs } = require('./paymentJobs');

// The Qonto library is core code (specs/plugins-phase-3a-online-payment.md rule 22), shared with the
// control plane: the plugin wires it to the instance's settings and routes.
const { createQontoSettingsController, mountQontoSettingsRoutes } = sdk.coreModule('qonto').qontoSettingsController;
const { ensureWebhookSubscription } = sdk.coreModule('qonto').qontoWebhookRegistrar;

const id = 'online-payment';

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const tableColumns = (db, name) => new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name));

// Rule 13 — copied once, as stored: the five secrets keep their AES-256-GCM blobs (same key). Empty
// values are skipped; the old columns stay in place, unread.
function copySettingsFromAppSettings(db) {
  if (!hasTable(db, 'app_settings') || !hasTable(db, 'plugin_settings')) return;
  const cols = tableColumns(db, 'app_settings');
  const keys = KEYS.filter((key) => cols.has(key));
  if (keys.length === 0) return;
  const row = db.prepare(`SELECT ${keys.join(', ')} FROM app_settings WHERE id = 1`).get();
  if (!row) return;
  const insert = db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)');
  keys.forEach((key) => {
    const value = row[key];
    if (value === null || value === undefined || String(value) === '') return;
    insert.run(id, key, String(value));
  });
}

// Rule 16 — the erasure forgets the copy migration, which reruns at the next install: the old columns
// must not hand the erased connection back.
function resetLegacyColumns(db) {
  if (!hasTable(db, 'app_settings')) return;
  const cols = tableColumns(db, 'app_settings');
  const keys = KEYS.filter((key) => cols.has(key));
  if (keys.length > 0) db.prepare(`UPDATE app_settings SET ${keys.map((key) => `${key} = ''`).join(', ')} WHERE id = 1`).run();
}

function register(ctx) {
  ctx.settings.declare(DECLARED);
  ctx.settings.declare(RECONCILIATION_DECLARED);
  ctx.migrations([{ name: 'settings_from_app_settings_v1', up: copySettingsFromAppSettings }]);

  // The core settings of the plugin's own database (the app's in production, a test's in a suite).
  let core = null;
  const coreSettings = () => {
    if (!core) core = ctx.db ? sdk.coreModule('settingsModel').create(ctx.db) : sdk.coreModule('settingsModel');
    return core;
  };
  const store = createSettingsStore({ settings: ctx.settings, core: coreSettings });
  bind(store);
  const provider = createQontoProvider({ settings: store });
  ctx.paymentProvider(provider);
  // specs/plugins-phase-0-foundation.md rule 25 — the Plugins card says the connection is missing.
  ctx.setupStatus(() => (store.qontoConnected() ? null : 'à connecter'));

  // Rule 11 — the settings page endpoints, at the URLs the Paiements page and Qonto (OAuth redirect)
  // already know.
  const router = express.Router();
  mountQontoSettingsRoutes(router, createQontoSettingsController({ settings: store }));
  ctx.mount('/api/payments', router);

  // Rule 12 — the URL registered at Qonto.
  const webhook = createWebhookController({ provider, settings: store });
  ctx.webhook('/api/payments/qonto/webhook', webhook.handleWebhook);

  // Rule 14 — the reconciliation pass, behind the webhook and the guest's own success page; and the
  // lifecycle pass every 15 minutes (specs/payment-link-lifecycle.md rule 16), never at the same time.
  const effectDeps = () => ({ ...sdk.coreModule('paymentEffectDeps').buildPaymentEffectDeps(), provider });
  createPaymentJobs({
    isConnected: () => store.qontoConnected(),
    pollIntervalMs: resolvePaymentPollTickMs(),
    log: ctx.log,
    runPoll: async () => {
      // The subscription is part of the safety net (specs/settings-one-save-and-automatic-webhook.md
      // rule 11): free once recorded, and it never throws.
      await ensureWebhookSubscription({ settings: store });
      return sdk.coreModule('paymentPollRunner').runPaymentPoll(effectDeps());
    },
    runLifecycle: () => sdk.coreModule('paymentPollRunner').runLinkLifecycle(effectDeps()),
  }).forEach((job) => ctx.jobs.every(job));

  // specs/qonto-bank-reconciliation.md — the credits read from the account, the operator's decisions.
  const reconciliation = mountReconciliation(ctx, { store });

  // Rule 16 — the connection and the reconciliation's own tables are plugin data. Payment links, paid
  // buckets and the request emails are the stays' records: they stay (so do the fiches the reconciliation
  // marked — specs/qonto-bank-reconciliation.md rule 24).
  ctx.data({
    tables: reconciliation.tables,
    describe: () => [
      ...(store.qontoConnected() || store.qontoCredentials().clientId
        ? [{ label: 'la connexion Qonto (identifiants, jetons, webhook)', count: 1 }]
        : []),
      ...reconciliation.describe(),
    ],
    purge: resetLegacyColumns,
  });
}

module.exports = { id, register, __test: { copySettingsFromAppSettings, resetLegacyColumns } };
