/**
 * Google Calendar controller — OAuth connect flow, calendar selection, status, test and sync
 * (specs/google-calendar-oauth-rework.md §4.3).
 *
 * Thin: OAuth mechanics live in utils/googleOAuthClient, the sync engine in
 * utils/googleCalendarSync, token storage in models/settingsModel. These handlers only
 * orchestrate the browser redirect dance + JSON endpoints:
 *   GET  /oauth/authorize  → 302 to Google consent (state stored in the session)
 *   GET  /oauth/callback   → exchange the code, store the refresh token, 302 back to /settings
 *   POST /oauth/disconnect → best-effort revoke + clear connection
 *   GET  /calendars        → the user's writable calendars (picker)
 *   PUT  /calendar         → select the target calendar (validated against the list)
 *   GET  /status           → connection/sync state + French statusLabel
 *   POST /test-connection  → calendars.get on the selected calendar
 *   POST /sync-now         → full reconcile
 *
 * The callback is reachable with the admin's session because the cookie is `sameSite=lax`
 * (a top-level GET navigation from Google carries it) — Qonto precedent.
 * Raw Google errors are logged server-side only (2026-06-01 security audit, finding M3).
 */

const crypto = require('crypto');
const settingsModel = require('../models/settingsModel');
const { buildGoogleOAuthClient } = require('../utils/googleOAuthClient');
const { testConnection, mapGoogleError } = require('../utils/googleCalendarClient');
const { getErrorStatus } = require('../utils/googleCalendarEvents');
const defaultGoogleCalendarSync = require('../utils/googleCalendarSync');

// Status labels shown in the Settings chip (spec rule 25). The client keys its chip color on
// the machine `statusKey`, never on the French label.
const STATUS_LABELS = {
  notConfigured: 'Synchronisation non configurée',
  inProgress: 'Configuration en cours',
  active: 'Synchronisation active',
  failed: 'Échec de la dernière synchro',
};

function computeStatusKey({ oauthConfigured, connected, calendarId, lastSyncOk }) {
  if (!oauthConfigured || !connected) return 'notConfigured';
  if (!calendarId) return 'inProgress';
  if (lastSyncOk === false) return 'failed';
  return 'active';
}

// Ready-to-render French « Dernière synchro » line (fat backend: the client never composes
// locale labels). `lastSyncAt` is an ISO timestamp written by recordGoogleSyncResult.
function formatLastSyncLabel(lastSyncAt, lastSyncDetail) {
  if (!lastSyncAt) return null;
  const date = new Date(lastSyncAt);
  if (Number.isNaN(date.getTime())) return lastSyncDetail || lastSyncAt;
  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris',
  });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });
  const label = `${dateFmt.format(date)} à ${timeFmt.format(date)}`;
  return lastSyncDetail ? `${label} — ${lastSyncDetail}` : label;
}

function buildController({
  settings = settingsModel,
  oauthFactory = buildGoogleOAuthClient,
  sync = defaultGoogleCalendarSync,
  connectionTest = testConnection,
} = {}) {
  async function listWritableCalendars(calendarApi) {
    const calendars = [];
    let pageToken;
    do {
      // eslint-disable-next-line no-await-in-loop
      const res = await calendarApi.calendarList.list({ maxResults: 250, pageToken });
      const data = (res && res.data) || {};
      for (const item of data.items || []) {
        if (item.accessRole === 'writer' || item.accessRole === 'owner') {
          calendars.push({
            id: String(item.id),
            summary: String(item.summary || item.id),
            primary: Boolean(item.primary),
          });
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return calendars;
  }

  function status(req, res) {
    const oauthConfigured = oauthFactory().isConfigured();
    const s = settings.googleStatus();
    const statusKey = computeStatusKey({
      oauthConfigured,
      connected: s.connected,
      calendarId: s.calendarId,
      lastSyncOk: s.lastSyncOk,
    });
    res.json({
      oauthConfigured,
      connected: s.connected,
      connectedEmail: s.connectedEmail || null,
      connectedAt: s.connectedAt,
      calendarId: s.calendarId || null,
      calendarSummary: s.calendarSummary || null,
      syncActive: s.connected && Boolean(s.calendarId),
      lastSyncAt: s.lastSyncAt,
      lastSyncOk: s.lastSyncOk,
      lastSyncDetail: s.lastSyncDetail || null,
      lastSyncLabel: formatLastSyncLabel(s.lastSyncAt, s.lastSyncDetail),
      statusKey,
      statusLabel: STATUS_LABELS[statusKey],
    });
  }

  function oauthAuthorize(req, res) {
    const oauth = oauthFactory();
    if (!oauth.isConfigured()) {
      return res.status(400).json({
        error: 'GOOGLE_OAUTH_NOT_CONFIGURED',
        message: 'Identifiants Google OAuth (client id/secret) manquants dans .env.local.',
      });
    }
    if (!oauth.resolveRedirectUri()) {
      return res.status(400).json({
        error: 'PUBLIC_URL_MISSING',
        message: "L'URL publique de GuestFlow n'est pas configurée (Paramètres) et GOOGLE_OAUTH_REDIRECT_URI est absent.",
      });
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.googleOAuthState = state;
    return res.redirect(oauth.getAuthorizeUrl({ state }));
  }

  async function oauthCallback(req, res) {
    const { code, state, error } = req.query;
    // Land back on Paramètres (the Google card reads ?google=… to show a success/error toast).
    const back = (result) => res.redirect(`/settings?google=${result}`);

    if (error) return back('error');
    const expected = req.session.googleOAuthState;
    delete req.session.googleOAuthState;
    if (!code || !state || !expected || String(state) !== String(expected)) {
      return back('invalid_state');
    }
    try {
      const tokens = await oauthFactory().exchangeCode({ code: String(code) });
      if (!tokens.refreshToken) return back('error');
      settings.storeGoogleTokens({ refreshToken: tokens.refreshToken, email: tokens.email });
      return back('connected');
    } catch (err) {
      console.error('[googleCalendarController.oauthCallback]', (err && err.response && err.response.data) || err);
      return back('error');
    }
  }

  async function oauthDisconnect(req, res) {
    try {
      // revokeToken is best-effort by contract (never throws); the DB clear always runs.
      await oauthFactory().revokeToken(settings.googleTokens().refreshToken);
      settings.clearGoogleConnection();
      return res.json({ ok: true });
    } catch (err) {
      console.error('[googleCalendarController.oauthDisconnect]', err);
      return res.status(500).json({ error: 'GOOGLE_DISCONNECT_FAILED', message: 'Erreur lors de la déconnexion du compte Google.' });
    }
  }

  function notConnectedResponse(res) {
    return res.status(400).json({
      error: 'GOOGLE_NOT_CONNECTED',
      message: 'Connectez votre compte Google avant de choisir un agenda.',
    });
  }

  function googleErrorResponse(res, tag, err) {
    console.error(`[googleCalendarController.${tag}]`, (err && err.response && err.response.data) || err);
    const mapped = mapGoogleError(err);
    return res.status(mapped.code === 'UNKNOWN' ? 500 : 400).json({ error: mapped.code, message: mapped.error });
  }

  async function listCalendars(req, res) {
    if (!settings.googleConnected()) return notConnectedResponse(res);
    try {
      const calendars = await listWritableCalendars(oauthFactory().getAuthedCalendar());
      return res.json({ calendars });
    } catch (err) {
      return googleErrorResponse(res, 'listCalendars', err);
    }
  }

  async function setCalendar(req, res) {
    if (!settings.googleConnected()) return notConnectedResponse(res);
    const calendarId = String((req.body && req.body.calendarId) || '').trim();
    if (!calendarId) {
      return res.status(400).json({ error: 'INVALID_CALENDAR', message: 'Choisissez un agenda dans la liste.' });
    }
    try {
      // Single calendarList.get instead of re-fetching the whole paginated list: validates
      // both membership and write access in one API call.
      const resp = await oauthFactory().getAuthedCalendar().calendarList.get({ calendarId });
      const entry = (resp && resp.data) || {};
      if (entry.accessRole !== 'writer' && entry.accessRole !== 'owner') {
        return res.status(400).json({ error: 'INVALID_CALENDAR', message: "Cet agenda ne fait pas partie de vos agendas modifiables." });
      }
      const summary = String(entry.summary || calendarId);
      settings.storeGoogleCalendarSelection({ calendarId: String(entry.id || calendarId), summary });
      sync.scheduleReconcile();
      return res.json({ ok: true, calendarId: String(entry.id || calendarId), calendarSummary: summary });
    } catch (err) {
      if (getErrorStatus(err) === 404) {
        return res.status(400).json({ error: 'INVALID_CALENDAR', message: "Cet agenda ne fait pas partie de vos agendas modifiables." });
      }
      return googleErrorResponse(res, 'setCalendar', err);
    }
  }

  async function testConnectionAction(req, res) {
    try {
      const { calendarId } = settings.googleCalendarSelection();
      const configured = settings.googleConnected() && Boolean(calendarId);
      const calendarApi = configured ? oauthFactory().getAuthedCalendar() : null;
      const result = await connectionTest({ calendarId, configured }, { calendarApi });
      if (result.ok) return res.json(result);
      const httpStatus = result.code === 'UNKNOWN' ? 500 : 400;
      return res.status(httpStatus).json(result);
    } catch (err) {
      console.error('[googleCalendarController.testConnection]', err);
      return res.status(500).json({ ok: false, code: 'UNKNOWN', error: 'Erreur serveur lors du test de connexion Google Calendar.' });
    }
  }

  async function syncNow(req, res) {
    if (!sync.isActive()) {
      return res.status(400).json({
        error: 'GOOGLE_SYNC_INACTIVE',
        message: 'Connectez votre compte Google et choisissez un agenda avant de synchroniser.',
      });
    }
    try {
      const result = await sync.runReconcileGuarded();
      if (result && result.alreadyRunning) {
        return res.status(409).json({ error: 'SYNC_IN_PROGRESS', message: 'Une synchronisation est déjà en cours.' });
      }
      return res.json({
        ok: result.ok,
        pushed: result.pushed,
        deleted: result.deleted,
        skipped: result.skipped,
        errors: result.errors,
        detail: result.detail || null,
      });
    } catch (error) {
      console.error('[googleCalendarController.syncNow]', (error && error.response && error.response.data) || error);
      return res.status(500).json({ error: 'GOOGLE_CALENDAR_SYNC_FAILED', message: 'Erreur lors de la synchronisation Google Calendar.' });
    }
  }

  return {
    status,
    oauthAuthorize,
    oauthCallback,
    oauthDisconnect,
    listCalendars,
    setCalendar,
    testConnection: testConnectionAction,
    syncNow,
  };
}

const defaultController = buildController();
defaultController.buildController = buildController;
defaultController.STATUS_LABELS = STATUS_LABELS;
defaultController.computeStatusKey = computeStatusKey;
defaultController.formatLastSyncLabel = formatLastSyncLabel;

module.exports = defaultController;
