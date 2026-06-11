/**
 * Platforms controller — exposes the canonical platform-name list consumed by the UI dropdowns
 * (reservation form platform <Select> + property iCal-source form). Thin: delegates the union /
 * dedup / sort to platformsModel.listNames(). See specs/ical-platforms-in-dropdowns.md.
 */

const platformsModel = require('../models/platformsModel');

function listNames(req, res) {
  res.json({ platforms: platformsModel.listNames() });
}

module.exports = { listNames };
