/**
 * GET /api/reservations/upcoming — every arrival from today on, grouped by day and shaped for its cards
 * (specs/inte-performance.md rule 12), in ONE response (specs/upcoming-reservations-cards.md rule 6). The page used to fetch the list and
 * then each reservation on its own: one call per stay, enough to hit the API rate limit and lock the
 * whole app out once a season was booked.
 *
 * `?day=YYYY-MM-DD` answers that one day only (rule 8): the page refreshes the day of a « prêt »
 * toggle without re-reading every stay of the season.
 */

const upcomingModel = require('../models/upcomingReservationsModel');
const reservationsModel = require('../models/reservationsModel');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { groupArrivalsByDay, toArrivalCard } = require('../utils/upcomingArrivals');

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day: `2026-13-01` and `2026-02-30` have the shape but no day behind them.
function isCalendarDay(value) {
  if (!ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function buildController({
  model = upcomingModel,
  detailOf = (id) => reservationsModel.getByIdWithDetails(id),
  today = getTodayIsoDate,
} = {}) {
  return {
    upcoming(req, res) {
      const current = today();
      const only = req.query && req.query.day;
      if (only !== undefined && !isCalendarDay(String(only))) {
        return res.status(400).json({ error: 'Date invalide.' });
      }
      let ids;
      if (only === undefined) ids = model.arrivalIdsFrom(current);
      else ids = only >= current ? model.arrivalIdsOn(only) : [];
      const detailed = ids.map((id) => detailOf(id)).filter(Boolean);
      return res.json(groupArrivalsByDay(detailed.map(toArrivalCard), current));
    },
  };
}

module.exports = { ...buildController(), buildController };
