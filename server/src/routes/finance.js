const router = require('express').Router();
const ctrl = require('../controllers/financeController');

router.get('/dashboard', ctrl.getDashboard);
router.get('/dashboard/detail/:tile', ctrl.getDashboardDetail);
router.get('/pace', ctrl.getPace);
router.get('/pace/:month', ctrl.getPaceMonth);
router.get('/goal-context', ctrl.goalContext);
router.get('/tourist-tax', ctrl.touristTax);
router.patch('/tourist-tax/:reservationId/declared', ctrl.setTouristTaxDeclared);

module.exports = router;
