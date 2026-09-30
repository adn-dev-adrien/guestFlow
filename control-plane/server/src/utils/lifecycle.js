/**
 * The subscription state machine (specs/control-plane-plans-and-access.md rules 14, 15, 19). Pure:
 * the state is derived from the subscription's dates and the operator's overrides, on Paris days.
 *
 *   trial      before trialEndsAt
 *   active     paid, before the `due` window
 *   due        7 days (monthly billing) or 30 days (yearly) before endsAt, until endsAt
 *   grace      endsAt … endsAt + 7
 *   read_only  endsAt + 8 … endsAt + 30
 *   suspended  from endsAt + 31
 *   archived   deprovisioned by the operator (rule 20)
 *
 * A « Remettre en actif » override holds `active` until its date, then the calendar takes over.
 */

const { addMonths, daysBetween } = require('./days');

const GRACE_DAYS = 7;
const READ_ONLY_LAST_DAY = 30;
const DUE_WINDOW_DAYS = { monthly: 7, yearly: 30 };

const STATE_LABELS = {
  trial: 'Essai',
  active: 'Actif',
  due: 'À renouveler',
  grace: 'Grâce',
  read_only: 'Lecture seule',
  suspended: 'Suspendu',
  archived: 'Archivé',
};

function dueWindow(billing) {
  return DUE_WINDOW_DAYS[billing] || DUE_WINDOW_DAYS.yearly;
}

function stateOf({ endsAt, trialEndsAt, billing, forceActiveUntil, archivedAt }, today) {
  if (archivedAt) return 'archived';
  if (forceActiveUntil && today <= forceActiveUntil) return 'active';
  if (trialEndsAt && today < trialEndsAt) return 'trial';
  const late = daysBetween(endsAt, today);
  if (late < -dueWindow(billing)) return 'active';
  if (late < 0) return 'due';
  if (late <= GRACE_DAYS) return 'grace';
  if (late <= READ_ONLY_LAST_DAY) return 'read_only';
  return 'suspended';
}

// The day the paid period (or the trial) ends, and how many days are left until it.
function nextDeadline({ endsAt, trialEndsAt }, today) {
  return trialEndsAt && today < trialEndsAt ? trialEndsAt : endsAt;
}

function daysLeft(sub, today) {
  return daysBetween(today, nextDeadline(sub, today));
}

// Rule 15: a payment extends from the current end, or from today when the end is already past, so a
// late payment never buys days that were already lost.
function renewedEndsAt(endsAt, months, today) {
  return addMonths(endsAt > today ? endsAt : today, months);
}

module.exports = {
  GRACE_DAYS,
  READ_ONLY_LAST_DAY,
  DUE_WINDOW_DAYS,
  STATE_LABELS,
  dueWindow,
  stateOf,
  nextDeadline,
  daysLeft,
  renewedEndsAt,
};
