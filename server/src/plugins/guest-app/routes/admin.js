/** `/api/guest-app/**` — the operator's side (specs/guest-app.md §4.3). */

const express = require('express');

function buildAdminRouter({ lodgings, items }) {
  const router = express.Router();
  router.get('/lodgings/:propertyId', lodgings.read);
  router.put('/lodgings/:propertyId', lodgings.write);
  router.get('/items', items.list);
  router.get('/items/:kind/:id', items.read);
  router.put('/items/:kind/:id', items.write);
  return router;
}

module.exports = { buildAdminRouter };
