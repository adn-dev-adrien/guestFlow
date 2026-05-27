const router = require('express').Router();
const ctrl = require('../controllers/schoolHolidaysController');

// Static sub-paths must come BEFORE the /:id catchalls.
router.get('/', ctrl.list);
router.post('/sync', ctrl.sync);
router.get('/sync-settings', ctrl.getSyncSettings);
router.put('/sync-settings', ctrl.updateSyncSettings);

router.post('/', ctrl.create);
router.put('/:id/unlock', ctrl.unlock);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
