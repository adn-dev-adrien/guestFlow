/**
 * The external bookings router, mounted by the plugin at `/api/resource-bookings`
 * (specs/plugins-phase-3c-hourly-resources.md rule 10).
 */

const { Router } = require('express');

function buildRouter(controller) {
  const router = Router();
  // Specific routes before /:id to avoid conflicts.
  router.get('/planning-events', (req, res) => controller().planningEvents(req, res));
  router.get('/occupied-slots', (req, res) => controller().occupiedSlots(req, res));
  router.get('/', (req, res) => controller().list(req, res));
  router.get('/:id', (req, res) => controller().getOne(req, res));
  router.post('/', (req, res) => controller().create(req, res));
  router.put('/:id', (req, res) => controller().update(req, res));
  router.delete('/:id', (req, res) => controller().remove(req, res));
  return router;
}

module.exports = { buildRouter };
