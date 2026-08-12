/**
 * Welcome pack controller — specs/welcome-pack-auto-options.md §4.3.
 *
 * Endpoint
 *   GET /api/properties/:id/welcome-pack
 *       ?platform=&startDate=&endDate=&checkInTime=&checkOutTime=&adults=&children=&teens=
 *       → { eligible, lines: [{ optionId, title, freeUnits, unitPrice,
 *                               mode: 'quantity' | 'occurrence',
 *                               quantity?, occurrence?: { date, time } }] }
 *
 * Everything the reservation form needs to decide is decided here: what the pack contains, whether
 * the platform qualifies, whether the free units cover the party, and which day is « the first
 * morning ». The client applies `lines` as they come — an option the rate cannot fully cover is
 * absent from the array, never a line the operator has to notice and undo.
 */

const propertiesModel = require('../models/propertiesModel');
const { buildWelcomePackLines } = require('../utils/welcomePack');

function parseIdParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function buildController({ model = propertiesModel, build = buildWelcomePackLines } = {}) {
  return {
    forProperty(req, res) {
      const propertyId = parseIdParam(req.params.id);
      if (!propertyId) return res.status(400).json({ error: 'INVALID_PROPERTY_ID' });
      const q = req.query || {};
      // An unknown property simply has no pack — the form asks before the operator has committed to
      // anything, so a 404 would only add noise to a path that must fail silently anyway.
      const packOptions = model.listWelcomePackOptions(propertyId);
      return res.json(build({
        packOptions,
        platform: q.platform,
        startDate: q.startDate,
        endDate: q.endDate,
        checkInTime: q.checkInTime,
        checkOutTime: q.checkOutTime,
        adults: q.adults,
        children: q.children,
        teens: q.teens,
      }));
    },
  };
}

const controller = buildController();
controller.buildController = buildController;

module.exports = controller;
