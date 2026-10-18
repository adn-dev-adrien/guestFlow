/**
 * GET /api/today → { today: 'YYYY-MM-DD' } — the date the server runs on (Europe/Paris), the one every
 * engine reads (specs/ds-sweep-planning.md rule 28). The Dashboard and the Planning start from it
 * rather than from the browser's clock, whose UTC day is yesterday between midnight and 2 a.m. in Paris.
 * Any signed-in role may read it.
 */

const router = require('express').Router();
const { getTodayIsoDate } = require('../utils/reservationHelpers');

router.get('/', (req, res) => res.json({ today: getTodayIsoDate() }));

module.exports = router;
