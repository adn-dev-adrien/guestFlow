/**
 * Google Calendar sync engine (specs/google-calendar-oauth-rework.md §3 rules 16-24).
 *
 * Correctness comes from `reconcile()` (diff-push + orphan purge); the fire-and-forget
 * `schedulePush`/`scheduleDelete`/`scheduleReconcile` entrypoints are latency optimizations
 * hooked after reservation writes — they swallow their own errors so a Google outage can
 * never fail a user request (rule 19).
 *
 * Exports a default singleton bound to the production settings/model, plus a
 * `createGoogleCalendarSync` factory so tests inject fakes (no googleapis at test time —
 * the default `getCalendar` is a lazy thunk only invoked at run time, and the built client
 * is cached per refresh-token blob so a burst of pushes doesn't mint one access token each).
 */

const settingsModel = require('../models/settingsModel');
const googleCalendarModel = require('../models/googleCalendarModel');
const { buildGoogleOAuthClient, isInvalidGrant } = require('./googleOAuthClient');
const { mapGoogleError } = require('./googleCalendarClient');
const {
  buildGoogleEventPayload,
  getGoogleEventIdForReservation,
  upsertReservationEvent,
  deleteReservationEventById,
  eventDiffers,
  getErrorStatus,
} = require('./googleCalendarEvents');

const INVALID_GRANT_DETAIL = 'Connexion Google expirée ou révoquée. Reconnectez votre compte.';
const UNREADABLE_TOKEN_DETAIL = 'Connexion Google illisible (clé de chiffrement changée ?). Reconnectez votre compte.';

function buildRunDetail({ pushed, deleted, skipped, errors }) {
  const base = `${pushed} envoyée(s), ${deleted} supprimée(s), ${skipped} inchangée(s)`;
  return errors > 0 ? `${base} — ${errors} erreur(s)` : base;
}

function createGoogleCalendarSync({
  settings = settingsModel,
  model = googleCalendarModel,
  getCalendar = null,
  log = (...args) => console.error(...args),
} = {}) {
  // Default client cache, keyed on the ENCRYPTED token blob: no decrypt on the fast path,
  // and googleapis keeps refreshing the access token in memory instead of doing one
  // refresh-token grant per operation. Invalidated automatically on disconnect/reconnect
  // (the blob changes).
  let cachedCalendar = null;
  let cachedTokenBlob = '';
  const resolveCalendar = getCalendar || (() => {
    const blob = settings.googleTokenBlob();
    if (!blob) {
      cachedCalendar = null;
      cachedTokenBlob = '';
      return null;
    }
    if (!cachedCalendar || blob !== cachedTokenBlob) {
      cachedCalendar = buildGoogleOAuthClient({ settings }).getAuthedCalendar();
      cachedTokenBlob = blob;
    }
    return cachedCalendar;
  });

  function isActive() {
    return settings.googleConnected() && Boolean(settings.googleCalendarSelection().calendarId);
  }

  // Shared preamble: null when sync is inactive; `unreadableToken: true` when a connection
  // exists but the stored refresh token can't be used (AES key mismatch) — the caller then
  // records a failure instead of silently freezing (the blob exists, so status would
  // otherwise keep claiming « Synchronisation active » while nothing syncs).
  function activeContext() {
    if (!isActive()) return null;
    const calendar = resolveCalendar();
    if (!calendar) return { unreadableToken: true };
    const { calendarId } = settings.googleCalendarSelection();
    return { calendar, calendarId };
  }

  async function pushReservation(reservationId) {
    const ctx = activeContext();
    if (!ctx || ctx.unreadableToken) return null;
    const reservation = model.getReservationForSync(reservationId);
    if (!reservation) return null;
    return upsertReservationEvent(ctx.calendar, ctx.calendarId, reservation, reservation.options);
  }

  async function deleteReservationEvent(reservationId) {
    const ctx = activeContext();
    if (!ctx || ctx.unreadableToken) return null;
    return deleteReservationEventById(ctx.calendar, ctx.calendarId, reservationId);
  }

  async function listGuestflowEvents(calendar, calendarId) {
    const events = [];
    let pageToken;
    do {
      const res = await calendar.events.list({
        calendarId,
        privateExtendedProperty: 'guestflowSource=guestflow',
        maxResults: 2500,
        showDeleted: false,
        pageToken,
      });
      const data = (res && res.data) || {};
      events.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return events;
  }

  // Full reconcile: diff-push changed/missing reservations, purge orphan events. Per-item
  // fault isolation — one failing reservation is counted and skipped, the loop continues.
  // `invalid_grant` aborts the whole run (the token is dead; retrying per item is noise).
  async function reconcile() {
    const ctx = activeContext();
    if (!ctx) return { ok: false, inactive: true, pushed: 0, deleted: 0, skipped: 0, errors: 0 };
    if (ctx.unreadableToken) {
      settings.recordGoogleSyncResult({ ok: false, detail: UNREADABLE_TOKEN_DETAIL });
      return { ok: false, pushed: 0, deleted: 0, skipped: 0, errors: 1, detail: UNREADABLE_TOKEN_DETAIL };
    }
    const { calendar, calendarId } = ctx;

    let pushed = 0;
    let deleted = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const remoteEvents = await listGuestflowEvents(calendar, calendarId);
      // Key the canonical event (id === gfres<rid>) by reservation id; any guestflow-stamped
      // event under another id is a stray copy (e.g. duplicated in the Google UI) → purged
      // outright, otherwise it would shadow the canonical one forever.
      const remoteByReservationId = new Map();
      const strayEvents = [];
      for (const event of remoteEvents) {
        const rid = Number(event && event.extendedProperties && event.extendedProperties.private
          && event.extendedProperties.private.guestflowReservationId);
        if (!Number.isFinite(rid)) continue;
        if (event.id === getGoogleEventIdForReservation(rid)) remoteByReservationId.set(rid, event);
        else strayEvents.push(event);
      }

      const reservations = model.listReservationsForSync();
      const knownIds = new Set(reservations.map((r) => Number(r.id)));

      for (const reservation of reservations) {
        try {
          const remote = remoteByReservationId.get(Number(reservation.id));
          const desired = buildGoogleEventPayload(reservation, reservation.options);
          if (remote && !eventDiffers(remote, desired)) {
            skipped += 1;
            continue;
          }
          await upsertReservationEvent(calendar, calendarId, reservation, reservation.options, desired);
          pushed += 1;
        } catch (error) {
          if (isInvalidGrant(error)) throw error;
          errors += 1;
          log('[googleCalendarSync.reconcile] reservation', reservation.id, (error && error.response && error.response.data) || error);
        }
      }

      const orphanEvents = strayEvents.concat(
        [...remoteByReservationId.entries()]
          .filter(([rid]) => !knownIds.has(rid))
          .map(([, event]) => event),
      );
      for (const event of orphanEvents) {
        try {
          await calendar.events.delete({ calendarId, eventId: event.id });
          deleted += 1;
        } catch (error) {
          if (isInvalidGrant(error)) throw error;
          const status = getErrorStatus(error);
          if (status === 404 || status === 410) continue;
          errors += 1;
          log('[googleCalendarSync.reconcile] orphan', event.id, (error && error.response && error.response.data) || error);
        }
      }

      const ok = errors === 0;
      const detail = buildRunDetail({ pushed, deleted, skipped, errors });
      settings.recordGoogleSyncResult({ ok, detail });
      return { ok, pushed, deleted, skipped, errors, detail };
    } catch (error) {
      const detail = isInvalidGrant(error) ? INVALID_GRANT_DETAIL : mapGoogleError(error).error;
      settings.recordGoogleSyncResult({ ok: false, detail });
      log('[googleCalendarSync.reconcile]', (error && error.response && error.response.data) || error);
      return { ok: false, pushed, deleted, skipped, errors: errors + 1, detail };
    }
  }

  // Overlap guard shared by sync-now, the scheduled pass and the debounced trigger: a run
  // already in progress → skip (spec edge case). A `scheduleReconcile` received meanwhile
  // queues exactly one follow-up run.
  let reconcileInProgress = false;
  let reconcilePending = false;

  async function runReconcileGuarded() {
    if (reconcileInProgress) return { ok: false, alreadyRunning: true };
    reconcileInProgress = true;
    try {
      return await reconcile();
    } finally {
      reconcileInProgress = false;
      if (reconcilePending) {
        reconcilePending = false;
        Promise.resolve().then(() => runReconcileGuarded()).catch(log);
      }
    }
  }

  function schedulePush(reservationId) {
    Promise.resolve().then(() => pushReservation(reservationId)).catch((error) => {
      if (isInvalidGrant(error)) settings.recordGoogleSyncResult({ ok: false, detail: INVALID_GRANT_DETAIL });
      log('[googleCalendarSync.schedulePush]', reservationId, (error && error.response && error.response.data) || error);
    });
  }

  function scheduleDelete(reservationId) {
    Promise.resolve().then(() => deleteReservationEvent(reservationId)).catch((error) => {
      if (isInvalidGrant(error)) settings.recordGoogleSyncResult({ ok: false, detail: INVALID_GRANT_DETAIL });
      log('[googleCalendarSync.scheduleDelete]', reservationId, (error && error.response && error.response.data) || error);
    });
  }

  function scheduleReconcile() {
    if (reconcileInProgress) {
      reconcilePending = true;
      return;
    }
    Promise.resolve().then(() => runReconcileGuarded()).catch(log);
  }

  return {
    isActive,
    pushReservation,
    deleteReservationEvent,
    reconcile,
    runReconcileGuarded,
    schedulePush,
    scheduleDelete,
    scheduleReconcile,
  };
}

const defaultSync = createGoogleCalendarSync();
defaultSync.create = createGoogleCalendarSync;
defaultSync.INVALID_GRANT_DETAIL = INVALID_GRANT_DETAIL;
defaultSync.UNREADABLE_TOKEN_DETAIL = UNREADABLE_TOKEN_DETAIL;

module.exports = defaultSync;
