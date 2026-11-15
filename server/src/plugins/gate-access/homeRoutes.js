/**
 * The house's « Domotique » tree, `/public/v1/home` (specs/guest-app-home-automation.md rules 1-2): the gate
 * connector's key, signature and signed answers, on the router so no route can forget them.
 */

const express = require('express');

function buildHomeRouter({ controller, limiter, requireConnector, signResponse }) {
  const router = express.Router();
  router.use(limiter);
  router.use(requireConnector);
  router.use(signResponse);
  router.get('/ping', controller.ping);
  router.put('/catalog', controller.catalog);
  router.post('/readings', controller.readings);
  router.post('/series', controller.series);
  router.get('/commands', controller.commands);
  router.post('/commands/results', controller.results);
  return router;
}

module.exports = { buildHomeRouter };
