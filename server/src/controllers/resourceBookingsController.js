/**
 * Resource bookings controller — planning-events / occupied-slots / list / get / create / update /
 * delete. All booking logic (price, slot-conflict, validation) lives in `resourceBookingsModel`, which
 * returns `{ ok, id }` or `{ error, status }`; this controller just maps to HTTP.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory for
 * tests. (The factory is NOT named `create` — that's a request handler here.)
 */

function createController(model) {
  function planningEvents(req, res) {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    return res.json(model.listPlanningEvents(from, to));
  }

  function occupiedSlots(req, res) {
    const { resourceId, date } = req.query;
    if (!resourceId || !date) return res.status(400).json({ error: 'resourceId and date required' });
    return res.json({ occupiedSlots: model.getOccupiedSlots(resourceId, date) });
  }

  function list(req, res) {
    const { resourceId, date, weekStart } = req.query;
    if (!resourceId) return res.status(400).json({ error: 'resourceId required' });
    if (!date && !weekStart) return res.status(400).json({ error: 'date or weekStart required' });
    return res.json(model.listForResource({ resourceId, date, weekStart }));
  }

  function getOne(req, res) {
    const booking = model.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Non trouvée' });
    return res.json(booking);
  }

  function create(req, res) {
    const result = model.createBooking(req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ id: result.id });
  }

  function update(req, res) {
    const result = model.update(req.params.id, req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true });
  }

  function remove(req, res) {
    const result = model.remove(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true });
  }

  return { planningEvents, occupiedSlots, list, getOne, create, update, remove };
}

const defaultController = createController(require('../models/resourceBookingsModel'));
defaultController.buildController = createController;

module.exports = defaultController;
