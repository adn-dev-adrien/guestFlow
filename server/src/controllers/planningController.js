/**
 * Planning controller — aggregate endpoints of the home and the Planning page: the day lists, the days
 * of a window, the breakfast list and the option-card ticks. The laundry endpoints belong to the
 * `linen` plugin (specs/plugins-phase-2-hosts.md rule 4), the resource cards to `hourly-resources`
 * (specs/plugins-phase-3c-hourly-resources.md rule 10).
 */

const breakfastModel = require('../models/breakfastModel');
const planningOptionCardsModel = require('../models/planningOptionCardsModel');
const planningAlertsModel = require('../models/planningAlertsModel');
const planningDaysModel = require('../models/planningDaysModel');
const reservationsModel = require('../models/reservationsModel');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { isReceptionOnly } = require('../constants/roles');
const { toReceptionReservationView } = require('../utils/receptionView');
const { frenchDayLabel } = require('../utils/upcomingArrivals');
const { checkWindow, relativeLabel, windowDays, idsByDate } = require('../utils/planningDays');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function buildController({
  breakfastModel: injectedBreakfastModel = breakfastModel,
  planningOptionCardsModel: injectedOptionCardsModel = planningOptionCardsModel,
  planningAlertsModel: injectedAlertsModel = planningAlertsModel,
  planningDaysModel: injectedDaysModel = planningDaysModel,
  detailOf = (id) => reservationsModel.getByIdWithDetails(id),
  today = getTodayIsoDate,
} = {}) {
  // The stay as the requester may read it: the detailed model shape, finance-free for reception.
  const stayReader = (req) => {
    const cache = new Map();
    return (id) => {
      if (!cache.has(id)) {
        const detail = detailOf(id);
        cache.set(id, detail && isReceptionOnly(req.user) ? toReceptionReservationView(detail) : detail);
      }
      return cache.get(id);
    };
  };
  const stays = (ids, read) => (ids || []).map(read).filter(Boolean);

  return {
    /**
     * GET /api/planning/today (specs/dashboard-planning-scroll.md rules 1–3): the home's day lists in
     * one call — today's departures and arrivals and, when nobody arrives, the next arrival day.
     */
    today(req, res) {
      const current = today();
      const read = stayReader(req);
      const arrivals = idsByDate(injectedDaysModel.arrivalsInRange(current, current))[current];
      const departures = idsByDate(injectedDaysModel.departuresInRange(current, current))[current];
      let nextArrival = null;
      if (!arrivals) {
        const date = injectedDaysModel.nextArrivalDayAfter(current);
        if (date) {
          nextArrival = {
            date,
            label: frenchDayLabel(date, current),
            relativeLabel: relativeLabel(current, date),
            reservations: stays(idsByDate(injectedDaysModel.arrivalsInRange(date, date))[date], read),
          };
        }
      }
      return res.json({
        today: current,
        departures: stays(departures, read),
        arrivals: stays(arrivals, read),
        nextArrival,
      });
    },

    /**
     * GET /api/planning/days?from&to (rules 8–9): every calendar day of a window, at most 31 days,
     * with its arrivals, departures, breakfast and option cards, plus the window's cleaning alerts.
     */
    days(req, res) {
      const from = (req.query && req.query.from) || '';
      const to = (req.query && req.query.to) || '';
      const invalid = checkWindow(from, to);
      if (invalid) return res.status(400).json({ error: invalid });
      const current = today();
      const read = stayReader(req);
      const arrivals = idsByDate(injectedDaysModel.arrivalsInRange(from, to));
      const departures = idsByDate(injectedDaysModel.departuresInRange(from, to));
      const breakfast = injectedBreakfastModel.breakfastByDate({ from, to }) || {};
      const optionCards = injectedOptionCardsModel.cardsInRange({ from, to }) || {};
      return res.json({
        from,
        to,
        today: current,
        days: windowDays(from, to, current).map((day) => ({
          ...day,
          arrivals: stays(arrivals[day.date], read),
          departures: stays(departures[day.date], read),
          breakfast: breakfast[day.date] || null,
          optionCards: optionCards[day.date] || null,
        })),
        alerts: injectedAlertsModel.alertsInRange({ from, to }),
      });
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
