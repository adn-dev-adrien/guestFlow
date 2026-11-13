/**
 * The `hourly-resources` HTTP handlers (specs/plugins-phase-3c-hourly-resources.md rule 10), at the
 * URLs they always had:
 *   - the external bookings: planning-events / occupied-slots / list / get / create / update / delete.
 *     All booking logic (price, slot-conflict, validation) lives in the bookings model, which returns
 *     `{ ok, id }` or `{ error, status }`; this controller just maps to HTTP;
 *   - the free slots of the arrival SAS picker;
 *   - the planning's ignition and session cards.
 */

const sdk = require('../sdk');

const { isReceptionOnly } = sdk.coreModule('roles');
const { toReceptionPlanningEventList } = sdk.coreModule('receptionView');
const { checkPlanningRange } = sdk.coreModule('planningDateRange');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (value) => typeof value === 'string' && ISO_DATE_RE.test(value);
// Only a number or its digits: Number([1]) is 1, Number({toString:1}) throws.
const wholeNumber = (value) => (typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN);

function createController({ bookings: model, scheduling, planningCards, reservations, invoicing }) {
  // Rule 2 — whether an invoice can be made now: the server's answer, never guessed by the screen.
  const invoiceReady = () => sdk.coreModule('invoiceIssuers').ready();
  const withReady = (booking) => (booking ? { ...booking, invoiceReady: invoiceReady() } : booking);
  const fail = (res, result) => res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });

  function planningEvents(req, res) {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    // Bound the span before touching the DB (DATA-1): reception can reach this endpoint, and an
    // unbounded range is a query-amplification DoS.
    const rangeError = checkPlanningRange(from, to);
    if (rangeError) return res.status(rangeError.status).json({ error: rangeError.error, message: rangeError.message });

    const events = model().listPlanningEvents(from, to);
    // Reception must never receive the finance (price/paid) or PII (phone/notes/raw names) that the
    // full planning payload carries — project through the whitelist (AUTH-4). Admin keeps everything.
    if (isReceptionOnly(req.user)) return res.json(toReceptionPlanningEventList(events));
    return res.json(events);
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
    return res.json(withReady(booking));
  }

  function create(req, res) {
    const result = model().createBooking(req.body);
    if (result.error) return fail(res, result);
    return res.json({ id: result.id, totalPrice: result.totalPrice, warning: result.warning });
  }

  /**
   * POST /api/resource-bookings/preview — the price of a booking draft, written nowhere
   * (specs/resource-supplements-total-server-side.md rules 4-7). Admin only: it carries money.
   */
  function preview(req, res) {
    const result = model().priceBooking(req.body || {});
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ ...result, invoiceReady: invoiceReady() });
  }

  function update(req, res) {
    const result = model().update(req.params.id, req.body);
    if (result.error) return fail(res, result);
    return res.json({ ok: true, totalPrice: result.totalPrice, warning: result.warning });
  }

  function remove(req, res) {
    const result = model().remove(req.params.id);
    if (result.error) return fail(res, result);
    return res.json({ ok: true });
  }

  // specs/resource-booking-pricing-and-invoicing.md rules 11-12 — POST/DELETE /:id/payment.
  function recordPayment(req, res) {
    const body = req.body || {};
    const result = model().recordPayment(req.params.id, { tenders: body.tenders, paidAt: body.paidAt });
    if (result.error) return fail(res, result);
    return res.json(withReady(model().findById(req.params.id)));
  }

  function clearPayment(req, res) {
    const result = model().clearPayment(req.params.id);
    if (result.error) return fail(res, result);
    return res.json(withReady(model().findById(req.params.id)));
  }

  // Rules 13-16 — POST /:id/invoice `{ billing? }`: the address typed after a refusal goes with the retry.
  async function issueInvoice(req, res) {
    const body = req.body || {};
    if (body.billing !== undefined) {
      const stored = model().recordArrivalBilling(req.params.id, body.billing);
      if (stored && stored.error) return fail(res, stored);
    }
    const result = await invoicing().issue(req.params.id);
    if (result.error) return fail(res, result);
    return res.json(withReady(model().findById(req.params.id)));
  }

  // Rules 18-19 — POST /:id/invoice/attach `{ transactionId? }`.
  async function attachInvoice(req, res) {
    const body = req.body || {};
    const transactionId = typeof body.transactionId === 'string' && body.transactionId.trim() ? body.transactionId.trim() : null;
    const result = await invoicing().attach(req.params.id, { transactionId });
    if (result.error) return fail(res, result);
    return res.json(withReady(model().findById(req.params.id)));
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
    // A repeated key arrives as a list: only one id is an id.
    const reservationId = typeof req.query.reservationId === 'string' ? req.query.reservationId : null;
    const reservation = reservationId && reservations.getByIdWithDetails(reservationId);
    if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' });

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
      return res.status(400).json({ error: 'INVALID_DATE_RANGE', message: 'Période invalide.' });
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
    const reservationId = wholeNumber(body.reservationId);
    const resourceId = wholeNumber(body.resourceId);
    const date = typeof body.date === 'string' ? body.date : '';
    const { start = '' } = body;
    // A tick reads as INVALID_PAYMENT_FLAG does: `Boolean("false")` ticked the card.
    if (!Number.isInteger(reservationId) || reservationId <= 0
      || !Number.isInteger(resourceId) || resourceId <= 0
      || (body.lineId != null && !(Number.isInteger(wholeNumber(body.lineId)) && wholeNumber(body.lineId) > 0))
      || !isIsoDate(date)
      || (start !== null && typeof start !== 'string')
      || (body.done !== undefined && ![true, false, 1, 0].includes(body.done))) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Données invalides.' });
    }
    const result = planningCards().setSessionDone({
      reservationId, resourceId, lineId: body.lineId == null ? undefined : wholeNumber(body.lineId), date, start: start || '', done: Boolean(body.done),
      kind: body.kind === 'ignition' ? 'ignition' : 'session',
    });
    if (result && result.error) {
      const status = result.error === 'NOT_FOUND' || result.error === 'SESSION_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    return res.json(result);
  }

  return {
    planningEvents, occupiedSlots, list, getOne, create, preview, update, remove,
    recordPayment, clearPayment, issueInvoice, attachInvoice,
    freeSlots, resourceCards, setResourceCardDone,
  };
}

module.exports = { createController };
