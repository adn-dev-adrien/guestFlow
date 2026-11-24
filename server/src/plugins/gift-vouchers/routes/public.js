/**
 * `/public/v1/gift-vouchers/**` (specs/gift-vouchers.md §4.3), behind the public API key, the visitor context and the
 * public limiter; the payment start and the status read have the core's own budgets. Thin: parse → controller → JSON.
 * Nothing a visitor reads may be cached by a shared cache — except a campaign's front at its versioned address (specs/gift-voucher-campaigns.md rule 62).
 */

const express = require('express');

function buildPublicRouter({
  guard, offer, check, use, limiters = {},
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
  router.get('/links/:slug', offer.link);
  router.get('/campaigns/:slug/visual', (req, res, next) => Promise.resolve(offer.visual(req, res)).catch(next));
  router.post('/check', check.check);
  // « Mon bain » — the code always travels in the body (rules 23-25).
  router.post('/use', use.open);
  router.post('/use/slots', use.slots);
  router.post('/use/quote', use.quote);
  router.post('/use/confirm', (req, res, next) => Promise.resolve(use.confirm(req, res)).catch(next));
  router.post('/orders', offer.create);
  router.post('/orders/:id/pay', payStart, offer.pay);
  router.get('/orders/:id/pdf', status, offer.pdf);
  router.get('/orders/:id', status, offer.status);
  return router;
}

module.exports = { buildPublicRouter };
