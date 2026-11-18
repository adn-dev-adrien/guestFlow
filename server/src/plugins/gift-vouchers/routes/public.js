/**
 * `/public/v1/gift-vouchers/**` (specs/gift-vouchers.md §4.3), behind the public API key, the visitor context and the
 * public limiter; the payment start and the status read have the core's own budgets. Thin: parse → controller → JSON.
 * Nothing a visitor reads may be cached by a shared cache.
 */

const express = require('express');

function buildPublicRouter({
  guard, offer, check, limiters = {},
}) {
  const passThrough = (req, res, next) => next();
  const { payStart = passThrough, status = passThrough } = limiters;
  const router = express.Router();
  router.use(guard);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/offer', offer.read);
  router.post('/offer/price', offer.price);
  router.post('/check', check.check);
  router.post('/orders', offer.create);
  router.post('/orders/:id/pay', payStart, offer.pay);
  router.get('/orders/:id/pdf', status, offer.pdf);
  router.get('/orders/:id', status, offer.status);
  return router;
}

module.exports = { buildPublicRouter };
