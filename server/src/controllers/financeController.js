// Finance controller — thin handlers: parse query → financeModel → respond.

const model = require('../models/financeModel');

function summary(req, res) {
  res.json(model.getSummary({ from: req.query.from, to: req.query.to }));
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

module.exports = { summary, projection, operational, touristTax };
