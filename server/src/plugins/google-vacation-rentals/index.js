/**
 * Google Vacation Rentals (specs/google-vacation-rentals-feed.md). Pushes to Google the website's
 * price of every stay of the horizon, and each night's availability and restrictions, for the
 * properties switched on. Simulation by default: nothing leaves the server until Google opens the
 * partner account and the operator switches to Envoi.
 *
 * Latency: a reservation or an iCal import → a run within a minute (rule 11); a saved tariff →
 * `pricing.changed`, debounced 30 s (rule 12). Correctness: the daily full re-send (rule 13).
 */

const express = require('express');
const sdk = require('../sdk');
const { MIGRATIONS, TABLES, buildModel } = require('./model');
const { declared, createSettings } = require('./settings');
const { createSource } = require('./source');
const { createGoogleClient } = require('./googleClient');
const { createPushService } = require('./pushService');
const { createAccuracyCheck } = require('./accuracyCheck');
const { createController } = require('./controller');

const id = 'google-vacation-rentals';

function register(ctx) {
  ctx.migrations(MIGRATIONS);
  ctx.settings.declare(declared(ctx.settings));

  const listProperties = () => ctx.db.prepare('SELECT id, name FROM properties ORDER BY id').all();
  const settings = createSettings({ store: ctx.settings, listProperties });

  // Built on first use: register() only declares (specs/plugins-phase-1-sdk.md §3.B).
  let parts = null;
  const get = () => {
    if (parts) return parts;
    const model = buildModel(ctx.db);
    const source = createSource({ db: ctx.db });
    const { getTodayIsoDate } = sdk.coreModule('reservationHelpers');
    const client = createGoogleClient({ mode: settings.mode, dataDir: () => ctx.dataDir });
    const pushService = createPushService({
      settings, model, client, loadState: source.loadState, capacityOf: source.capacityOf, today: getTodayIsoDate, log: ctx.log,
    });
    const accuracy = createAccuracyCheck({
      settings, model, quoteWebsite: source.quoteWebsite, sizesOf: source.sizesOf, capacityOf: source.capacityOf, today: getTodayIsoDate,
    });
    const controller = createController({
      settings, model, pushService, accuracy, siteOrigin: () => sdk.coreModule('settingsModel').publicSiteOrigin(),
    });
    parts = { model, pushService, controller };
    return parts;
  };

  // Rule 2 — what is missing, in the words of the Plugins page.
  ctx.setupStatus(() => {
    if (!settings.partnerId()) return 'identifiant partenaire manquant';
    return settings.enabledProperties().length ? null : 'aucun logement activé';
  });

  const router = express.Router();
  router.get('/status', (req, res) => get().controller.status(req, res));
  router.post('/push', (req, res) => get().controller.push(req, res));
  router.post('/check', (req, res) => get().controller.check(req, res));
  router.get('/log', (req, res) => get().controller.log(req, res));
  ctx.mount('/api/google-vacation-rentals', router);

  const propertyOfReservation = (reservationId) => {
    const row = ctx.db.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(Number(reservationId));
    return row ? row.propertyId : null;
  };
  ['reservation.created', 'reservation.updated', 'reservation.cancelled', 'reservation.deleted'].forEach((name) => {
    ctx.events.on(name, ({ reservationId } = {}) => {
      // A deleted reservation has no row left: every property is recomputed, which costs a diff.
      get().pushService.schedule(propertyOfReservation(reservationId), 'availability');
    });
  });
  ctx.events.on('ical.imported', () => get().pushService.schedule(null, 'availability'));
  ctx.events.on('pricing.changed', ({ propertyId = null } = {}) => get().pushService.schedule(propertyId, 'pricing'));

  // Rule 13 — hourly, and the full re-send runs at the configured hour once a day.
  ctx.jobs.every({
    name: 'nightly-full-resend',
    intervalMs: 60 * 60 * 1000,
    bootDelayMs: 150 * 1000,
    run: () => get().pushService.nightlyTick(),
  });

  ctx.data({
    tables: TABLES,
    describe: (db) => {
      const lines = [];
      const rates = db.prepare('SELECT COUNT(*) AS n FROM gvr_rate_snapshot').get().n;
      if (rates > 0) lines.push({ label: rates > 1 ? `${rates} prix de séjour envoyés` : '1 prix de séjour envoyé', count: rates });
      const runs = db.prepare('SELECT COUNT(*) AS n FROM gvr_push_log').get().n;
      if (runs > 0) lines.push({ label: runs > 1 ? `${runs} passages au journal` : '1 passage au journal', count: runs });
      return lines;
    },
    purge: () => {
      if (parts) parts.pushService.cancelPending();
      parts = null;
    },
  });
}

module.exports = { id, register };
