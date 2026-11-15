/** `/api/gift-vouchers/**` — the operator's side (specs/gift-vouchers.md §4.3). Admin only: no reception entry is declared. */

const express = require('express');

function buildAdminRouter({ admin }) {
  const router = express.Router();
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
