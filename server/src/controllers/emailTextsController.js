/**
 * « Textes des emails » — the single page, the file and the translator
 * (specs/guest-email-texts-made-simple.md rules 9–12, 16–20).
 *
 *   GET  /api/email-texts?propertyId=        { sections, properties, propertyId, canTranslate }
 *   PUT  /api/email-texts                    { changes: { [key]: { fr?, en? } } } → 200 | 422 { key, field, message }
 *   POST /api/email-texts/confirm            { key } — « relu »: drops the « traduit automatiquement » mark
 *   GET  /api/email-texts/export             the CSV (rule 16)
 *   POST /api/email-texts/import[?confirm=true]  raw CSV → { changed, refused, unchanged, applied }
 *   POST /api/email-texts/translate          fills every empty English (rules 19–20)
 *
 * Exports a `buildController({ database, translator })` factory; the route binds production.
 */

const { todayIso: localTodayIso } = require('../utils/localDate');
const emailTextsModel = require('../models/emailTextsModel');
const emailTextsCsv = require('../utils/emailTextsCsv');
const { badlyEncoded, ENCODING_MESSAGE } = require('../utils/translationCsv');
const textTranslator = require('../utils/textTranslator');
const { SECTIONS } = require('../utils/templateTokens');

const publicItem = ({ allowed, ...item }) => item;

function buildController({ database, translator = textTranslator }) {
  const model = () => emailTextsModel.buildModel(database);

  function list(req, res) {
    const properties = database.prepare('SELECT id, name FROM properties ORDER BY id').all();
    const requested = Number(req.query && req.query.propertyId);
    const propertyId = (properties.find((p) => p.id === requested) || properties[0] || {}).id || null;
    const items = model().list({ propertyId });
    const templates = database.prepare('SELECT id, stableKey, name FROM email_templates WHERE stableKey IS NOT NULL').all();
    const sections = SECTIONS.map((s) => ({
      id: s.id,
      title: s.title,
      templates: s.stableKeys.map((k) => templates.find((t) => t.stableKey === k)).filter(Boolean)
        .filter((t) => items.some((i) => i.key === `subject:${t.stableKey}`)),
      items: items.filter((i) => i.section === s.id).map(publicItem),
    })).filter((s) => s.items.length);
    return res.json({ sections, properties, propertyId, canTranslate: translator.isAvailable() });
  }

  function save(req, res) {
    const raw = (req.body && req.body.changes) || {};
    const changes = Object.entries(raw).map(([key, v]) => ({
      key,
      fr: v && v.fr !== undefined ? String(v.fr) : undefined,
      en: v && v.en !== undefined ? String(v.en) : undefined,
    }));
    const result = model().apply(changes);
    if (!result.ok) return res.status(422).json({ key: result.key, field: result.field, message: result.message });
    return res.json({ applied: result.applied });
  }

  function confirm(req, res) {
    const key = String((req.body && req.body.key) || '');
    if (!model().find(key)) return res.status(404).json({ error: 'TEXT_NOT_FOUND' });
    model().confirm(key);
    return res.json({ key });
  }

  function exportCsv(req, res) {
    const csv = emailTextsCsv.serialise(model().all());
    const day = localTodayIso();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="textes-emails-${day}.csv"`);
    return res.send(csv);
  }

  // Rule 17 — the summary first; the accepted rows are written, in one transaction, only once the
  // owner confirms. Refused rows are listed with their line and never written.
  function importCsv(req, res) {
    const text = typeof req.body === 'string' ? req.body : String((req.body && req.body.csv) || '');
    if (badlyEncoded(text)) return res.status(400).json({ error: 'BAD_ENCODING', message: ENCODING_MESSAGE });
    let rows;
    try {
      rows = emailTextsCsv.parse(text);
    } catch (err) {
      if (err && err.code === 'MALFORMED_CSV') {
        return res.status(400).json({ error: 'MALFORMED_CSV', line: err.line, message: `Ligne ${err.line} : ${err.message}` });
      }
      throw err;
    }
    const m = model();
    const byKey = new Map(m.all().map((item) => [item.key, item]));
    const plan = emailTextsCsv.plan(rows, { find: (key) => byKey.get(key) || null, validate: m.validate });
    const confirmed = String((req.query && req.query.confirm) || '') === 'true';
    if (!confirmed || !plan.changed.length) return res.json({ ...plan, applied: false });
    const result = m.apply(plan.changed.map(({ key, fr, en }) => ({ key, fr, en })));
    if (!result.ok) return res.status(422).json({ key: result.key, field: result.field, message: result.message });
    return res.json({ ...plan, applied: true });
  }

  // Rules 19–20 — every empty English from its French. « Accès » is never sent: it may hold a code.
  // A text whose variables did not come back is skipped and counted; a failed call writes nothing.
  async function translate(req, res) {
    if (!translator.isAvailable()) return res.status(404).json({ error: 'TRANSLATION_UNAVAILABLE' });
    const todo = model().all().filter((item) => item.kind !== 'access' && String(item.fr).trim() && !String(item.en).trim());
    if (!todo.length) return res.json({ translated: 0, skipped: 0 });
    let english;
    try {
      english = await translator.translate(todo.map((item) => item.fr));
    } catch (err) {
      return res.status(502).json({ error: 'TRANSLATION_FAILED', message: 'Traduction impossible, rien n’a été modifié.' });
    }
    const changes = todo.map((item, i) => ({ key: item.key, en: english[i] })).filter((c) => c.en != null);
    const result = changes.length ? model().apply(changes, { autoTranslated: true }) : { ok: true };
    if (!result.ok) return res.status(502).json({ error: 'TRANSLATION_FAILED', message: 'Traduction impossible, rien n’a été modifié.' });
    return res.json({ translated: changes.length, skipped: todo.length - changes.length });
  }

  return { list, save, confirm, exportCsv, importCsv, translate };
}

module.exports = { buildController };
