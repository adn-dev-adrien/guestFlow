const router = require('express').Router();
const ctrl = require('../controllers/calendarController');

router.get('/', ctrl.range);

module.exports = router;
