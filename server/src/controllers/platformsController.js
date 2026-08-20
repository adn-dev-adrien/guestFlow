/**
 * Platforms controller — exposes the canonical platform-name list consumed by the UI dropdowns
 * (reservation form platform <Select> + property iCal-source form). Thin: delegates the union /
 * dedup / sort to platformsModel.listNames(). See specs/ical-platforms-in-dropdowns.md.
 */

const platformsModel = require('../models/platformsModel');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { parsePayoutDueDaysInput } = require('../utils/platformPayout');

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

// `:key` is the platform label/name. Sets the GLOBAL tourist-tax mode (applies to every property).
// Body `{ touristTaxCollection: 'platform' | 'platform_reversed' | 'owner' }`.
function setTouristTax(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  const mode = req.body && req.body.touristTaxCollection;
  if (!['platform', 'platform_reversed', 'owner'].includes(mode)) {
    return res.status(400).json({ error: 'INVALID_TOURIST_TAX_MODE' });
  }
  const updated = platformsModel.setTouristTaxCollection(key, mode);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, touristTaxCollection: updated.touristTaxCollection });
}

// specs/platform-deposit-toggle.md — set a platform's GLOBAL acompte flag. `:key` is the platform
// label/name. Body `{ takesDeposit: boolean }`. Applies to every property.
function setDepositMode(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  const takesDeposit = req.body && req.body.takesDeposit;
  const updated = platformsModel.setDepositMode(key, takesDeposit);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, platformTakesDeposit: updated.platformTakesDeposit });
}

// specs/platform-payout-due-date.md §4.3 — set a platform's GLOBAL payout delay (days after the
// guest leaves before the transfer is considered late). `:key` is the platform label/name.
// Body `{ days: 0..365 }`. Own channels (`direct`, `Lodgify`) have no payout to wait for.
function setPayoutDueDays(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  if (!key.trim()) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  if (isDirectChannel(key)) return res.status(400).json({ error: 'DIRECT_CHANNEL' });
  const days = parsePayoutDueDaysInput(req.body && req.body.days);
  if (days === null) return res.status(400).json({ error: 'INVALID_DAYS' });
  const updated = platformsModel.setPayoutDueDays(key, days);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, payoutDueDays: updated.payoutDueDays });
}

module.exports = {
  listNames, listWithCommission, setCommission, setColor, setTouristTax, setDepositMode,
  setPayoutDueDays,
};
