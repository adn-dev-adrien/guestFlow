/**
 * Translation catalogue model (specs/translation-catalogue.md §5) — sole DB access for
 * `translation_entries` and `translation_values`.
 *
 * Two tables rather than a column per language, so adding a third language is data and never a
 * migration (rule 17).
 *
 * « À revérifier » is NOT a column: it is `sourceAtTime <> sourceText`, computed everywhere it is
 * needed. A flag that can be derived must not also be stored — the two would drift, and the stored
 * one would win.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory for tests.
 */

function createModel(database) {
  /** Every entry with its translations, shaped for `translationCsv.serialise`. */
  function listEntries() {
    const entries = database.prepare(
      'SELECT entryKey, kind, sourceId, sourceText FROM translation_entries ORDER BY entryKey'
    ).all();
    const byKey = new Map(entries.map((e) => [e.entryKey, { ...e, values: {} }]));
    for (const v of database.prepare('SELECT entryKey, lang, text, sourceAtTime FROM translation_values').all()) {
      const entry = byKey.get(v.entryKey);
      if (entry) entry.values[v.lang] = { text: v.text, sourceAtTime: v.sourceAtTime };
    }
    return [...byKey.values()];
  }

  /**
   * Rule 1 — reconcile the catalogue with what the sources say today.
   *
   * Idempotent by construction: it upserts what exists and deletes what no longer does. An entry's
   * translations survive a French edit (rule 4: the key is the provenance, not the text); they are
   * lost only when the source row itself is gone (rule 6), and the collector deliberately still
   * yields archived options so archiving never costs a translation.
   */
  function collect(sources, { now = new Date() } = {}) {
    const stamp = now.toISOString();
    const upsert = database.prepare(`
      INSERT INTO translation_entries (entryKey, kind, sourceId, sourceText, seenAt)
      VALUES (@entryKey, @kind, @sourceId, @sourceText, @seenAt)
      ON CONFLICT(entryKey) DO UPDATE SET kind = @kind, sourceId = @sourceId, sourceText = @sourceText, seenAt = @seenAt`);
    const result = { added: 0, updated: 0, removed: 0 };

    database.transaction(() => {
      const seen = new Set();
      for (const s of sources) {
        const sourceText = String(s.sourceText == null ? '' : s.sourceText).trim();
        if (!sourceText) continue;
        seen.add(s.entryKey);
        const before = database.prepare('SELECT sourceText FROM translation_entries WHERE entryKey = ?').get(s.entryKey);
        upsert.run({
          entryKey: s.entryKey,
          kind: s.kind,
          sourceId: s.sourceId == null ? null : Number(s.sourceId),
          sourceText,
          seenAt: stamp,
        });
        if (!before) result.added += 1;
        else if (before.sourceText !== sourceText) result.updated += 1;
      }
      for (const row of database.prepare('SELECT entryKey FROM translation_entries').all()) {
        if (!seen.has(row.entryKey)) {
          database.prepare('DELETE FROM translation_values WHERE entryKey = ?').run(row.entryKey);
          database.prepare('DELETE FROM translation_entries WHERE entryKey = ?').run(row.entryKey);
          result.removed += 1;
        }
      }
    })();
    return result;
  }

  /**
   * Work out what an uploaded file would change, without touching anything.
   *
   * Split from `applyImport` on purpose: rule 12 has to be able to say « this removes 4 translations »
   * *before* a single row is written, and the only honest way to say that is to have computed it.
   */
  function planImport(rows) {
    const plan = { updates: [], removals: [], reviewClears: [], ignoredUnknown: 0, unchanged: 0 };
    for (const row of rows || []) {
      const entry = database.prepare('SELECT entryKey, sourceText FROM translation_entries WHERE entryKey = ?').get(row.entryKey);
      // Rule 13: what the catalogue contains is GuestFlow's to decide. A key we do not know is a
      // typo or a stale file, never an instruction to create something.
      if (!entry) { plan.ignoredUnknown += 1; continue; }
      for (const [lang, rawText] of Object.entries(row.values || {})) {
        const text = String(rawText == null ? '' : rawText).trim();
        const current = database.prepare('SELECT text, sourceAtTime FROM translation_values WHERE entryKey = ? AND lang = ?')
          .get(row.entryKey, lang);
        if (!text) {
          if (current) plan.removals.push({ entryKey: row.entryKey, lang, was: current.text, line: row.line });
          continue;
        }
        if (!current || current.text !== text) {
          plan.updates.push({ entryKey: row.entryKey, lang, text, sourceAtTime: entry.sourceText });
          continue;
        }
        // Same text as stored. The only thing that can still change is the review flag: emptying the
        // « à revérifier » cell is how the operator says they have looked at it (rule 5).
        if (current.sourceAtTime !== entry.sourceText && row.reviewAcknowledged) {
          plan.reviewClears.push({ entryKey: row.entryKey, lang, sourceAtTime: entry.sourceText });
        } else {
          plan.unchanged += 1;
        }
      }
    }
    return plan;
  }

  /** Rule 11 — one transaction. A file is applied whole or not at all. */
  function applyImport(plan) {
    const put = database.prepare(`
      INSERT INTO translation_values (entryKey, lang, text, sourceAtTime)
      VALUES (@entryKey, @lang, @text, @sourceAtTime)
      ON CONFLICT(entryKey, lang) DO UPDATE SET text = @text, sourceAtTime = @sourceAtTime`);
    const drop = database.prepare('DELETE FROM translation_values WHERE entryKey = ? AND lang = ?');
    const realign = database.prepare('UPDATE translation_values SET sourceAtTime = ? WHERE entryKey = ? AND lang = ?');

    database.transaction(() => {
      for (const u of plan.updates) put.run(u);
      for (const r of plan.removals) drop.run(r.entryKey, r.lang);
      for (const c of plan.reviewClears) realign.run(c.sourceAtTime, c.entryKey, c.lang);
    })();

    return {
      updated: plan.updates.length,
      cleared: plan.removals.length,
      reviewCleared: plan.reviewClears.length,
      ignoredUnknown: plan.ignoredUnknown,
      unchanged: plan.unchanged,
    };
  }

  /** What the Settings card shows (rule 20). */
  function summary(languages) {
    const langs = (languages || []).filter((l) => l && l !== 'fr');
    const total = database.prepare('SELECT COUNT(*) AS n FROM translation_entries').get().n;
    const untranslated = {};
    let needsReview = 0;
    for (const lang of langs) {
      untranslated[lang] = database.prepare(`
        SELECT COUNT(*) AS n FROM translation_entries e
        WHERE NOT EXISTS (SELECT 1 FROM translation_values v
                          WHERE v.entryKey = e.entryKey AND v.lang = ? AND TRIM(v.text) <> '')`).get(lang).n;
    }
    if (langs.length) {
      const marks = langs.map(() => '?').join(',');
      needsReview = database.prepare(`
        SELECT COUNT(DISTINCT v.entryKey) AS n FROM translation_values v
        JOIN translation_entries e ON e.entryKey = v.entryKey
        WHERE v.lang IN (${marks}) AND v.sourceAtTime <> e.sourceText`).get(...langs).n;
    }
    return { total, untranslated, needsReview };
  }

  /**
   * Every translation for one language, as `entryKey → text`.
   *
   * One query for the whole catalogue rather than one per label: the option list is projected inside
   * a `map`, and a lookup per row would be a query per row.
   */
  function valuesFor(lang) {
    const out = new Map();
    if (!lang || lang === 'fr') return out;
    for (const row of database.prepare("SELECT entryKey, text FROM translation_values WHERE lang = ? AND TRIM(text) <> ''").all(lang)) {
      out.set(row.entryKey, row.text);
    }
    return out;
  }

  /**
   * Rule 17 — the languages the catalogue currently holds, English always included.
   *
   * There is no setting to maintain: a language exists because a column bearing its name came back
   * in an uploaded file. Adding German is therefore literally adding a « deutsch » column, which is
   * what the rule promises, and it needs no screen to do it.
   */
  function languagesInUse() {
    const rows = database.prepare("SELECT DISTINCT lang FROM translation_values WHERE TRIM(text) <> '' ORDER BY lang").all();
    const langs = rows.map((r) => r.lang).filter((l) => l && l !== 'fr');
    return langs.includes('en') ? langs : ['en', ...langs];
  }

  /** Used by the migration to seed the catalogue from the columns it is about to drop. */
  function seedValue({ entryKey, lang, text, sourceAtTime }) {
    const clean = String(text == null ? '' : text).trim();
    if (!clean) return false;
    const exists = database.prepare('SELECT 1 FROM translation_entries WHERE entryKey = ?').get(entryKey);
    if (!exists) return false;
    database.prepare(`
      INSERT INTO translation_values (entryKey, lang, text, sourceAtTime)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entryKey, lang) DO NOTHING`).run(entryKey, lang, clean, String(sourceAtTime || ''));
    return true;
  }

  function countValues(lang) {
    return database.prepare("SELECT COUNT(*) AS n FROM translation_values WHERE lang = ? AND TRIM(text) <> ''").get(lang).n;
  }

  return { listEntries, collect, planImport, applyImport, summary, valuesFor, seedValue, countValues, languagesInUse };
}

/**
 * The default instance resolves its handle on first USE, not on require.
 *
 * `database.js` runs this migration during its own module body, and its `module.exports = db` is the
 * very last line: a `require('../database')` at the top of this file would capture the still-empty
 * exports object and keep it forever. Binding late costs nothing — every function reaches for
 * `database.prepare` when it is called anyway — and removes the whole class of problem.
 */
const METHODS = ['listEntries', 'collect', 'planImport', 'applyImport', 'summary', 'valuesFor', 'seedValue', 'countValues', 'languagesInUse'];
const lazy = {};
for (const name of METHODS) {
  lazy[name] = (...args) => createModel(require('../database'))[name](...args);
}

module.exports = lazy;
module.exports.create = createModel;
