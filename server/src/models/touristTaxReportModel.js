// specs/tourist-tax-report-v2.md — the tourist-tax report over any period. It owns WHICH window, logement and
// declaration status are read; the declaration rows themselves come from financeModel.getTouristTaxRows, the very
// rows of the monthly extraction, so a stay's amount is computed once (rule 1). The stays a platform remits itself
// are read here, from the platform's mode (rule 6), and priced as their fiche shows them.

const db = require('../database');
const financeModel = require('./financeModel');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { platformDisplayName } = require('../utils/attributionChannel');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { resolveTaxPeriod, periodChoices } = require('../utils/touristTaxPeriod');
const { buildTouristTaxReport, ourStayRow, platformStayRow, DECLARATION_FILTERS } = require('../utils/touristTaxReport');

const { WE_REMIT_SQL, todayIso, nightsBetween } = financeModel.helpers;

const MESSAGES = {
  unknownProperty: 'Logement inconnu.',
  badDeclaration: 'Statut de déclaration inconnu.',
};

const channelLabel = (platform) => (isDirectChannel(platform) ? 'Direct' : platformDisplayName(platform));
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function createTouristTaxReportModel(database, finance) {
  const properties = () => database.prepare('SELECT id, name FROM properties ORDER BY id').all();
  // Rule 15 — the first month a stay could be declared in: its last night's.
  const firstStayMonth = () => {
    const row = database.prepare("SELECT MIN(DATE(endDate, '-1 day')) AS d FROM reservations WHERE kind = 'reservation'").get();
    return row && row.d ? String(row.d).slice(0, 7) : null;
  };

  // Rule 6 — attributed at the last night: no payment of ours gates a tax we never collect.
  function platformRemittedRows({ start, endExclusive }) {
    const rows = database.prepare(`
      SELECT r.*, p.name AS propertyName, c.firstName, c.lastName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      JOIN clients c ON c.id = r.clientId
      WHERE r.kind = 'reservation'
        AND NOT ${WE_REMIT_SQL}
        AND DATE(r.endDate, '-1 day') >= ?
        AND DATE(r.endDate, '-1 day') < ?
    `).all(start, endExclusive);
    return rows.map((r) => {
      const quote = quoteStoredReservation(database, r) || {};
      // The figure the fiche shows struck through: what the platform says it withheld, else the engine's estimate.
      const amount = quote.platformTouristTaxWithheld != null ? quote.platformTouristTaxWithheld : quote.touristTaxOriginalTotal;
      return platformStayRow({
        reservationId: r.id,
        propertyId: r.propertyId,
        propertyName: r.propertyName,
        reservationName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        platformLabel: channelLabel(r.platform),
        startDate: r.startDate,
        endDate: r.endDate,
        nightsCount: nightsBetween(r.startDate, r.endDate),
        adults: r.adults,
        children: r.children,
        teens: r.teens,
        babies: r.babies,
        taxAmount: round2(amount),
      });
    });
  }

  // What the extraction row does not carry and the report shows: the babies it exempts, the channel's name.
  function staysById(ids) {
    if (ids.length === 0) return new Map();
    return new Map(database
      .prepare(`SELECT id, babies, platform FROM reservations WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids)
      .map((r) => [Number(r.id), r]));
  }

  /**
   * @param {{ period?, month?, quarter?, year?, from?, to?, propertyId?, declaration? }} params — query strings.
   * @returns {{ ok: true, data: object } | { ok: false, status: number, error: string }}
   */
  function getReport(params = {}) {
    const today = todayIso();
    const resolved = resolveTaxPeriod({ ...params, period: params.period || 'month', today });
    if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
    const declaration = params.declaration == null || params.declaration === '' ? 'all' : params.declaration;
    if (!DECLARATION_FILTERS.includes(declaration)) return { ok: false, status: 400, error: MESSAGES.badDeclaration };
    const all = properties();
    let propertyId = null;
    if (params.propertyId != null && params.propertyId !== '') {
      propertyId = /^\d+$/.test(String(params.propertyId)) ? Number(params.propertyId) : NaN;
      if (!all.some((p) => p.id === propertyId)) return { ok: false, status: 400, error: MESSAGES.unknownProperty };
    }

    const { window } = resolved;
    const span = { start: window.from, endExclusive: window.coveredToExclusive };
    const onProperty = (row) => propertyId == null || Number(row.propertyId) === propertyId;
    const rows = finance.getTouristTaxRows(span).filter(onProperty);
    const extra = staysById([...new Set(rows.map((r) => Number(r.reservationId)))]);
    const ourRows = rows.map((row) => {
      const stay = extra.get(Number(row.reservationId)) || {};
      return ourStayRow(row, { babies: stay.babies, platformLabel: channelLabel(stay.platform) });
    });
    const platformRows = platformRemittedRows(span).filter(onProperty);
    const report = buildTouristTaxReport({ ourRows, platformRows, declaration });
    // Rule 34 — a stay is attributed by its end, so a night of the register may lie outside the window read: each
    // night says so, and the report says whether any does (the page explains it once).
    const nights = report.nights.map((n) => ({ ...n, outsideWindow: n.date < window.from || n.date > window.coveredTo }));
    const columns = { ...report.columns, nightsOutsideWindow: nights.some((n) => n.outsideWindow) };

    return {
      ok: true,
      data: {
        window,
        filters: { propertyId, declaration },
        today,
        currentMonth: today.slice(0, 7),
        properties: all,
        choices: periodChoices({ firstMonth: firstStayMonth(), today, window }),
        ...report,
        nights,
        columns,
      },
    };
  }

  return { getReport };
}

const defaultModel = createTouristTaxReportModel(db, financeModel);
defaultModel.buildModel = (database) => createTouristTaxReportModel(database, financeModel.buildModel(database));
defaultModel.MESSAGES = MESSAGES;

module.exports = defaultModel;
