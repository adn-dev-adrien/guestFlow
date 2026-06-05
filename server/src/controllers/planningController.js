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
const laundryTripSkipsModel = require('../models/laundryTripSkipsModel');
const {
  findLaundryDaysInRange,
  prevLaundryDay,
  previousNonSkippedLaundryDay,
} = require('../utils/laundryWindow');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

const EMPTY_LAUNDRY_BLOCK = Object.freeze({
  singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  largeTowels: 0, mediumTowels: 0, smallTowels: 0,
});

function buildController({
  laundryModel: injectedLaundryModel = laundryModel,
  settingsModel: injectedSettingsModel = settingsModel,
  linenInventoryModel: injectedLinenInventoryModel = linenInventoryModel,
  laundryTripSkipsModel: injectedLaundryTripSkipsModel = laundryTripSkipsModel,
} = {}) {
  return {
    /**
     * GET /api/planning/laundry?from=YYYY-MM-DD[&to=YYYY-MM-DD]
     *
     * Returns the laundry summary for every occurrence of `laundryWeekday` (from settings)
     * in the requested range. Drop-off counts sheets used by reservations whose endDate
     * is in `(L-7d, L]`; pick-up is the previous laundry day's drop-off (which may itself
     * be outside the requested range — we still compute it).
     *
     * `to` is OPTIONAL. When omitted the server defaults it to the inventory horizon
     * (= the last reservation's endDate, same business concept that drives the linen
     * simulation). This keeps the client from having to derive the "right" upper bound
     * from UI state (scroll position, page size, etc.) — the business horizon is a server
     * concern (specs/skip-laundry-trip.md §4.1 hotfix 2026-06-05 follow-up #3,
     * CLAUDE.md §6.0). The client passes `to` only when it explicitly wants a slice (e.g.
     * incremental loading of a future window via infinite scroll).
     *
     * The client filters out silent laundry days (both sides zero) — the server emits them
     * uniformly so the contract stays predictable.
     */
    laundrySummary(req, res) {
      const from = (req.query && req.query.from) || '';
      const rawTo = (req.query && req.query.to) || '';
      if (!isIsoDate(from)) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      if (rawTo && !isIsoDate(rawTo)) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      const row = injectedSettingsModel.read();
      const weekday = row && row.laundryWeekday != null ? Number(row.laundryWeekday) : 2;
      // Compute `to`. Explicit query param wins; otherwise derive from the inventory horizon.
      // No horizon (no future reservations) AND no explicit `to` → emit nothing: there's
      // nothing to project against.
      let to = rawTo;
      if (!to) {
        const sim = injectedLinenInventoryModel.simulate();
        to = sim?.horizon || null;
        if (!to) {
          return res.json({ laundryWeekday: weekday, laundryDays: [] });
        }
      }
      if (from > to) {
        // Explicit slice that ends before it starts → still a 400 (operator error).
        // The horizon fallback never trips this because horizon ≥ today by construction.
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      const laundryDates = findLaundryDaysInRange(from, to, weekday);
      // specs/skip-laundry-trip.md §3.1 rule 6 — the operator can mark a trip as not-made,
      // and BOTH the drop-off and the pick-up of that trip carry over to the next non-skipped
      // trip. Concretely: the half-open window of a non-skipped card extends backward through
      // every skipped trip in between, so reservations from the in-between weeks finally land
      // in "À apporter" / "À récupérer" instead of disappearing into the skipped card.
      //
      // Before this wiring shipped, the "Disponible après ce dépôt" line (via
      // `linenInventoryModel.simulate`) was already skip-aware (PR #126), but the À apporter
      // / À récupérer counts were not — the next card showed its pre-skip values, which
      // diverged from the inventory line on the same card. The fix makes the two paths agree.
      const skippedDates = new Set(injectedLaundryTripSkipsModel.listAll());
      const widestPrev = (laundryDay) => (
        previousNonSkippedLaundryDay(laundryDay, skippedDates) || prevLaundryDay(laundryDay)
      );
      // Each dropOff / pickUp block carries the bed-linen sums AND the bathroom-linen sums.
      // The bathroom counts are spread into the same block (not a separate sibling) so the
      // client renders both under a unified "À apporter / À récupérer" section without an
      // extra plumbing layer.
      const buildBlock = (startExclusive, endInclusive) => ({
        ...injectedLaundryModel.dropOffForWindow(startExclusive, endInclusive),
        ...injectedLaundryModel.dropOffBathroomForWindow(startExclusive, endInclusive),
      });
      const laundryDays = laundryDates.map((date) => {
        // A skipped trip's counts are masked on the client by the "Voyage non réalisé"
        // caption (LaundryDayCard §3.3). We emit zeros for a uniform contract — the next
        // non-skipped trip's widened window will absorb this batch.
        if (skippedDates.has(date)) {
          return { date, dropOff: { ...EMPTY_LAUNDRY_BLOCK }, pickUp: { ...EMPTY_LAUNDRY_BLOCK } };
        }
        const prev = widestPrev(date);
        const prevPrev = widestPrev(prev);
        return {
          date,
          dropOff: buildBlock(prev, date),
          // Pick-up(L) = Drop-off(prev). Same half-open semantics shifted by one non-skipped
          // step, so the previous batch coming back from the laundry reflects what was
          // actually deposited there.
          pickUp: buildBlock(prevPrev, prev),
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
