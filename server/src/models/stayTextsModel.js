/**
 * Stay texts model — sole DB access for `stay_texts` (specs/plugins-phase-p-productisation.md §3.A).
 *
 * A row is keyed by (key, propertyId); propertyId 0 is the global text. Each language is stored on
 * its own: NULL means « never edited » and falls back, '' means « no paragraph ».
 *
 * API: buildModel(db) → { forContext(propertyId), rows(propertyId), save(key, { fr, en }, propertyId),
 *      reset(key, lang, propertyId) }
 */

function buildModel(database) {
  const byProperty = database.prepare('SELECT key, fr, en FROM stay_texts WHERE propertyId = ?');
  const upsert = database.prepare(`
    INSERT INTO stay_texts (key, propertyId, fr, en, updatedAt) VALUES (@key, @propertyId, @fr, @en, datetime('now'))
    ON CONFLICT (key, propertyId) DO UPDATE SET fr = excluded.fr, en = excluded.en, updatedAt = excluded.updatedAt
  `);
  const findOne = database.prepare('SELECT key, fr, en FROM stay_texts WHERE key = ? AND propertyId = ?');
  const removeOne = database.prepare('DELETE FROM stay_texts WHERE key = ? AND propertyId = ?');

  const asMap = (rows) => Object.fromEntries(rows.map((r) => [r.key, { fr: r.fr, en: r.en }]));

  /** What the stay content reads: the global texts and the property's own. */
  function forContext(propertyId) {
    const id = Number(propertyId) || 0;
    return { global: asMap(byProperty.all(0)), property: id ? asMap(byProperty.all(id)) : {} };
  }

  function rows(propertyId) {
    return asMap(byProperty.all(Number(propertyId) || 0));
  }

  function save(key, { fr = null, en = null }, propertyId = 0) {
    upsert.run({ key, propertyId: Number(propertyId) || 0, fr, en });
  }

  /** Back to the default for one language; the row goes once neither language is edited. */
  const reset = database.transaction((key, lang, propertyId = 0) => {
    const id = Number(propertyId) || 0;
    const row = findOne.get(key, id);
    if (!row) return;
    const next = { fr: row.fr, en: row.en, [lang === 'en' ? 'en' : 'fr']: null };
    if (next.fr == null && next.en == null) removeOne.run(key, id);
    else upsert.run({ key, propertyId: id, ...next });
  });

  return { forContext, rows, save, reset };
}

module.exports = { buildModel };
