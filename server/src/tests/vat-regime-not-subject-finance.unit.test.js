// specs/vat-optional-mode.md rule 12d — the finance dashboard: each reservation's HT uses its own
// period's rate, and the payload says whether the HT figures mean anything (`showHt`): false when the
// period in force is « Sans TVA » and no reservation of the view is under VAT.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const finance = require('../models/financeModel');
const dashboard = require('../models/financeDashboardModel');

const NOT_SUBJECT = Number(db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run().lastInsertRowid);
const assignAll = (id) => db.prepare("UPDATE reservations SET vatPeriodId = ? WHERE kind != 'devis'").run(id);
const view = (params = { fiscalYear: 2027 }) => dashboard.getDashboard(params).data;

test('rule 12d: under VAT the dashboard shows its HT figures', () => {
  assert.equal(view().showHt, true);
  assert.equal(finance.getSummary({ fiscalYear: 2027 }).showHt, true);
});

test('rule 12d: no stay under VAT and « Sans TVA » in force → showHt is false everywhere it is read', () => {
  assignAll(NOT_SUBJECT);
  const data = view();
  assert.equal(data.showHt, false);
  assert.equal(dashboard.getDashboardDetail('properties', { fiscalYear: 2027 }).data.showHt, false);
  assert.equal(finance.getSummary({ fiscalYear: 2027 }).showHt, false);
});

test('rule 12d: each reservation\'s HT uses its own period: a not-subject stay carries no VAT in its HT', () => {
  const { totalSejour, htAmount } = finance.helpers;
  const reservation = db.prepare("SELECT * FROM reservations WHERE id = 104").get();
  const stay = totalSejour(reservation);
  assert.ok(htAmount(reservation, stay, 0) > htAmount(reservation, stay, 10));
  const hero = view().hero;
  assert.ok(Math.abs(hero.revenueHt - hero.revenue) < hero.revenue * 0.05, 'HT is the price minus the tourist tax only');
});

test('rule 12d: one stay under VAT brings the HT figures back, with a mixed history', () => {
  db.prepare('UPDATE reservations SET vatPeriodId = 1 WHERE id = 104').run();
  assert.equal(view().showHt, true);
  assert.equal(dashboard.getDashboardDetail('properties', { fiscalYear: 2027 }).data.showHt, true);
});

test('rule 12d: the regime in force counts too — a view of old « Sans TVA » stays alone keeps its HT while VAT is back', () => {
  db.prepare("INSERT INTO vat_periods (regime, rate, basis, effectiveFrom) VALUES ('subject', 10, 'booking', '2027-10-01')").run();
  assignAll(NOT_SUBJECT);
  assert.equal(view().showHt, true);
});
