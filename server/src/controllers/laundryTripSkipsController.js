/**
 * Laundry trip skips controller — thin GET/POST/DELETE trio behind `/api/laundry/skips`.
 * Admin-only via the default role middleware (no entry added to the accountant allow-list).
 *
 * Spec: specs/skip-laundry-trip.md §4.1 + §4.3.
 */

const model = require('../models/laundryTripSkipsModel');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  // Defensive against malformed-but-shape-matching strings like "2026-13-99" — Date.parse
  // returns NaN for those, but the regex doesn't catch them.
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function createController(skipsModel) {
  return {
    listSkips(req, res) {
      return res.json({ skips: skipsModel.listAll() });
    },

    addSkip(req, res) {
      const date = req.body && req.body.date;
      if (!isValidIsoDate(date)) {
        return res.status(400).json({ error: 'Date attendue au format YYYY-MM-DD.', code: 'INVALID_DATE' });
      }
      skipsModel.add(date);
      return res.json({ ok: true, skips: skipsModel.listAll() });
    },

    removeSkip(req, res) {
      const date = req.params && req.params.date;
      if (!isValidIsoDate(date)) {
        return res.status(400).json({ error: 'Date attendue au format YYYY-MM-DD.', code: 'INVALID_DATE' });
      }
      skipsModel.remove(date);
      return res.json({ ok: true, skips: skipsModel.listAll() });
    },
  };
}

const defaultController = createController(model);
defaultController.create = createController;

module.exports = defaultController;
