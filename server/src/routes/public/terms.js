const express = require('express');

const router = express.Router();
const ctrl = require('../../controllers/public/publicTermsController');

router.get('/', ctrl.getCurrent);
router.get('/:version', ctrl.getVersion);

module.exports = router;
