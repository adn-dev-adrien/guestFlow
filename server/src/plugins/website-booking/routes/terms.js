const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/publicTermsController');

router.get('/', ctrl.getCurrent);
router.get('/:version', ctrl.getVersion);

module.exports = router;
