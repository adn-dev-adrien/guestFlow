// specs/tourist-tax-report-v2.md §4.3 — thin handlers of the tourist-tax report: parse the query → model → respond.
// A repeated query key reads as not sent (utils/bodyText `scalarQuery`), so it meets the refusal of a missing one.

const model = require('../models/touristTaxReportModel');
const { scalarQuery } = require('../utils/bodyText');
const { touristTaxReportCsv, csvFileName, VIEWS } = require('../utils/touristTaxReportCsv');

const BAD_VIEW = 'Vue inconnue.';

const reportParams = (q) => ({
  period: q.period, month: q.month, quarter: q.quarter, year: q.year, from: q.from, to: q.to,
  propertyId: q.propertyId, declaration: q.declaration,
});

function getReport(req, res) {
  const result = model.getReport(reportParams(scalarQuery(req.query)));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

function getReportCsv(req, res) {
  const query = scalarQuery(req.query);
  const view = query.view == null || query.view === '' ? 'list' : query.view;
  if (!VIEWS.includes(view)) return res.status(400).json({ error: BAD_VIEW });
  const result = model.getReport(reportParams(query));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFileName(result.data, view)}"`);
  return res.send(touristTaxReportCsv(result.data, view));
}

module.exports = { getReport, getReportCsv, BAD_VIEW };
