const express = require('express');

// Thin: parse, call the controller, answer. The operator is the journal's author.
function consoleRoutes(ctx) {
  const router = express.Router();
  const { customers, catalogue, alerts, billing, templates } = ctx.controllers;
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
  router.post('/customers/:id/payment', async (req, res) => res.json(await billing.recordPayment(req.params.id, body(req), who(req))));
  router.post('/customers/:id/rename/preview', (req, res) => res.json(customers.renamePreview(req.params.id, body(req))));
  router.post('/customers/:id/rename', (req, res) => res.json(customers.rename(req.params.id, body(req), who(req))));
  router.post('/customers/:id/billing', (req, res) => res.json(customers.setBilling(req.params.id, body(req), who(req))));
  router.post('/customers/:id/remind', async (req, res) => res.json(await billing.remind(req.params.id, body(req), who(req))));
  router.post('/customers/:id/invoice/retry', async (req, res) => res.json(await billing.retryInvoice(req.params.id, who(req))));
  router.post('/customers/:id/check-payment', async (req, res) => res.json(await billing.checkCustomer(req.params.id, who(req))));
  router.post('/customers/:id/extend', (req, res) => res.json(customers.extend(req.params.id, body(req), who(req))));
  router.post('/customers/:id/force-active', (req, res) => res.json(customers.forceActive(req.params.id, body(req), who(req))));
  router.post('/customers/:id/plan', (req, res) => res.json(customers.changePlan(req.params.id, body(req), who(req))));
  router.post('/customers/:id/deprovision', async (req, res) => res.json(await billing.deprovision(req.params.id, body(req), who(req))));
  router.post('/customers/:id/reactivate', (req, res) => res.json(customers.reactivate(req.params.id, who(req))));
  router.post('/customers/:id/cancel-erase', (req, res) => res.json(customers.cancelErase(req.params.id, who(req))));
  router.post('/customers/:id/erase', (req, res) => res.json(customers.eraseNow(req.params.id, body(req), who(req))));
  router.get('/customers/:id/licence', (req, res) => {
    const { filename, token } = customers.licenceDownload(req.params.id);
    res.set('Content-Disposition', `attachment; filename="${filename}"`).type('application/jose').send(token);
  });

  router.post('/emails/:id/send', async (req, res) => res.json(await billing.sendQueued(req.params.id, who(req))));
  router.post('/emails/:id/ignore', (req, res) => res.json(billing.ignoreQueued(req.params.id, who(req))));

  router.get('/templates', (req, res) => res.json(templates.list()));
  router.put('/templates/:key', (req, res) => res.json(templates.save(req.params.key, body(req), who(req))));
  router.post('/templates/:key/preview', (req, res) => res.json(templates.preview(req.params.key, body(req))));

  return router;
}

module.exports = { consoleRoutes };
