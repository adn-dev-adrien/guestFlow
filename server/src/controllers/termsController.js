/**
 * CGV administration and fiche block (specs/reservations/terms-acceptance-record.md §3.1, §3.5).
 *
 * Every label the client prints is built here: the page and the fiche only render.
 */

const db = require('../database');
const termsModel = require('../models/termsModel');
const termsActivities = require('../utils/termsActivities');
const settingsModel = require('../models/settingsModel');
const { TERMS_VARIABLES, buildTermsVariables, renderVersion } = require('../utils/termsRenderer');

const MAX_MARKDOWN_LENGTH = 200000;

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

function buildOverview(deps = {}, activity = termsActivities.LODGING) {
  const model = deps.termsModel || termsModel;
  const draft = model.getDraft(activity);
  const current = model.getCurrent(activity);
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
    activity,
    draft: { fr: draft.markdownFr, en: draft.markdownEn, updatedAt: draft.updatedAt },
    current: current ? { version: current.version, publishedAt: current.publishedAt, publishedAtLabel: parisDateTimeLabel(current.publishedAt) } : null,
    nextVersion: current ? current.version + 1 : 1,
    canPublish: publishBlockedReason === null,
    publishBlockedReason,
    staleVariables: staleVariables(current, vars),
    unknownVariables: draftRender.unknown,
    variables: TERMS_VARIABLES,
    versions: model.listVersionsWithCounts(activity).map(shapeVersionSummary),
    // specs/plugins/plugins-phase-3a-online-payment.md rule 15 — edited here since the CGV link of the emails
    // is its core reader. The stored value only: an origin set in the environment stays there.
    publicSiteOrigin: String((deps.settingsModel || settingsModel).read().publicSiteOrigin || ''),
  };
}

const INVALID_ORIGIN = 'Adresse invalide : le domaine seul, par exemple https://www.mon-site.fr';

/**
 * The public site origin: '' (unset) or an http(s) origin without path, query or fragment. Returns the
 * cleaned value, or `{ error }` in French.
 */
function parsePublicSiteOrigin(raw) {
  if (raw != null && typeof raw !== 'string') return { error: INVALID_ORIGIN };
  const value = (raw || '').trim().replace(/\/+$/, '');
  if (!value) return { value: '' };
  let url;
  try { url = new URL(value); } catch { url = null; }
  const ok = url && (url.protocol === 'https:' || url.protocol === 'http:')
    && (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash && !url.username;
  if (!ok) return { error: INVALID_ORIGIN };
  return { value: url.origin };
}

function updatePublicSiteOrigin(req, res) {
  const parsed = parsePublicSiteOrigin(req.body && req.body.publicSiteOrigin);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  settingsModel.storePublicSiteOrigin(parsed.value);
  return res.json(buildOverview({}, termsActivities.LODGING));
}

function validateTexts(body) {
  const fr = body?.fr;
  const en = body?.en;
  if (typeof fr !== 'string' || typeof en !== 'string') return 'Les champs fr et en sont obligatoires.';
  if (fr.length > MAX_MARKDOWN_LENGTH || en.length > MAX_MARKDOWN_LENGTH) return 'Texte trop long.';
  return null;
}

/** The activity a request names (`?activity=` or the body), `lodging` by default; null when it is unknown or its plugin is off. */
function activityOf(req) {
  const raw = (req.query && req.query.activity) != null ? req.query.activity : req.body && req.body.activity;
  return termsActivities.resolve(raw);
}

const UNKNOWN_ACTIVITY = 'Activité inconnue.';

function listActivities(req, res) {
  termsActivities.seedDrafts(termsModel);
  return res.json({
    activities: termsActivities.list().map((a) => {
      const current = termsModel.getCurrent(a.key);
      return { key: a.key, label: a.label, currentVersion: current ? current.version : null };
    }),
  });
}

function getOverview(req, res) {
  const activity = activityOf(req);
  if (!activity) return res.status(404).json({ error: UNKNOWN_ACTIVITY });
  termsActivities.seedDrafts(termsModel);
  return res.json(buildOverview({}, activity));
}

function saveDraft(req, res) {
  const activity = activityOf(req);
  if (!activity) return res.status(404).json({ error: UNKNOWN_ACTIVITY });
  const err = validateTexts(req.body);
  if (err) return res.status(400).json({ error: err });
  termsModel.saveDraft({ fr: req.body.fr, en: req.body.en, activity });
  return res.json(buildOverview({}, activity));
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
function publishDraft(deps = {}, { userId = null, now = new Date(), activity = termsActivities.LODGING } = {}) {
  const model = deps.termsModel || termsModel;
  const overview = buildOverview(deps, activity);
  if (!overview.canPublish) return { error: overview.publishBlockedReason, status: 422 };
  const draft = model.getDraft(activity);
  const vars = currentVariables(deps);
  const r = renderVersion({ fr: draft.markdownFr, en: draft.markdownEn }, vars);
  const version = model.publishVersion({
    activity,
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
  const activity = activityOf(req);
  if (!activity) return res.status(404).json({ error: UNKNOWN_ACTIVITY });
  const result = publishDraft({}, { userId: req.user?.id || null, activity });
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json(buildOverview({}, activity));
}

function getVersion(req, res) {
  const activity = activityOf(req);
  if (!activity) return res.status(404).json({ error: UNKNOWN_ACTIVITY });
  const v = termsModel.getByVersion(req.params.version, activity);
  if (!v) return res.status(404).json({ error: 'Version introuvable.' });
  return res.json({
    version: v.version,
    publishedAt: v.publishedAt,
    publishedAtLabel: parisDateTimeLabel(v.publishedAt),
    contentHash: v.contentHash,
    html: { fr: v.htmlFr, en: v.htmlEn },
  });
}

function shapeAcceptance(a) {
  return {
    version: a.version,
    acceptedAt: a.acceptedAt,
    acceptedAtLabel: parisDateTimeLabel(a.acceptedAt),
    versionPublishedAtLabel: parisDateLabel(a.publishedAt),
    shortHash: String(a.contentHash || '').slice(0, 12),
    ip: a.ip || '',
    userAgent: a.userAgent || '',
    pluginVersion: a.pluginVersion || '',
  };
}

const CHANNEL_LABELS = {
  site: 'site', 'guest-app': 'appli séjour', 'payment-link': 'lien de paiement', 'mon-bain': 'Mon bain',
};

/** The other activities' acceptances recorded on the reservation (rule 37): one extra line each on the fiche. */
function otherAcceptances(reservation, model) {
  const rows = model.listOtherAcceptancesByReservation(reservation.id);
  return {
    activityAcceptances: rows.map((a) => ({
      activity: a.activity,
      label: (termsActivities.find(a.activity) || { label: a.activity }).label,
      channelLabel: CHANNEL_LABELS[a.channel] || a.channel,
      ...shapeAcceptance(a),
    })),
  };
}

/**
 * The fiche block (rules 21-22). `not_applicable` for a back-office devis; `missing` for a website
 * request without acceptance (before this feature, or while the emergency switch was off).
 */
function buildFicheBlock(reservation, deps = {}) {
  const model = deps.termsModel || termsModel;
  const others = reservation ? otherAcceptances(reservation, model) : { activityAcceptances: [] };
  if (!reservation || reservation.requestOrigin !== 'public') {
    return { termsAcceptanceState: 'not_applicable', termsAcceptance: null, ...others };
  }
  const a = model.findAcceptanceByReservation(reservation.id);
  if (!a) return { termsAcceptanceState: 'missing', termsAcceptance: null, ...others };
  return { termsAcceptanceState: 'recorded', termsAcceptance: shapeAcceptance(a), ...others };
}

module.exports = {
  getOverview,
  listActivities,
  updatePublicSiteOrigin,
  parsePublicSiteOrigin,
  saveDraft,
  preview,
  publish,
  getVersion,
  buildOverview,
  publishDraft,
  buildFicheBlock,
  staleVariables,
  parisDateTimeLabel,
};
