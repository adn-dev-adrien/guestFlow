// specs/tourist-tax-report-v2.md rules 6-14 — the tourist-tax report's shaping, pure: the declaration rows the
// extraction already computed (one amount per stay, never a second computation), the stays a platform remits
// itself, the declaration filter, the « Par nuit » register and the totals of the sticky bar. Every sum runs in
// cents, so the register and the list add up to the same totals to the cent.

const { addDays } = require('./dateDays');
const { localIsoDate } = require('./localDate');

const DECLARATION_FILTERS = ['all', 'todo', 'done'];

const cents = (euros) => Math.round(Number(euros || 0) * 100);
const euros = (c) => c / 100;
const count = (value) => Math.max(0, Math.round(Number(value || 0)));

/**
 * Rule 30 — the day a tick was made, in the server's day (Europe/Paris): the stamp is SQLite's UTC `datetime('now')`,
 * so a tick between midnight and 1-2 a.m. would otherwise read the day before.
 */
function declaredOnOf(stamp) {
  if (!stamp) return null;
  const text = String(stamp).trim();
  const utc = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(utc.getTime()) ? text.slice(0, 10) : localIsoDate(utc);
}

/** `total` split into `parts` whole shares, the remainder on the first ones: Σ shares === total. */
function distribute(total, parts) {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Rule 7 — one row of ours: the extraction's row as it stands (amount, nights, adults, refunded nights, tick),
 * plus the persons it exempts. Taxed = the adults the row declares; exempt = the minors on the stay (children
 * and teens, as the row already counts them, and babies), never on a row of added guests (only adults are added).
 */
function ourStayRow(row, { babies = 0, platformLabel = '' } = {}) {
  const added = Boolean(row.addedGuestsRow);
  const nightsCount = count(row.nightsCount);
  const taxedPersons = count(row.adults);
  const exemptPersons = added ? 0 : count(row.children) + count(babies);
  return {
    key: added ? `${row.reservationId}-added` : String(row.reservationId),
    reservationId: row.reservationId,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    reservationName: row.reservationName,
    platformLabel,
    startDate: row.startDate,
    endDate: row.endDate,
    remittedBy: 'us',
    addedGuestsRow: added,
    noGuestAdded: Boolean(row.noGuestAdded),
    nightsCount,
    persons: taxedPersons + exemptPersons,
    taxedPersons,
    exemptPersons,
    taxedPersonNights: count(row.adultNights),
    exemptPersonNights: exemptPersons * nightsCount,
    taxAmount: euros(cents(row.taxAmount)),
    refundedTaxNights: count(row.refundedTaxNights),
    refundedTaxAmount: euros(cents(row.refundedTaxAmount)),
    touristTaxDeclaredAt: row.touristTaxDeclaredAt || null,
    touristTaxDeclaredOn: declaredOnOf(row.touristTaxDeclaredAt),
    declared: Boolean(row.touristTaxDeclaredAt),
    declarable: Boolean(row.declarable),
    // Rule 16 — what the commune's percentage form asks for, as the extraction row carries it.
    nightPricePerOccupantHt: row.nightPricePerOccupantHt == null ? null : euros(cents(row.nightPricePerOccupantHt)),
    accommodationAmount: euros(cents(row.accommodationAmount)),
  };
}

/** Rule 6 — a stay whose tax its platform remits to the commune itself: shown apart, never in what we remit. */
function platformStayRow(row) {
  const nightsCount = count(row.nightsCount);
  const taxedPersons = count(row.adults);
  const exemptPersons = count(row.children) + count(row.teens) + count(row.babies);
  return {
    key: `${row.reservationId}-platform`,
    reservationId: row.reservationId,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    reservationName: row.reservationName,
    platformLabel: row.platformLabel,
    startDate: row.startDate,
    endDate: row.endDate,
    remittedBy: 'platform',
    addedGuestsRow: false,
    noGuestAdded: false,
    nightsCount,
    persons: taxedPersons + exemptPersons,
    taxedPersons,
    exemptPersons,
    taxedPersonNights: taxedPersons * nightsCount,
    exemptPersonNights: exemptPersons * nightsCount,
    taxAmount: euros(cents(row.taxAmount)),
    refundedTaxNights: 0,
    refundedTaxAmount: 0,
    touristTaxDeclaredAt: null,
    touristTaxDeclaredOn: null,
    declared: false,
    declarable: false,
    nightPricePerOccupantHt: null,
    accommodationAmount: null,
  };
}

const keepByDeclaration = (declaration) => (row) => (declaration === 'done' ? row.declared
  : declaration === 'todo' ? !row.declared : true);

function byStayOrder(a, b) {
  return String(a.startDate).localeCompare(String(b.startDate))
    || String(a.propertyName || '').localeCompare(String(b.propertyName || ''), 'fr')
    || String(a.reservationName || '').localeCompare(String(b.reservationName || ''), 'fr')
    || Number(a.reservationId) - Number(b.reservationId)
    || Number(a.addedGuestsRow) - Number(b.addedGuestsRow);
}

/**
 * Rules 9-10 — the register: one entry per occupied night of the rows listed, the first `nightsCount` nights of
 * each stay (the refunded ones are its last). Each row's amount and person-nights are spread over its nights in
 * whole cents and whole persons, so Σ register === the list's totals.
 */
function nightRegister(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const n = row.nightsCount;
    if (n <= 0) continue;
    const amounts = distribute(cents(row.taxAmount), n);
    const taxed = distribute(row.taxedPersonNights, n);
    const exempt = distribute(row.exemptPersonNights, n);
    for (let i = 0; i < n; i += 1) {
      const date = addDays(String(row.startDate).slice(0, 10), i);
      if (!byDate.has(date)) byDate.set(date, { date, stays: new Set(), taxedPersons: 0, exemptPersons: 0, amountCents: 0 });
      const night = byDate.get(date);
      night.stays.add(row.reservationId);
      night.taxedPersons += taxed[i];
      night.exemptPersons += exempt[i];
      night.amountCents += amounts[i];
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((night) => ({
      date: night.date,
      staysCount: night.stays.size,
      persons: night.taxedPersons + night.exemptPersons,
      taxedPersons: night.taxedPersons,
      exemptPersons: night.exemptPersons,
      taxAmount: euros(night.amountCents),
    }));
}

/** Rules 11-12 — the sticky bar, over the rows of ours listed and the platform stays of the same selection. */
function reportTotals(ours, platform) {
  const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
  // A row of added guests is the same stay and the same nights: a stay and its nights count once.
  const nightsByStay = new Map();
  for (const row of ours) if (!nightsByStay.has(row.reservationId) || !row.addedGuestsRow) nightsByStay.set(row.reservationId, row.nightsCount);
  const amountCents = sum(ours, (r) => cents(r.taxAmount));
  const declaredCents = sum(ours.filter((r) => r.declared), (r) => cents(r.taxAmount));
  const toDeclare = ours.filter((r) => !r.declared).length;
  return {
    staysCount: nightsByStay.size,
    rowsCount: ours.length,
    declaredRowsCount: ours.length - toDeclare,
    toDeclareRowsCount: toDeclare,
    persons: sum(ours, (r) => r.persons),
    taxedPersons: sum(ours, (r) => r.taxedPersons),
    exemptPersons: sum(ours, (r) => r.exemptPersons),
    nights: sum([...nightsByStay.values()], (n) => n),
    taxedPersonNights: sum(ours, (r) => r.taxedPersonNights),
    exemptPersonNights: sum(ours, (r) => r.exemptPersonNights),
    amount: euros(amountCents),
    declaredAmount: euros(declaredCents),
    remainingAmount: euros(amountCents - declaredCents),
    allDeclared: ours.length > 0 && toDeclare === 0,
    platformRemittedStaysCount: platform.length,
    platformRemittedAmount: euros(sum(platform, (r) => cents(r.taxAmount))),
  };
}

/**
 * @param {{ ourRows: Array<object>, platformRows: Array<object>, declaration: 'all'|'todo'|'done' }} input
 *   `ourRows` already shaped by `ourStayRow`, `platformRows` by `platformStayRow`, both on the selection's logement.
 * @returns {{ stays: Array<object>, nights: Array<object>, totals: object }}
 */
function buildTouristTaxReport({ ourRows, platformRows, declaration = 'all' }) {
  const ours = ourRows.filter(keepByDeclaration(declaration)).sort(byStayOrder);
  const platform = [...platformRows].sort(byStayOrder);
  const stays = (declaration === 'all' ? [...ours, ...platform] : ours).sort(byStayOrder);
  // Rule 16 — the base columns are shown when a row of ours is taxed on a percentage of its price.
  const columns = { percentageBase: ours.some((r) => r.nightPricePerOccupantHt != null) };
  return { stays, nights: nightRegister(ours), totals: reportTotals(ours, platform), columns };
}

module.exports = {
  buildTouristTaxReport, ourStayRow, platformStayRow, nightRegister, reportTotals, distribute, declaredOnOf, DECLARATION_FILTERS,
};
