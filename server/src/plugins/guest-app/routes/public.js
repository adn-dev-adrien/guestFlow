/**
 * `/public/v1/guest/**` (specs/guest-app.md §4.3). Thin: parse → controller → JSON. Same-origin with the guest
 * app, cookie-authenticated, never the site's shared key. Nothing a session reads may be cached.
 */

const express = require('express');
const { requireModule } = require('../middleware/guestSession');

function buildPublicRouter({
  controller, shop, booklet, guestSession, limiters,
}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/sessions', limiters.session, controller.createSession);
  router.post('/sessions/lookup', limiters.lookup, controller.lookup);
  router.get('/me', limiters.read, guestSession.requireSession, controller.me);
  router.get('/lodging', limiters.read, controller.lodging);
  const shopRoute = [limiters.read, guestSession.requireSession, requireModule('shop', controller.shownKeysOf)];
  router.get('/shop', ...shopRoute, shop.read);
  router.get('/shop/resources/:id/slots', ...shopRoute, guestSession.requireStay, shop.slots);
  router.post('/shop/delivery-slots', ...shopRoute, guestSession.requireStay, shop.deliverySlots);
  // Rule 5 — the booklet reads for a session or, in visitor mode, for the printed code.
  const bookletRoute = [limiters.read, booklet.reader, requireModule('booklet', controller.shownKeysOf)];
  router.get('/booklet', ...bookletRoute, booklet.index);
  router.get('/booklet/search', ...bookletRoute, booklet.search);
  router.get('/booklet/pages/:slug', ...bookletRoute, booklet.page);
  return router;
}

module.exports = { buildPublicRouter };
