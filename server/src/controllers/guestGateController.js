// The guest-facing half of the gate access (specs/guest-gate-access.md §3.3, §3.5, §3.8).
//
// Four routes, no authentication beyond the code the guest was sent, and one rule that shapes all
// of them: this surface never says more than the guest needs. A wrong code, a locked code, a code
// belonging to a stay that ended last month — one answer, 401, and the journal knows the difference.

const gateAccessModel = require('../models/gateAccessModel');
const settingsModel = require('../models/settingsModel');
const db = require('../database');
const gateSession = require('../utils/gateSession');
const gateQueue = require('../utils/gateQueue');
const { shouldEnforceHttps } = require('../utils/securityConfig');
const { guestBaseUrl } = require('../middleware/requireGuestHost');
const { formatCode } = require('../utils/gateCode');

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_TIME_FR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const DATE_FR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: 'numeric', month: 'long',
});

function sessionSecret() {
  // Provisioned at boot by index.js (getOrCreateSecret), like PUBLIC_API_KEY.
  return String(process.env.GATE_SESSION_SECRET || '');
}

function isSecureDeployment() {
  return shouldEnforceHttps(process.env);
}

function clientIp(req) {
  return String(req.ip || (req.socket && req.socket.remoteAddress) || '').slice(0, 60) || null;
}

function userAgent(req) {
  return String(req.get('user-agent') || '').slice(0, 300) || null;
}

/** One shape for every refusal, so nothing leaks through the difference between two failures. */
function refuse(res, status, code) {
  return res.status(status).json({ error: { code } });
}

/**
 * What the page renders. Deliberately flat and pre-formatted: the guest page is a few kilobytes of
 * vanilla JS on a phone at a gate, it has no business computing dates or deciding wording.
 */
function buildPayload({ resolved, runtime, settings, shareUrl }) {
  const { access, reservation, window, state } = resolved;
  const client = db.prepare('SELECT firstName, lastName FROM clients WHERE id = ?').get(reservation.clientId) || {};
  const property = db.prepare('SELECT name FROM properties WHERE id = ?').get(reservation.propertyId) || {};
  const row = db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(reservation.id) || {};

  return {
    state,
    stay: {
      guestLabel: String(client.firstName || '').trim() || null,
      propertyName: String(property.name || '').trim() || null,
      reservationNumber: row.reservationNumber || null,
      startLabel: window ? DATE_FR.format(window.scheduledStart) : null,
      endLabel: window ? DATE_FR.format(window.checkOut) : null,
      startsAt: window ? window.start.toISOString() : null,
      endsAt: window ? window.end.toISOString() : null,
      endsAtLabel: window ? DATE_TIME_FR.format(window.end) : null,
    },
    gate: { state: runtime.gateState },
    service: {
      available: runtime.available,
      phone: String((settings && settings.companyPhone) || '').trim() || null,
    },
    // The share link carries the code, and that is the point: the guest is meant to pass it to
    // their family (§3.4 rule 14). It only ever reaches a session that already holds the code.
    share: shareUrl ? { url: shareUrl, code: formatCode(access.code || '') } : null,
  };
}

function shareUrlFor(access) {
  const base = guestBaseUrl();
  if (!base || !access.code) return null;
  return `${base}/?c=${encodeURIComponent(access.code)}`;
}

function setSessionCookie(res, { accessId, deviceId }, window) {
  const secure = isSecureDeployment();
  // Live until the stay ends, and never longer: a cookie outliving its access is only clutter.
  const maxAgeMs = window ? Math.max(0, window.end.getTime() - Date.now()) + DAY_MS : DAY_MS;
  res.append('Set-Cookie', gateSession.buildSetCookie({ accessId, deviceId }, sessionSecret(), {
    secure, maxAgeMs,
  }));
}

/**
 * POST /gate/v1/session — the guest types the code, or arrives through the `?c=` link.
 *
 * The window state does NOT gate the answer: a stay that has not started yet, or ended an hour ago,
 * still opens a session and gets its payload with `state`, because the page has to be able to say
 * « votre accès sera actif le 12 septembre à 16:00 » rather than « code incorrect ». Only a code
 * that matches nothing, or a code locked by repeated failures, gets the flat 401.
 */
function openSession(req, res) {
  const submitted = (req.body && req.body.code) || '';
  const ip = clientIp(req);
  const ua = userAgent(req);

  const resolved = gateAccessModel.findByCode(submitted);
  if (!resolved) {
    // Unknown code. 401 and nothing else — see the CrowdSec note in the spec (§3.3 rule 11).
    gateAccessModel.appendEvent({ kind: 'code_ko', reason: 'unknown', ip, userAgent: ua });
    return refuse(res, 401, 'INVALID_CODE');
  }

  const { access } = resolved;
  if (gateAccessModel.isLockedOut(access.id)) {
    gateAccessModel.appendEvent({ accessId: access.id, kind: 'code_ko', reason: 'locked', ip, userAgent: ua });
    return refuse(res, 401, 'INVALID_CODE');
  }
  if (resolved.state === 'unknown') {
    gateAccessModel.appendEvent({ accessId: access.id, kind: 'code_ko', reason: 'no_window', ip, userAgent: ua });
    return refuse(res, 401, 'INVALID_CODE');
  }

  gateAccessModel.clearCodeFailures(access.id);

  // Keep the device this browser already had for THIS access; a phone that held another stay's
  // session simply gets a new device id here (§3.8 rule 27).
  const existing = gateSession.readSession(req, sessionSecret(), { secure: isSecureDeployment() });
  const deviceId = existing && existing.accessId === access.id
    ? existing.deviceId
    : gateAccessModel.newDeviceId();

  const { deviceCount, isNew } = gateAccessModel.touchDevice(access.id, deviceId, { ip, userAgent: ua });
  gateAccessModel.appendEvent({
    accessId: access.id,
    kind: 'code_ok',
    reason: isNew ? `new device (${deviceCount})` : null,
    ip,
    userAgent: ua,
    deviceId,
  });

  setSessionCookie(res, { accessId: access.id, deviceId }, resolved.window);

  const payload = buildPayload({
    resolved,
    runtime: gateAccessModel.readRuntime(),
    settings: settingsModel.read(),
    shareUrl: shareUrlFor(access),
  });

  if (resolved.state === 'before') return res.status(403).json({ error: { code: 'NOT_YET_ACTIVE' }, ...payload });
  if (resolved.state === 'after') return res.status(403).json({ error: { code: 'EXPIRED' }, ...payload });
  return res.json(payload);
}

/** Resolves the session cookie to a live access, or null. */
function currentAccess(req) {
  const session = gateSession.readSession(req, sessionSecret(), { secure: isSecureDeployment() });
  if (!session) return null;
  const resolved = gateAccessModel.resolve(session.accessId);
  if (!resolved) return null;
  return { ...resolved, deviceId: session.deviceId };
}

/** GET /gate/v1/session — what the page asks on load, and on every return to the foreground. */
function readSessionState(req, res) {
  const resolved = currentAccess(req);
  if (!resolved) return refuse(res, 401, 'NO_SESSION');

  gateAccessModel.touchDevice(resolved.access.id, resolved.deviceId, {
    ip: clientIp(req), userAgent: userAgent(req),
  });

  const payload = buildPayload({
    resolved,
    runtime: gateAccessModel.readRuntime(),
    settings: settingsModel.read(),
    shareUrl: shareUrlFor(resolved.access),
  });

  if (resolved.state === 'revoked') return res.status(403).json({ error: { code: 'REVOKED' }, ...payload });
  if (resolved.state === 'before') return res.status(403).json({ error: { code: 'NOT_YET_ACTIVE' }, ...payload });
  if (resolved.state === 'after') return res.status(403).json({ error: { code: 'EXPIRED' }, ...payload });
  if (resolved.state === 'unknown') return refuse(res, 403, 'EXPIRED');
  return res.json(payload);
}

/**
 * POST /gate/v1/open — the thumb.
 *
 * Order matters here, and every step refuses for a different reason:
 *   1. no live session, or a window that is not open → nothing to discuss;
 *   2. the house has not been heard from in a minute → 503, and the page had already greyed the
 *      button out (§3.5 rule 19), so this is the race, not the normal path;
 *   3. the gate is not closed → the request is SATISFIED with no pulse (§3.8 rule 28). A second
 *      pulse would reverse the travel and close it on the car going through;
 *   4. the ceilings;
 *   5. only then does a request exist, and a poller is woken.
 */
function requestOpen(req, res) {
  const resolved = currentAccess(req);
  if (!resolved) return refuse(res, 401, 'NO_SESSION');

  const ip = clientIp(req);
  const ua = userAgent(req);
  const { access } = resolved;

  if (resolved.state !== 'active') {
    const code = resolved.state === 'before' ? 'NOT_YET_ACTIVE'
      : resolved.state === 'revoked' ? 'REVOKED' : 'EXPIRED';
    gateAccessModel.appendEvent({ accessId: access.id, kind: 'refused', reason: code.toLowerCase(), ip, userAgent: ua });
    return refuse(res, 403, code);
  }

  const runtime = gateAccessModel.readRuntime();
  if (!runtime.available) {
    gateAccessModel.appendEvent({ accessId: access.id, kind: 'refused', reason: 'house unreachable', ip, userAgent: ua });
    return refuse(res, 503, 'SERVICE_UNAVAILABLE');
  }

  if (runtime.gateState === 'open') {
    gateAccessModel.appendEvent({
      accessId: access.id, kind: 'already_open', reason: 'gate not closed — no pulse sent', ip, userAgent: ua, deviceId: resolved.deviceId,
    });
    return res.json({ requestId: null, status: 'already_open' });
  }

  if (gateAccessModel.countOpensSince(access.id) >= gateAccessModel.OPENS_PER_HOUR_PER_ACCESS) {
    gateAccessModel.appendEvent({ accessId: access.id, kind: 'refused', reason: 'access ceiling', ip, userAgent: ua });
    return refuse(res, 429, 'TOO_MANY_OPENS');
  }
  if (gateAccessModel.countGateOpensSince() >= gateAccessModel.OPENS_PER_HOUR_PER_GATE) {
    gateAccessModel.appendEvent({ accessId: access.id, kind: 'refused', reason: 'gate ceiling', ip, userAgent: ua });
    return refuse(res, 429, 'TOO_MANY_OPENS');
  }

  const { request, deduped } = gateAccessModel.createRequest({
    accessId: access.id, deviceId: resolved.deviceId,
  });
  if (!deduped) {
    gateAccessModel.appendEvent({
      accessId: access.id, kind: 'open', reason: `request ${request.id}`, ip, userAgent: ua, deviceId: resolved.deviceId,
    });
    gateQueue.notify();
  }

  return res.json({ requestId: request.id, status: request.status, deduped });
}

/** GET /gate/v1/open/:requestId — the page polls this every second while the gate travels. */
function readRequestStatus(req, res) {
  const resolved = currentAccess(req);
  if (!resolved) return refuse(res, 401, 'NO_SESSION');

  gateAccessModel.expireStaleRequests();
  const request = gateAccessModel.getRequest(req.params.requestId);
  // A request belonging to another access is not "forbidden", it is not found: this session has no
  // business knowing it exists.
  if (!request || request.accessId !== resolved.access.id) return refuse(res, 404, 'NOT_FOUND');

  return res.json({
    requestId: request.id,
    status: request.status,
    detail: request.detail || null,
    gate: { state: gateAccessModel.readRuntime().gateState },
  });
}

module.exports = {
  openSession,
  readSessionState,
  requestOpen,
  readRequestStatus,
  __test: { buildPayload, shareUrlFor },
};
