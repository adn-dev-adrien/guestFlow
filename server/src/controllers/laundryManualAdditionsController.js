/**
 * Laundry manual additions controller — GET list + PUT upsert behind
 * `/api/laundry/manual-additions`. Admin-only via the default role middleware (no entry in the
 * accountant allow-list), same as the skips controller.
 *
 * Spec: specs/manual-laundry-additions.md §4.3.
 */

const model = require('../models/laundryManualAdditionsModel');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function createController(additionsModel) {
  return {
    /** GET /api/laundry/manual-additions → { additions: { 'YYYY-MM-DD': {…6 counts} } } (non-empty only). */
    listAdditions(req, res) {
      return res.json({ additions: additionsModel.listAll() });
    },

    /**
     * PUT /api/laundry/manual-additions/:date — upsert the six per-type counts for a trip date.
     * All-zero deletes the row (model concern). Returns the stored counts + the refreshed list.
     */
    setAddition(req, res) {
      const date = req.params && req.params.date;
      if (!isValidIsoDate(date)) {
        return res.status(400).json({ error: 'Date attendue au format YYYY-MM-DD.', code: 'INVALID_DATE' });
      }
      const counts = additionsModel.set(date, req.body || {});
      return res.json({ ok: true, date, counts, additions: additionsModel.listAll() });
    },
  };
}

const defaultController = createController(model);
defaultController.create = createController;

module.exports = defaultController;
