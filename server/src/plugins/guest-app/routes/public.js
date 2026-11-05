/**
 * `/public/v1/guest/**` (specs/guest-app.md §4.3). Thin: parse → controller → JSON. Same-origin with the guest
 * app, cookie-authenticated, never the site's shared key. Nothing a session reads may be cached.
 */

const express = require('express');
const { requireModule } = require('../middleware/guestSession');

function buildPublicRouter({ controller, shop, guestSession, limiters }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/sessions', limiters.session, controller.createFromCode);
  router.post('/sessions/lookup', limiters.lookup, controller.lookup);
  router.get('/me', limiters.read, guestSession.requireSession, controller.me);
  router.post('/me/confirm-name', limiters.read, guestSession.requireSession, guestSession.requireStay, controller.confirmName);
  router.get('/lodging', limiters.read, controller.lodging);
  router.get('/shop', limiters.read, guestSession.requireSession, requireModule('shop', controller.shownKeysOf), shop.read);
  return router;
}

module.exports = { buildPublicRouter };
