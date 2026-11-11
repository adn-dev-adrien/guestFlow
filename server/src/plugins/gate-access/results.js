/**
 * What guestFlow does with the house's outcomes, and when it tells the admins
 * (specs/gate-access-sowel-connector.md §3.2 and §3.3).
 *
 * The plugin posts a result for EVERY key of the list at every read, so the same failure arrives
 * every hour. The admins hear about it once: the error they were pushed about is kept on the row,
 * a second identical failure says nothing, a different error speaks again, and a success forgets it.
 */

const { describeStay, errorReason, stayShortName, failureTitle, isStale } = require('./keys');

const MAX_RESULTS = 500;
const ACTIONS = new Set(['create', 'revoke']);

/** Web Push to every active admin — no preference, these are faults to fix (rule 14). */
async function pushToAdmins({ model, pushService, logger = console }, payload) {
  let userIds = [];
  try {
    userIds = model.adminUserIds();
  } catch (err) {
    logger.warn('[gate-keys] admin lookup failed:', err && err.message ? err.message : err);
    return 0;
  }
  let reached = 0;
  for (const userId of userIds) {
    const outcome = await pushService.sendToUser(userId, payload);
    if (outcome && outcome.sent > 0) reached += 1;
  }
  return reached;
}

const STATE = /^[a-z_]{1,32}$/;
const MAX_CODE = 64;
const MAX_URL = 2048;
const MAX_ERROR = 64;
const MAX_MESSAGE = 500;
const INVALID = Symbol('invalid');

// An optional string field: absent → null, a string within bounds → itself, anything else → INVALID.
// The code and the link end up in the guest's e-mails: an object or a number is never coerced.
function optionalText(value, max, accepts = () => true) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return INVALID;
  return accepts(value) ? value : INVALID;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A wire result, validated. `null` when it cannot be filed (rule 11). */
function parseResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const reservationId = Number(raw.reservationId);
  if (!Number.isInteger(reservationId) || reservationId <= 0) return null;
  const action = String(raw.action || '');
  if (!ACTIONS.has(action)) return null;
  if (typeof raw.ok !== 'boolean') return null;
  const fields = raw.ok
    ? {
      state: optionalText(raw.state, 32, (v) => STATE.test(v)),
      code: optionalText(raw.code, MAX_CODE),
      url: optionalText(raw.url, MAX_URL, isHttpsUrl),
      error: null,
      message: null,
    }
    : {
      state: null,
      code: null,
      url: null,
      error: optionalText(raw.error, MAX_ERROR) || 'unknown',
      message: optionalText(raw.message, MAX_MESSAGE),
    };
  if (Object.values(fields).includes(INVALID)) return null;
  return { reservationId, action, ok: raw.ok, ...fields };
}

/**
 * POST /public/v1/gate/results — files every valid result, then pushes the new failures.
 *
 * @returns {Promise<{ status: number, body: object }>}
 */
async function receiveResults({ model, pushService, logger = console, now = new Date() }, body) {
  const list = body && Array.isArray(body.results) ? body.results : null;
  if (!list) {
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'results[] attendu.' } } };
  }
  if (list.length > MAX_RESULTS) {
    return { status: 413, body: { error: { code: 'TOO_MANY', message: 'Plus de 500 résultats en un envoi.' } } };
  }

  const receivedAt = now.toISOString();
  const toAlert = [];
  let stored = 0;

  // All or nothing: a batch that throws half-way files none of its results and pushes no alert.
  model.transaction(() => {
    for (const raw of list) {
      const result = parseResult(raw);
      if (!result) continue;
      const stay = model.stayFor(result.reservationId);
      // The window the key was listed with — kept on the row so a later deletion can still revoke it.
      const described = stay && stay.kind === 'reservation' ? describeStay(stay) : null;
      const previous = model.get(result.reservationId);
      model.upsertResult({ ...result, ...(described || {}), propertyId: described ? stay.propertyId : null, receivedAt });
      stored += 1;

      if (result.ok) {
        if (previous && previous.alertedError) model.setAlertedError(result.reservationId, null);
        continue;
      }
      if (previous && previous.alertedError === result.error) continue;
      model.setAlertedError(result.reservationId, result.error);
      toAlert.push({ result, stay, row: model.get(result.reservationId) });
    }
  });

  for (const { result, stay, row } of toAlert) {
    await pushToAdmins({ model, pushService, logger }, {
      title: failureTitle(result),
      body: `${stayShortName(stay, row)} — ${errorReason(result)}`,
      url: '/',
    });
  }

  return { status: 200, body: { stored } };
}

/**
 * The hourly « not read for more than 3 h » pass (rules 17-18). Pushes once; a read clears it.
 * @returns {Promise<{ alerted: boolean }>}
 */
async function runStaleReadCheck({ model, pushService, logger = console, now = new Date() }) {
  const { lastReadAt, staleAlertedAt } = model.readState();
  if (!isStale(lastReadAt, now) || staleAlertedAt) return { alerted: false };
  model.markStaleAlerted(now.toISOString());
  const at = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(lastReadAt));
  await pushToAdmins({ model, pushService, logger }, {
    title: 'Clés portail : Sowel ne lit plus',
    body: `Dernière lecture des clés par Sowel : ${at}. Les séjours à venir n'auront pas de clé.`,
    url: '/',
  });
  return { alerted: true };
}

/** GET /api/dashboard/gate-keys — what the dashboard alert lists (rules 13, 16, 17). */
function dashboardAlerts({ model, now = new Date() }) {
  const failures = model.failures(now.toISOString()).map((row) => {
    const stay = model.stayFor(row.reservationId);
    return {
      reservationId: Number(row.reservationId),
      reservationNumber: stay && stay.reservationNumber ? String(stay.reservationNumber) : null,
      guestFirstName: stay && stay.clientFirstName ? String(stay.clientFirstName) : null,
      name: stayShortName(stay, row),
      action: String(row.action),
      title: failureTitle(row),
      reason: errorReason(row),
      exists: Boolean(stay),
    };
  });
  const { lastReadAt } = model.readState();
  return { failures, stale: isStale(lastReadAt, now), lastReadAt };
}

module.exports = {
  MAX_RESULTS,
  parseResult,
  receiveResults,
  runStaleReadCheck,
  dashboardAlerts,
  pushToAdmins,
};
