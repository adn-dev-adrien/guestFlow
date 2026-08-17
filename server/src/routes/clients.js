const router = require('express').Router();
const controller = require('../controllers/clientsController');

router.get('/', controller.list);
// Declared before `/:id` so the literal path wins (specs/clients-upcoming-past-directory.md §4.1).
router.get('/directory', controller.directory);
router.post('/parse-contact', controller.parseContact);
router.post('/cleanup-orphans', controller.cleanupOrphans);
router.get('/cleanup-orphans/preview', controller.cleanupOrphansPreview);
router.post('/cleanup-orphans/delete', controller.cleanupOrphansDelete);
router.get('/:id', controller.getOne);
router.get('/:id/delete-impact', controller.getDeleteImpact);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
