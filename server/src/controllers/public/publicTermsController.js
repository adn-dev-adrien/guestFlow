/**
 * Public CGV reads (specs/terms-acceptance-record.md rule 7): the current published version, or a
 * given one for the pinned `/cgv/?v=N` link. A draft is never exposed.
 */

const termsModel = require('../../models/termsModel');
const { ok, fail } = require('./publicHttp');

function shape(v) {
  return {
    version: v.version,
    publishedAt: v.publishedAt,
    html: { fr: v.htmlFr, en: v.htmlEn },
  };
}

function getCurrent(req, res) {
  const v = termsModel.getCurrent();
  if (!v) return fail(res, 503, 'TERMS_NOT_CONFIGURED', 'Les conditions générales ne sont pas encore publiées.');
  return ok(res, { ...shape(v), currentVersion: v.version });
}

function getVersion(req, res) {
  const n = Number(req.params.version);
  if (!Number.isInteger(n) || n < 1) return fail(res, 404, 'TERMS_NOT_FOUND', 'Version introuvable.');
  const v = termsModel.getByVersion(n);
  if (!v) return fail(res, 404, 'TERMS_NOT_FOUND', 'Version introuvable.');
  const current = termsModel.getCurrent();
  return ok(res, { ...shape(v), currentVersion: current ? current.version : v.version });
}

module.exports = { getCurrent, getVersion };
