// « À vérifier » of the Suivi financier (specs/finance-data-checks.md). Read-only. Each check reads the rule
// that already defines its concept — the tax « Recalculer » would give (quoteStoredReservation), the stays the
// tourist-tax page lists and their « Déclarée » tick (financeModel.getTouristTaxExtraction), the platform stay
// of the finance dashboard (isPlatformStay), the iCal placeholder client (isPlaceholderClient) — and only
// decides which stays of the exercise it lists.

const db = require('../database');
const financeModel = require('./financeModel');
const fiscalYearUtil = require('../utils/fiscalYear');
const { exerciseMonths } = require('../utils/exerciseOverview');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { isTouristTaxRemittedByOwner } = require('../utils/pricing');
const { isPlaceholderClient } = require('../utils/placeholderClient');
const { isPlatformStay } = require('./financeDashboardModel');
const { platformDisplayName } = require('../utils/attributionChannel');
const { round2 } = require('../utils/paymentStatus');
const shape = require('../utils/financeDataChecks');

const H = financeModel.helpers;

function createDataChecksModel(database, finance) {
  const columns = () => new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));

  // Rule 1 — the exercise and the logement, read as the dashboard reads them.
  function context({ fiscalYear, propertyId } = {}) {
    const today = H.todayIso();
    const endMonth = H.getFiscalYearEndMonth(database);
    const exercise = fiscalYearUtil.resolve(endMonth, { key: fiscalYear, today });
    let scopedId = null;
    if (propertyId != null && propertyId !== '') {
      scopedId = Number(propertyId);
      const known = Number.isInteger(scopedId) && database.prepare('SELECT 1 FROM properties WHERE id = ?').get(scopedId);
      if (!known) return { ok: false, status: 400, error: 'Logement inconnu.' };
    }
    return { ok: true, today, exercise, propertyId: scopedId };
  }

  // Rule 5 — the stays a stay check looks at: a reservation, not cancelled, over (today > endDate, the
  // tourist tax's own « terminé », D16), whose last night falls in the exercise, of the logement asked.
  function finishedStays(ctx) {
    const cols = columns();
    const optional = (name) => (cols.has(name) ? `r.${name}` : `NULL AS ${name}`);
    return database.prepare(`
      SELECT r.*, ${optional('reservationNumber')}, ${optional('requestOrigin')}, ${optional('platformGrossAmount')},
             p.name AS propertyName, c.firstName, c.lastName
        FROM reservations r
        JOIN properties p ON p.id = r.propertyId
        LEFT JOIN clients c ON c.id = r.clientId
       WHERE r.kind = 'reservation'
         AND r.cancelledAt IS NULL
         AND r.endDate < ?
         AND DATE(r.endDate, '-1 day') >= ? AND DATE(r.endDate, '-1 day') <= ?
         ${ctx.propertyId != null ? 'AND r.propertyId = ?' : ''}
       ORDER BY r.endDate, r.id
    `).all(ctx.today, ctx.exercise.from, ctx.exercise.to, ...(ctx.propertyId != null ? [ctx.propertyId] : []));
  }

  const yearOf = (ctx) => ctx.today.slice(0, 4);
  const stayItem = (ctx, stay, detail, withGuest = true) => ({
    reservationId: Number(stay.id),
    label: shape.stayLabel(stay, { year: yearOf(ctx), withGuest: withGuest && !isPlaceholderClient(stay) }),
    detail,
  });

  // Rule 6 — a stay whose tax WE remit carries 0 € while the tax « Recalculer » would give is above 0.
  function touristTaxMissing(ctx, stays) {
    const items = [];
    for (const stay of stays) {
      if (round2(Number(stay.touristTaxTotal || 0)) !== 0) continue;
      const platform = String(stay.platform || 'direct').toLowerCase();
      if (!isTouristTaxRemittedByOwner(database, stay.propertyId, platform)) continue;
      const quote = quoteStoredReservation(database, stay, { freezeTouristTax: false });
      if (!quote || quote.error || !quote.touristTaxRemittedByOwner) continue;
      const expected = round2(Number(quote.touristTaxTotal || 0));
      if (expected > 0) items.push(stayItem(ctx, stay, shape.expectedTaxDetail(expected)));
    }
    return shape.buildCheck('tourist-tax-missing', items);
  }

  // Rule 7 — a past month of the exercise where the tourist-tax page lists a declarable row not ticked.
  function touristTaxUndeclared(ctx) {
    const firstTicked = database.prepare(`
      SELECT MIN(DATE(endDate, '-1 day')) AS day FROM reservations
       WHERE kind = 'reservation' AND touristTaxDeclaredAt IS NOT NULL
    `).get();
    const items = [];
    const currentMonth = ctx.today.slice(0, 7);
    const startMonth = firstTicked && firstTicked.day ? String(firstTicked.day).slice(0, 7) : null;
    if (startMonth) {
      for (const { month } of exerciseMonths(ctx.exercise.from, ctx.exercise.to)) {
        if (month >= currentMonth || month < startMonth) continue;
        const result = finance.getTouristTaxExtraction({ month });
        if (!result.ok) continue;
        const rows = result.data.reservations.filter((row) => row.declarable && !row.touristTaxDeclaredAt
          && round2(Number(row.taxAmount || 0)) > 0
          && (ctx.propertyId == null || Number(row.propertyId) === ctx.propertyId));
        if (rows.length === 0) continue;
        const amount = round2(rows.reduce((sum, row) => sum + Number(row.taxAmount || 0), 0));
        const stays = new Set(rows.map((row) => row.reservationId)).size;
        items.push({ month, label: shape.monthItemLabel(month), detail: shape.undeclaredDetail(amount, stays), amount, stays });
      }
    }
    return shape.buildCheck('tourist-tax-undeclared', items);
  }

  // Rule 8 — a finished platform stay whose « Montant total payé par le client » was never typed.
  function platformPaymentMissing(ctx, stays) {
    const items = stays
      .filter((stay) => isPlatformStay(stay) && (stay.platformGrossAmount == null || stay.platformGrossAmount === ''))
      .map((stay) => stayItem(ctx, stay, `Canal : ${platformDisplayName(stay.platform)}`));
    return shape.buildCheck('platform-payment-missing', items);
  }

  // Rule 9 — a finished stay still held by the client the iCal import made up.
  function guestNameMissing(ctx, stays) {
    const items = stays
      .filter((stay) => isPlaceholderClient(stay))
      .map((stay) => stayItem(ctx, stay, `Client : ${[stay.firstName, stay.lastName].filter(Boolean).join(' ')}`, false));
    return shape.buildCheck('guest-name-missing', items);
  }

  function getDataChecks(params = {}) {
    const ctx = context(params);
    if (!ctx.ok) return ctx;
    const stays = finishedStays(ctx);
    const { pendingCount, checks } = shape.assemble([
      touristTaxMissing(ctx, stays),
      touristTaxUndeclared(ctx),
      platformPaymentMissing(ctx, stays),
      guestNameMissing(ctx, stays),
    ]);
    const { key, label, from, to } = ctx.exercise;
    return {
      ok: true,
      data: { exercise: { key, label, from, to }, propertyId: ctx.propertyId, asOf: ctx.today, pendingCount, checks },
    };
  }

  return { getDataChecks };
}

const defaultModel = createDataChecksModel(db, financeModel);
defaultModel.buildModel = (database) => createDataChecksModel(database, financeModel.buildModel(database));

module.exports = defaultModel;
