// Finance controller — thin handlers: parse query → financeModel → respond.

const model = require('../models/financeModel');

function summary(req, res) {
  res.json(model.getSummary({ from: req.query.from, to: req.query.to }));
}

function breakdown(req, res) {
  const result = model.getBreakdown({ metric: req.query.metric, from: req.query.from, to: req.query.to });
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
