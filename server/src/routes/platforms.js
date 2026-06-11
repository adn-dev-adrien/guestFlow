/**
 * Platforms routes — read-only list of platform names for the UI dropdowns.
 * specs/ical-platforms-in-dropdowns.md.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/platformsController');

router.get('/', controller.listNames);

module.exports = router;
