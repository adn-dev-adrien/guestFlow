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

const { WE_REMIT_SQL, TAX_ON_ARRIVAL_SQL, todayIso, nightsBetween } = financeModel.helpers;

const MESSAGES = {
  unknownProperty: 'Logement inconnu.',
  badDeclaration: 'Statut de déclaration inconnu.',
};

// The platform's mode « it collects the tax from the guest » (collectsTouristTax = 1), reached by the label a manual
// stay stores or the iCal key bridged to it, as TAX_ON_ARRIVAL_SQL does for the other mode.
const PLATFORM_COLLECTS_SQL = `(
  lower(COALESCE(NULLIF(TRIM(r.platform), ''), 'direct')) <> 'direct'
  AND (
    EXISTS (SELECT 1 FROM platforms pl WHERE lower(pl.name) = lower(r.platform) AND pl.collectsTouristTax = 1)
    OR EXISTS (
      SELECT 1 FROM ical_sources s JOIN platforms pl ON lower(pl.name) = lower(s.platformLabel)
      WHERE (lower(s.platformKey) = lower(r.platform) OR lower(s.platformLabel) = lower(r.platform))
        AND pl.collectsTouristTax = 1
    )
  )
)`;

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function createTouristTaxReportModel(database, finance) {
  // Rule 51 (review V3R-4) — an iCal key (`booking`) reads as its platform's label (`Booking`), through the same
  // ical_sources bridge as the platform predicates, then the app's display name. A minimal schema has no bridge.
  const labelOfKey = (() => {
    try {
      return database.prepare('SELECT platformLabel FROM ical_sources WHERE lower(platformKey) = lower(?) AND TRIM(COALESCE(platformLabel, \'\')) <> \'\' LIMIT 1');
    } catch { return null; }
  })();
  const channelLabel = (platform) => {
    if (isDirectChannel(platform)) return 'Direct';
    const bridged = labelOfKey && platform ? labelOfKey.get(String(platform)) : null;
    return platformDisplayName(bridged ? bridged.platformLabel : platform);
  };

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

  // Rules 38, 42, 43 (D-HC15, D-HC18) — a stay we would remit (WE_REMIT) but whose tax is frozen at 0 € (D-HC10)
  // is listed as the platform's when the platform's MODE says it collects the tax (`collectsTouristTax = 1`, read
  // from the mode, never the name), with the amount it stated. Attached at its last night like every platform row
  // (rule 6), never by the day we were paid. Any other stay frozen at 0 € (direct, a platform that does not collect,
  // a property without tax) stays hidden.
  function frozenAtZeroPlatformRows({ start, endExclusive }) {
    const rows = database.prepare(`
      SELECT r.*, p.name AS propertyName, c.firstName, c.lastName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      JOIN clients c ON c.id = r.clientId
      WHERE r.kind = 'reservation'
        AND ${WE_REMIT_SQL}
        AND ${PLATFORM_COLLECTS_SQL}
        -- Rule 50 (D-HC21) — a tax WE collected at arrival (the fiche's « en complément », or the platform's mode)
        -- never went through the platform: the stay stays hidden. The tax page's own at-arrival reading.
        AND NOT ${TAX_ON_ARRIVAL_SQL}
        AND DATE(r.endDate, '-1 day') >= ?
        AND DATE(r.endDate, '-1 day') < ?
    `).all(start, endExclusive);
    return rows
      .filter((r) => !isDirectChannel(r.platform) && finance.isTaxFrozenAtZero(r))
      .map((r) => platformStayRow({
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
        taxAmount: round2(r.platformTouristTaxAmount),
      }));
  }

  // What the extraction row does not carry and the report shows: the babies it exempts, the channel's name.
  function staysById(ids) {
    // Rule 46 (review V2-8) — in chunks of 500: SQLite caps the bound parameters of one statement.
    const byId = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      database.prepare(`SELECT id, babies, platform FROM reservations WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .all(...chunk)
        .forEach((r) => byId.set(Number(r.id), r));
    }
    return byId;
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
    const frozenPlatformRows = frozenAtZeroPlatformRows(span);
    const platformRows = [...platformRemittedRows(span), ...frozenPlatformRows].filter(onProperty);
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
