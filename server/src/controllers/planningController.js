/**
 * Planning controller — aggregate endpoints for the Planning page: breakfast and option cards. The
 * laundry endpoints belong to the `linen` plugin (specs/plugins-phase-2-hosts.md rule 4), the resource
 * cards to `hourly-resources` (specs/plugins-phase-3c-hourly-resources.md rule 10).
 */

const breakfastModel = require('../models/breakfastModel');
const planningOptionCardsModel = require('../models/planningOptionCardsModel');
const planningAlertsModel = require('../models/planningAlertsModel');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function buildController({
  breakfastModel: injectedBreakfastModel = breakfastModel,
  planningOptionCardsModel: injectedOptionCardsModel = planningOptionCardsModel,
  planningAlertsModel: injectedAlertsModel = planningAlertsModel,
} = {}) {
  return {
    /**
     * GET /api/planning/alerts?from=YYYY-MM-DD&to=YYYY-MM-DD
     *
     * The cleaning alerts of the planning cards (specs/planning-arrival-alerts.md rules 7–10), keyed
     * by card kind: `{ arrivals: { [reservationId]: alert }, departures: { [reservationId]: alert } }`.
     */
    alerts(req, res) {
      const from = (req.query && req.query.from) || '';
      const to = (req.query && req.query.to) || '';
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
        return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
      }
      return res.json(injectedAlertsModel.alertsInRange({ from, to }));
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
      let result = injectedOptionCardsModel.setOccurrenceDone({
        reservationId, optionId, date, time: String(body.time || ''), done: Boolean(body.done),
      });
      // A breakfast served without chosen mornings has a card every morning but no stored occurrence:
      // its flag is kept apart (specs/breakfast-option-planning-card.md, 2026-10-27 spec review).
      if (result && (result.error === 'NOT_FOUND' || result.error === 'OCCURRENCE_NOT_FOUND')) {
        const fallback = injectedBreakfastModel.setFallbackDone({ reservationId, optionId, date, done: Boolean(body.done) });
        if (fallback && !fallback.error) result = fallback;
      }
      if (result && result.error) {
        const status = result.error === 'NOT_FOUND' || result.error === 'OCCURRENCE_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({ error: result.error });
      }
      return res.json(result);
    },
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
