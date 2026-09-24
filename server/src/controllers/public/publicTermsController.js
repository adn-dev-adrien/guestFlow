/**
 * Public CGV reads (specs/terms-acceptance-record.md rule 7): the current published version, or a
 * given one for the pinned `/cgv/?v=N` link. A draft is never exposed.
 */

const termsModel = require('../../models/termsModel');
const { ok, failT } = require('./publicHttp');

function shape(v) {
  return {
    version: v.version,
    publishedAt: v.publishedAt,
    html: { fr: v.htmlFr, en: v.htmlEn },
  };
}

function getCurrent(req, res) {
  const v = termsModel.getCurrent();
  if (!v) return failT(res, req, 503, 'TERMS_NOT_CONFIGURED', 'termsNotConfigured');
  return ok(res, { ...shape(v), currentVersion: v.version });
}

function getVersion(req, res) {
  const n = Number(req.params.version);
  if (!Number.isInteger(n) || n < 1) return failT(res, req, 404, 'TERMS_NOT_FOUND', 'termsNotFound');
  const v = termsModel.getByVersion(n);
  if (!v) return failT(res, req, 404, 'TERMS_NOT_FOUND', 'termsNotFound');
  const current = termsModel.getCurrent();
  return ok(res, { ...shape(v), currentVersion: current ? current.version : v.version });
}

module.exports = { getCurrent, getVersion };
