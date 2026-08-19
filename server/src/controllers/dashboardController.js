/**
 * Dashboard controller — aggregate endpoints feeding the Dashboard page
 * (specs/linen-inventory-shortage-tracking.md §4.1).
 *
 * Currently exposes only `linenShortage`. Other dashboard aggregates can join here later.
 */

const linenInventoryModel = require('../models/linenInventoryModel');
const reservationsModel = require('../models/reservationsModel');
const icalDateDriftModel = require('../models/icalDateDriftModel');
const icalCancellationModel = require('../models/icalCancellationModel');
const googleCalendarSync = require('../utils/googleCalendarSync');
const { validateApprovalCompensation } = require('../utils/cancellationCompensations');
const { buildPaymentDeadlineRows } = require('../utils/paymentDeadlines');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TYPE_LABELS = Object.freeze({
  single: 'Drap simple',
  double: 'Drap double',
  baby:   'Drap bébé',
  large:  'Serviette grande',
  medium: 'Serviette moyenne',
  small:  'Serviette petite',
});

function buildController({
  linenInventoryModel: injectedLinenInventoryModel = linenInventoryModel,
  reservationsModel: injectedReservationsModel = reservationsModel,
  icalDateDriftModel: injectedIcalDateDriftModel = icalDateDriftModel,
  icalCancellationModel: injectedIcalCancellationModel = icalCancellationModel,
  googleCalendarSync: injectedGoogleCalendarSync = googleCalendarSync,
  // Injected so the deadline endpoints stay testable without Qonto/SMTP: production wires the real
  // payments controller lazily (it pulls the Qonto client, which must not load with the dashboard).
  sendDepositRequest = (id) => require('./paymentsController').sendDepositRequestFor(id),
  sendBalanceRequest = (id) => require('./paymentsController').sendBalanceRequestFor(id),
  today: injectedToday = null,
} = {}) {
  const resolveToday = () => injectedToday || getTodayIsoDate();
  return {
    /**
     * GET /api/dashboard/linen-shortage
     *
     * Returns a grouped-by-type list of every projected shortage in the horizon. Hidden when
     * no shortage is found.
     *
     * Payload shape:
     *   {
     *     horizon: 'YYYY-MM-DD' | null,
     *     shortagesByType: [
     *       {
     *         type: 'single', label: 'Drap simple',
     *         firstShortageDate: 'YYYY-MM-DD',
     *         maxMissing: 3,
     *         impactedReservations: [{ id, clientName, startDate, endDate }, ...],
     *       },
     *       ...
     *     ]
     *   }
     */
    linenShortage(req, res) {
      const result = injectedLinenInventoryModel.simulate();
      if (!result) return res.json({ horizon: null, shortagesByType: [] });

      const typesWithShortage = Object.entries(result.shortagesByType)
        .filter(([, agg]) => agg.firstDate && agg.maxMissing > 0);
      if (typesWithShortage.length === 0) {
        return res.json({ horizon: result.horizon, shortagesByType: [] });
      }

      // Resolve impacted reservation details (client name + dates) via the reservations model.
      // One batched query for all impacted ids across all types — cheaper than N point reads.
      const allImpactedIds = new Set();
      for (const [, agg] of typesWithShortage) {
        for (const id of agg.impactedReservationIds) allImpactedIds.add(id);
      }
      const rows = typeof injectedReservationsModel.findClientNamesByIds === 'function'
        ? injectedReservationsModel.findClientNamesByIds(Array.from(allImpactedIds))
        : [];
      const reservationsById = new Map(rows.map((r) => [Number(r.id), r]));
      const resolveReservation = (id) => {
        const r = reservationsById.get(Number(id));
        if (!r) return { id, clientName: `#${id}`, startDate: '', endDate: '' };
        const firstName = String(r.firstName || '').trim();
        const lastName = String(r.lastName || '').trim();
        const clientName = `${firstName} ${lastName}`.trim() || `#${id}`;
        return { id, clientName, startDate: r.startDate || '', endDate: r.endDate || '' };
      };

      const shortagesByType = typesWithShortage.map(([type, agg]) => ({
        type,
        label: TYPE_LABELS[type] || type,
        firstShortageDate: agg.firstDate,
        maxMissing: agg.maxMissing,
        impactedReservations: agg.impactedReservationIds.map(resolveReservation),
      }));

      return res.json({ horizon: result.horizon, shortagesByType });
    },

    /**
     * GET /api/dashboard/ical-date-drift
     *
     * Returns every pending date-drift approval for iCal-locked reservations
     * (specs/ical-sync-override-locked-dates.md §4.3). Empty `alerts: []` when nothing pending.
     */
    icalDateDrift(req, res) {
      const alerts = injectedIcalDateDriftModel.listPending();
      return res.json({ alerts });
    },

    /**
     * POST /api/dashboard/ical-date-drift/:id/approve
     *
     * Applies the narrow date override on the reservation and flips the drift row to
     * outcome='approved' (atomic). Maps domain error codes to HTTP statuses.
     */
    approveIcalDateDrift(req, res) {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
      const result = injectedIcalDateDriftModel.approve(id);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json({ ok: true });
      // Approved date override → fire-and-forget Google push, after the response so the
      // committed approval can never be turned into a 500 by the hook (spec rule 19-20).
      if (result.reservationId) injectedGoogleCalendarSync.schedulePush(result.reservationId);
      return undefined;
    },

    /**
     * POST /api/dashboard/ical-date-drift/:id/reject
     *
     * Flips the drift row to outcome='rejected' without touching the reservation.
     */
    rejectIcalDateDrift(req, res) {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
      const result = injectedIcalDateDriftModel.reject(id);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      return res.json({ ok: true });
    },

    /**
     * GET /api/dashboard/ical-cancellation
     *
     * Returns every pending cancellation approval for iCal-imported reservations whose UID
     * has fallen out of every source feed (specs/ical-cancellation-approval.md §4.3).
     * Empty `alerts: []` when nothing pending.
     */
    icalCancellation(req, res) {
      const alerts = injectedIcalCancellationModel.listPending();
      return res.json({ alerts });
    },

    /**
     * POST /api/dashboard/ical-cancellation/:id/approve
     *
     * Atomically deletes the reservation + its ical_import_events mappings + writes a
     * history audit entry + flips the alert to outcome='approved' — and, when the body carries
     * `{ compensation: { expectedAmount, expectedDate?, notes? } }`, records the indemnity the
     * platform owes for the cancelled stay in that same transaction. Returns 200 with
     * `outcome: 'reservation_gone'` (idempotent shape) when the reservation was already
     * manually deleted between the sync and the approve click.
     */
    approveIcalCancellation(req, res) {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
      // Optional compensation block (specs/cancellation-compensation.md §3.2): when the platform
      // owes an indemnity for the cancelled stay, it is created in the SAME transaction as the
      // deletion. Absent body ⇒ `null` ⇒ the historical delete-only behaviour, untouched.
      const parsedCompensation = validateApprovalCompensation((req.body || {}).compensation);
      if (!parsedCompensation.ok) {
        return res.status(400).json({ error: parsedCompensation.error, field: parsedCompensation.field });
      }
      const result = injectedIcalCancellationModel.approve(id, parsedCompensation.value);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json({ ok: true, outcome: result.outcome, compensationId: result.compensationId ?? null });
      // Approved cancellation → fire-and-forget Google event delete, after the response
      // (spec rule 19-20). Also fired on 'reservation_gone': the event may still exist as
      // an orphan.
      if (result.reservationId) injectedGoogleCalendarSync.scheduleDelete(result.reservationId);
      return undefined;
    },

    /**
     * POST /api/dashboard/ical-cancellation/:id/reject
     *
     * Flips the alert to outcome='rejected' without touching the reservation. The
     * dropped iCal mappings stay dropped (they were removed during the sync that raised
     * the alert and we don't restore them — spec §8).
     */
    rejectIcalCancellation(req, res) {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
      const result = injectedIcalCancellationModel.reject(id);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      return res.json({ ok: true });
    },

    /**
     * GET /api/dashboard/ical-new-today
     *
     * Returns the reservations imported via iCal during the current (UTC) day, fully shaped for
     * display (specs/dashboard-ical-new-reservations.md). Read-only notification card — empty
     * `alerts: []` when nothing was imported today.
     */
    icalNewReservationsToday(req, res) {
      const alerts = injectedReservationsModel.listNewIcalReservationsToday();
      return res.json({ alerts });
    },

    /**
     * GET /api/dashboard/payment-deadlines
     *
     * Every direct reservation with a missed payment deadline (specs/payment-schedule-and-cancellation.md
     * §3.4). Rows arrive ready to render: state, severity, amounts, days late, and which actions apply.
     * Empty `rows: []` when nothing is late — the card then draws nothing.
     */
    paymentDeadlines(req, res) {
      const today = resolveToday();
      const rows = buildPaymentDeadlineRows(
        injectedReservationsModel.listPaymentDeadlineCandidates(today),
        today,
      );
      return res.json({ rows });
    },

    /**
     * POST /api/dashboard/payment-deadlines/:id/snooze — { days? }
     *
     * Hides one row for a while. The échéances themselves never move (rule 18): what the guest was
     * promised — and the date the stay may be cancelled — is unchanged.
     */
    snoozePaymentDeadline(req, res) {
      const id = Number(req.params.id);
      const requested = Number(req.body && req.body.days);
      const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 60) : 7;
      const snoozedUntil = addDaysToIsoDate(resolveToday(), days);
      injectedReservationsModel.snoozePaymentAlert(id, snoozedUntil);
      return res.json({ ok: true, snoozedUntil });
    },

    /**
     * POST /api/dashboard/payment-deadlines/:id/remind — { type: 'deposit' | 'balance' }
     *
     * Re-sends the matching payment request (fresh Qonto link + templated email), relaying the
     * payment service's own status and error shape verbatim.
     */
    async remindPaymentDeadline(req, res) {
      const id = Number(req.params.id);
      const type = String((req.body && req.body.type) || 'balance');
      if (type !== 'deposit' && type !== 'balance') {
        return res.status(400).json({ error: 'INVALID_TYPE', message: 'Type de relance invalide (deposit/balance).' });
      }
      try {
        const { httpStatus, body } = type === 'deposit'
          ? await sendDepositRequest(id)
          : await sendBalanceRequest(id);
        return res.status(httpStatus).json(body);
      } catch (err) {
        return res.status(502).json({ error: 'REMINDER_FAILED', message: String((err && err.message) || err) });
      }
    },

    /**
     * GET /api/dashboard/public-devis-pending
     *
     * Site-origin devis awaiting handling (specs/site-booking-notifications.md §3 rule 5). Feeds
     * the DevisPublicRequestAlert; empty `alerts: []` when nothing is pending.
     */
    publicDevisPending(req, res) {
      const alerts = injectedReservationsModel.listPendingPublicDevis();
      return res.json({ alerts });
    },
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
