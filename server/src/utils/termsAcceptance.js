/**
 * Whether a subject (a reservation, a voucher order, an outside booking) must still accept the CURRENT terms of an activity, and the
 * refusal codes that say so (specs/gift-voucher-campaigns.md rules 37-38). Shared by the plugins through `ctx.terms` and by the core.
 */

const termsModel = require('../models/termsModel');

const NOT_ACCEPTED = 'TERMS_NOT_ACCEPTED';
const OUTDATED = 'TERMS_OUTDATED';

function previousAcceptance({ activity, subjectType, subjectRef, reservationId }, model) {
  if (subjectType === 'reservation') return model.findAcceptanceByReservation(subjectRef != null ? subjectRef : reservationId, activity);
  return model.findAcceptanceBySubject({ activity, subjectType, subjectRef });
}

/**
 * → null when nothing is owed (no published version, or this subject already accepted it), else the refusal code:
 * `TERMS_NOT_ACCEPTED` (no version sent) or `TERMS_OUTDATED` (a version that is not the current one).
 */
function requireAccepted({
  activity, versionId, subjectType = 'reservation', subjectRef = null, reservationId = null,
}, deps = {}) {
  const model = deps.termsModel || termsModel;
  const current = model.getCurrent(activity);
  if (!current) return null;
  const previous = subjectRef != null || reservationId != null
    ? previousAcceptance({ activity, subjectType, subjectRef, reservationId }, model)
    : null;
  if (previous && previous.termsVersionId === current.id) return null;
  if (versionId == null || versionId === '') return NOT_ACCEPTED;
  return Number(versionId) === current.id ? null : OUTDATED;
}

const SUBJECT_TYPES = Object.freeze(['reservation', 'voucherOrder', 'outsideBooking']);
const CHANNELS = Object.freeze(['site', 'guest-app', 'payment-link', 'mon-bain']);

/**
 * Records the acceptance of the CURRENT version of an activity's terms by a subject. Throws `TERMS_OUTDATED` (with `code`) when `versionId` is
 * not the current one, and a plain error for an unknown subject type, channel or an activity with nothing published. A reservation's history
 * line is written by the model; any other subject's owner gets `onAccepted(row)`.
 */
function accept({
  activity, versionId, subjectType, subjectRef = null, reservationId = null, channel, ip = null, userAgent = null, pluginVersion = null, onAccepted, pluginId = 'plugin',
} = {}, deps = {}) {
  const model = deps.termsModel || termsModel;
  const prefix = `[plugin:${pluginId}]`;
  if (!SUBJECT_TYPES.includes(subjectType)) throw new Error(`${prefix} terms.accept: unknown subjectType "${subjectType}"`);
  if (!CHANNELS.includes(channel)) throw new Error(`${prefix} terms.accept: unknown channel "${channel}"`);
  const current = model.getCurrent(activity);
  if (!current) throw new Error(`${prefix} terms.accept: nothing published for "${activity}"`);
  if (Number(versionId) !== current.id) throw Object.assign(new Error(OUTDATED), { code: OUTDATED });
  const found = require('./termsActivities').find(activity);
  return model.insertAcceptance({
    activity,
    subjectType,
    subjectRef,
    reservationId,
    channel,
    ip,
    userAgent,
    pluginVersion,
    onAccepted,
    termsVersionId: current.id,
    version: current.version,
    acceptedAt: new Date().toISOString(),
    historyLabel: activity === 'lodging' ? undefined : `Conditions générales — ${found ? found.label : activity}`,
  });
}

module.exports = {
  requireAccepted, accept, NOT_ACCEPTED, OUTDATED, SUBJECT_TYPES, CHANNELS,
};
