// The gate-access card (specs/guest-gate-access.md §3.6).
//
// One shape, three readers: the fiche, the arrival SAS, and the email context. It lives in utils/
// rather than in the controller because a util may be required from anywhere — an email renderer
// pulling a controller in would be the layering upside down.
//
// Reading it CREATES the access when the stay does not have one yet. That is deliberate (§3.1
// rule 1): the code comes into being the first time anyone needs to show it, and never before.

const gateAccessModel = require('../models/gateAccessModel');
const { formatCode } = require('./gateCode');
const { guestBaseUrl } = require('../middleware/requireGuestHost');

const DATE_TIME_FR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** The card's payload. `null` when the stay can have no access — a devis, a cancelled booking. */
function buildGateAccessCard(reservationId) {
  const access = gateAccessModel.ensureForReservation(reservationId);
  if (!access) return null;

  const resolved = gateAccessModel.resolve(access.id);
  const runtime = gateAccessModel.readRuntime();
  const base = guestBaseUrl();

  return {
    accessId: access.id,
    // Null once the purge has cleared it, a week after the stay: the row stays a record, the code
    // stops being a secret anyone can read off the fiche.
    code: access.code ? formatCode(access.code) : null,
    url: base && access.code ? `${base}/?c=${encodeURIComponent(access.code)}` : null,
    permanentUrl: base || null,
    state: resolved ? resolved.state : 'unknown',
    window: resolved && resolved.window ? {
      startsAt: resolved.window.start.toISOString(),
      endsAt: resolved.window.end.toISOString(),
      label: `${DATE_TIME_FR.format(resolved.window.start)} → ${DATE_TIME_FR.format(resolved.window.end)}`,
    } : null,
    earlyOpenedAt: access.earlyOpenedAt || null,
    revokedAt: access.revokedAt || null,
    deviceCount: gateAccessModel.countDevices(access.id),
    devices: gateAccessModel.listDevices(access.id).map((device) => ({
      id: device.id,
      firstSeenAt: device.firstSeenAt,
      lastSeenAt: device.lastSeenAt,
      userAgent: device.userAgent,
    })),
    events: gateAccessModel.listEvents(access.id, { limit: 30 }).map((event) => ({
      id: event.id,
      at: event.createdAt,
      kind: event.kind,
      reason: event.reason,
    })),
    // What the guest page would show right now, so the operator can tell « it is not working » from
    // « the gate is already open ».
    service: { available: runtime.available, gateState: runtime.gateState },
  };
}


module.exports = { buildGateAccessCard };
