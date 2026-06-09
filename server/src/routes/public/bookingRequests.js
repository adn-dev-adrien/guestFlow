const express = require('express');

const router = express.Router();
const { bookingRequestLimiter } = require('../../middleware/rateLimiters');
const ctrl = require('../../controllers/public/publicBookingRequestController');

router.post('/', bookingRequestLimiter, ctrl.create);

module.exports = router;
