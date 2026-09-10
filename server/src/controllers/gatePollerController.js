// The half of the contract the house calls (specs/guest-gate-access.md §4.3).
//
// Two routes, and the whole inversion of trust rests on them: guestFlow holds no Sowel credential,
// opens no connection towards the house, and knows nothing about the gate beyond what the plugin
// tells it here. It answers questions and waits.

const gateAccessModel = require('../models/gateAccessModel');
const gateQueue = require('../utils/gateQueue');
const db = require('../database');

const DEFAULT_WAIT_S = 25;
const MAX_WAIT_S = 55;   // Caddy's default read timeout is 60 s; a long-poll must end before it.

function parseWaitMs(raw) {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_WAIT_S * 1000;
  return Math.min(seconds, MAX_WAIT_S) * 1000;
}

/** The shape the plugin hands to the recipe. Nothing about the guest beyond which stay pressed. */
function present(request) {
  if (!request) return null;
  const resolved = gateAccessModel.resolve(request.accessId);
  const reservation = resolved && resolved.reservation;
  let propertyName = null;
  let reservationNumber = null;
  if (reservation) {
    const property = db.prepare('SELECT name FROM properties WHERE id = ?').get(reservation.propertyId);
    const row = db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(reservation.id);
    propertyName = (property && property.name) || null;
    reservationNumber = (row && row.reservationNumber) || null;
  }
  return {
    id: request.id,
    reservationId: request.accessId && reservation ? reservation.id : null,
    reservationNumber,
    propertyName,
    requestedAt: request.requestedAt,
  };
}

/**
 * GET /public/v1/gate/requests?wait=25&state=closed
 *
 * The heartbeat AND the state feed, in one call (§3.5 rule 19.bis). Every poll says what the plugin
 * currently sees on the `closed` contact, which is how the page can grey its button out before the
 * guest presses — guestFlow has no other way of knowing, and a second endpoint would let the two
 * drift apart.
 *
 * Answers immediately when work is waiting, otherwise holds the connection until something arrives
 * or `wait` elapses. `{ request: null }` is the normal, quiet answer.
 */
async function pollRequests(req, res) {
  gateAccessModel.noteHeartbeat({ state: String(req.query.state || 'unknown') });
  gateAccessModel.expireStaleRequests();

  const immediate = gateAccessModel.claimNextRequest();
  if (immediate) return res.json({ request: present(immediate) });

  const woken = await gateQueue.waitForWork(parseWaitMs(req.query.wait));
  if (!woken) return res.json({ request: null });

  // Woken by a press — but another poller may have taken it in the meantime, and a request can be
  // deduplicated away. Nothing to serve is a perfectly good answer.
  const claimed = gateAccessModel.claimNextRequest();
  return res.json({ request: present(claimed) });
}

/**
 * POST /public/v1/gate/requests/:id/result — what the recipe decided.
 *
 * Idempotent: a retry after a lost response changes nothing and still answers 204. The vocabulary
 * is closed (`opened`, `already_open`, `refused`, `error`) so the page never has to render a status
 * it has no wording for.
 */
function reportResult(req, res) {
  const status = String((req.body && req.body.status) || '').trim();
  const allowed = ['opened', 'already_open', 'refused', 'error'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: { code: 'INVALID_STATUS', allowed } });
  }

  const detail = req.body && req.body.detail ? String(req.body.detail).slice(0, 300) : null;
  const { request, changed } = gateAccessModel.resolveRequest(req.params.id, status, { detail });
  if (!request) return res.status(404).json({ error: { code: 'NOT_FOUND' } });

  if (changed) {
    gateAccessModel.appendEvent({
      accessId: request.accessId,
      kind: status,
      reason: detail,
      deviceId: request.deviceId,
    });
  }
  return res.status(204).end();
}

module.exports = { pollRequests, reportResult, __test: { parseWaitMs, present, MAX_WAIT_S } };
