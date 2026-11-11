const express = require('express');

// Thin: parse, call the controller, answer (specs/hosting-h1-fleet-runtime.md §4.1).
function fleetRoutes(ctx) {
  const router = express.Router();
  const { fleet } = ctx.controllers;
  const who = (req) => req.session.operatorEmail;
  const body = (req) => req.body || {};

  router.get('/fleet/versions', (req, res) => res.json(fleet.view()));
  router.post('/fleet/versions/check', async (req, res) => res.json(await fleet.check()));
  router.post('/fleet/releases/install', (req, res) => res.json(fleet.installRelease(body(req), who(req))));
  router.post('/fleet/updates', (req, res) => res.json(fleet.startUpdate(body(req), who(req))));
  router.post('/fleet/plugins/push', (req, res) => res.json(fleet.pushPlugin(body(req), who(req))));
  router.get('/customers/:id/restore-window', async (req, res) => res.json(await fleet.restoreWindow(req.params.id)));
  router.post('/customers/:id/restore', async (req, res) => res.json(await fleet.restore(req.params.id, body(req), who(req))));

  return router;
}

module.exports = { fleetRoutes };
