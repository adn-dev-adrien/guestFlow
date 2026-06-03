/**
 * Planning controller — aggregate endpoints for the Planning page
 * (specs/weekly-bed-linen-tracking.md).
 *
 * Currently exposes only `laundrySummary`. Other planning aggregates can join here later
 * (e.g. weekly occupancy chips, cleaning lists) — keeps planning-domain endpoints out of
 * the already-fat /api/reservations route.
 */

const laundryModel = require('../models/laundryModel');
const settingsModel = require('../models/settingsModel');
const linenInventoryModel = require('../models/linenInventoryModel');
const { findLaundryDaysInRange, prevLaundryDay } = require('../utils/laundryWindow');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function buildController({
  laundryModel: injectedLaundryModel = laundryModel,
  settingsModel: injectedSettingsModel = settingsModel,
  linenInventoryModel: injectedLinenInventoryModel = linenInventoryModel,
} = {}) {
  return {
    /**
     * GET /api/planning/laundry?from=YYYY-MM-DD&to=YYYY-MM-DD
     *
     * Returns the laundry summary for every occurrence of `laundryWeekday` (from settings)
     * within the requested range. Drop-off counts sheets used by reservations whose endDate
     * is in `(L-7d, L]`; pick-up is the previous laundry day's drop-off (which may itself
     * be outside the requested range — we still compute it).
     *
     * The client filters out silent laundry days (both sides zero) — the server emits them
     * uniformly so the contract stays predictable.
     */
    laundrySummary(req, res) {
      const from = (req.query && req.query.from) || '';
      const to = (req.query && req.query.to) || '';
      if (!isIsoDate(from) || !isIsoDate(to)) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      if (from > to) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      const row = injectedSettingsModel.read();
      const weekday = row && row.laundryWeekday != null ? Number(row.laundryWeekday) : 2;
      const laundryDates = findLaundryDaysInRange(from, to, weekday);
      // Each dropOff / pickUp block carries the bed-linen sums AND the bathroom-linen sums.
      // The bathroom counts are spread into the same block (not a separate sibling) so the
      // client renders both under a unified "À apporter / À récupérer" section without an
      // extra plumbing layer.
      const buildBlock = (startExclusive, endInclusive) => ({
        ...injectedLaundryModel.dropOffForWindow(startExclusive, endInclusive),
        ...injectedLaundryModel.dropOffBathroomForWindow(startExclusive, endInclusive),
      });
      const laundryDays = laundryDates.map((date) => {
        const prev = prevLaundryDay(date);
        return {
          date,
          dropOff: buildBlock(prev, date),
          // Pick-up(L) = Drop-off(L - 7 days). Same half-open semantics shifted by 7.
          pickUp: buildBlock(prevLaundryDay(prev), prev),
        };
      });
      return res.json({ laundryWeekday: weekday, laundryDays });
    },

    /**
     * GET /api/planning/linen-inventory
     *
     * Returns the per-laundry-day inventory snapshot (post-day-end clean per type) so the
     * client can render "Disponible après ce dépôt" on each laundry card
     * (specs/linen-inventory-shortage-tracking.md §3.5 / §4.3).
     *
     * Payload shape:
     *   { horizon: 'YYYY-MM-DD', byLaundryDay: { 'YYYY-MM-DD': { single, double, baby, large, medium, small }, ... } }
     *
     * Empty `byLaundryDay` when no horizon (no future reservation) or no stock tracked.
     */
    linenInventory(req, res) {
      const result = injectedLinenInventoryModel.simulate();
      if (!result) return res.json({ horizon: null, byLaundryDay: {} });
      const row = injectedSettingsModel.read();
      const laundryWeekday = Number(row.laundryWeekday == null ? 2 : row.laundryWeekday);
      const byLaundryDay = {};
      for (const day of result.days) {
        const isLaundryDay = (new Date(`${day.date}T00:00:00Z`).getUTCDay()) === laundryWeekday;
        if (isLaundryDay) {
          byLaundryDay[day.date] = day.clean;
        }
      }
      return res.json({ horizon: result.horizon, byLaundryDay });
    },
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
