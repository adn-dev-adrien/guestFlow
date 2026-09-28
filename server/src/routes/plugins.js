const router = require('express').Router();
const ctrl = require('../controllers/pluginsController');

router.get('/', ctrl.list);
router.post('/:id/install', ctrl.install);
router.post('/:id/activate', ctrl.activate);
router.post('/:id/deactivate', ctrl.deactivate);
router.delete('/:id', ctrl.uninstall);
router.get('/:id/settings', ctrl.getSettings);
router.put('/:id/settings', ctrl.saveSettings);

module.exports = router;
