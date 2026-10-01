// Booking pace of the Suivi financier (specs/booking-pace.md §4.1): reads the stays through financeModel
// — never re-deriving a stay's amount — and hands them to utils/bookingPace.

const db = require('../database');
const financeModel = require('./financeModel');
const pace = require('../utils/bookingPace');
const yoy = require('../utils/yearOverYear');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function createBookingPaceModel(database, finance) {
  const H = finance.helpers;

  function context(params = {}) {
    const metric = params.metric == null || params.metric === '' ? 'reservations' : String(params.metric);
    if (!pace.METRICS.includes(metric)) return { ok: false, status: 400, error: 'Mesure inconnue.' };
    let propertyId = null;
    if (params.propertyId != null && params.propertyId !== '') {
      propertyId = Number(params.propertyId);
      if (!database.prepare('SELECT 1 FROM properties WHERE id = ?').get(propertyId)) {
        return { ok: false, status: 400, error: 'Logement inconnu.' };
      }
    }
    const stays = finance.getPaceStays({ propertyId });
    // finance-dashboard-redesign rule 17: last year exists from the month of the earliest live stay.
    const earliest = stays.filter((s) => !s.cancelledOn).reduce((min, s) => (min == null || s.startDate < min ? s.startDate : min), null);
    return {
      ok: true,
      metric,
      propertyId,
      stays,
      coverageMonth: yoy.coverageMonth(earliest),
      today: params.today || H.todayIso(),
    };
  }

  function getPace(params = {}) {
    const c = context(params);
    if (!c.ok) return c;
    return {
      ok: true,
      data: { propertyId: c.propertyId, ...pace.buildPace({ stays: c.stays, today: c.today, metric: c.metric, coverageMonth: c.coverageMonth }) },
    };
  }

  function getPaceMonth(month, params = {}) {
    if (!MONTH_RE.test(String(month || ''))) return { ok: false, status: 400, error: 'Mois invalide.' };
    const c = context(params);
    if (!c.ok) return c;
    return {
      ok: true,
      data: pace.buildPickupCurve({ stays: c.stays, month, today: c.today, metric: c.metric, coverageMonth: c.coverageMonth }),
    };
  }

  return { getPace, getPaceMonth };
}

const defaultModel = createBookingPaceModel(db, financeModel);
defaultModel.buildModel = (database) => createBookingPaceModel(database, financeModel.buildModel(database));

module.exports = defaultModel;
