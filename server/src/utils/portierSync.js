/**
 * Pushing stays and the logo to Portier through the outbox (specs/gate-access-portier.md §3.1, §3.5).
 *
 * The write and the send are two different moments, on purpose:
 *
 *   - `pushStay`, `cancelStay`, `pushBranding` only INSERT an outbox row, with the caller's database
 *     handle, so the row joins whatever transaction the caller is in. A rolled-back reservation
 *     change therefore leaves no push behind, and a committed one can never lose its push.
 *   - `drain()` sends the rows afterwards. Each write schedules one with `setImmediate`, which
 *     better-sqlite3's synchronous transactions guarantee runs after the commit (or the rollback).
 *
 * The row id is the push's revision: pushes and cancels of one reservation share Portier's counter,
 * so a late push is recognised as late. Rows are sent in id order within a reservation; a failing
 * row holds back the later rows of its own reservation only.
 *
 * No timer runs while nothing fails. A failure arms ONE timer for the earliest retry, with a back-off
 * of 30 s, 1, 2, 5, 15 minutes, then hourly. Without `PORTIER_SVC_URL`/`PORTIER_KEY_GF` the rows are
 * kept and nothing is attempted.
 *
 * Unlike Google Calendar (fire-and-forget corrected by a reconcile), a gate access cannot wait for a
 * reconcile: a lost push is a guest locked out at the gate.
 */

const fs = require('fs');
const path = require('path');
const { computeWindow } = require('./gateWindow');
const { buildModel } = require('../models/portierOutboxModel');

const CANCEL_REASONS = new Set(['cancelled', 'deleted', 'devis']);
const BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const HOURLY_MS = 60 * 60 * 1000;
const SENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FAILING_VISIBLE_AFTER_MS = 60 * 60 * 1000;
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const LOGO_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

// A handful of model unit tests run the reservation write paths against minimal in-memory schemas
// that predate the outbox. Production always has the table (database.js creates it at boot).
const outboxPresence = new WeakMap();
const models = new WeakMap();

function hasOutbox(database) {
  if (!outboxPresence.has(database)) {
    const row = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'portier_outbox'").get();
    outboxPresence.set(database, Boolean(row));
  }
  return outboxPresence.get(database);
}

function modelFor(database) {
  if (!models.has(database)) models.set(database, buildModel(database));
  return models.get(database);
}

function backoffDelay(attempts) {
  return attempts >= 1 && attempts <= BACKOFF_MS.length ? BACKOFF_MS[attempts - 1] : HOURLY_MS;
}

/** What Portier needs to know about a stay — nothing else about the reservation concerns the gate. */
function stayPayload(database, reservationId) {
  const row = database.prepare(`
    SELECT r.id, r.kind, r.startDate, r.endDate, r.checkInTime, r.checkOutTime, r.reservationNumber,
           p.name AS propertyName, c.firstName, c.lastName
      FROM reservations r
      LEFT JOIN properties p ON p.id = r.propertyId
      LEFT JOIN clients c ON c.id = r.clientId
     WHERE r.id = ?
  `).get(Number(reservationId));
  if (!row || String(row.kind || 'reservation') !== 'reservation') return null;
  const window = computeWindow(row);
  if (!window) return null;
  return {
    startsAt: window.start.toISOString(),
    endsAt: window.end.toISOString(),
    propertyName: String(row.propertyName || ''),
    guestFirstName: String(row.firstName || row.lastName || '').trim(),
    reservationNumber: String(row.reservationNumber || row.id),
  };
}

function writeStay(database, reservationId, now) {
  if (!hasOutbox(database)) return null;
  const payload = stayPayload(database, reservationId);
  if (!payload) return null;
  return modelFor(database).insert({ reservationId, type: 'stay', payload, createdAt: now.toISOString() });
}

function writeBranding(database, now) {
  if (!hasOutbox(database)) return null;
  let settings = null;
  try {
    settings = database.prepare('SELECT companyName, companyLogoPath FROM app_settings WHERE id = 1').get();
  } catch {
    return null;
  }
  const logoPath = String((settings && settings.companyLogoPath) || '').trim();
  if (!logoPath) return null;
  return modelFor(database).insert({
    reservationId: null,
    type: 'branding',
    payload: { name: String(settings.companyName || ''), logoPath, updatedAt: now.toISOString() },
    createdAt: now.toISOString(),
  });
}

// ── Writes (inside the caller's transaction) ─────────────────────────────────────────────────────

/** A reservation exists, or its dates, times or lodging changed. No-op for a devis or a cancellation. */
function pushStay(database, reservationId, { now = new Date() } = {}) {
  const id = writeStay(database, reservationId, now);
  if (id) scheduleDrain();
  return id;
}

/** The stay no longer holds: `cancelled`, `deleted`, or turned back into a `devis`. */
function cancelStay(database, reservationId, reason, { now = new Date() } = {}) {
  if (!CANCEL_REASONS.has(reason)) throw new Error(`cancelStay: unknown reason ${reason}`);
  if (!hasOutbox(database)) return null;
  const id = modelFor(database).insert({
    reservationId, type: 'cancel', payload: { reason }, createdAt: now.toISOString(),
  });
  scheduleDrain();
  return id;
}

/** The company logo changed. No-op when there is no logo: the contract has no « remove the logo ». */
function pushBranding(database, { now = new Date() } = {}) {
  const id = writeBranding(database, now);
  if (id) scheduleDrain();
  return id;
}

/**
 * The one-time deployment backfill (§3.1): every reservation whose stay has not ended, and the logo.
 * Runs inside database.js's migration transaction, before the server listens; the boot drain sends.
 */
function backfill(database, { today, now = new Date() }) {
  if (!hasOutbox(database)) return { stays: 0, branding: false };
  const ids = database.prepare(`
    SELECT id FROM reservations
     WHERE COALESCE(kind, 'reservation') = 'reservation' AND endDate >= ?
     ORDER BY startDate, id
  `).all(String(today)).map((r) => r.id);
  let stays = 0;
  for (const id of ids) {
    if (writeStay(database, id, now)) stays += 1;
  }
  return { stays, branding: Boolean(writeBranding(database, now)) };
}

// ── What the operator sees (§3.1: a push failing for more than an hour is visible) ───────────────

function refusalOf(row) {
  if (!row || !row.sentAt || !String(row.lastError || '').startsWith('refused')) return null;
  const [, status, field = '', reason = ''] = String(row.lastError).split(' ');
  return { status: Number(status), field, reason };
}

function reservationPushStatus(database, reservationId, { now = new Date() } = {}) {
  if (!hasOutbox(database)) return { failingSince: null, refusal: null };
  const model = modelFor(database);
  const before = new Date(now.getTime() - FAILING_VISIBLE_AFTER_MS).toISOString();
  return {
    failingSince: model.failingSince(reservationId, { before }),
    refusal: refusalOf(model.lastRow(reservationId)),
  };
}

function failingSummary(database, { now = new Date() } = {}) {
  if (!hasOutbox(database)) return null;
  const before = new Date(now.getTime() - FAILING_VISIBLE_AFTER_MS).toISOString();
  return modelFor(database).failingSummary({ before });
}

// ── Sending ──────────────────────────────────────────────────────────────────────────────────────

function readLogoFromUploads(logoPath) {
  const file = path.join(UPLOADS_DIR, path.basename(String(logoPath || '')));
  if (!fs.existsSync(file)) return null;
  return { bytes: fs.readFileSync(file), mime: LOGO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' };
}

function createDrainer({
  database,
  client,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  readLogo = readLogoFromUploads,
  logger = console,
}) {
  const { PortierUnavailableError } = require('./portierClient');
  let running = false;
  let rerun = false;
  let timer = null;

  const iso = (ms) => new Date(ms).toISOString();

  function send(row) {
    const payload = JSON.parse(row.payload);
    if (row.type === 'stay') {
      return client.call({ method: 'PUT', path: `/svc/v1/stays/${row.reservationId}`, body: { revision: row.id, ...payload } });
    }
    if (row.type === 'cancel') {
      return client.call({ method: 'POST', path: `/svc/v1/stays/${row.reservationId}/cancel`, body: { revision: row.id, reason: payload.reason } });
    }
    const logo = readLogo(payload.logoPath);
    if (!logo) return Promise.resolve({ status: 410, data: { field: 'logo', reason: 'logo_missing' } });
    return client.call({
      method: 'PUT',
      path: '/svc/v1/branding',
      body: { name: payload.name, logo: logo.bytes.toString('base64'), mime: logo.mime, updatedAt: payload.updatedAt },
    });
  }

  function fail(model, row, err) {
    const attempts = Number(row.attempts || 0) + 1;
    model.markFailed(row.id, {
      attempts,
      nextAttemptAt: iso(now() + backoffDelay(attempts)),
      lastError: String((err && err.message) || err || 'unknown').slice(0, 300),
    });
  }

  async function runOnce() {
    if (!client.isConfigured()) return;
    const model = modelFor(database);
    const blocked = new Set();
    let outage = null;
    for (const row of model.listPending()) {
      const lane = row.reservationId == null ? 'branding' : `reservation:${row.reservationId}`;
      if (blocked.has(lane)) continue;
      if (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > now()) {
        blocked.add(lane);
        continue;
      }
      blocked.add(lane);
      // Portier is down: every due row gets its back-off without knocking again, so each one
      // counts as failing for the banner and none is hammered.
      if (outage) {
        fail(model, row, outage);
        continue;
      }
      try {
        const answer = await send(row);
        if (answer.status >= 200 && answer.status < 300) {
          model.markSent(row.id, { sentAt: iso(now()) });
          blocked.delete(lane);
        } else {
          // Portier answered and refused (a 422 window too long, say). Retrying the same payload
          // cannot succeed, and holding the lane would block the reservation's next, valid push.
          const data = answer.data || {};
          const lastError = `refused ${answer.status} ${data.field || ''} ${data.reason || data.error || ''}`.trim();
          model.markSent(row.id, { sentAt: iso(now()), lastError });
          blocked.delete(lane);
          logger.warn(`[portier] outbox #${row.id} (${row.type} ${row.reservationId ?? ''}) ${lastError}`);
        }
      } catch (err) {
        if (err instanceof PortierUnavailableError) outage = err;
        fail(model, row, err);
      }
    }
    model.purgeSent(iso(now() - SENT_RETENTION_MS));
    if (outage) logger.warn(`[portier] outbox waits: ${outage.message}`);
  }

  function arm() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (!client.isConfigured()) return;
    const next = modelFor(database).nextRetryAt();
    if (!next) return;
    timer = setTimer(() => {
      timer = null;
      return drain();
    }, Math.max(0, Date.parse(next) - now()));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function drain() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        await runOnce();
      } while (rerun);
    } catch (err) {
      logger.error('[portier] outbox drain failed:', err && err.message ? err.message : err);
    } finally {
      running = false;
      arm();
    }
  }

  return { drain, hasTimer: () => Boolean(timer) };
}

let defaultDrainer = null;
let drainScheduled = false;

function getDefaultDrainer() {
  if (!defaultDrainer) {
    defaultDrainer = createDrainer({ database: require('../database'), client: require('./portierClient') });
  }
  return defaultDrainer;
}

/** Sends what the outbox holds. Safe to call at any time; concurrent calls collapse into one run. */
function drain() {
  if (!require('./portierClient').isConfigured()) return Promise.resolve();
  return getDefaultDrainer().drain();
}

function scheduleDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  setImmediate(() => {
    drainScheduled = false;
    drain();
  });
}

module.exports = {
  pushStay,
  cancelStay,
  pushBranding,
  backfill,
  drain,
  reservationPushStatus,
  failingSummary,
  createDrainer,
  __test: { stayPayload, backoffDelay, hasOutbox, BACKOFF_MS, HOURLY_MS },
};
