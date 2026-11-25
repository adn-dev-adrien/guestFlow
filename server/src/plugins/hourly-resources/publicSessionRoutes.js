/**
 * `/public/v1/sessions/**` (specs/site-outside-resource-booking.md §4.4), behind the public API key and the visitor context; the confirmation has the booking-request limiter's budget
 * and the status read the payment status limiter's. Nothing a visitor reads may be cached by a shared cache. Thin: parse → controller → JSON.
 */

const express = require('express');

function buildPublicSessionRouter({
  guard, sessions, limiters = {},
}) {
  const passThrough = (req, res, next) => next();
  const { confirm: confirmLimit = passThrough, status: statusLimit = passThrough } = limiters;
  const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const router = express.Router();
  router.use(guard);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/resources', sessions.resources);
  router.post('/slots', sessions.slots);
  router.post('/quote', sessions.quote);
  router.post('/confirm', confirmLimit, wrap(sessions.confirm));
  router.get('/status/:ref', statusLimit, wrap(sessions.status));
  return router;
}

module.exports = { buildPublicSessionRouter };
