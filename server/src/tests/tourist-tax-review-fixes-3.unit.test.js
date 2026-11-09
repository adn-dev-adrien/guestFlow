// Review fixes, round 3 (second verification, 2026-11-06), through the real controllers:
//   specs/tourist-tax-report-v2.md §3 rules 42 and 43 (V2-1, D-HC18) and rule 46 (V2-8).
// Each test owns a quarter of its own and moves the clock past it.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, fiche, pay } = require('./moneyLedgerFixture');
const financeController = require('../controllers/financeController');
const reportController = require('../controllers/touristTaxReportController');

const pad2 = (n) => String(n).padStart(2, '0');
let quarterSlot = 1;
function nextQuarter() {
  const now = new Date();
  const d = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3 * quarterSlot, 1);
  quarterSlot += 1;
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { key: `${y}-Q${q}`, months: [0, 1, 2].map((i) => `${y}-${pad2((q - 1) * 3 + 1 + i)}`), after: q === 4 ? `${y + 1}-01` : `${y}-${pad2(q * 3 + 1)}` };
}
const clockAt = (t, iso) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
};
const report = (query) => { const res = respond(); reportController.getReport({ query }, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };
const frozenAtZero = (stay, stated = null) => db.prepare('UPDATE reservations SET touristTaxTotal = 0, platformTouristTaxAmount = ? WHERE id = ?').run(stated, stay.id);

test('rule 42 (V2-1): a platform\'s stay frozen at 0 € is attached at its last night, not at the day its solde was paid', (t) => {
  const q = nextQuarter();
  const [m1, m2] = q.months;
  // Last night in m1, solde paid in m2 (the day it was paid would move it to m2).
  const stay = fiche(NO_ACOMPTE, PLATFORM.reversed, { startDate: `${m1}-25`, endDate: `${m1}-28`, platformGrossAmount: 900 });
  clockAt(t, `${q.after}-10`);
  pay(stay.id, { balancePaid: true, balancePaidDate: `${m2}-03` });
  frozenAtZero(stay, 27.03);

  const first = report({ period: 'month', month: m1 });
  const row = first.stays.find((r) => r.reservationId === stay.id);
  assert.ok(row, 'listed in the month of its last night');
  assert.deepEqual([row.remittedBy, row.taxAmount], ['platform', 27.03]);
  assert.equal(first.totals.platformRemittedAmount, 27.03);
  assert.equal(report({ period: 'month', month: m2 }).stays.some((r) => r.reservationId === stay.id), false);
  assert.ok(report({ period: 'quarter', quarter: q.key }).stays.some((r) => r.reservationId === stay.id));
  assert.equal(report({ period: 'custom', from: `${m1}-27`, to: `${m1}-27` }).stays.some((r) => r.reservationId === stay.id), true);
});

test('rule 43 (D-HC18): listed only when the platform\'s mode says it collects the tax; otherwise hidden like a direct stay', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const collects = fiche(NO_ACOMPTE, PLATFORM.reversed, { startDate: `${m}-03`, endDate: `${m}-05`, platformGrossAmount: 900 });
  const atArrival = fiche(WITH_ACOMPTE, PLATFORM.owner, { startDate: `${m}-03`, endDate: `${m}-05`, platformGrossAmount: 900 });
  clockAt(t, `${q.after}-10`);
  for (const stay of [collects, atArrival]) {
    pay(stay.id, { balancePaid: true, balancePaidDate: `${m}-05` });
    db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = ?').run(`${m}-05`, stay.id);
    frozenAtZero(stay);
  }

  const data = report({ period: 'month', month: m });
  const listed = data.stays.find((r) => r.reservationId === collects.id);
  assert.ok(listed, 'the collecting platform\'s stay is listed');
  assert.deepEqual([listed.remittedBy, listed.taxAmount], ['platform', 0]);
  assert.equal(data.stays.some((r) => r.reservationId === atArrival.id), false, 'a « collect at arrival » platform is hidden');
  assert.equal(data.totals.platformRemittedStaysCount, 1);
});

test('rule 46 (V2-8): more than 500 stays in a window are read in chunks, every one listed', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const count = 520;
  // Properties first (no availability is judged on a direct insert), then their paid stays.
  const property = db.prepare("INSERT OR IGNORE INTO properties (id, name, touristTaxMode, touristTaxPerDayPerPerson) VALUES (?, ?, 'per_day_per_person', 1.2)");
  db.transaction(() => { for (let i = 0; i < count; i += 1) property.run(1000 + i, `L${i}`); })();
  const insert = db.prepare(`INSERT INTO reservations (kind, clientId, propertyId, startDate, endDate, platform, adults, children, teens, babies,
    touristTaxRate, touristTaxTotal, totalPrice, finalPrice, balanceAmount, balancePaid, balancePaidDate)
    VALUES ('reservation', 1, ?, ?, ?, 'direct', 2, 0, 0, 0, 1.2, 4.8, 600, 600, 604.8, 1, ?)`);
  db.transaction(() => {
    for (let i = 0; i < count; i += 1) insert.run(1000 + i, `${m}-10`, `${m}-12`, `${m}-12`);
  })();
  const largest = [];
  const prepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', (sql) => {
    if (/WHERE id IN \(/.test(sql)) largest.push((sql.match(/\?/g) || []).length);
    return prepare(sql);
  });
  clockAt(t, `${q.after}-10`);

  const res = respond();
  financeController.touristTax({ query: { month: m } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reservations.length, count);
  const data = report({ period: 'month', month: m });
  assert.equal(data.totals.staysCount, count);
  assert.ok(largest.length >= 4, 'chunked reads on both paths');
  assert.ok(largest.every((n) => n <= 500), `largest IN list: ${Math.max(...largest)}`);
});
