// specs/tourist-tax-report-v2.md §3 rules 13, 30 and 44 — the CSV of the tourist-tax report, pure: French Excel format, one row per
// stay or per night, the statut of each row, the total line read from the report's totals, the file's name.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { touristTaxReportCsv, csvFileName, LIST_HEADERS, NIGHT_HEADERS } = require('../utils/touristTaxReportCsv');
const { buildTouristTaxReport, ourStayRow, platformStayRow } = require('../utils/touristTaxReport');

const Y = new Date().getFullYear() + 1;
const day = (d) => `${Y}-08-${String(d).padStart(2, '0')}`;
const fr = (d) => `${String(d).padStart(2, '0')}/08/${Y}`;

const extractionRow = (over = {}) => ({
  reservationId: 1, propertyId: 1, propertyName: 'Granja', reservationName: 'Camille Registre', startDate: day(1), endDate: day(3),
  touristTaxDeclaredAt: null, declarable: true, adults: 2, children: 1, nightsCount: 2, adultNights: 4, taxAmount: 6.6,
  refundedTaxNights: 0, refundedTaxAmount: 0, ...over,
});

function sample() {
  const report = buildTouristTaxReport({
    ourRows: [
      ourStayRow(extractionRow({ touristTaxDeclaredAt: `${day(5)} 10:00:00` }), { platformLabel: 'Direct' }),
      ourStayRow(extractionRow({ reservationId: 1, addedGuestsRow: true, adults: 1, children: 0, adultNights: 2, taxAmount: 3.3 }), { platformLabel: 'Direct' }),
      ourStayRow(extractionRow({ reservationId: 2, reservationName: '=HYPERLINK("x")', startDate: day(4), endDate: day(6), taxAmount: 5 }), { platformLabel: 'Booking' }),
    ],
    platformRows: [platformStayRow({ reservationId: 3, propertyId: 1, propertyName: 'Granja', reservationName: 'Sam', platformLabel: 'Airbnb', startDate: day(2), endDate: day(3), nightsCount: 1, adults: 2, taxAmount: 3.3 })],
    declaration: 'all',
  });
  return { window: { from: day(1), to: day(31) }, ...report };
}
const lines = (text) => text.replace(/^﻿/, '').trim().split('\r\n');

test('rule 13: the list CSV, one row per stay, its statut, the total line from the totals', () => {
  const text = touristTaxReportCsv(sample(), 'list');
  assert.ok(text.startsWith('﻿'));
  const [header, ...rows] = lines(text);
  assert.equal(header, LIST_HEADERS.join(';'));
  assert.deepEqual(rows, [
    `Déclarée le ${fr(5)};Camille Registre;Granja;Direct;${fr(1)};${fr(3)};2;3;2;1;4;2;6,60;`,
    `À déclarer;Camille Registre · Complément de taxe de séjour;Granja;Direct;${fr(1)};${fr(3)};;1;1;0;2;0;3,30;`,
    `Reversée par la plateforme;Sam;Granja;Airbnb;${fr(2)};${fr(3)};;;;;;;;3,30`,
    `À déclarer;"'=HYPERLINK(""x"")";Granja;Booking;${fr(4)};${fr(6)};2;3;2;1;4;2;5;`,
    'Total à reverser;2 séjours;;;;;4;7;5;2;10;4;14,90;3,30',
  ]);
});

test('rule 13: the register CSV, one row per night, and its total line', () => {
  const [header, ...rows] = lines(touristTaxReportCsv(sample(), 'night'));
  assert.equal(header, NIGHT_HEADERS.join(';'));
  assert.deepEqual(rows, [
    `${fr(1)};1;4;3;1;4,95`,
    `${fr(2)};1;4;3;1;4,95`,
    `${fr(4)};1;3;2;1;2,50`,
    `${fr(5)};1;3;2;1;2,50`,
    'Total à reverser;4;14;10;4;14,90',
  ]);
});

test('rule 13: the file is named after the window and the view', () => {
  assert.equal(csvFileName(sample(), 'list'), `taxe-de-sejour-${day(1)}_${day(31)}.csv`);
  assert.equal(csvFileName(sample(), 'night'), `taxe-de-sejour-${day(1)}_${day(31)}-par-nuit.csv`);
});

test('rule 30: the « Montant » column adds up to the total line, the platforms\' amount apart', () => {
  const [, ...rows] = lines(touristTaxReportCsv(sample(), 'list'));
  const cells = rows.map((r) => r.split(';'));
  const money = (v) => (v === '' ? 0 : Math.round(Number(v.replace(',', '.')) * 100));
  const body = cells.slice(0, -1);
  const total = cells.at(-1);
  assert.equal(body.reduce((s, c) => s + money(c[12]), 0), money(total[12]));
  assert.equal(body.reduce((s, c) => s + money(c[13]), 0), money(total[13]));
});

test('rule 30: a tick is dated in the server\'s day, not in UTC', () => {
  const report = buildTouristTaxReport({
    ourRows: [ourStayRow(extractionRow({ touristTaxDeclaredAt: `${Y}-07-31 22:30:00` }), { platformLabel: 'Direct' })],
    platformRows: [],
  });
  assert.equal(report.stays[0].touristTaxDeclaredOn, `${Y}-08-01`);
  assert.match(lines(touristTaxReportCsv({ window: { from: day(1), to: day(31) }, ...report }, 'list'))[1], new RegExp(`^Déclarée le 01/08/${Y};`));
});

test('rule 30: a window cut at the current month names its file after the last day it covers', () => {
  const report = { ...sample(), window: { from: `${Y}-01-01`, to: `${Y}-12-31`, coveredTo: `${Y}-11-30`, futureExcluded: true } };
  assert.equal(csvFileName(report, 'list'), `taxe-de-sejour-${Y}-01-01_${Y}-11-30.csv`);
  assert.equal(csvFileName(report, 'night'), `taxe-de-sejour-${Y}-01-01_${Y}-11-30-par-nuit.csv`);
});

test('rule 44: under « Toutes » every count column adds up over the rows to the total line, added guests\' nights counted once', () => {
  const [, ...rows] = lines(touristTaxReportCsv(sample(), 'list'));
  const cells = rows.map((r) => r.split(';'));
  const body = cells.slice(0, -1);
  const total = cells.at(-1);
  for (const col of [6, 7, 8, 9, 10, 11]) {
    assert.equal(body.reduce((s, c) => s + Number(c[col] || 0), 0), Number(total[col]), `column ${col}`);
  }
});
