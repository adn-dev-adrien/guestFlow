/** `/api/guest-app/**` — the operator's side (specs/guest-app.md §4.3). */

const express = require('express');

function buildAdminRouter({ lodgings }) {
  const router = express.Router();
  router.get('/lodgings/:propertyId', lodgings.read);
  router.put('/lodgings/:propertyId', lodgings.write);
  return router;
}

module.exports = { buildAdminRouter };
