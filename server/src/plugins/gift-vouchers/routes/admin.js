/** `/api/gift-vouchers/**` — the operator's side (specs/gift-vouchers/gift-vouchers.md §4.3, specs/gift-vouchers/gift-voucher-campaigns.md §4.4). Admin only: no reception entry is declared. */

const express = require('express');

function buildAdminRouter({
  admin, stays, campaigns, visuals, receiveVisual, receiveRecipe,
}) {
  const router = express.Router();
  // A voucher on a fiche (rules 40-41): declared before `/:id`, which would read « stays » as a voucher.
  router.get('/stays/:reservationId', stays.read);
  router.post('/stays/:reservationId/pay', stays.pay);
  router.post('/stays/:reservationId/recredit', stays.recredit);
  router.delete('/stays/:reservationId/payments/:ref', stays.undo);
  // The campaigns and the offer (specs/gift-vouchers/gift-voucher-campaigns.md §4.4): declared before `/:id` too.
  router.get('/catalogue', campaigns.catalogue);
  router.get('/campaigns', campaigns.list);
  router.post('/campaigns', campaigns.create);
  router.post('/campaigns/preview-price', campaigns.previewPrice);
  router.post('/campaigns/import', receiveRecipe, campaigns.importRecipe);
  router.get('/campaigns/:id', campaigns.read);
  router.put('/campaigns/:id', campaigns.update);
  router.post('/campaigns/:id/duplicate', campaigns.duplicate);
  router.get('/campaigns/:id/merchant-card.pdf', campaigns.merchantCard);
  router.get('/campaigns/:id/print-layout', campaigns.printLayout);
  router.get('/campaigns/:id/print.pdf', campaigns.printPdf);
  router.get('/campaigns/:id/recipe.zip', campaigns.exportRecipe);
  // The visual library (rules 47-48).
  router.get('/visuals', visuals.list);
  router.post('/visuals', receiveVisual, visuals.create);
  router.get('/visuals/:id', visuals.read);
  router.get('/visuals/:id/image', visuals.image);
  router.put('/visuals/:id', receiveVisual, visuals.update);
  router.delete('/visuals/:id', visuals.remove);
  router.get('/offer', campaigns.offer);
  router.post('/offer/price', campaigns.offerPrice);
  router.get('/', admin.list);
  router.post('/', admin.create);
  router.get('/:id', admin.read);
  router.get('/:id/pdf', admin.pdf);
  router.get('/:id/print-layout', admin.printLayout);
  router.get('/:id/print.pdf', admin.printPdf);
  router.post('/:id/extend', admin.extend);
  router.post('/:id/cancel', admin.cancel);
  router.post('/:id/refunds/:rid/settle', admin.settleRefund);
  router.post('/:id/adjust', admin.adjust);
  router.post('/:id/resend', admin.resend);
  router.post('/:id/reveal', admin.reveal);
  return router;
}

module.exports = { buildAdminRouter };
