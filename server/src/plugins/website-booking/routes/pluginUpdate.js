/**
 * Public route: WordPress plugin update manifest (specs/wordpress-plugin-self-update.md §4.3).
 *
 * Mounted at `/public/v1/plugin-update`, behind the public API key check and the public rate limiter
 * — the same credential the plugin already uses for availability and quotes. No new anonymous surface.
 */

const router = require('express').Router();
const controller = require('../controllers/pluginUpdateController');

router.get('/', controller.getPluginUpdate);

module.exports = router;
