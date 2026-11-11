// Shared fixture of the rollback-queue suites (specs/self-update-and-releases.md rules 33, 43): what the manual queue
// of the rollback floor (v3.18.0 and v3.19.0, identical here) reads in `email_templates`. Copied from
// `git show v3.19.0:server/src/models/emailLogModel.js` (`listPending`) and its registry's
// `EVENT_TRIGGERED_STABLE_KEYS` and `DEFAULT_TEMPLATES`; a later floor that changes them must update this file.

// Every default template the floor's own registry seeds (`git show v3.19.0:server/src/utils/defaultEmailTemplatesRegistry.js`).
// The floor knows how to render these; any other default template is new to it.
const FLOOR_TEMPLATE_KEYS = Object.freeze([
  'arrival_reminder_1d', 'arrival_reminder_7d', 'balance_reminder', 'balance_request', 'cancellation_notice',
  'deposit_reminder', 'deposit_request', 'full_request', 'guest_thanks_j1', 'reservation_confirmation',
  'season_gift_vouchers', 'season_new_year',
]);

// The keys the floor's queue excludes by name.
const FLOOR_EVENT_KEYS = Object.freeze(['reservation_confirmation', 'deposit_request', 'balance_request', 'full_request', 'cancellation_notice']);

// The anchors the floor's queue matches on (`COALESCE(t.anchor, 'start') = …`, one UNION branch each).
const FLOOR_QUEUE_ANCHORS = Object.freeze(['start', 'validUntil', 'depositDueDate', 'balanceDueDate']);

// The floor's `start` branch, verbatim: every enabled manual template on `start` it does not exclude by key.
const FLOOR_START_BRANCH = `
  SELECT t.stableKey AS stableKey, r.id AS reservationId
  FROM email_templates t
  JOIN reservations r
    ON COALESCE(r.kind, 'reservation') = 'reservation'
   AND date(r.startDate, t.dayOffset || ' days') BETWEEN date(?, '-' || ? || ' days') AND date(?)
   AND (t.dayOffset > 0 OR date(r.startDate) >= date(?))
  WHERE t.enabled = 1
    AND t.sendMode = 'manual'
    AND COALESCE(t.anchor, 'start') = 'start'
    AND COALESCE(t.stableKey, '') NOT IN (${FLOOR_EVENT_KEYS.map(() => '?').join(', ')})`;

function floorQueue(db, today) {
  return db.prepare(FLOOR_START_BRANCH).all(today, 7, today, today, ...FLOOR_EVENT_KEYS).map((r) => r.stableKey);
}

module.exports = { FLOOR_TEMPLATE_KEYS, FLOOR_EVENT_KEYS, FLOOR_QUEUE_ANCHORS, floorQueue };
