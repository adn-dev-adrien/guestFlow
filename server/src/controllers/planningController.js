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
const laundryManualAdditionsModel = require('../models/laundryManualAdditionsModel');
const laundryExtraTripsModel = require('../models/laundryExtraTripsModel');
const breakfastModel = require('../models/breakfastModel');
const planningOptionCardsModel = require('../models/planningOptionCardsModel');
const planningResourceCardsModel = require('../models/planningResourceCardsModel');
const { findLaundryDaysInRange, activeExtraDates } = require('../utils/laundryWindow');
const { createTripLedger, makeBlockBuilders } = require('../utils/laundryTripLedger');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function buildController({
  laundryModel: injectedLaundryModel = laundryModel,
  settingsModel: injectedSettingsModel = settingsModel,
  linenInventoryModel: injectedLinenInventoryModel = linenInventoryModel,
  laundryTripSkipsModel: injectedLaundryTripSkipsModel = laundryTripSkipsModel,
  laundryManualAdditionsModel: injectedLaundryManualAdditionsModel = laundryManualAdditionsModel,
  laundryExtraTripsModel: injectedLaundryExtraTripsModel = laundryExtraTripsModel,
  breakfastModel: injectedBreakfastModel = breakfastModel,
  planningOptionCardsModel: injectedOptionCardsModel = planningOptionCardsModel,
  planningResourceCardsModel: injectedResourceCardsModel = planningResourceCardsModel,
} = {}) {
  return {
    /**
     * GET /api/planning/laundry?from=YYYY-MM-DD[&to=YYYY-MM-DD]
     *
     * Returns the laundry summary for every occurrence of `laundryWeekday` (from settings)
     * in the requested range, plus every extra laundry trip in the range
     * (specs/laundry-extra-trip.md). Drop-off counts sheets used by reservations whose endDate
     * is in `(previous trip, T]`; pick-up is what sits at the laundry before T — with weekly
     * trips only, exactly the previous laundry day's drop-off (which may itself be outside the
     * requested range — we still compute it).
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
     *
     * Each drop-off also carries `incomplete: [{ id, clientName, propertyName, endDate }]` — the
     * stays of the window that declare bed linen but have no quantity saved yet
     * (specs/laundry-counts-explicit-option-only.md §3.2), so the card can flag a figure it knows
     * is short instead of under-reporting in silence.
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
      // specs/laundry-extra-trip.md §3.2 — the summary is a ledger over the TRIP SEQUENCE: every
      // non-skipped regular laundry day plus every active extra trip, chronologically. A skipped
      // trip (specs/skip-laundry-trip.md §3.1 rule 6) is simply absent from the sequence, so the
      // next trip's drop-off window widens backward across it; an extra trip takes the dirty pile
      // (and all or part of the pool) with it, so the next trip only carries what came after.
      // The ledger's buildBlock merges bed + bathroom + bath-mat sums + the signed manual lines into
      // one block per side (the client renders both under a unified "À apporter / À récupérer").
      //
      // The "Disponible après ce dépôt" line (via `linenInventoryModel.simulate`) follows the same
      // sequence — the two paths must agree (PR #126 hotfix 2026-06-05 taught us what happens when
      // they don't).
      const skippedDates = new Set(injectedLaundryTripSkipsModel.listAll());
      const extraTrips = injectedLaundryExtraTripsModel.listAll();
      const ledger = createTripLedger({
        weekday,
        skippedDates,
        extraTrips,
        ...makeBlockBuilders({
          laundryModel: injectedLaundryModel,
          laundryManualAdditionsModel: injectedLaundryManualAdditionsModel,
        }),
      });
      const regularDates = findLaundryDaysInRange(from, to, weekday);
      const extraDates = activeExtraDates(extraTrips.map((t) => t.date), weekday)
        .filter((d) => d >= from && d <= to);
      const tripDates = Array.from(new Set([...regularDates, ...extraDates])).sort();
      // Each entry: { date, kind, dropOff (+ incomplete), pickUp } and, for an extra trip,
      // { pickUpAll, leftAtLaundry }. A skipped regular trip emits zeros — the client masks them with
      // the "Voyage non réalisé" caption.
      const laundryDays = tripDates.map((date) => ledger.entryFor(date)).filter(Boolean);
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
      // Emit only the TRACKED types (stock > 0) in the « Disponible après ce dépôt » snapshot —
      // a type with stock 0 is "not tracked" (no availability figure, no shortage) per
      // specs/linen-inventory-shortage-tracking.md §3.1 + specs/laundry-bath-mat.md §3 rule 7.
      // Without this, an untracked type with demand (e.g. bath mats at stock 0) would surface a
      // misleading negative figure on the card.
      const trackedTypes = {
        single: row.bedLinenStockSingle, double: row.bedLinenStockDouble, baby: row.bedLinenStockBaby,
        large: row.towelStockLarge, medium: row.towelStockMedium, small: row.towelStockSmall,
        bathMat: row.towelStockBathMat,
      };
      const tracked = Object.keys(trackedTypes).filter((t) => Number(trackedTypes[t] || 0) > 0);
      const projectClean = (clean) => {
        const out = {};
        for (const t of tracked) out[t] = clean[t];
        return out;
      };
      // Keyed by every regular laundry day (skipped or not) AND every extra trip day
      // (specs/laundry-extra-trip.md §3.3 rule 15), so the extra card shows its own line.
      const byLaundryDay = {};
      for (const day of result.days) {
        const isLaundryDay = (new Date(`${day.date}T00:00:00Z`).getUTCDay()) === laundryWeekday;
        if (isLaundryDay || day.isTripDay) {
          byLaundryDay[day.date] = projectClean(day.clean);
        }
      }
      return res.json({ horizon: result.horizon, byLaundryDay });
    },

    /**
     * GET /api/planning/breakfast?from=YYYY-MM-DD&to=YYYY-MM-DD
     *
     * Returns the per-day breakfast list for the requested window
     * (specs/breakfast-option-and-planning-card.md §3 + §4).
     *
     * Payload shape:
     *   { breakfastByDate: {
     *       'YYYY-MM-DD': {
     *         items: [{ reservationId, clientName, propertyName, persons,
     *                   coffee, tea, chocolate, milk, pastries, cereals, note }, ...],
     *         totalPersons: number,
     *       }, ...
     *     } }
     *
     * Empty `breakfastByDate` when no reservation contributes in the window. The model
     * applies the half-open `(startDate, endDate]` "présent le matin" rule, the
     * babies-excluded person count, and the property-default fallback. The client just
     * mounts the card and trusts the payload.
     */
    breakfastSummary(req, res) {
      const from = (req.query && req.query.from) || '';
      const to = (req.query && req.query.to) || '';
      if (!isIsoDate(from) || !isIsoDate(to)) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      if (from > to) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      const breakfastByDate = injectedBreakfastModel.breakfastByDate({ from, to });
      return res.json({ breakfastByDate });
    },

    /**
     * GET /api/planning/option-cards?from=YYYY-MM-DD&to=YYYY-MM-DD
     *
     * Option-driven planning cards (specs/option-planning-card.md §3.3): one card per stored
     * occurrence of a `showsPlanningCard` option whose date ∈ [from, to], shaped ready to render.
     */
    optionCards(req, res) {
      const from = (req.query && req.query.from) || '';
      const to = (req.query && req.query.to) || '';
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      const optionCardsByDate = injectedOptionCardsModel.cardsInRange({ from, to });
      return res.json({ optionCardsByDate });
    },

    /**
     * POST /api/planning/option-cards/done
     * Body: { reservationId, optionId, date, time, done }
     * Toggles the « préparé » flag of one occurrence (specs/option-planning-card.md §3.5).
     */
    setOptionCardDone(req, res) {
      const body = req.body || {};
      const reservationId = Number(body.reservationId);
      const optionId = Number(body.optionId);
      const date = String(body.date || '');
      if (!Number.isInteger(reservationId) || reservationId <= 0
        || !Number.isInteger(optionId) || optionId <= 0
        || !isIsoDate(date)) {
        return res.status(400).json({ error: 'INVALID_PAYLOAD' });
      }
      const result = injectedOptionCardsModel.setOccurrenceDone({
        reservationId, optionId, date, time: String(body.time || ''), done: Boolean(body.done),
      });
      if (result && result.error) {
        const status = result.error === 'NOT_FOUND' || result.error === 'OCCURRENCE_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({ error: result.error });
      }
      return res.json(result);
    },

    /**
     * GET /api/planning/resource-cards?from=YYYY-MM-DD&to=YYYY-MM-DD
     * Resource-driven planning cards (specs/resource-hourly-scheduling.md §3.4): one card per session.
     */
    resourceCards(req, res) {
      const from = (req.query && req.query.from) || '';
      const to = (req.query && req.query.to) || '';
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      const resourceCardsByDate = injectedResourceCardsModel.cardsInRange({ from, to });
      return res.json({ resourceCardsByDate });
    },

    /**
     * POST /api/planning/resource-cards/done
     * Body: { reservationId, resourceId, date, start, done, kind? } — toggles one session's « préparé »
     * flag, or its « démarrer » one with `kind: 'ignition'` (specs/resource-ignition-task.md §3 rule 6).
     */
    setResourceCardDone(req, res) {
      const body = req.body || {};
      const reservationId = Number(body.reservationId);
      const resourceId = Number(body.resourceId);
      const date = String(body.date || '');
      if (!Number.isInteger(reservationId) || reservationId <= 0
        || !Number.isInteger(resourceId) || resourceId <= 0
        || !isIsoDate(date)) {
        return res.status(400).json({ error: 'INVALID_PAYLOAD' });
      }
      const result = injectedResourceCardsModel.setSessionDone({
        reservationId, resourceId, date, start: String(body.start || ''), done: Boolean(body.done),
        kind: body.kind === 'ignition' ? 'ignition' : 'session',
      });
      if (result && result.error) {
        const status = result.error === 'NOT_FOUND' || result.error === 'SESSION_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({ error: result.error });
      }
      return res.json(result);
    },
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
