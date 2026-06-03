/**
 * Dashboard controller — aggregate endpoints feeding the Dashboard page
 * (specs/linen-inventory-shortage-tracking.md §4.1).
 *
 * Currently exposes only `linenShortage`. Other dashboard aggregates can join here later.
 */

const linenInventoryModel = require('../models/linenInventoryModel');
const reservationsModel = require('../models/reservationsModel');
const icalDateDriftModel = require('../models/icalDateDriftModel');

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
} = {}) {
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
      return res.json({ ok: true });
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
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
