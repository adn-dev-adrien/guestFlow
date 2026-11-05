// « Profil des séjours » (specs/stay-profile.md §4.3) — thin: the dashboard's query → model → respond.

const model = require('../models/stayProfileModel');

function getStayProfile(req, res) {
  const q = req.query || {};
  const result = model.getStayProfile({
    fiscalYear: q.fiscalYear, period: q.period, month: q.month, from: q.from, to: q.to, propertyId: q.propertyId,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

module.exports = { getStayProfile };
