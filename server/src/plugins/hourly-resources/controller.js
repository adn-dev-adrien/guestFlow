/**
 * The `hourly-resources` HTTP handlers (specs/plugins-phase-3c-hourly-resources.md rule 10), at the
 * URLs they always had:
 *   - the external bookings: planning-events / occupied-slots / list / get / create / update / delete.
 *     All booking logic (price, slot-conflict, validation) lives in the bookings model, which returns
 *     `{ ok, id }` or `{ error, status }`; this controller just maps to HTTP;
 *   - the free slots of the arrival SAS picker;
 *   - the planning's ignition and session cards.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (value) => typeof value === 'string' && ISO_DATE_RE.test(value);

function createController({ bookings: model, scheduling, planningCards, reservations }) {
  function planningEvents(req, res) {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    return res.json(model().listPlanningEvents(from, to));
  }

  function occupiedSlots(req, res) {
    const { resourceId, date } = req.query;
    if (!resourceId || !date) return res.status(400).json({ error: 'resourceId and date required' });
    return res.json({ occupiedSlots: model().getOccupiedSlots(resourceId, date) });
  }

  function list(req, res) {
    const { resourceId, date, weekStart } = req.query;
    if (!resourceId) return res.status(400).json({ error: 'resourceId required' });
    if (!date && !weekStart) return res.status(400).json({ error: 'date or weekStart required' });
    return res.json(model().listForResource({ resourceId, date, weekStart }));
  }

  function getOne(req, res) {
    const booking = model().findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Non trouvée' });
    return res.json(booking);
  }

  function create(req, res) {
    const result = model().createBooking(req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ id: result.id });
  }

  function update(req, res) {
    const result = model().update(req.params.id, req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true });
  }

  function remove(req, res) {
    const result = model().remove(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true });
  }

  /**
   * Bookable slots of one resource over a reservation's stay, for the arrival SAS picker
   * (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rules 21, 25). Every slot comes back
   * already classified — the client renders states, it never derives them.
   *
   * `pending` carries the blocks on the picker: not persisted yet, but they occupy their slot and
   * keep the resource warm for the next one.
   */
  function freeSlots(req, res) {
    const reservation = reservations.getByIdWithDetails(req.query.reservationId);
    if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

    let pending = [];
    if (req.query.pending) {
      try {
        const parsed = JSON.parse(req.query.pending);
        pending = Array.isArray(parsed) ? parsed : [];
      } catch { return res.status(400).json({ error: 'pending invalide' }); }
    }

    const payload = scheduling().getFreeSlots({ reservation, resourceId: req.params.id, pending });
    if (!payload) return res.status(404).json({ error: 'RESOURCE_NOT_SOLD_ON_RESERVATION' });
    return res.json(payload);
  }

  /**
   * GET /api/planning/resource-cards?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Resource-driven planning cards (specs/resource-hourly-scheduling.md §3.4): one card per session.
   */
  function resourceCards(req, res) {
    const from = (req.query && req.query.from) || '';
    const to = (req.query && req.query.to) || '';
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      return res.status(400).json({ error: 'INVALID_DATE_RANGE' });
    }
    return res.json({ resourceCardsByDate: planningCards().cardsInRange({ from, to }) });
  }

  /**
   * POST /api/planning/resource-cards/done
   * Body: { reservationId, resourceId, date, start, done, kind? } — toggles one session's « préparé »
   * flag, or its « démarrer » one with `kind: 'ignition'` (specs/resource-ignition-task.md §3 rule 6).
   */
  function setResourceCardDone(req, res) {
    const body = req.body || {};
    const reservationId = Number(body.reservationId);
    const resourceId = Number(body.resourceId);
    const date = String(body.date || '');
    if (!Number.isInteger(reservationId) || reservationId <= 0
      || !Number.isInteger(resourceId) || resourceId <= 0
      || !isIsoDate(date)) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }
    const result = planningCards().setSessionDone({
      reservationId, resourceId, date, start: String(body.start || ''), done: Boolean(body.done),
      kind: body.kind === 'ignition' ? 'ignition' : 'session',
    });
    if (result && result.error) {
      const status = result.error === 'NOT_FOUND' || result.error === 'SESSION_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    return res.json(result);
  }

  return {
    planningEvents, occupiedSlots, list, getOne, create, update, remove,
    freeSlots, resourceCards, setResourceCardDone,
  };
}

module.exports = { createController };
