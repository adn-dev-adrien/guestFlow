const router = require('express').Router();
const ctrl = require('../controllers/establishmentClosuresController');

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.delete);

module.exports = router;
