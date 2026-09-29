/**
 * Google Agenda (specs/google-calendar-oauth-rework.md; module per specs/plugins-phase-1-sdk.md).
 * Every stay pushed to the operator's Google calendar. The reservation events are the latency path;
 * the 15-minute reconcile is the correctness path (it also catches any event a handler missed).
 */

const express = require('express');
const syncEngine = require('./sync');
const { buildModel } = require('./model');
const { buildController } = require('./controller');
const { createGoogleSettings, DECLARED } = require('./settings');

const id = 'google-calendar';

function register(ctx) {
  ctx.settings.declare(DECLARED);
  const settings = createGoogleSettings({ store: ctx.settings, publicUrl: () => ctx.core.settings.publicUrl() });

  // Reads core tables only (reservations, properties, clients, options); built on first use.
  let model = null;
  const lazyModel = new Proxy({}, {
    get: (_, key) => {
      if (!model) model = buildModel(ctx.db);
      return model[key];
    },
  });

  const sync = syncEngine.create({ settings, model: lazyModel, pluginActive: ctx.isLive, log: ctx.log.error });
  const controller = buildController({ settings, sync });

  const router = express.Router();
  router.get('/status', controller.status);
  router.get('/oauth/authorize', controller.oauthAuthorize);
  router.get('/oauth/callback', controller.oauthCallback);
  router.post('/oauth/disconnect', controller.oauthDisconnect);
  router.get('/calendars', controller.listCalendars);
  router.put('/calendar', controller.setCalendar);
  router.post('/test-connection', controller.testConnection);
  router.post('/sync-now', controller.syncNow);
  // The callback URL is registered in the Google console: it must not move (rule 5).
  ctx.mount('/api/google-calendar', router);

  ctx.events.on('reservation.created', ({ reservationId }) => sync.schedulePush(reservationId));
  ctx.events.on('reservation.updated', ({ reservationId }) => sync.schedulePush(reservationId));
  ctx.events.on('reservation.cancelled', ({ reservationId }) => sync.scheduleDelete(reservationId));
  ctx.events.on('reservation.deleted', ({ reservationId }) => sync.scheduleDelete(reservationId));
  ctx.events.on('ical.imported', () => sync.scheduleReconcile());

  // specs/google-calendar-oauth-rework.md §3 rule 22 — silent no-op until a calendar is chosen.
  ctx.jobs.every({
    name: 'reconcile',
    intervalMs: 15 * 60 * 1000,
    bootDelayMs: 130 * 1000,
    run: async () => {
      if (!sync.isActive()) return;
      const result = await sync.runReconcileGuarded();
      if (result && !result.alreadyRunning && (result.pushed || result.deleted || result.errors)) {
        ctx.log.info(`reconcile: ${result.pushed} pushed, ${result.deleted} deleted, ${result.skipped} unchanged, ${result.errors} error(s)`);
      }
    },
  });

  ctx.data({
    tables: [],
    describe: () => (settings.googleConnected()
      ? [{ label: `la connexion Google${settings.googleStatus().connectedEmail ? ` (${settings.googleStatus().connectedEmail})` : ''}`, count: 1 }]
      : []),
  });
}

module.exports = { id, register };
