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
const { isoToday } = require('../utils/emailAutoSendRunner');

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
  const today = deps.today || (() => isoToday());

  function afterWrite(row) {
    if (row && SEQUENCE_STABLE_KEYS.includes(row.stableKey) && templateAutoSends(row)
      && settingsModel && !settingsModel.read().guestSequenceStartDate) {
      settingsModel.upsert({ guestSequenceStartDate: today() });
    }
    if (deps.scheduler) deps.scheduler.syncWithTemplates();
  }

  function list(req, res) {
    return res.json(model.list());
  }

  function getOne(req, res) {
    const row = model.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    return res.json(row);
  }

  function create(req, res) {
    const errors = validateForCreate(req.body);
    if (errors.length > 0) return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: errors });
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
    const errors = validateForUpdate(req.body);
    if (errors.length > 0) return res.status(400).json({ error: 'INVALID_PAYLOAD', fields: errors });
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

  function remove(req, res) {
    const ok = model.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
    afterWrite(null);
    return res.json({ ok: true });
  }

  return { list, getOne, create, update, remove };
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
