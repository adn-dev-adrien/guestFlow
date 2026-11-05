// specs/tourist-tax-report-v2.md §3 rule 16 — the percentage form's base on the report: each row of ours carries the
// extraction's « nuit HT par occupant » and « montant du séjour HT », and the report says when a row of ours needs
// them shown. Through the real controllers, on the fixture's percentage property (Lodge) and a per-night one.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { respond, NO_ACOMPTE, S, fiche, pay } = require('./moneyLedgerFixture');
const financeController = require('../controllers/financeController');
const reportController = require('../controllers/touristTaxReportController');
const { buildTouristTaxReport, ourStayRow, platformStayRow } = require('../utils/touristTaxReport');

const LODGE = 2;
const pad2 = (n) => String(n).padStart(2, '0');
const monthAhead = (k) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + k, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
const call = (fn, query) => { const res = respond(); fn({ query }, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };

test('rule 16: a percentage row carries the base the monthly extraction shows, and the report asks for the columns', (t) => {
  const m = monthAhead(30);
  const lodge = fiche(LODGE, 'direct', { startDate: `${m}-04`, endDate: `${m}-07` });
  pay(lodge.id, S);
  const gite = fiche(NO_ACOMPTE, 'direct', { startDate: `${m}-10`, endDate: `${m}-12` });
  pay(gite.id, S);
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${monthAhead(31)}-10T12:00:00`).getTime() });

  const legacy = call(financeController.touristTax, { month: m });
  const data = call(reportController.getReport, { period: 'month', month: m });
  for (const id of [lodge.id, gite.id]) {
    const was = legacy.reservations.find((r) => r.reservationId === id);
    const now = data.stays.find((r) => r.reservationId === id);
    assert.equal(now.nightPricePerOccupantHt, was.nightPricePerOccupantHt);
    assert.equal(now.accommodationAmount, was.accommodationAmount);
  }
  assert.ok(data.stays.find((r) => r.reservationId === lodge.id).nightPricePerOccupantHt > 0);
  assert.equal(data.stays.find((r) => r.reservationId === gite.id).nightPricePerOccupantHt, null);
  assert.equal(data.columns.percentageBase, true);
  assert.equal(call(reportController.getReport, { period: 'month', month: m, propertyId: String(NO_ACOMPTE) }).columns.percentageBase, false);
});

const START = `${monthAhead(2)}-03`;

test('rule 16: no row of ours on a percentage base, no base columns; a platform row never asks for them', () => {
  const ours = ourStayRow({ reservationId: 1, startDate: START, adults: 2, nightsCount: 2, adultNights: 4, taxAmount: 4.8, nightPricePerOccupantHt: null, accommodationAmount: 300 });
  const platform = platformStayRow({ reservationId: 2, startDate: START, adults: 2, nightsCount: 2, taxAmount: 3 });
  assert.deepEqual([platform.nightPricePerOccupantHt, platform.accommodationAmount], [null, null]);
  assert.deepEqual(buildTouristTaxReport({ ourRows: [ours], platformRows: [platform] }).columns, { percentageBase: false });
  const based = ourStayRow({ reservationId: 3, startDate: START, adults: 2, nightsCount: 2, adultNights: 4, taxAmount: 4.8, nightPricePerOccupantHt: 45.426, accommodationAmount: 300 });
  assert.equal(based.nightPricePerOccupantHt, 45.43);
  // The filter decides: a percentage row filtered out takes its columns with it.
  assert.deepEqual(buildTouristTaxReport({ ourRows: [ours, based], platformRows: [], declaration: 'done' }).columns, { percentageBase: false });
  assert.deepEqual(buildTouristTaxReport({ ourRows: [ours, based], platformRows: [] }).columns, { percentageBase: true });
});
