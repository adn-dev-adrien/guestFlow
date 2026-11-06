// specs/tourist-tax-report-v2.md rule 13 — the CSV of the selection on screen: the list (one row per stay) or the
// register (one row per night), then a total line read from the report's own totals. Pure; French Excel format
// through utils/csv.js (`;`, BOM, comma decimals, formula cells neutralised).

const { serializeCsv } = require('./csv');

const VIEWS = ['list', 'night'];
const frDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// Rule 30 — « Montant » holds only what we remit, so the column adds up to the total line; a platform's amount has
// a column of its own.
const LIST_HEADERS = [
  'Statut', 'Séjour', 'Logement', 'Canal', 'Arrivée', 'Départ', 'Nuits', 'Personnes', 'Taxées', 'Exonérées',
  'Nuitées taxées', 'Nuitées exonérées', 'Montant', 'Reversé par la plateforme',
];
// Rule 30 — the added guests' row reads as on the page.
const ADDED_GUESTS_SUFFIX = ' · Complément de taxe de séjour';
const NIGHT_HEADERS = ['Nuit du', 'Séjours', 'Personnes', 'Taxées', 'Exonérées', 'Montant'];

function statusOf(row) {
  if (row.remittedBy === 'platform') return 'Reversée par la plateforme';
  return row.declared ? `Déclarée le ${frDate(row.touristTaxDeclaredOn || String(row.touristTaxDeclaredAt).slice(0, 10))}` : 'À déclarer';
}

const listsPlatforms = (report) => ((report.filters && report.filters.declaration) || 'all') === 'all';

function listCsv(report) {
  const rows = report.stays.map((row) => [
    statusOf(row),
    row.addedGuestsRow ? `${row.reservationName}${ADDED_GUESTS_SUFFIX}` : row.reservationName,
    row.propertyName,
    row.platformLabel,
    frDate(row.startDate),
    frDate(row.endDate),
    // Rule 44 (review V2-6) — a platform's row is told for information: its counts stay empty, so every column of
    // the file adds up to the « Total à reverser » line, which counts only ours.
    // A row of added guests is the same stay and the same nights: its « Nuits » stays empty, the stay counts them once.
    ...(row.remittedBy === 'platform' ? [null, null, null, null, null, null] : [
      row.addedGuestsRow ? null : row.nightsCount,
      row.persons,
      row.taxedPersons,
      row.exemptPersons,
      row.taxedPersonNights,
      row.exemptPersonNights,
    ]),
    row.remittedBy === 'platform' ? null : row.taxAmount,
    row.remittedBy === 'platform' ? row.taxAmount : null,
  ]);
  const t = report.totals;
  rows.push(['Total à reverser', `${t.staysCount} séjour${t.staysCount > 1 ? 's' : ''}`, '', '', '', '', t.nights, t.persons,
    t.taxedPersons, t.exemptPersons, t.taxedPersonNights, t.exemptPersonNights, t.amount,
    // Rule 37 (review V1-1) — the platforms' total only where their rows are listed (« Toutes »), so the column
    // adds up over the rows of the file; the bar keeps its own figure (rule 11).
    listsPlatforms(report) && t.platformRemittedStaysCount ? t.platformRemittedAmount : null]);
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

/** `taxe-de-sejour-<du>_<au>[-par-nuit].csv`: the days the file covers, so a window cut at the current month ends there (rule 30). */
function csvFileName(report, view) {
  const to = report.window.coveredTo || report.window.to;
  return `taxe-de-sejour-${report.window.from}_${to}${view === 'night' ? '-par-nuit' : ''}.csv`;
}

function touristTaxReportCsv(report, view = 'list') {
  return view === 'night' ? nightCsv(report) : listCsv(report);
}

module.exports = { touristTaxReportCsv, csvFileName, VIEWS, LIST_HEADERS, NIGHT_HEADERS, ADDED_GUESTS_SUFFIX };
