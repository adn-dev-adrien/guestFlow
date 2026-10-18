const router = require('express').Router();
const ctrl = require('../controllers/pluginsController');

router.get('/', ctrl.list);
// specs/plugins-phase-4-registry.md rules 9, 13, 16, 20.
router.get('/status', ctrl.status);
// specs/plugins-phase-p-productisation.md rule 40.
router.get('/page', ctrl.pageOwner);
router.post('/refresh', ctrl.refresh);
router.post('/update-all', ctrl.updateAll);
router.post('/:id/install', ctrl.install);
router.post('/:id/update', ctrl.update);
router.post('/:id/rollback', ctrl.rollback);
router.post('/:id/activate', ctrl.activate);
router.post('/:id/deactivate', ctrl.deactivate);
router.delete('/:id', ctrl.uninstall);
router.get('/:id/settings', ctrl.getSettings);
router.put('/:id/settings', ctrl.saveSettings);

module.exports = router;
