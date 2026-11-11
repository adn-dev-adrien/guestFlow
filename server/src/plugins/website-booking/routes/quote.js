const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/publicQuoteController');

router.post('/', ctrl.quote);

module.exports = router;
