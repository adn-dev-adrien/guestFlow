/**
 * The reconciliation routes (specs/qonto-bank-reconciliation.md §4.3), under `/api/payments/reconciliation`.
 * Thin: parse, call the controller, send its `{ status, body }`. Auth is the global `/api` guard and the
 * deny-by-default role guard — admin only, no allowlist entry.
 */

const express = require('express');

function buildRouter(controller, statements) {
  const router = express.Router();
  const send = (res, answer) => res.status(answer.status).json(answer.body);
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((answer) => send(res, answer)).catch((err) => {
    console.error('[online-payment] reconciliation route error:', err); // eslint-disable-line no-console
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du rapprochement bancaire.' });
  });

  router.get('/', wrap((req) => controller.list({ view: req.query.view, filter: req.query.filter })));
  router.post('/read', wrap((req) => controller.readNow({ view: req.query.view, filter: req.query.filter })));
  router.post('/links', wrap((req) => controller.confirm({
    transactionId: req.body && req.body.transactionId, allocations: req.body && req.body.allocations, user: req.user,
  })));
  router.delete('/links/:transactionId', wrap((req) => controller.undo({ transactionId: req.params.transactionId, user: req.user })));
  router.post('/discards', wrap((req) => controller.discard({
    transactionId: req.body && req.body.transactionId, reservationId: req.body && req.body.reservationId, ledgerKey: req.body && req.body.ledgerKey,
  })));
  router.post('/transactions/:id/outside', wrap((req) => controller.setOutside({ transactionId: req.params.id, outside: true, user: req.user })));
  router.delete('/transactions/:id/outside', wrap((req) => controller.setOutside({ transactionId: req.params.id, outside: false, user: req.user })));
  router.post('/links/batch', wrap((req) => controller.linkBatch({ pairs: req.body && req.body.pairs, proposalId: req.body && req.body.proposalId, user: req.user })));
  router.post('/allocation-preview', wrap((req) => controller.previewAllocation({
    reservationId: req.body && req.body.reservationId, transactionIds: req.body && req.body.transactionIds,
    receiptKeys: req.body && req.body.receiptKeys, pairs: req.body && req.body.pairs, proposalId: req.body && req.body.proposalId,
  })));
  router.post('/confirm-all', wrap((req) => controller.confirmAll({
    proposalIds: req.body && req.body.proposalIds, amounts: req.body && req.body.amounts, user: req.user,
  })));
  router.get('/reservations/:id/credits', wrap((req) => controller.ficheCredits({ reservationId: req.params.id, q: req.query.q, offset: req.query.offset })));
  router.get('/candidates', wrap((req) => controller.candidates({ transactionId: req.query.transactionId, q: req.query.q, offset: req.query.offset })));
  router.get('/reserve-attention', wrap(() => ({ status: 200, body: controller.reserveAttention() })));
  router.get('/bank-accounts', wrap(() => controller.bankAccounts()));

  // specs/mollie-settlement-receipts.md §4.3 — the statement of a Mollie credit.
  router.get('/mollie-statements/status', wrap(() => ({ status: 200, body: statements.status() })));
  router.get(/^\/mollie-statements\/([^/]+)\.pdf$/, (req, res) => {
    Promise.resolve(statements.pdf(req.params[0])).then((answer) => {
      if (answer.status !== 200) return res.status(answer.status).json(answer.body);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${answer.fileName}"`);
      return res.send(answer.bytes);
    }).catch((err) => {
      console.error('[online-payment] statement pdf error:', err); // eslint-disable-line no-console
      if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du relevé.' });
    });
  });
  router.post('/mollie-statements/:transactionId/retry', wrap((req) => statements.retry(req.params.transactionId)));
  return router;
}

module.exports = { buildRouter };
