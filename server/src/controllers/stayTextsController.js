/**
 * Stay texts controller — « Textes des mails », the sentences of the guest emails
 * (specs/plugins-phase-p-productisation.md §3.A rules 1–5, §4.3).
 *
 *   GET    /api/stay-texts?propertyId=      the catalogue with the stored wording
 *   PUT    /api/stay-texts/:key             { fr, en, propertyId? } → 200 | 422 { field, message }
 *   DELETE /api/stay-texts/:key?propertyId=&lang=   back to the default (or to the global text)
 *
 * Exports a `buildController({ database })` factory; the route binds it to the production database.
 */

const { CATALOGUE, entryOf } = require('../utils/stayTextCatalogue');
const { unknownToken } = require('../utils/emailTemplateRenderer');
const stayTextsModel = require('../models/stayTextsModel');

/** Rule 4: the first unknown token or flag of a text, as the 422 the client shows inline. */
function tokenError(field, text, allowed) {
  const name = unknownToken(text, allowed);
  return name ? { field, message: `Variable inconnue : {{${name}}}` } : null;
}

function buildController({ database }) {
  const model = () => stayTextsModel.buildModel(database);

  function list(req, res) {
    const propertyId = Number(req.query.propertyId) || 0;
    const globalRows = model().rows(0);
    const ownRows = propertyId ? model().rows(propertyId) : {};
    const effective = (key, side) => {
      const row = globalRows[key];
      return row && row[side] != null ? row[side] : entryOf(key)[side];
    };
    const entries = CATALOGUE
      .filter((e) => !propertyId || e.overridable)
      .map((e) => {
        const own = ownRows[e.key] || {};
        const fr = propertyId ? (own.fr ?? '') : effective(e.key, 'fr');
        const en = propertyId ? (own.en ?? '') : effective(e.key, 'en');
        return {
          key: e.key,
          email: e.email,
          label: e.label,
          tokens: e.tokens,
          flags: e.flags,
          overridable: Boolean(e.overridable),
          fr,
          en,
          defaultFr: e.fr,
          defaultEn: e.en,
          // For a property, the global text shows as the placeholder of an empty override (rule 3).
          globalFr: effective(e.key, 'fr'),
          globalEn: effective(e.key, 'en'),
          isDefault: propertyId ? !own.fr && !own.en : fr === e.fr && en === e.en,
        };
      });
    res.json({ texts: entries });
  }

  function save(req, res) {
    const entry = entryOf(req.params.key);
    if (!entry) return res.status(404).json({ error: 'STAY_TEXT_NOT_FOUND' });
    const body = req.body || {};
    const propertyId = Number(body.propertyId) || 0;
    if (propertyId && !entry.overridable) return res.status(400).json({ error: 'NOT_OVERRIDABLE' });
    const fr = body.fr == null ? '' : String(body.fr);
    const en = body.en == null ? '' : String(body.en);
    const allowed = { tokens: entry.tokens, flags: entry.flags };
    const error = tokenError('fr', fr, allowed) || tokenError('en', en, allowed);
    if (error) return res.status(422).json(error);
    model().save(entry.key, { fr, en }, propertyId);
    return res.json({ key: entry.key, fr, en, propertyId });
  }

  function reset(req, res) {
    const entry = entryOf(req.params.key);
    if (!entry) return res.status(404).json({ error: 'STAY_TEXT_NOT_FOUND' });
    const propertyId = Number(req.query.propertyId) || 0;
    const langs = req.query.lang === 'fr' || req.query.lang === 'en' ? [req.query.lang] : ['fr', 'en'];
    for (const lang of langs) model().reset(entry.key, lang, propertyId);
    return res.json({ key: entry.key, propertyId });
  }

  return { list, save, reset };
}

module.exports = { buildController, tokenError };
