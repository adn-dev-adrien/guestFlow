// Finance controller — thin handlers: parse query → financeModel → respond.

const model = require('../models/financeModel');

// `fiscalYear` selects the exercise the annual figures describe (specs/fiscal-year-and-nights-sold.md
// §4.3): the END year of the exercise, e.g. 2026 for 1 Oct 2025 → 30 Sep 2026. Absent or invalid → the
// model falls back to the current exercise, so a hand-edited URL degrades instead of 400-ing.
function summary(req, res) {
  res.json(model.getSummary({ from: req.query.from, to: req.query.to, fiscalYear: req.query.fiscalYear }));
}

function breakdown(req, res) {
  const result = model.getBreakdown({
    metric: req.query.metric, from: req.query.from, to: req.query.to, fiscalYear: req.query.fiscalYear,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

function projection(req, res) {
  res.json(model.getProjection({ date: req.query.date }));
}

function operational(req, res) {
  res.json(model.getOperational());
}

function touristTax(req, res) {
  const result = model.getTouristTaxExtraction({ month: req.query.month });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

// specs/tourist-tax-declared-checkbox.md §4.3 — tick / untick « Déclarée » for one reservation.
function setTouristTaxDeclared(req, res) {
  const result = model.setTouristTaxDeclared({
    reservationId: req.params.reservationId,
    declared: Boolean(req.body && req.body.declared),
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json({ ok: true, declaredAt: result.data.declaredAt });
}

module.exports = { summary, breakdown, projection, operational, touristTax, setTouristTaxDeclared };
