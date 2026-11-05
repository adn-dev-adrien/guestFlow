// « À vérifier » of the Suivi financier (specs/finance-data-checks.md §4.3) — thin: query → model → respond.

const model = require('../models/financeDataChecksModel');

function getDataChecks(req, res) {
  const result = model.getDataChecks({ fiscalYear: req.query.fiscalYear, propertyId: req.query.propertyId });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

module.exports = { getDataChecks };
