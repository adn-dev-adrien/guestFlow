/**
 * `/public/v1/gift-vouchers/**` (specs/gift-vouchers.md §4.3), behind the public API key, the visitor context and the
 * public limiter. Thin: parse → controller → JSON. Nothing a visitor reads may be cached by a shared cache.
 */

const express = require('express');

function buildPublicRouter({ guard, offer, check }) {
  const router = express.Router();
  router.use(guard);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/offer', offer.read);
  router.post('/check', check.check);
  return router;
}

module.exports = { buildPublicRouter };
