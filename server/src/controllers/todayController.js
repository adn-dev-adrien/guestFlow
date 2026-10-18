/**
 * GET /api/today — the calendar day on the server's clock, which runs in the accommodations' time zone
 * (specs/server-timezone.md). The pages that open « on today » start from this instead of the
 * browser's UTC date, which still read yesterday between midnight and 2 a.m. in Paris
 * (specs/upcoming-reservations-cards.md rule 7).
 */

const { getTodayIsoDate } = require('../utils/reservationHelpers');

function buildController({ today = getTodayIsoDate } = {}) {
  return {
    getToday(req, res) {
      res.json({ today: today() });
    },
  };
}

module.exports = { ...buildController(), buildController };
