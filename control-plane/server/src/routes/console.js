const express = require('express');

// Thin: parse, call the controller, answer. The operator is the journal's author.
function consoleRoutes(ctx) {
  const router = express.Router();
  const { customers, catalogue, alerts } = ctx.controllers;
  const who = (req) => req.session.operatorEmail;
  const body = (req) => req.body || {};

  router.get('/alerts', (req, res) => res.json(alerts.list()));

  router.get('/catalogue', (req, res) => res.json(catalogue.view()));
  router.post('/catalogue/toggle', (req, res) => res.json(catalogue.toggle(body(req))));
  router.post('/catalogue/impact', (req, res) => res.json(catalogue.impact(body(req))));
  router.put('/catalogue', (req, res) => res.json(catalogue.save(body(req), who(req))));

  router.get('/customers', (req, res) => res.json(customers.fleet()));
  router.post('/customers/preview', (req, res) => res.json(customers.preview(body(req))));
  router.post('/customers', async (req, res) => res.status(201).json(await customers.create(body(req), who(req))));
  router.get('/customers/:id', (req, res) => res.json(customers.view(req.params.id)));
  router.post('/customers/:id/steps/:step', async (req, res) => res.json(await customers.stepAction(req.params.id, req.params.step, body(req).action, who(req))));
  router.post('/customers/:id/payment', (req, res) => res.json(customers.recordPayment(req.params.id, body(req), who(req))));
  router.post('/customers/:id/extend', (req, res) => res.json(customers.extend(req.params.id, body(req), who(req))));
  router.post('/customers/:id/force-active', (req, res) => res.json(customers.forceActive(req.params.id, body(req), who(req))));
  router.post('/customers/:id/plan', (req, res) => res.json(customers.changePlan(req.params.id, body(req), who(req))));
  router.post('/customers/:id/deprovision', async (req, res) => res.json(await customers.deprovision(req.params.id, body(req), who(req))));
  router.post('/customers/:id/reactivate', (req, res) => res.json(customers.reactivate(req.params.id, who(req))));
  router.post('/customers/:id/cancel-erase', (req, res) => res.json(customers.cancelErase(req.params.id, who(req))));
  router.post('/customers/:id/erase', (req, res) => res.json(customers.eraseNow(req.params.id, body(req), who(req))));
  router.get('/customers/:id/licence', (req, res) => {
    const { filename, token } = customers.licenceDownload(req.params.id);
    res.set('Content-Disposition', `attachment; filename="${filename}"`).type('application/jose').send(token);
  });

  return router;
}

module.exports = { consoleRoutes };
