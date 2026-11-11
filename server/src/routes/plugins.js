const router = require('express').Router();
const ctrl = require('../controllers/pluginsController');
// specs/plugin-operator-provisioning.md rule 4 — the lifecycle does not exist on an operator-managed space.
const selfManaged = require('../middleware/requireSelfManagedPlugins');

router.get('/', ctrl.list);
// specs/plugins-phase-4-registry.md rules 9, 13, 16, 20.
router.get('/status', selfManaged, ctrl.status);
// specs/plugins-phase-p-productisation.md rule 40.
router.get('/page', selfManaged, ctrl.pageOwner);
router.post('/refresh', selfManaged, ctrl.refresh);
router.post('/update-all', selfManaged, ctrl.updateAll);
router.post('/:id/install', selfManaged, ctrl.install);
router.post('/:id/update', selfManaged, ctrl.update);
router.post('/:id/rollback', selfManaged, ctrl.rollback);
router.post('/:id/activate', selfManaged, ctrl.activate);
router.post('/:id/deactivate', selfManaged, ctrl.deactivate);
router.delete('/:id', selfManaged, ctrl.uninstall);
router.get('/:id/settings', ctrl.getSettings);
router.put('/:id/settings', ctrl.saveSettings);

module.exports = router;
