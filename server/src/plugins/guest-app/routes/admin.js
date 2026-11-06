/** `/api/guest-app/**` — the operator's side (specs/guest-app.md §4.3). */

const express = require('express');

function buildAdminRouter({
  lodgings, items, serviceHours, studio, stayLinks,
}) {
  const router = express.Router();
  router.get('/lodgings/:propertyId', lodgings.read);
  router.put('/lodgings/:propertyId', lodgings.write);
  router.post('/lodgings/:propertyId/regenerate-qr', lodgings.regenerateQr);
  router.get('/lodgings/:propertyId/qr-poster.pdf', lodgings.qrPoster);
  router.get('/reservations/:id/stay-link', stayLinks.read);
  router.post('/reservations/:id/stay-link/regenerate', stayLinks.regenerate);
  router.get('/items', items.list);
  router.get('/items/:kind/:id', items.read);
  router.put('/items/:kind/:id', items.write);
  router.get('/service-hours', serviceHours.read);
  router.put('/service-hours', serviceHours.write);

  router.get('/studio/lodgings/:propertyId/booklet', studio.readBooklet);
  router.put('/studio/lodgings/:propertyId/booklet', studio.writeBooklet);
  router.get('/studio/lodgings/:propertyId/preview', studio.preview);
  router.get('/studio/lodgings/:propertyId/search', studio.search);
  router.post('/studio/lodgings/:propertyId/publish', studio.publish);
  router.post('/studio/lodgings/:propertyId/pages', studio.createPage);
  router.get('/studio/pages/:id', studio.readPage);
  router.put('/studio/pages/:id', studio.updatePage);
  router.delete('/studio/pages/:id', studio.deletePage);
  router.post('/studio/pages/:id/placements', studio.share);
  router.delete('/studio/pages/:id/placements/:propertyId', studio.unshare);
  router.post('/studio/pages/:id/duplicate', studio.duplicate);
  router.post('/studio/pages/:id/blocks', studio.createBlock);
  router.put('/studio/pages/:id/blocks/order', studio.reorderBlocks);
  router.put('/studio/blocks/:id', studio.updateBlock);
  router.delete('/studio/blocks/:id', studio.deleteBlock);
  router.get('/studio/media', studio.listMedia);
  router.post('/studio/media', studio.receiveFile, studio.uploadMedia);
  router.put('/studio/media/:id', studio.updateMedia);
  return router;
}

module.exports = { buildAdminRouter };
