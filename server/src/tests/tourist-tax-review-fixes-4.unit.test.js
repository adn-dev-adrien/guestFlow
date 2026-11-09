// Review fixes, round 4 (final verification, 2026-11-06), through the real controllers:
//   specs/tourist-tax-report-v2.md §3 rules 50 (D-HC21), 51 (V3R-4) and 52 (V3R-1).
// Each test owns a quarter of its own and moves the clock past it.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, fiche, pay } = require('./moneyLedgerFixture');
const reportController = require('../controllers/touristTaxReportController');
const { touristTaxReportCsv } = require('../utils/touristTaxReportCsv');
const { buildTouristTaxReport, ourStayRow } = require('../utils/touristTaxReport');

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
const report = (query) => { const res = respond(); reportController.getReport({ query }, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };
const lines = (text) => text.replace(/^﻿/, '').trim().split('\r\n');

test('rule 50 (D-HC21): a stay whose tax we put « en complément » and is frozen at 0 € is hidden, whatever the platform\'s mode', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const switched = fiche(NO_ACOMPTE, PLATFORM.reversed, { startDate: `${m}-03`, endDate: `${m}-05`, platformGrossAmount: 900 });
  const plain = fiche(WITH_ACOMPTE, PLATFORM.reversed, { startDate: `${m}-03`, endDate: `${m}-05`, platformGrossAmount: 900 });
  clockAt(t, `${q.after}-10`);
  for (const stay of [switched, plain]) pay(stay.id, { balancePaid: true, balancePaidDate: `${m}-05` });
  db.prepare('UPDATE reservations SET touristTaxTotal = 0, complementPaid = 1, complementPaidDate = ?, touristTaxInComplement = 1 WHERE id = ?').run(`${m}-05`, switched.id);
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(plain.id);

  const data = report({ period: 'month', month: m });
  assert.equal(data.stays.some((r) => r.reservationId === switched.id), false, 'collected at arrival by us: hidden');
  assert.ok(data.stays.some((r) => r.reservationId === plain.id && r.remittedBy === 'platform'), 'the platform collected: listed');
  assert.equal(data.totals.platformRemittedStaysCount, 1);
});

test('rule 51 (V3R-4): a stay stored with an iCal key reads its platform\'s display name', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const stay = fiche(NO_ACOMPTE, PLATFORM.reversed, { startDate: `${m}-03`, endDate: `${m}-05`, platformGrossAmount: 900 });
  db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel) VALUES (?, 'Flux', '', 'canal-rev', ?)").run(NO_ACOMPTE, PLATFORM.reversed);
  clockAt(t, `${q.after}-10`);
  pay(stay.id, { balancePaid: true, balancePaidDate: `${m}-05` });
  db.prepare("UPDATE reservations SET platform = 'canal-rev' WHERE id = ?").run(stay.id);

  const row = report({ period: 'month', month: m }).stays.find((r) => r.reservationId === stay.id);
  assert.ok(row, 'the stay is listed');
  assert.equal(row.platformLabel, PLATFORM.reversed);
});

test('rule 52 (V3R-1): a filtered CSV listing an added guests\' row without its stay counts the stay\'s nights on it', () => {
  const y = new Date().getFullYear() + 1;
  const day = (d) => `${y}-08-${pad2(d)}`;
  const base = { reservationId: 7, propertyName: 'Granja', reservationName: 'A', startDate: day(1), endDate: day(3), nightsCount: 2 };
  const main = ourStayRow({ ...base, adults: 2, adultNights: 4, taxAmount: 4.8, touristTaxDeclaredAt: `${day(5)} 09:00:00` });
  const added = ourStayRow({ ...base, addedGuestsRow: true, adults: 1, adultNights: 2, taxAmount: 2.4 });
  for (const declaration of ['todo', 'done', 'all']) {
    const built = buildTouristTaxReport({ ourRows: [main, added], platformRows: [], declaration });
    const [, ...rows] = lines(touristTaxReportCsv({ window: { from: day(1), to: day(31) }, filters: { declaration }, ...built }, 'list'))
      .map((l) => l.split(';'));
    const body = rows.slice(0, -1);
    const total = rows.at(-1);
    for (const col of [6, 7, 8, 9, 10, 11]) {
      assert.equal(body.reduce((s, c) => s + Number(c[col] || 0), 0), Number(total[col] || 0), `${declaration}, column ${col}`);
    }
  }
});
