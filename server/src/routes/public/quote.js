const express = require('express');

const router = express.Router();
const ctrl = require('../../controllers/public/publicQuoteController');

router.post('/', ctrl.quote);

module.exports = router;
