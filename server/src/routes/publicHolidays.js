const router = require('express').Router();
const ctrl = require('../controllers/publicHolidaysController');

router.get('/', ctrl.list);

module.exports = router;
