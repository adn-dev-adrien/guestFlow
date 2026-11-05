// specs/tourist-tax-report-v2.md rule 13 — the CSV of the selection on screen: the list (one row per stay) or the
// register (one row per night), then a total line read from the report's own totals. Pure; French Excel format
// through utils/csv.js (`;`, BOM, comma decimals, formula cells neutralised).

const { serializeCsv } = require('./csv');

const VIEWS = ['list', 'night'];
const frDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

const LIST_HEADERS = [
  'Statut', 'Séjour', 'Logement', 'Canal', 'Arrivée', 'Départ', 'Nuits', 'Personnes', 'Taxées', 'Exonérées',
  'Nuitées taxées', 'Nuitées exonérées', 'Montant',
];
const NIGHT_HEADERS = ['Nuit du', 'Séjours', 'Personnes', 'Taxées', 'Exonérées', 'Montant'];

function statusOf(row) {
  if (row.remittedBy === 'platform') return 'Reversée par la plateforme';
  return row.declared ? `Déclarée le ${frDate(String(row.touristTaxDeclaredAt).slice(0, 10))}` : 'À déclarer';
}

function listCsv(report) {
  const rows = report.stays.map((row) => [
    statusOf(row),
    row.addedGuestsRow ? `${row.reservationName} (voyageurs ajoutés)` : row.reservationName,
    row.propertyName,
    row.platformLabel,
    frDate(row.startDate),
    frDate(row.endDate),
    row.nightsCount,
    row.persons,
    row.taxedPersons,
    row.exemptPersons,
    row.taxedPersonNights,
    row.exemptPersonNights,
    row.taxAmount,
  ]);
  const t = report.totals;
  rows.push(['Total à reverser', `${t.staysCount} séjour${t.staysCount > 1 ? 's' : ''}`, '', '', '', '', t.nights, t.persons,
    t.taxedPersons, t.exemptPersons, t.taxedPersonNights, t.exemptPersonNights, t.amount]);
  return serializeCsv(LIST_HEADERS, rows);
}

function nightCsv(report) {
  const rows = report.nights.map((night) => [
    frDate(night.date), night.staysCount, night.persons, night.taxedPersons, night.exemptPersons, night.taxAmount,
  ]);
  const t = report.totals;
  rows.push(['Total à reverser', t.nights, t.taxedPersonNights + t.exemptPersonNights, t.taxedPersonNights,
    t.exemptPersonNights, t.amount]);
  return serializeCsv(NIGHT_HEADERS, rows);
}

/** `taxe-de-sejour-<du>_<au>[-par-nuit].csv`, the window as the report names it. */
function csvFileName(report, view) {
  return `taxe-de-sejour-${report.window.from}_${report.window.to}${view === 'night' ? '-par-nuit' : ''}.csv`;
}

function touristTaxReportCsv(report, view = 'list') {
  return view === 'night' ? nightCsv(report) : listCsv(report);
}

module.exports = { touristTaxReportCsv, csvFileName, VIEWS, LIST_HEADERS, NIGHT_HEADERS };
