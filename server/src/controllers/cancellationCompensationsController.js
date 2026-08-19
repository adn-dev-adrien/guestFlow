/**
 * Cancellation compensations controller — CRUD behind `/api/accounting/cancellation-compensations`
 * (specs/cancellation-compensation.md §4.3).
 *
 * Thin: parses + validates through the pure `utils/cancellationCompensations` validators, then
 * delegates to `cancellationCompensationsModel`. The month/year pair filters ONLY the received
 * compensations — a pending one has no accounting date, so it is always returned in full.
 *
 * Role gating is handled upstream by `middleware/enforceRoleAccess`: the accountant may GET these
 * routes (they are under `/accounting/*`) but every write stays admin-only. Nothing here relaxes it.
 */

const defaultModel = require('../models/cancellationCompensationsModel');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const {
  validateDraft,
  validateReceipt,
} = require('../utils/cancellationCompensations');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseMonthYear(query) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
  return { month, year };
}

function monthBounds({ month, year }) {
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year);
  return {
    from: `${yyyy}-${mm}-01`,
    nextMonth: month === 12 ? `${year + 1}-01-01` : `${yyyy}-${String(month + 1).padStart(2, '0')}-01`,
  };
}

function parseId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function createController(model = defaultModel, { today = getTodayIsoDate } = {}) {
  // Business errors travel as `{ error, status }` from the model; validators as `{ error, field }`.
  const fail = (res, result) => res.status(result.status || 400).json({ error: result.error, field: result.field });

  return {
    // GET /api/accounting/cancellation-compensations?month=&year=
    list(req, res) {
      const params = parseMonthYear(req.query);
      if (!params) return res.status(400).json({ error: 'INVALID_MONTH_OR_YEAR' });
      const pending = model.listPending();
      const received = model.listReceivedByMonth(monthBounds(params));
      return res.json({
        pending,
        received,
        totals: {
          pendingExpected: round2(pending.reduce((sum, c) => sum + Number(c.expectedAmount || 0), 0)),
          receivedInMonth: round2(received.reduce((sum, c) => sum + Number(c.receivedAmount || 0), 0)),
        },
      });
    },

    // POST /api/accounting/cancellation-compensations — manual creation (no iCal alert behind it).
    create(req, res) {
      const parsed = validateDraft(req.body);
      if (!parsed.ok) return fail(res, parsed);
      return res.status(201).json({ compensation: model.create(parsed.value) });
    },

    // PUT /api/accounting/cancellation-compensations/:id — pending only.
    update(req, res) {
      const id = parseId(req);
      if (!id) return res.status(400).json({ error: 'INVALID_ID' });
      const parsed = validateDraft(req.body);
      if (!parsed.ok) return fail(res, parsed);
      const result = model.update(id, parsed.value);
      if (result.error) return fail(res, result);
      return res.json({ compensation: result.data });
    },

    // POST /api/accounting/cancellation-compensations/:id/receive — the money landed.
    receive(req, res) {
      const id = parseId(req);
      if (!id) return res.status(400).json({ error: 'INVALID_ID' });
      const parsed = validateReceipt(req.body, today());
      if (!parsed.ok) return fail(res, parsed);
      const result = model.receive(id, parsed.value);
      if (result.error) return fail(res, result);
      return res.json({ compensation: result.data });
    },

    // POST /api/accounting/cancellation-compensations/:id/reopen — back to editable; the entry
    // leaves the month's journal at once (it is built from `status`/`receivedDate` at read time).
    reopen(req, res) {
      const id = parseId(req);
      if (!id) return res.status(400).json({ error: 'INVALID_ID' });
      const result = model.reopen(id);
      if (result.error) return fail(res, result);
      return res.json({ compensation: result.data });
    },

    // DELETE /api/accounting/cancellation-compensations/:id — pending only.
    remove(req, res) {
      const id = parseId(req);
      if (!id) return res.status(400).json({ error: 'INVALID_ID' });
      const result = model.remove(id);
      if (result.error) return fail(res, result);
      return res.json({ ok: true });
    },
  };
}

const defaultController = createController();

module.exports = defaultController;
// NOT `create`: that name is already one of the controller's own handlers (POST), and overwriting
// it would make the route call the factory instead of the handler — same trap as refundsController.
module.exports.createController = createController;
