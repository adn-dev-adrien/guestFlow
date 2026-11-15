/** `/api/gift-vouchers/**` — the operator's side (specs/gift-vouchers.md §4.3). Admin only: no reception entry is declared. */

const express = require('express');

function buildAdminRouter({ admin, stays }) {
  const router = express.Router();
  // A voucher on a fiche (rules 40-41): declared before `/:id`, which would read « stays » as a voucher.
  router.get('/stays/:reservationId', stays.read);
  router.post('/stays/:reservationId/pay', stays.pay);
  router.post('/stays/:reservationId/recredit', stays.recredit);
  router.delete('/stays/:reservationId/payments/:ref', stays.undo);
  router.get('/', admin.list);
  router.post('/', admin.create);
  router.get('/:id', admin.read);
  router.get('/:id/pdf', admin.pdf);
  router.post('/:id/extend', admin.extend);
  router.post('/:id/cancel', admin.cancel);
  router.post('/:id/adjust', admin.adjust);
  router.post('/:id/resend', admin.resend);
  router.post('/:id/reveal', admin.reveal);
  return router;
}

module.exports = { buildAdminRouter };
