const router = require('express').Router();
const controller = require('../controllers/clientsController');

router.get('/', controller.list);
router.post('/cleanup-orphans', controller.cleanupOrphans);
router.get('/:id', controller.getOne);
router.get('/:id/delete-impact', controller.getDeleteImpact);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
