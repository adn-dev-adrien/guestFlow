/**
 * Planning controller — aggregate endpoints for the Planning page: breakfast, option cards and
 * resource cards. The laundry endpoints belong to the `linen` plugin
 * (specs/plugins-phase-2-hosts.md rule 4).
 */

const breakfastModel = require('../models/breakfastModel');
const planningOptionCardsModel = require('../models/planningOptionCardsModel');
const planningResourceCardsModel = require('../models/planningResourceCardsModel');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function buildController({
  breakfastModel: injectedBreakfastModel = breakfastModel,
  planningOptionCardsModel: injectedOptionCardsModel = planningOptionCardsModel,
  planningResourceCardsModel: injectedResourceCardsModel = planningResourceCardsModel,
} = {}) {
  return {
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
