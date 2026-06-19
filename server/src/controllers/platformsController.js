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

// Set a platform's GLOBAL calendar colour (specs/platforms-and-ical-rework.md §3 rules 5-6). The
// `:key` is the platform label/name; an empty colour or the built-in brand colour clears the
// override. Upserts the platform so a never-used built-in can still be recoloured.
function setColor(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  const updated = platformsModel.setColor(key, req.body && req.body.color);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, color: updated.color });
}

module.exports = { listNames, listWithCommission, setCommission, setColor };
