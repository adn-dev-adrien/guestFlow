/**
 * The external bookings router, mounted by the plugin at `/api/resource-bookings`
 * (specs/plugins-phase-3c-hourly-resources.md rule 10).
 */

const { Router } = require('express');

function buildRouter(controller, visitController = null) {
  const router = Router();
  const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  // Specific routes before /:id to avoid conflicts.
  router.get('/planning-events', (req, res) => controller().planningEvents(req, res));
  router.get('/occupied-slots', (req, res) => controller().occupiedSlots(req, res));
  router.post('/preview', (req, res) => controller().preview(req, res));
  router.get('/', (req, res) => controller().list(req, res));
  router.get('/:id', (req, res) => controller().getOne(req, res));
  router.post('/', (req, res) => controller().create(req, res));
  // specs/resource-booking-pricing-and-invoicing.md §4.3.
  router.post('/:id/payment', (req, res) => controller().recordPayment(req, res));
  router.delete('/:id/payment', (req, res) => controller().clearPayment(req, res));
  router.post('/:id/invoice', (req, res, next) => Promise.resolve(controller().issueInvoice(req, res)).catch(next));
  router.post('/:id/invoice/attach', (req, res, next) => Promise.resolve(controller().attachInvoice(req, res)).catch(next));
  // specs/outside-booking-sas.md §4.3 — the mini SAS of an outside visit.
  if (visitController) {
    router.get('/:id/visit', wrap((req, res) => visitController().getVisit(req, res)));
    router.get('/:id/visit/articles', wrap((req, res) => visitController().articles(req, res)));
    router.post('/:id/visit/quote', wrap((req, res) => visitController().quote(req, res)));
    router.post('/:id/visit', wrap((req, res) => visitController().commit(req, res)));
    router.post('/:id/visit/payment', wrap((req, res) => visitController().pay(req, res)));
    router.patch('/:id/visit/lines/:lineId', wrap((req, res) => visitController().patchLine(req, res)));
    router.post('/:id/visit/payment-link', wrap((req, res) => visitController().mintLink(req, res)));
    router.delete('/:id/visit/payment-link/:linkId', wrap((req, res) => visitController().withdrawLink(req, res)));
    router.post('/:id/visit/payment-link/:linkId/email', wrap((req, res) => visitController().emailLink(req, res)));
    router.post('/:id/no-show', wrap((req, res) => visitController().noShow(req, res)));
  }
  router.put('/:id', (req, res) => controller().update(req, res));
  router.delete('/:id', (req, res) => controller().remove(req, res));
  return router;
}

module.exports = { buildRouter };
