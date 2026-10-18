/**
 * GET /api/reservations/upcoming — every arrival from today on, grouped by day and fully detailed, in
 * ONE response (specs/upcoming-reservations-cards.md rule 6). The page used to fetch the list and
 * then each reservation on its own: one call per stay, enough to hit the API rate limit and lock the
 * whole app out once a season was booked.
 */

const upcomingModel = require('../models/upcomingReservationsModel');
const reservationsModel = require('../models/reservationsModel');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { groupArrivalsByDay } = require('../utils/upcomingArrivals');

function buildController({
  model = upcomingModel,
  detailOf = (id) => reservationsModel.getByIdWithDetails(id),
  today = getTodayIsoDate,
} = {}) {
  return {
    upcoming(req, res) {
      const day = today();
      const detailed = model.arrivalIdsFrom(day).map((id) => detailOf(id)).filter(Boolean);
      res.json(groupArrivalsByDay(detailed, day));
    },
  };
}

module.exports = { ...buildController(), buildController };
