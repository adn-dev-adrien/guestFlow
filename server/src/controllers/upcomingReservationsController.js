/**
 * GET /api/reservations/upcoming — every arrival from today on, grouped by day and fully detailed, in
 * ONE response (specs/upcoming-reservations-cards.md rule 6). The page used to fetch the list and
 * then each reservation on its own: one call per stay, enough to hit the API rate limit and lock the
 * whole app out once a season was booked.
 *
 * `?day=YYYY-MM-DD` answers that one day only (rule 8): the page refreshes the day of a « prêt »
 * toggle without re-reading every stay of the season.
 */

const upcomingModel = require('../models/upcomingReservationsModel');
const reservationsModel = require('../models/reservationsModel');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { groupArrivalsByDay } = require('../utils/upcomingArrivals');

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function buildController({
  model = upcomingModel,
  detailOf = (id) => reservationsModel.getByIdWithDetails(id),
  today = getTodayIsoDate,
} = {}) {
  return {
    upcoming(req, res) {
      const current = today();
      const only = req.query && req.query.day;
      if (only !== undefined && !ISO_DAY.test(String(only))) {
        return res.status(400).json({ error: 'Date invalide.' });
      }
      let ids;
      if (only === undefined) ids = model.arrivalIdsFrom(current);
      else ids = only >= current ? model.arrivalIdsOn(only) : [];
      const detailed = ids.map((id) => detailOf(id)).filter(Boolean);
      return res.json(groupArrivalsByDay(detailed, current));
    },
  };
}

module.exports = { ...buildController(), buildController };
