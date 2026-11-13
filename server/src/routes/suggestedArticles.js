/**
 * Suggested articles (the outside-visit spec rules 36-37): the resolved read, and the settings page's read and write. Core. Admin-only by the role guard.
 */
const express = require('express');
const controller = require('../controllers/suggestedArticlesController');

const resolved = express.Router();
resolved.get('/', controller.resolved);

const settings = express.Router();
settings.get('/', controller.settings);
settings.put('/:kind/:id', controller.save);

module.exports = { resolved, settings };
