/**
 * `/public/v1/guest/**` (specs/guest-app.md §4.3). Thin: parse → controller → JSON. Same-origin with the guest
 * app, cookie-authenticated, never the site's shared key. Nothing a session reads may be cached.
 */

const express = require('express');
const { requireModule } = require('../middleware/guestSession');

const { webManifest } = require('../webManifest');

function buildPublicRouter({
  controller, shop, orders, booklet, guestSession, limiters, appName = () => null,
}) {
  const router = express.Router();
  // Rule 52 — the install manifest: the same for every guest, readable before any session, revalidated on each read.
  router.get('/manifest.webmanifest', limiters.read, (req, res) => {
    res.set({ 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.send(JSON.stringify(webManifest({ appName: appName() })));
  });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/sessions', limiters.session, controller.createSession);
  router.post('/sessions/lookup', limiters.lookup, controller.lookup);
  router.get('/me', limiters.read, guestSession.requireSession, controller.me);
  router.get('/lodging', limiters.read, controller.lodging);
  // Rules 12-14 — the gate tile's door: the stay's key link, for a stay session only.
  router.get('/gate', limiters.read, guestSession.requireSession, controller.gateRead);
  const shopRoute = [limiters.read, guestSession.requireSession, requireModule('shop', controller.shownKeysOf)];
  router.get('/shop', ...shopRoute, shop.read);
  router.get('/shop/resources/:id/slots', ...shopRoute, guestSession.requireStay, shop.slots);
  router.post('/shop/delivery-slots', ...shopRoute, guestSession.requireStay, shop.deliverySlots);
  // Rules 32-38 — a stay's orders: the quote, the order and its page belong to the shop, the list to « Mes commandes ».
  const stayShop = [...shopRoute, guestSession.requireStay];
  router.post('/orders/quote', ...stayShop, orders.quote);
  router.post('/orders', ...stayShop, limiters.order, orders.create);
  router.get('/orders', limiters.read, guestSession.requireSession, requireModule('orders', controller.shownKeysOf), guestSession.requireStay, orders.list);
  router.get('/orders/:id', ...stayShop, orders.read);
  router.post('/orders/:id/abandon', ...stayShop, orders.abandon);
  // Rule 5 — the booklet reads for a session or, in visitor mode, for the printed code.
  const bookletRoute = [limiters.read, booklet.reader, requireModule('booklet', controller.shownKeysOf)];
  router.get('/booklet', ...bookletRoute, booklet.index);
  router.get('/booklet/search', ...bookletRoute, booklet.search);
  router.get('/booklet/pages/:slug', ...bookletRoute, booklet.page);
  return router;
}

module.exports = { buildPublicRouter };
