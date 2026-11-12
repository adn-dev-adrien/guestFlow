// specs/tourist-tax-report-v2.md rules 56-57 (2026-11-12, manual trial of 4.0.0) — the tax is declared per logement: the
// report carries the totals of each logement, and « Marquer {logement} déclaré » ticks that logement's declarable rows in one
// call, never a platform's stay and never another logement's.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, fiche, pay,
} = require('./moneyLedgerFixture');
const reportController = require('../controllers/touristTaxReportController');
const { propertyTotals } = require('../utils/touristTaxReport');
const { csvFileName } = require('../utils/touristTaxReportCsv');

const pad2 = (n) => String(n).padStart(2, '0');
let slot = 40;
function nextMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + slot, 1);
  slot += 1;
  const month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const after = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { month, after: `${after.getFullYear()}-${pad2(after.getMonth() + 1)}` };
}
const clockAt = (t, iso) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
};
const ok = (query) => { const res = respond(); reportController.getReport({ query }, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };
const declare = (propertyId, query) => { const res = respond(); reportController.declareProperty({ params: { propertyId }, query }, res); return res; };
const paidStay = (propertyId, startDate, endDate, extra = {}, platform = 'direct') => {
  const stay = fiche(propertyId, platform, { startDate, endDate, ...extra });
  pay(stay.id, S);
  return stay;
};

test('rule 56 — propertyTotals is reportTotals over each logement\'s own rows, in logement order', () => {
  const row = (propertyId, taxAmount, declared) => ({
    reservationId: propertyId * 10 + taxAmount, propertyId, propertyName: `P${propertyId}`, nightsCount: 2, persons: 2, taxedPersons: 2, exemptPersons: 0,
    taxedPersonNights: 4, exemptPersonNights: 0, taxAmount, declared,
  });
  const byProperty = propertyTotals(
    [row(2, 5, true), row(2, 7, false), row(1, 3, false)],
    [{ reservationId: 99, propertyId: 1, propertyName: 'P1', taxAmount: 4 }],
  );
  assert.deepEqual(byProperty.map((p) => p.propertyId), [1, 2]);
  assert.equal(byProperty[1].amount, 12);
  assert.equal(byProperty[1].declaredAmount, 5);
  assert.equal(byProperty[1].remainingAmount, 7);
  assert.equal(byProperty[1].allDeclared, false);
  assert.equal(byProperty[0].platformRemittedStaysCount, 1);
  assert.equal(byProperty[0].platformRemittedAmount, 4);
  assert.equal(byProperty[0].taxedPersonNights, 4);
});

test('rule 56 — the report carries one totals block per logement, adding up to the bar', (t) => {
  const { month, after } = nextMonth();
  paidStay(NO_ACOMPTE, `${month}-04`, `${month}-07`);
  paidStay(WITH_ACOMPTE, `${month}-10`, `${month}-12`, { adults: 3 });
  clockAt(t, `${after}-10`);
  const data = ok({ period: 'month', month });
  assert.ok(data.byProperty.length >= 2);
  const sum = data.byProperty.reduce((s, p) => s + Math.round(p.amount * 100), 0) / 100;
  assert.equal(sum, data.totals.amount);
  for (const p of data.byProperty) assert.ok(p.propertyName);
});

test('rule 57 — « Marquer {logement} déclaré » ticks that logement\'s rows only, in one call', (t) => {
  const { month, after } = nextMonth();
  const mine = paidStay(NO_ACOMPTE, `${month}-04`, `${month}-07`);
  const other = paidStay(WITH_ACOMPTE, `${month}-10`, `${month}-12`);
  clockAt(t, `${after}-10`);
  const res = declare(String(NO_ACOMPTE), { period: 'month', month });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.declaredCount, 1);
  const at = (id) => db.prepare('SELECT touristTaxDeclaredAt AS a FROM reservations WHERE id = ?').get(id).a;
  assert.ok(at(mine.id));
  assert.equal(at(other.id), null);
  const data = ok({ period: 'month', month });
  const block = data.byProperty.find((p) => p.propertyId === NO_ACOMPTE);
  assert.equal(block.allDeclared, true);
  assert.equal(declare(String(NO_ACOMPTE), { period: 'month', month }).body.declaredCount, 0, 'repeated: nothing left to tick');
});

test('rule 57 — a platform that remits the tax itself is never ticked, and an unknown logement is refused', (t) => {
  const { month, after } = nextMonth();
  const remitted = paidStay(NO_ACOMPTE, `${month}-14`, `${month}-16`, {}, PLATFORM.remitted);
  clockAt(t, `${after}-10`);
  declare(String(NO_ACOMPTE), { period: 'month', month });
  assert.equal(db.prepare('SELECT touristTaxDeclaredAt AS a FROM reservations WHERE id = ?').get(remitted.id).a, null);
  const refused = declare('99999', { period: 'month', month });
  assert.equal(refused.statusCode, 400);
});

test('rule 56 — declarableRowsCount is what « Marquer {logement} déclaré » would tick, read by the server', () => {
  const row = (propertyId, reservationId, declared, declarable) => ({
    reservationId, propertyId, propertyName: `P${propertyId}`, nightsCount: 1, persons: 1, taxedPersons: 1, exemptPersons: 0,
    taxedPersonNights: 1, exemptPersonNights: 0, taxAmount: 1, declared, declarable,
  });
  const [a, b] = propertyTotals([row(1, 1, false, true), row(1, 2, false, false), row(1, 3, true, true), row(2, 4, false, false)], []);
  assert.equal(a.declarableRowsCount, 1);
  assert.equal(b.declarableRowsCount, 0);
});

test('rule 60 — the export of one logement carries its slug in the file name', () => {
  // date-literal-ok: a file name built from the window's dates, nothing compares them with today
  const report = { window: { from: '2026-10-01', to: '2026-10-31' }, filters: { propertyId: 2 }, properties: [{ id: 2, name: 'L\'Estiva' }] };
  assert.equal(csvFileName(report, 'list'), 'taxe-de-sejour-l-estiva-2026-10-01_2026-10-31.csv');
  assert.equal(csvFileName({ ...report, filters: { propertyId: null } }, 'list'), 'taxe-de-sejour-2026-10-01_2026-10-31.csv');
});
