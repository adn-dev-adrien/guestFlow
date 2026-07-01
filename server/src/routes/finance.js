const router = require('express').Router();
const ctrl = require('../controllers/financeController');

router.get('/summary', ctrl.summary);
router.get('/breakdown', ctrl.breakdown);
router.get('/projection', ctrl.projection);
router.get('/operational', ctrl.operational);
router.get('/tourist-tax', ctrl.touristTax);
router.patch('/tourist-tax/:reservationId/declared', ctrl.setTouristTaxDeclared);

module.exports = router;
