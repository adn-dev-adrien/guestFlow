/**
 * Translation catalogue endpoints (specs/translation-catalogue.md §4.3).
 *
 * Thin: the collector decides what is translatable, the model decides what a file changes, the CSV
 * module decides what a file looks like. This layer only refreshes, maps errors to HTTP, and enforces
 * the one rule that has to live at the boundary — an import that removes translations is confirmed
 * before it is applied (rule 12).
 */

const db = require('../database');
const translationsModel = require('../models/translationsModel');
const { collectSources } = require('../utils/translationCollector');
const { applyDefaultTranslations } = require('../utils/translationCatalogueMigration');
const translationCsv = require('../utils/translationCsv');

/**
 * Rule 1 + rule 10 — reconcile before answering, so what the operator downloads includes the option
 * they created five minutes ago. Idempotent and cheap: one pass over ~60 short labels.
 */
function refresh() {
  translationsModel.collect(collectSources(db));
  applyDefaultTranslations(translationsModel);
}

function getSummary(req, res) {
  refresh();
  const languages = translationsModel.languagesInUse();
  return res.json({ languages: ['fr', ...languages], ...translationsModel.summary(languages) });
}

function exportCsv(req, res) {
  refresh();
  const languages = translationsModel.languagesInUse();
  const csv = translationCsv.serialise(translationsModel.listEntries(), languages);
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="traductions-${day}.csv"`);
  return res.send(csv);
}

function importCsv(req, res) {
  const text = typeof req.body === 'string' ? req.body : String((req.body && req.body.csv) || '');
  let parsed;
  try {
    parsed = translationCsv.parse(text);
  } catch (err) {
    if (err && err.code === 'MALFORMED_CSV') {
      return res.status(400).json({
        error: 'MALFORMED_CSV',
        line: err.line,
        message: `Ligne ${err.line} : ${err.message} Rien n'a été modifié.`,
      });
    }
    throw err;
  }

  // Refresh first: a file listing an option deleted since the download must report that key as
  // unknown, not resurrect it.
  refresh();
  const plan = translationsModel.planImport(parsed.rows);

  // Rule 12 — an empty cell against a stored translation is a legitimate removal, and is also what a
  // file mangled by a spreadsheet looks like. The difference is not ours to guess.
  const confirmed = String((req.query && req.query.confirmRemovals) || '') === 'true';
  if (plan.removals.length && !confirmed) {
    return res.status(409).json({
      error: 'REMOVALS_NOT_CONFIRMED',
      removals: plan.removals.length,
      updates: plan.updates.length,
      message: `Ce fichier retire ${plan.removals.length} traduction(s).`,
    });
  }

  return res.json(translationsModel.applyImport(plan));
}

module.exports = { getSummary, exportCsv, importCsv, refresh };
