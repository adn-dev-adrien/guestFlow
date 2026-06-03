/**
 * Dashboard controller — aggregate endpoints feeding the Dashboard page
 * (specs/linen-inventory-shortage-tracking.md §4.1).
 *
 * Currently exposes only `linenShortage`. Other dashboard aggregates can join here later.
 */

const linenInventoryModel = require('../models/linenInventoryModel');
const reservationsModel = require('../models/reservationsModel');

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
      // We resolve them lazily — only for the IDs that appear in at least one shortage.
      const allImpactedIds = new Set();
      for (const [, agg] of typesWithShortage) {
        for (const id of agg.impactedReservationIds) allImpactedIds.add(id);
      }
      const reservationsById = new Map();
      for (const id of allImpactedIds) {
        const r = injectedReservationsModel.findById ? injectedReservationsModel.findById(id) : null;
        if (r) reservationsById.set(id, r);
      }
      const resolveReservation = (id) => {
        const r = reservationsById.get(id);
        if (!r) return { id, clientName: '', startDate: '', endDate: '' };
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
  };
}

module.exports = buildController();
module.exports.buildController = buildController;
