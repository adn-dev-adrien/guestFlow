const router = require('express').Router();
const ctrl = require('../controllers/financeController');

router.get('/summary', ctrl.summary);
router.get('/breakdown', ctrl.breakdown);
router.get('/projection', ctrl.projection);
router.get('/operational', ctrl.operational);
router.get('/dashboard', ctrl.getDashboard);
router.get('/dashboard/detail/:tile', ctrl.getDashboardDetail);
router.get('/goal-context', ctrl.goalContext);
router.get('/tourist-tax', ctrl.touristTax);
router.patch('/tourist-tax/:reservationId/declared', ctrl.setTouristTaxDeclared);

module.exports = router;
