const router = require('express').Router();
const ctrl = require('../controllers/pluginsController');

router.get('/', ctrl.list);
router.post('/:id/activate', ctrl.activate);
router.post('/:id/deactivate', ctrl.deactivate);
router.get('/:id/settings', ctrl.getSettings);
router.put('/:id/settings', ctrl.saveSettings);

module.exports = router;
