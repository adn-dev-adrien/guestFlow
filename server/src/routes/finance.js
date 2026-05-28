const router = require('express').Router();
const ctrl = require('../controllers/financeController');

router.get('/summary', ctrl.summary);
router.get('/projection', ctrl.projection);
router.get('/operational', ctrl.operational);
router.get('/tourist-tax', ctrl.touristTax);

module.exports = router;
