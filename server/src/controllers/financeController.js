// Finance controller — thin handlers: parse query → financeModel → respond.

const model = require('../models/financeModel');
const dashboard = require('../models/financeDashboardModel');

// specs/finance-dashboard-redesign.md §4.3 — the whole page in one payload, and each tile's table.
const dashboardParams = (q) => ({
  fiscalYear: q.fiscalYear, period: q.period, month: q.month, from: q.from, to: q.to,
  propertyId: q.propertyId, until: q.until, scope: q.scope,
});

function getDashboard(req, res) {
  const result = dashboard.getDashboard(dashboardParams(req.query));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

function getDashboardDetail(req, res) {
  const result = dashboard.getDashboardDetail(req.params.tile, dashboardParams(req.query));
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

function goalContext(req, res) {
  res.json(model.getGoalContext());
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

module.exports = { getDashboard, getDashboardDetail, goalContext, touristTax, setTouristTaxDeclared };
