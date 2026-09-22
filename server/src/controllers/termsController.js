/**
 * CGV administration and fiche block (specs/terms-acceptance-record.md §3.1, §3.5).
 *
 * Every label the client prints is built here: the page and the fiche only render.
 */

const db = require('../database');
const termsModel = require('../models/termsModel');
const settingsModel = require('../models/settingsModel');
const { TERMS_VARIABLES, buildTermsVariables, renderVersion } = require('../utils/termsRenderer');

const MAX_MARKDOWN_LENGTH = 200000;

// First plugin release that sends the acceptance (specs/terms-acceptance-record.md §3.3).
const MIN_PLUGIN_VERSION = '1.8.0';

function isVersionBelow(version, minimum) {
  const a = String(version || '').split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i];
  }
  return false;
}

const PARIS_DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const PARIS_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
});

/** « 21/09/2026 à 14:32:07 », Europe/Paris. */
function parisDateTimeLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(PARIS_DATE_TIME.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} à ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parisDateLabel(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : PARIS_DATE.format(d);
}

function currentVariables(deps = {}) {
  const settings = (deps.settingsModel || settingsModel).read();
  const database = deps.db || db;
  const properties = database.prepare('SELECT name, defaultCautionAmount FROM properties ORDER BY name COLLATE NOCASE').all();
  return buildTermsVariables(settings, properties);
}

/** Variables whose value changed since `version` was published (rule 4). */
function staleVariables(version, vars) {
  if (!version) return [];
  let frozen = {};
  try { frozen = JSON.parse(version.variablesJson || '{}'); } catch { frozen = {}; }
  const used = `${version.markdownFr}\n${version.markdownEn}`;
  return TERMS_VARIABLES.filter((name) => used.includes(`{{${name}}}`) && frozen[name] !== vars[name]);
}

function shapeVersionSummary(v) {
  return {
    version: v.version,
    publishedAt: v.publishedAt,
    publishedAtLabel: parisDateTimeLabel(v.publishedAt),
    shortHash: String(v.contentHash || '').slice(0, 12),
    acceptanceCount: Number(v.acceptanceCount || 0),
  };
}

function buildOverview(deps = {}) {
  const model = deps.termsModel || termsModel;
  const settings = (deps.settingsModel || settingsModel).termsSettings();
  const draft = model.getDraft();
  const current = model.getCurrent();
  const vars = currentVariables(deps);
  const draftRender = renderVersion({ fr: draft.markdownFr, en: draft.markdownEn }, vars);
  const draftMatchesCurrent = Boolean(current)
    && current.markdownFr === draft.markdownFr
    && current.markdownEn === draft.markdownEn
    && current.contentHash === draftRender.contentHash;
  const empty = !draft.markdownFr.trim() || !draft.markdownEn.trim();
  let publishBlockedReason = null;
  if (empty) publishBlockedReason = 'Les textes français et anglais sont tous les deux obligatoires.';
  else if (draftRender.unknown.length) publishBlockedReason = `Variable(s) inconnue(s) : ${draftRender.unknown.map((n) => `{{${n}}}`).join(', ')}`;
  else if (draftMatchesCurrent) publishBlockedReason = `Rien de nouveau depuis la version ${current.version}.`;
  return {
    draft: { fr: draft.markdownFr, en: draft.markdownEn, updatedAt: draft.updatedAt },
    current: current ? { version: current.version, publishedAt: current.publishedAt, publishedAtLabel: parisDateTimeLabel(current.publishedAt) } : null,
    nextVersion: current ? current.version + 1 : 1,
    canPublish: publishBlockedReason === null,
    publishBlockedReason,
    staleVariables: staleVariables(current, vars),
    unknownVariables: draftRender.unknown,
    variables: TERMS_VARIABLES,
    versions: model.listVersionsWithCounts().map(shapeVersionSummary),
    requireTermsAcceptance: settings.requireTermsAcceptance,
    lastSeenPluginVersion: settings.lastSeenPluginVersion,
    // Rule 18 — a site still on an older plugin sends no acceptance: every booking is refused while
    // the enforcement is on.
    pluginOutdated: Boolean(settings.lastSeenPluginVersion) && isVersionBelow(settings.lastSeenPluginVersion, MIN_PLUGIN_VERSION),
    minPluginVersion: MIN_PLUGIN_VERSION,
  };
}

function validateTexts(body) {
  const fr = body?.fr;
  const en = body?.en;
  if (typeof fr !== 'string' || typeof en !== 'string') return 'Les champs fr et en sont obligatoires.';
  if (fr.length > MAX_MARKDOWN_LENGTH || en.length > MAX_MARKDOWN_LENGTH) return 'Texte trop long.';
  return null;
}

function getOverview(req, res) {
  return res.json(buildOverview());
}

function saveDraft(req, res) {
  const err = validateTexts(req.body);
  if (err) return res.status(400).json({ error: err });
  termsModel.saveDraft({ fr: req.body.fr, en: req.body.en });
  return res.json(buildOverview());
}

function preview(req, res) {
  const err = validateTexts(req.body);
  if (err) return res.status(400).json({ error: err });
  const r = renderVersion({ fr: req.body.fr, en: req.body.en }, currentVariables());
  return res.json({ html: { fr: r.htmlFr, en: r.htmlEn }, unknownVariables: r.unknown });
}

/**
 * Publishes the SAVED draft (rule 3): what is frozen is what the operator saved, never an unsaved
 * editor state.
 */
function publishDraft(deps = {}, { userId = null, now = new Date() } = {}) {
  const model = deps.termsModel || termsModel;
  const overview = buildOverview(deps);
  if (!overview.canPublish) return { error: overview.publishBlockedReason, status: 422 };
  const draft = model.getDraft();
  const vars = currentVariables(deps);
  const r = renderVersion({ fr: draft.markdownFr, en: draft.markdownEn }, vars);
  const version = model.publishVersion({
    markdownFr: draft.markdownFr,
    markdownEn: draft.markdownEn,
    htmlFr: r.htmlFr,
    htmlEn: r.htmlEn,
    variables: vars,
    contentHash: r.contentHash,
    publishedAt: now.toISOString(),
    publishedBy: userId,
  });
  return { version };
}

function publish(req, res) {
  const result = publishDraft({}, { userId: req.user?.id || null });
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json(buildOverview());
}

function getVersion(req, res) {
  const v = termsModel.getByVersion(req.params.version);
  if (!v) return res.status(404).json({ error: 'Version introuvable.' });
  return res.json({
    version: v.version,
    publishedAt: v.publishedAt,
    publishedAtLabel: parisDateTimeLabel(v.publishedAt),
    contentHash: v.contentHash,
    html: { fr: v.htmlFr, en: v.htmlEn },
  });
}

function updateEnforcement(req, res) {
  const value = req.body?.requireTermsAcceptance;
  if (typeof value !== 'boolean') return res.status(400).json({ error: 'requireTermsAcceptance doit être un booléen.' });
  settingsModel.upsert({ requireTermsAcceptance: value ? 1 : 0 });
  return res.json(buildOverview());
}

/**
 * The fiche block (rules 21-22). `not_applicable` for a back-office devis; `missing` for a website
 * request without acceptance (before this feature, or while the emergency switch was off).
 */
function buildFicheBlock(reservation, deps = {}) {
  if (!reservation || reservation.requestOrigin !== 'public') {
    return { termsAcceptanceState: 'not_applicable', termsAcceptance: null };
  }
  const a = (deps.termsModel || termsModel).findAcceptanceByReservation(reservation.id);
  if (!a) return { termsAcceptanceState: 'missing', termsAcceptance: null };
  return {
    termsAcceptanceState: 'recorded',
    termsAcceptance: {
      version: a.version,
      acceptedAt: a.acceptedAt,
      acceptedAtLabel: parisDateTimeLabel(a.acceptedAt),
      versionPublishedAtLabel: parisDateLabel(a.publishedAt),
      shortHash: String(a.contentHash || '').slice(0, 12),
      ip: a.ip || '',
      userAgent: a.userAgent || '',
      pluginVersion: a.pluginVersion || '',
    },
  };
}

module.exports = {
  getOverview,
  saveDraft,
  preview,
  publish,
  getVersion,
  updateEnforcement,
  buildOverview,
  publishDraft,
  buildFicheBlock,
  staleVariables,
  parisDateTimeLabel,
  isVersionBelow,
};
