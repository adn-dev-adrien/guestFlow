/**
 * The Sowel connector's public tree, `/public/v1/gate` (specs/gate-access-sowel-connector.md §3.4).
 * Its own key and its own signature — never the WordPress proxy's — and every answer signed: the
 * signing middleware sits on the router, so no route can forget it.
 */

const express = require('express');

function buildPublicRouter({ controller, limiter, requireConnector, signResponse }) {
  const router = express.Router();
  router.use(limiter);
  router.use(requireConnector);
  router.use(signResponse);
  router.get('/ping', controller.ping);
  router.get('/keys', controller.keys);
  router.post('/results', controller.results);
  return router;
}

module.exports = { buildPublicRouter };
