/**
 * Email templates controller — orchestrates CRUD on the templates library
 * (specs/email-automation.md §4.1 + §4.3).
 *
 * Validation rules:
 *   - `name`, `subject`, `body` required, non-empty after trim → otherwise 400.
 *   - `dayOffset` integer in [-90, +90] → otherwise 400.
 *   - `sendMode` ∈ {'auto', 'manual'} → otherwise 400.
 *   - `enabled` accepts boolean / 0 / 1 / 'true' / 'false'.
 *   - `stableKey` in the payload is ALWAYS ignored (set only by the registry seed).
 *
 * A template's mode is the only switch for automatic sending (specs/settings-rationalization.md
 * rule 17b). So every write:
 *   - fixes the guest-sequence start date the first time a SEQUENCE template goes « auto »
 *     (specs/guest-email-sequence.md rule 16 — never moved afterwards, so no past stay is mailed);
 *   - re-aligns the 08:00 scheduler, which only runs while one template is « auto ».
 *
 * Exports a default controller bound to the production model + a `buildController(model)`
 * factory for tests.
 */

const { templateAutoSends } = require('../utils/autoSendPolicy');
const { SEQUENCE_STABLE_KEYS } = require('../utils/guestEmailSequence');
const { todayIso } = require('../utils/localDate');
const { PLUGIN_OF_TEMPLATE, PAYMENT_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');
const { templateWhenLabel, templateWhen, describeWhen } = require('../utils/templateWhen');
const { displayNameOf, timeline, compare: stayOrder } = require('../utils/emailTimeline');
const { hasEnglishVersion } = require('../utils/emailTemplateLanguage');
const { weekdayLabel } = require('../utils/dateFr');
const { templateAllowed, chipsForTemplate, tokenError, sectionOfStableKey } = require('../utils/templateTokens');

// specs/guest-email-texts-made-simple.md rule 11 — a template refuses an unknown variable with the
// same 422 as a stay text or a mention, instead of dropping it silently at render time.
function templateTokenError(payload) {
  const allowed = templateAllowed();
  for (const field of ['subject', 'body', 'subjectEn', 'bodyEn']) {
    if (payload[field] === undefined || payload[field] === null) continue;
    const error = tokenError(field, String(payload[field]), allowed);
    if (error) return error;
  }
  return null;
}

const DAY_OFFSET_MIN = -90;
const DAY_OFFSET_MAX = 90;

function coerceEnabled(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === '0' || v === 'false') return false;
  return Boolean(v);
}

function validateForCreate(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['INVALID_PAYLOAD'];
  if (!String(payload.name || '').trim())    errors.push('name');
  if (!String(payload.subject || '').trim()) errors.push('subject');
  if (!String(payload.body || '').trim())    errors.push('body');
  const offset = Number(payload.dayOffset);
  if (!Number.isInteger(offset) || offset < DAY_OFFSET_MIN || offset > DAY_OFFSET_MAX) errors.push('dayOffset');
  if (!['auto', 'manual'].includes(String(payload.sendMode || '').toLowerCase())) errors.push('sendMode');
  return errors;
}

function validateForUpdate(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['INVALID_PAYLOAD'];
  if (payload.name      !== undefined && !String(payload.name).trim())    errors.push('name');
  if (payload.subject   !== undefined && !String(payload.subject).trim()) errors.push('subject');
  if (payload.body      !== undefined && !String(payload.body).trim())    errors.push('body');
  if (payload.dayOffset !== undefined) {
    const offset = Number(payload.dayOffset);
    if (!Number.isInteger(offset) || offset < DAY_OFFSET_MIN || offset > DAY_OFFSET_MAX) errors.push('dayOffset');
  }
  if (payload.sendMode  !== undefined && !['auto', 'manual'].includes(String(payload.sendMode).toLowerCase())) {
    errors.push('sendMode');
  }
  return errors;
}

/**
 * @param {object} model          — emailTemplatesModel
 * @param {object} settingsModel  — reads/writes `guestSequenceStartDate`
 * @param {{ scheduler?: { syncWithTemplates: Function }, today?: () => string }} deps
 */
function buildController(model, settingsModel, deps = {}) {
  const today = deps.today || todayIso;
  const isLive = deps.isLive || ((id) => require('../plugins/sdk/registry').isLive(id));
  const editorTokens = deps.editorTokens || (() => require('../plugins/sdk/eventBus').editorTokens());
  // A template only an inactive plugin could send is not listed (specs/plugins-phase-1-sdk.md rule 13).
  const sendable = (row) => !PLUGIN_OF_TEMPLATE[row.stableKey] || isLive(PLUGIN_OF_TEMPLATE[row.stableKey]);

  function afterWrite(row) {
    if (row && SEQUENCE_STABLE_KEYS.includes(row.stableKey) && templateAutoSends(row)
      && settingsModel && !settingsModel.read().guestSequenceStartDate) {
      settingsModel.upsert({ guestSequenceStartDate: today() });
    }
    if (deps.scheduler) deps.scheduler.syncWithTemplates();
  }

  // `textsSection`: the section of « Textes des emails » that writes this template's sentences
  // (specs/guest-email-texts-made-simple.md rule 12), null for a template of the operator's own.
  // `whenLabel` / `when`: the « Quand » (specs/email-automation.md rule 16; specs/guest-email-texts-made-simple.md
  // rule 43). `displayName`: the one name of the email on every page (rule 44). `hasEnglish`: whether it
  // can be sent to an English-speaking guest (specs/email-language-fr-en.md rule 9).
  const withSection = (row) => ({
    ...row,
    textsSection: sectionOfStableKey(row.stableKey),
    whenLabel: templateWhenLabel(row),
    when: templateWhen(row),
    displayName: displayNameOf(row),
    shipped: Boolean(row.stableKey),
    hasEnglish: hasEnglishVersion(row),
  });

  const withoutBodies = ({ body, bodyEn, ...rest }) => rest; // eslint-disable-line no-unused-vars

  // `?view=timeline` — Emails › Modèles in stay order, grouped by moment (rule 44).
  function list(req, res) {
    const rows = model.list().filter(sendable).map(withSection);
    // The timeline lists what the page shows; the two bodies (the bulk of the payload) are read from
    // `GET /:id` when the editor opens (specs/inte-performance.md rule 11).
    if (req.query && req.query.view === 'timeline') return res.json({ groups: timeline(rows.map(withoutBodies)) });
    // In stay order, like the timeline: the history filter and the send dialog list them so (rule 44).
    return res.json(rows.sort(stayOrder));
  }

  /**
   * « Envoyé [n] jours [avant|après|le jour même de] … » read against a template's own moment (rule 43):
   * the signed offset and the sentence, or a refusal `{ field, message }`. A moment the scheduler
   * does not count from the offset (the sequence, an action) is not set here.
   */
  function readWhen(template, when) {
    const row = template || { stableKey: null, anchor: 'start', dayOffset: 0 };
    const current = templateWhen(row);
    if (!current.editable) return { ok: false, field: 'when', message: 'Moment fixé par l’application : il ne se règle pas ici.' };
    return describeWhen({ days: when && when.days, direction: when && when.direction, anchor: current.anchor });
  }

  // POST /api/email-templates/when — the sentence read live, with the day it would leave for the next
  // stay it still reaches (rule 43).
  function when(req, res) {
    const body = req.body || {};
    const template = body.templateId ? model.findById(body.templateId) : null;
    if (body.templateId && !template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    const result = readWhen(template, body);
    if (!result.ok) return res.status(422).json({ field: result.field, message: result.message });
    let example = null;
    const anchor = template ? String(template.anchor || 'start') : 'start';
    const day = today();
    const stay = anchor === 'start' && typeof model.nextStay === 'function' ? model.nextStay(day, result.offsetDays) : null;
    if (stay && stay.startDate) {
      const year = Number(day.slice(0, 4));
      const start = String(stay.startDate).slice(0, 10);
      const [y, m, d] = start.split('-').map(Number);
      const send = new Date(Date.UTC(y, m - 1, d + result.offsetDays)).toISOString().slice(0, 10);
      const stayLabel = `${weekdayLabel(start, year)} au ${weekdayLabel(String(stay.endDate || '').slice(0, 10), year)}`;
      example = `Prochain séjour (${[stay.propertyName, stayLabel].filter(Boolean).join(', ')}) : envoyé le ${weekdayLabel(send, year)}.`;
    }
    return res.json({ offsetDays: result.offsetDays, sentence: result.sentence, example });
  }

  // A `when` in a write is read by the server (rule 43): the offset stored is the one it answers, never
  // one a page computed or kept from an earlier reading.
  function withWhen(template, body) {
    if (!body || body.when === undefined) return { ok: true, body };
    const result = readWhen(template, body.when);
    if (!result.ok) return result;
    const { when: ignored, ...rest } = body;
    return { ok: true, body: { ...rest, dayOffset: result.offsetDays } };
  }

  // GET /api/email-templates/plugin-variables — the live plugins' variables and conditions.
  function pluginVariables(req, res) {
    return res.json(editorTokens());
  }

  // GET /api/email-templates/:id/variables — the chips of one template, labelled (rule 10). `new`
  // stands for a template not created yet: every variable of every email.
  function variables(req, res) {
    if (req.params.id === 'new') return res.json(chipsForTemplate(null));
    const row = model.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    return res.json(chipsForTemplate(row));
  }

  function getOne(req, res) {
    const row = model.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    return res.json(row);
  }

  function create(req, res) {
    const read = withWhen(null, req.body);
    if (!read.ok) return res.status(422).json({ field: read.field, message: read.message });
    req.body = read.body;
    const errors = validateForCreate(req.body);
    if (errors.length > 0) return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: errors });
    const unknown = templateTokenError(req.body);
    if (unknown) return res.status(422).json(unknown);
    const row = model.insert({
      name:      String(req.body.name).trim(),
      subject:   String(req.body.subject),
      body:      String(req.body.body),
      // Optional English side (specs/email-language-fr-en.md). '' / absent → no English version.
      subjectEn: req.body.subjectEn === undefined ? undefined : String(req.body.subjectEn || ''),
      bodyEn:    req.body.bodyEn    === undefined ? undefined : String(req.body.bodyEn || ''),
      dayOffset: Number(req.body.dayOffset),
      sendMode:  String(req.body.sendMode).toLowerCase(),
      enabled:   coerceEnabled(req.body.enabled),
    });
    afterWrite(row);
    return res.status(201).json(row);
  }

  function update(req, res) {
    const existing = model.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    const read = withWhen(existing, req.body);
    if (!read.ok) return res.status(422).json({ field: read.field, message: read.message });
    req.body = read.body;
    const errors = validateForUpdate(req.body);
    if (errors.length > 0) return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: errors });
    // specs/payment-schedule-and-cancellation.md rule 44 — a template that asks for money is never « auto ».
    if (PAYMENT_STABLE_KEYS.includes(existing.stableKey) && String(req.body.sendMode || '').toLowerCase() === 'auto') {
      return res.status(409).json({ error: 'PAYMENT_TEMPLATE_STAYS_MANUAL', message: 'Un email qui demande de l’argent ne part jamais tout seul : il reste en validation manuelle.' });
    }
    const unknown = templateTokenError(req.body);
    if (unknown) return res.status(422).json(unknown);
    const row = model.update(req.params.id, {
      name:      req.body.name      === undefined ? undefined : String(req.body.name).trim(),
      subject:   req.body.subject   === undefined ? undefined : String(req.body.subject),
      body:      req.body.body      === undefined ? undefined : String(req.body.body),
      subjectEn: req.body.subjectEn === undefined ? undefined : String(req.body.subjectEn || ''),
      bodyEn:    req.body.bodyEn    === undefined ? undefined : String(req.body.bodyEn || ''),
      dayOffset: req.body.dayOffset === undefined ? undefined : Number(req.body.dayOffset),
      sendMode:  req.body.sendMode  === undefined ? undefined : String(req.body.sendMode).toLowerCase(),
      enabled:   coerceEnabled(req.body.enabled),
    });
    afterWrite(row);
    return res.json(row);
  }

  // A shipped email is switched off, never deleted (rule 44): the seed would put it back anyway.
  function remove(req, res) {
    const existing = model.findById(req.params.id);
    if (existing && existing.stableKey) {
      return res.status(409).json({ error: 'SHIPPED_TEMPLATE', message: 'Email livré : il se coupe, il ne se supprime pas.' });
    }
    const ok = model.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    afterWrite(null);
    return res.json({ ok: true });
  }

  return { list, when, pluginVariables, variables, getOne, create, update, remove };
}

const defaultController = (() => {
  try {
    // The real scheduler is required lazily: it pulls the database and the SMTP layer in.
    const scheduler = { syncWithTemplates: () => require('../utils/emailAutoSendScheduler').syncWithTemplates() };
    return buildController(require('../models/emailTemplatesModel'), require('../models/settingsModel'), { scheduler });
  } catch {
    return null;
  }
})();

if (defaultController) {
  defaultController.buildController = buildController;
  module.exports = defaultController;
} else {
  module.exports = { buildController };
}
