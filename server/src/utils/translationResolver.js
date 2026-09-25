/**
 * Reads the catalogue for one language (specs/translation-catalogue.md rules 14-16).
 *
 * The single place that answers « what does this label say in English? », for the three surfaces that
 * ask: the public API the site renders, the English e-mails, and the English devis PDF. Before this
 * module each of them read a different column; now a translation entered once is used by all three.
 *
 * Built per request, not per row: `toPublicOption` is called inside a `map`, so a lookup that hit the
 * database per label would be one query per line of the drawer. One query loads the catalogue for the
 * language and every lookup after that is a `Map.get`.
 *
 * The fallbacks are not symmetric, and that is deliberate (rule 15): a missing title falls back to
 * French, because a label cannot be blank; a missing description is dropped, because a missing line
 * reads better than a French paragraph in an English tunnel.
 */

const { optionKey, resourceKey, categoryKey } = require('./translationCollector');

/** `fr` is the source: it is never looked up, and never falls back. */
function isSourceLanguage(lang) {
  return !lang || String(lang).toLowerCase() === 'fr';
}

/**
 * @param {string} lang
 * @param {{valuesFor: (lang: string) => Map<string,string>}} model
 * @returns {{lang, optionTitle, optionDescription, resourceName, category}}
 */
function forLang(lang, model = require('../models/translationsModel')) {
  const source = isSourceLanguage(lang);
  const values = source ? new Map() : model.valuesFor(lang);
  const get = (key) => {
    const found = values.get(key);
    return typeof found === 'string' && found.trim() ? found : null;
  };

  // `titleEn` is still part of the public payload, and it means « the English title » whatever
  // language was asked for. Loaded lazily and memoised: the French path — the hot one — pays for it
  // only if something actually asks.
  let englishValues = null;
  const english = () => {
    if (englishValues) return englishValues;
    englishValues = String(lang).toLowerCase() === 'en' ? values : model.valuesFor('en');
    return englishValues;
  };

  return {
    lang: source ? 'fr' : String(lang),

    /** The English title, regardless of the language being served. `null` when untranslated. */
    englishOptionTitle(id) {
      const found = english().get(optionKey(id, 'title'));
      return typeof found === 'string' && found.trim() ? found : null;
    },

    /** The English resource name, regardless of the language being served. */
    englishResourceName(id) {
      const found = english().get(resourceKey(id));
      return typeof found === 'string' && found.trim() ? found : null;
    },

    /** Rule 14 — never an empty label, never a key. */
    optionTitle(id, french) {
      if (source) return french;
      return get(optionKey(id, 'title')) || french;
    },

    /** Rule 15 — absent rather than foreign. Returns null when there is nothing to show. */
    optionDescription(id, french) {
      const fr = french == null || String(french).trim() === '' ? null : french;
      if (source) return fr;
      return get(optionKey(id, 'description'));
    },

    resourceName(id, french) {
      if (source) return french;
      return get(resourceKey(id)) || french;
    },

    /**
     * Rule 16 — the LABEL only. Grouping keeps using the French text as its key, so the drawer groups
     * identically in both languages and nothing downstream ever keys on a translated string.
     */
    category(french) {
      const fr = String(french == null ? '' : french).trim();
      if (source || !fr) return fr;
      return get(categoryKey(fr)) || fr;
    },
  };
}

/** The neutral resolver: French in, French out. Lets every existing caller keep its arity. */
const SOURCE = forLang('fr', { valuesFor: () => new Map() });

/**
 * Attach `titleEn` / `nameEn` to joined reservation rows, from the catalogue.
 *
 * Three places build the same pair of joins — the e-mail graph, the e-mail sender and the devis model
 * — and all three used to read a column that no longer exists. The field keeps its name and its
 * meaning (`null` when untranslated) so everything downstream reads it exactly as before.
 *
 * One catalogue query for the whole set, not one per line. A database without the catalogue yet (a
 * minimal test schema) simply leaves whatever the rows already carried.
 */
function attachEnglishNames(database, { options = [], resources = [] } = {}) {
  let english = new Map();
  try { english = require('../models/translationsModel').create(database).valuesFor('en'); }
  catch { english = new Map(); }
  for (const o of options) o.titleEn = english.get(optionKey(o.optionId, 'title')) || o.titleEn || null;
  for (const r of resources) r.nameEn = english.get(resourceKey(r.resourceId)) || r.nameEn || null;
  return { options, resources };
}

module.exports = { forLang, SOURCE, isSourceLanguage, attachEnglishNames };
