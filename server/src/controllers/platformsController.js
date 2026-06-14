/**
 * Platforms controller — exposes the canonical platform-name list consumed by the UI dropdowns
 * (reservation form platform <Select> + property iCal-source form). Thin: delegates the union /
 * dedup / sort to platformsModel.listNames(). See specs/ical-platforms-in-dropdowns.md.
 */

const platformsModel = require('../models/platformsModel');

function listNames(req, res) {
  res.json({ platforms: platformsModel.listNames() });
}

// Non-direct platforms + their commission % (specs/platform-price-from-commission.md).
function listWithCommission(req, res) {
  res.json({ platforms: platformsModel.listWithCommission() });
}

// Set a platform's global commission % (clamped server-side to [0, 99.99]; Direct is rejected).
function setCommission(req, res) {
  const updated = platformsModel.setCommissionPercent(req.params.id, req.body && req.body.commissionPercent);
  if (!updated) return res.status(404).json({ error: 'PLATFORM_NOT_FOUND_OR_DIRECT' });
  return res.json({ id: updated.id, name: updated.name, commissionPercent: Number(updated.commissionPercent) || 0 });
}

module.exports = { listNames, listWithCommission, setCommission };
