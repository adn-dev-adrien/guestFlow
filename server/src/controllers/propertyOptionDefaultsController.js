/**
 * Per-property option defaults controller — thin orchestration over `propertyOptionDefaultsModel`
 * (specs/weekly-bed-linen-tracking.md §3.7).
 *
 * Endpoints
 *   GET    /api/properties/:id/option-defaults
 *          → [{ optionId, offered }]
 *   PUT    /api/properties/:id/option-defaults/:optionId   { offered: boolean }
 *          → { propertyId, optionId, offered } (idempotent upsert)
 *   DELETE /api/properties/:id/option-defaults/:optionId
 *          → 204 (idempotent unset; missing row is not an error)
 *   GET    /api/options/:id/property-defaults
 *          → [{ propertyId, propertyName, offered }]  (read-only mirror for OptionsPage)
 *
 * The 404 path on PUT covers the "operator deleted the property in another tab" race; the
 * idempotent DELETE never 404s — re-delete is fine.
 */

const propertyOptionDefaultsModel = require('../models/propertyOptionDefaultsModel');

function parseIdParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// specs/plugins-phase-3b-neat.md rule 5 — the client adds these defaults to a new booking: while no
// plugin offers the insurance, it is not among them, or creating a booking would be refused (422).
const withoutUnofferedInsurance = (rows) => require('../utils/insuranceOffer').dropInsurance(require('../database'), rows);

function buildController({ model = propertyOptionDefaultsModel, hideInsurance = withoutUnofferedInsurance } = {}) {
  return {
    listForProperty(req, res) {
      const propertyId = parseIdParam(req.params.id);
      if (!propertyId) return res.status(400).json({ error: 'INVALID_PROPERTY_ID' });
      return res.json(hideInsurance(model.listForProperty(propertyId)));
    },

    setForProperty(req, res) {
      const propertyId = parseIdParam(req.params.id);
      const optionId = parseIdParam(req.params.optionId);
      if (!propertyId || !optionId) return res.status(400).json({ error: 'INVALID_ID' });
      const offered = Boolean(req.body && req.body.offered);
      try {
        const row = model.set(propertyId, optionId, offered);
        return res.json(row);
      } catch (err) {
        // SQLite FK violation when the property or option doesn't exist → 404 is more
        // actionable than a 500 stack trace.
        if (String(err && err.message || '').includes('FOREIGN KEY')) {
          return res.status(404).json({ error: 'NOT_FOUND' });
        }
        throw err;
      }
    },

    unsetForProperty(req, res) {
      const propertyId = parseIdParam(req.params.id);
      const optionId = parseIdParam(req.params.optionId);
      if (!propertyId || !optionId) return res.status(400).json({ error: 'INVALID_ID' });
      model.unset(propertyId, optionId);
      return res.status(204).end();
    },

    listForOption(req, res) {
      const optionId = parseIdParam(req.params.id);
      if (!optionId) return res.status(400).json({ error: 'INVALID_OPTION_ID' });
      return res.json(model.listForOption(optionId));
    },
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
