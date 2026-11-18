/**
 * Public CGV reads (specs/terms-acceptance-record.md rule 7): the current published version, or a
 * given one for the pinned `/cgv/?v=N` link. A draft is never exposed. `?activity=` names the activity whose terms are read
 * (specs/gift-voucher-campaigns.md rule 37); absent, it is the lodging's, so the existing callers are unchanged.
 */

const sdk = require('../../sdk');

const termsModel = sdk.coreModule('termsModel');
const termsActivities = sdk.coreModule('termsActivities');
const { ok, failT } = sdk.coreModule('publicHttp');
const settings = require('../settings');

function shape(v) {
  return {
    version: v.version,
    publishedAt: v.publishedAt,
    html: { fr: v.htmlFr, en: v.htmlEn },
  };
}

function getCurrent(req, res) {
  const activity = termsActivities.resolve(req.query.activity);
  if (!activity) return failT(res, req, 404, 'TERMS_NOT_FOUND', 'termsNotFound');
  const v = termsModel.getCurrent(activity);
  // specs/wordpress-plugin.md rule 21 — `bookingClosed` tells the site a request would be refused, so
  // the form is replaced before the visitor fills it.
  if (!v && activity !== termsActivities.LODGING) return failT(res, req, 404, 'TERMS_NOT_FOUND', 'termsNotFound');
  if (!v) {
    const { requireTermsAcceptance } = settings.termsSettings();
    return failT(res, req, 503, 'TERMS_NOT_CONFIGURED', 'termsNotConfigured', [{ bookingClosed: requireTermsAcceptance }]);
  }
  return ok(res, { ...shape(v), currentVersion: v.version });
}

function getVersion(req, res) {
  const activity = termsActivities.resolve(req.query.activity);
  const n = Number(req.params.version);
  if (!activity || !Number.isInteger(n) || n < 1) return failT(res, req, 404, 'TERMS_NOT_FOUND', 'termsNotFound');
  const v = termsModel.getByVersion(n, activity);
  if (!v) return failT(res, req, 404, 'TERMS_NOT_FOUND', 'termsNotFound');
  const current = termsModel.getCurrent(activity);
  return ok(res, { ...shape(v), currentVersion: current ? current.version : v.version });
}

module.exports = { getCurrent, getVersion };
