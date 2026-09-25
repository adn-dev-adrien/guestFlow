/**
 * Collects what needs translating (specs/translation-catalogue.md rule 1).
 *
 * Nobody types an entry into the catalogue: creating an option puts it there, and this is the pass
 * that notices. It is the only place that decides what is translatable, so what the operator sees in
 * their file is decided here and nowhere else.
 *
 * Deliberately included: **archived** options. Archiving is reversible and retyping a translation is
 * not, so an archived option keeps its entry (rule 6). Only a deleted row loses one, and it loses it
 * because it stops being yielded here.
 */

/** `option:12:title` — the provenance, not the text, so a French edit keeps its translation (rule 4). */
function optionKey(id, field) {
  return `option:${Number(id)}:${field}`;
}

function resourceKey(id) {
  return `resource:${Number(id)}:name`;
}

/**
 * A category has no id — its text IS its identity. Renaming one therefore retires the old entry and
 * opens a new one, which is right: a renamed category is a different category, and its English has to
 * be looked at again anyway.
 */
function categoryKey(text) {
  return `category:${String(text).trim()}`;
}

/**
 * @param {object} database  better-sqlite3 handle
 * @returns {Array<{entryKey,kind,sourceId,sourceText}>} every translatable short label, today
 */
function collectSources(database) {
  const out = [];

  const options = database.prepare('SELECT id, title, description, category FROM options').all();
  for (const o of options) {
    const title = String(o.title == null ? '' : o.title).trim();
    if (title) out.push({ entryKey: optionKey(o.id, 'title'), kind: 'option.title', sourceId: o.id, sourceText: title });
    const description = String(o.description == null ? '' : o.description).trim();
    if (description) {
      out.push({ entryKey: optionKey(o.id, 'description'), kind: 'option.description', sourceId: o.id, sourceText: description });
    }
  }

  // One entry per DISTINCT category, not one per option: « Boissons » is translated once.
  const categories = new Set();
  for (const o of options) {
    const category = String(o.category == null ? '' : o.category).trim();
    if (category) categories.add(category);
  }
  for (const category of categories) {
    out.push({ entryKey: categoryKey(category), kind: 'category', sourceId: null, sourceText: category });
  }

  for (const r of database.prepare('SELECT id, name FROM resources').all()) {
    const name = String(r.name == null ? '' : r.name).trim();
    if (name) out.push({ entryKey: resourceKey(r.id), kind: 'resource.name', sourceId: r.id, sourceText: name });
  }

  return out;
}

module.exports = { collectSources, optionKey, resourceKey, categoryKey };
