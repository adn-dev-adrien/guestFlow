/**
 * Public route: WordPress plugin update manifest (specs/wordpress-plugin-self-update.md §4.3).
 *
 * Mounted under `/public/v1`, so it inherits the public API key check and the public rate limiter —
 * the same credential the plugin already uses for availability and quotes. No new anonymous surface.
 */

const router = require('express').Router();
const controller = require('../../controllers/public/pluginUpdateController');

router.get('/plugin-update', controller.getPluginUpdate);

module.exports = router;
