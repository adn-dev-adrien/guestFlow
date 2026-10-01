/**
 * Paiement en ligne (Qonto) — module per specs/plugins-phase-3a-online-payment.md §3.C.
 *
 * Qonto is the payment provider of the core's money path (rule 4): this module declares it, owns its
 * settings page endpoints, its OAuth flow, its webhook and the poll job. What a payment means — the link
 * record, the request email, the paid bucket, the devis conversion — stays core, and outlives the plugin.
 */

const express = require('express');
const sdk = require('../sdk');
const { DECLARED, KEYS, createSettingsStore, bind } = require('./settingsStore');
const { createQontoProvider } = require('./provider');
const { createQontoSettingsController, mountQontoSettingsRoutes } = require('./qontoSettingsController');
const { createWebhookController } = require('./webhookController');
const { ensureWebhookSubscription } = require('./qonto/qontoWebhookRegistrar');
const { resolvePaymentPollTickMs } = require('./paymentPollSchedule');

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

  // Rule 11 — the settings page endpoints, at the URLs the Paiements page and Qonto (OAuth redirect)
  // already know.
  const router = express.Router();
  mountQontoSettingsRoutes(router, createQontoSettingsController({ settings: store }));
  ctx.mount('/api/payments', router);

  // Rule 12 — the URL registered at Qonto.
  const webhook = createWebhookController({ provider, settings: store });
  ctx.webhook('/api/payments/qonto/webhook', webhook.handleWebhook);

  // Rule 14 — the reconciliation pass, behind the webhook and the guest's own success page.
  let inProgress = false;
  ctx.jobs.every({
    name: 'payment-poll',
    intervalMs: resolvePaymentPollTickMs(),
    bootDelayMs: 110 * 1000,
    run: async () => {
      if (inProgress || !store.qontoConnected()) return;
      inProgress = true;
      try {
        // The subscription is part of the safety net (specs/settings-one-save-and-automatic-webhook.md
        // rule 11): free once recorded, and it never throws.
        await ensureWebhookSubscription({ settings: store });
        const { runPaymentPoll } = sdk.coreModule('paymentPollRunner');
        const summary = await runPaymentPoll({ ...sdk.coreModule('paymentEffectDeps').buildPaymentEffectDeps(), provider });
        if (summary.retired > 0) ctx.log.info(`${summary.retired} expired link(s) retired without a Qonto call`);
        if (summary.stoppedBy) ctx.log.warn(`pass stopped by ${summary.stoppedBy} after ${summary.checked} link(s); the rest wait for the next tick`);
        if (summary.paid > 0) ctx.log.info(`${summary.paid} paid / ${summary.checked} checked`);
      } catch (err) {
        ctx.log.error('poll pass error:', err && err.message ? err.message : err);
      } finally {
        inProgress = false;
      }
    },
  });

  // Rule 16 — only the connection is plugin data. Payment links, paid buckets and the request emails
  // are the stays' records: they stay.
  ctx.data({
    tables: [],
    describe: () => (store.qontoConnected() || store.qontoCredentials().clientId
      ? [{ label: 'la connexion Qonto (identifiants, jetons, webhook)', count: 1 }]
      : []),
    purge: resetLegacyColumns,
  });
}

module.exports = { id, register, __test: { copySettingsFromAppSettings, resetLegacyColumns } };
