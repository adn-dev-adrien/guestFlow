// specs/tourist-tax-report-v2.md §4.3 — thin handlers of the tourist-tax report: parse the query → model → respond.
// Rule 28 (D-HC13) — a key sent twice, or as an object (`month[a]=`), is that key's 400: never read as absent, which
// would widen a filter to « every logement » or « every status » without a word.

const model = require('../models/touristTaxReportModel');
const { MESSAGES: PERIOD_MESSAGES } = require('../utils/touristTaxPeriod');
const { MESSAGES: WINDOW_MESSAGES } = require('../utils/financeWindow');
const { touristTaxReportCsv, csvFileName, VIEWS } = require('../utils/touristTaxReportCsv');

const BAD_VIEW = 'Vue inconnue.';

const KEY_REFUSALS = {
  period: PERIOD_MESSAGES.badKind,
  month: PERIOD_MESSAGES.badMonth,
  quarter: PERIOD_MESSAGES.badQuarter,
  year: PERIOD_MESSAGES.badYear,
  from: WINDOW_MESSAGES.missingDates,
  to: WINDOW_MESSAGES.missingDates,
  propertyId: model.MESSAGES.unknownProperty,
  declaration: model.MESSAGES.badDeclaration,
  view: BAD_VIEW,
};

/** The first key of the query that is not a plain string, as its refusal; null when every key is one. */
function shapeRefusal(query = {}) {
  const key = Object.keys(KEY_REFUSALS).find((k) => query[k] !== undefined && typeof query[k] !== 'string');
  return key ? KEY_REFUSALS[key] : null;
}

const reportParams = (q) => ({
  period: q.period, month: q.month, quarter: q.quarter, year: q.year, from: q.from, to: q.to,
  propertyId: q.propertyId, declaration: q.declaration,
});

function getReport(req, res) {
  const refused = shapeRefusal(req.query);
  if (refused) return res.status(400).json({ error: refused });
  const result = model.getReport(reportParams(req.query));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

function getReportCsv(req, res) {
  const refused = shapeRefusal(req.query);
  if (refused) return res.status(400).json({ error: refused });
  const query = req.query || {};
  const view = query.view == null || query.view === '' ? 'list' : query.view;
  if (!VIEWS.includes(view)) return res.status(400).json({ error: BAD_VIEW });
  const result = model.getReport(reportParams(query));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFileName(result.data, view)}"`);
  return res.send(touristTaxReportCsv(result.data, view));
}

module.exports = { getReport, getReportCsv, BAD_VIEW, shapeRefusal };
