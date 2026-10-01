/**
 * Laundry extra trips controller — `GET / PUT / DELETE /api/laundry/extra-trips` + the preview.
 *
 * An extra trip is a laundry trip on a FREE date (specs/laundry-extra-trip.md): the operator drops
 * the whole dirty pile and takes back everything at the laundry, or the per-type quantities he
 * declares. Writes are admin-only — the reception allowlist (`enforceRoleAccess`) only matches the
 * GETs, so the reception Planning can render the card read-only (§3.4 rule 16).
 *
 * Spec: specs/laundry-extra-trip.md §4.1 + §4.3.
 */

const { weekdayOf } = require('./laundryWindow');
const { createTripLedger, makeBlockBuilders } = require('./laundryTripLedger');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  // Defensive against malformed-but-shape-matching strings like "2026-13-99" — Date.parse
  // returns NaN for those, but the regex doesn't catch them.
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const INVALID_DATE = { error: 'Date attendue au format YYYY-MM-DD.', code: 'INVALID_DATE' };
const ON_LAUNDRY_DAY = { error: 'Ce jour est déjà un jour de blanchisserie.', code: 'EXTRA_TRIP_ON_LAUNDRY_DAY' };
const INVALID_PICKUP = { error: 'Les quantités récupérées sont requises pour une récupération partielle.', code: 'INVALID_PICKUP' };

// `settingsModel.read()` → the linen settings (`settings.js`), shaped like the former app_settings row.
function createController({
  extraTripsModel: trips,
  manualAdditionsModel: manual,
  settingsModel: settings,
  laundryModel: laundry,
  skipsModel: skips,
}) {
  const laundryWeekday = () => {
    const row = settings.read();
    return row && row.laundryWeekday != null ? Number(row.laundryWeekday) : 2;
  };

  return {
    /** GET /api/laundry/extra-trips → `{ trips: [{ date, pickUpAll, pickUp }] }` */
    list(req, res) {
      return res.json({ trips: trips.listAll() });
    },

    /**
     * GET /api/laundry/extra-trips/preview?date=YYYY-MM-DD
     * What an extra trip on `date` would drop and what would be at the laundry before it
     * (specs/laundry-extra-trip.md §4.3). Any record stored on `date` itself is ignored, so the same
     * preview serves the create and the edit dialogs.
     */
    preview(req, res) {
      const date = req.query && req.query.date;
      if (!isValidIsoDate(date)) return res.status(400).json(INVALID_DATE);
      const weekday = laundryWeekday();
      if (weekdayOf(date) === weekday) return res.status(400).json(ON_LAUNDRY_DAY);
      const ledger = createTripLedger({
        weekday,
        skippedDates: new Set(skips.listAll()),
        extraTrips: trips.listAll(),
        ...makeBlockBuilders({ laundryModel: laundry, laundryManualAdditionsModel: manual }),
      });
      return res.json({ date, ...ledger.previewFor(date) });
    },

    /**
     * PUT /api/laundry/extra-trips/:date — body `{ pickUpAll: boolean, pickUp?: {7 types} }`.
     * Upsert. Refuses a regular laundry day (rule 2) and a partial pick-up without quantities.
     */
    set(req, res) {
      const date = req.params && req.params.date;
      if (!isValidIsoDate(date)) return res.status(400).json(INVALID_DATE);
      if (weekdayOf(date) === laundryWeekday()) return res.status(400).json(ON_LAUNDRY_DAY);
      const body = req.body || {};
      const pickUpAll = body.pickUpAll !== false;
      if (!pickUpAll && (!body.pickUp || typeof body.pickUp !== 'object')) {
        return res.status(400).json(INVALID_PICKUP);
      }
      const trip = trips.set(date, { pickUpAll, pickUp: body.pickUp });
      return res.json({ ok: true, trip });
    },

    /**
     * DELETE /api/laundry/extra-trips/:date — idempotent. Also removes the manual line stored on that
     * date (rule 6): a manual line only makes sense on a trip date.
     */
    remove(req, res) {
      const date = req.params && req.params.date;
      if (!isValidIsoDate(date)) return res.status(400).json(INVALID_DATE);
      trips.remove(date);
      manual.remove(date);
      return res.json({ ok: true });
    },
  };
}

module.exports = { create: createController };
