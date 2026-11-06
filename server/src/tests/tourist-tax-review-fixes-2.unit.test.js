// Review fixes, round 2 (verification of 2026-11-06), through the real controllers:
//   specs/tourist-tax-report-v2.md §3 rules 37 and 38 (V1-1, D-HC15);
//   specs/tourist-tax-declared-checkbox.md §3 rules 9 and 10 (V1-2, V1-6).
// Each test owns a quarter of its own and moves the clock past it.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, fiche, pay } = require('./moneyLedgerFixture');
const financeController = require('../controllers/financeController');
const reportController = require('../controllers/touristTaxReportController');
const { touristTaxReportCsv } = require('../utils/touristTaxReportCsv');
const { buildTouristTaxReport, ourStayRow, platformStayRow } = require('../utils/touristTaxReport');

const pad2 = (n) => String(n).padStart(2, '0');
let quarterSlot = 1;
function nextQuarter() {
  const now = new Date();
  const d = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3 * quarterSlot, 1);
  quarterSlot += 1;
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { months: [0, 1, 2].map((i) => `${y}-${pad2((q - 1) * 3 + 1 + i)}`), after: q === 4 ? `${y + 1}-01` : `${y}-${pad2(q * 3 + 1)}` };
}
const clockAt = (t, iso) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
};
const call = (fn, req) => { const res = respond(); fn(req, res); return res; };
const report = (query) => call(reportController.getReport, { query }).body;
const tick = (id, body) => call(financeController.setTouristTaxDeclared, { params: { reservationId: id }, body });
const stampOf = (id) => db.prepare('SELECT touristTaxDeclaredAt AS d FROM reservations WHERE id = ?').get(id).d;
const paidStay = (propertyId, startDate, endDate, platform = 'direct', extra = {}) => {
  const stay = fiche(propertyId, platform, { startDate, endDate, ...extra });
  pay(stay.id, S);
  return stay;
};
const lines = (text) => text.replace(/^﻿/, '').trim().split('\r\n');

test('rule 37 (V1-1): a filtered list CSV leaves the platforms\' total empty, so every column adds up', () => {
  const y = new Date().getFullYear() + 1;
  const day = (d) => `${y}-08-${pad2(d)}`;
  const ours = ourStayRow({ reservationId: 1, propertyName: 'Granja', reservationName: 'A', startDate: day(1), endDate: day(3), adults: 2, nightsCount: 2, adultNights: 4, taxAmount: 4.8 }, { platformLabel: 'Direct' });
  const theirs = platformStayRow({ reservationId: 2, propertyName: 'Granja', reservationName: 'B', platformLabel: 'Airbnb', startDate: day(4), endDate: day(6), nightsCount: 2, adults: 2, taxAmount: 3.3 });
  for (const declaration of ['todo', 'done', 'all']) {
    const built = buildTouristTaxReport({ ourRows: [ours], platformRows: [theirs], declaration });
    const csv = touristTaxReportCsv({ window: { from: day(1), to: day(31) }, filters: { declaration }, ...built }, 'list');
    const [, ...rows] = lines(csv).map((l) => l.split(';'));
    const body = rows.slice(0, -1);
    const total = rows.at(-1);
    const money = (v) => (v === '' || v === undefined ? 0 : Math.round(Number(v.replace(',', '.')) * 100));
    assert.equal(body.reduce((s, c) => s + money(c[12]), 0), money(total[12]), declaration);
    assert.equal(body.reduce((s, c) => s + money(c[13]), 0), money(total[13]), declaration);
    assert.equal(total[13] === '', declaration !== 'all', declaration);
  }
});

test('declared-checkbox rule 9 (V1-2): a tick sent back on a platform\'s stay passes, its date unchanged', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const theirs = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-05`, PLATFORM.remitted);
  clockAt(t, `${q.after}-10`);
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = '2020-01-01 09:00:00' WHERE id = ?").run(theirs.id); // date-literal-ok: a stored stamp nothing compares with today
  const again = tick(theirs.id, { declared: true });
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(stampOf(theirs.id), '2020-01-01 09:00:00'); // date-literal-ok: the same stored stamp
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = NULL WHERE id = ?').run(theirs.id);
  assert.equal(tick(theirs.id, { declared: true }).statusCode, 400);
});

test('declared-checkbox rule 10 (V1-6): a stay frozen at 0 € cannot get a new tick; a stored one can go', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const zero = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-05`);
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(zero.id);
  const kept = paidStay(WITH_ACOMPTE, `${m}-03`, `${m}-05`);
  clockAt(t, `${q.after}-10`);

  const refused = tick(zero.id, { declared: true });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: 'Aucune taxe à déclarer pour ce séjour.', code: 'TOURIST_TAX_NOTHING_TO_DECLARE' });
  assert.equal(stampOf(zero.id), null);
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = '2020-01-01 09:00:00' WHERE id = ?").run(zero.id); // date-literal-ok: a stored stamp nothing compares with today
  assert.equal(tick(zero.id, { declared: true }).statusCode, 200);
  assert.equal(tick(zero.id, { declared: false }).statusCode, 200);
  assert.equal(stampOf(zero.id), null);
  assert.equal(tick(kept.id, { declared: true }).statusCode, 200);
});

test('rule 38 (D-HC15): a platform\'s stay frozen at 0 € is listed as the platform\'s, with its stated amount; a direct one is not', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const booking = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-06`, PLATFORM.reversed, { platformGrossAmount: 900 });
  db.prepare('UPDATE reservations SET touristTaxTotal = 0, platformTouristTaxAmount = 27.03 WHERE id = ?').run(booking.id);
  const direct = paidStay(WITH_ACOMPTE, `${m}-03`, `${m}-05`);
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(direct.id);
  const ours = paidStay(WITH_ACOMPTE, `${m}-10`, `${m}-12`);
  clockAt(t, `${q.after}-10`);

  const data = report({ period: 'month', month: m });
  const row = data.stays.find((r) => r.reservationId === booking.id);
  assert.ok(row, 'the platform stay is listed');
  assert.equal(row.remittedBy, 'platform');
  assert.equal(row.taxAmount, 27.03);
  assert.equal(row.declarable, false);
  assert.equal(data.stays.some((r) => r.reservationId === direct.id), false);
  assert.equal(data.totals.platformRemittedStaysCount, 1);
  assert.equal(data.totals.platformRemittedAmount, 27.03);
  assert.equal(data.totals.staysCount, 1);
  assert.equal(data.totals.amount, data.stays.find((r) => r.reservationId === ours.id).taxAmount);
  assert.equal(report({ period: 'month', month: m, declaration: 'todo' }).stays.some((r) => r.reservationId === booking.id), false);
  // The monthly page lists what we declare only: neither stay.
  const legacy = call(financeController.touristTax, { query: { month: m } }).body;
  assert.equal(legacy.reservations.some((r) => [booking.id, direct.id].includes(r.reservationId)), false);
  assert.equal(JSON.stringify(legacy).includes('frozenAtZero'), false);
});
