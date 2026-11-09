// Review fixes of the tourist-tax report (review R1, 2026-11-06), through the real controllers:
//   specs/tourist-tax-report-v2.md §3 rules 26, 27, 28, 29, 34 and 35;
//   specs/tourist-tax-declaration-month-stay-end.md §3 rule 9 (D-HC10) — a tax frozen at 0 € leaves both pages;
//   specs/tourist-tax-declared-checkbox.md §3 rule 9 — the « Déclarée » PATCH refuses a platform's stay and a non-boolean.
// Each test owns a quarter of its own, far ahead, and moves the clock past it.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, fiche, pay } = require('./moneyLedgerFixture');
const financeController = require('../controllers/financeController');
const reportController = require('../controllers/touristTaxReportController');
const { getMonthBounds } = require('../utils/financeCalcs');

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
const call = (fn, req) => { const res = respond(); fn(req, res); return res; };
const report = (query) => call(reportController.getReport, { query });
const monthly = (month) => call(financeController.touristTax, { query: { month } });
function csv(query) {
  const res = respond();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.send = (body) => { res.body = body; return res; };
  reportController.getReportCsv({ query }, res);
  return res;
}
const tick = (id, body) => call(financeController.setTouristTaxDeclared, { params: { reservationId: id }, body });
const paidStay = (propertyId, startDate, endDate, platform = 'direct', extra = {}) => {
  const stay = fiche(propertyId, platform, { startDate, endDate, ...extra });
  pay(stay.id, S);
  return stay;
};

test('rule 27 (and C-1): a year before 1000 or a period of 9999 is refused, never a 500, on both endpoints', () => {
  const cases = [
    [{ period: 'month', month: '0050-01' }, 'Mois invalide. Format attendu: YYYY-MM.'],
    [{ period: 'month', month: '0500-01' }, 'Mois invalide. Format attendu: YYYY-MM.'],
    [{ period: 'month', month: '9999-12' }, 'Les mois futurs ne sont pas autorisés.'],
    [{ period: 'quarter', quarter: '0099-Q1' }, 'Trimestre invalide. Format attendu: YYYY-Qn.'],
    [{ period: 'quarter', quarter: '0999-Q4' }, 'Trimestre invalide. Format attendu: YYYY-Qn.'],
    [{ period: 'quarter', quarter: '9999-Q4' }, 'Les mois futurs ne sont pas autorisés.'],
    [{ period: 'year', year: '0001' }, 'Année invalide. Format attendu: YYYY.'],
    [{ period: 'year', year: '0100' }, 'Année invalide. Format attendu: YYYY.'],
    [{ period: 'year', year: '9999' }, 'Les mois futurs ne sont pas autorisés.'],
  ];
  for (const [query, error] of cases) {
    for (const res of [report(query), csv(query)]) {
      assert.equal(res.statusCode, 400, JSON.stringify(query));
      assert.deepEqual(res.body, { error }, JSON.stringify(query));
    }
  }
  // The monthly endpoint reads the same bounds: a year before 1000 is no longer a 1 900-year window.
  assert.equal(monthly('0050-01').statusCode, 400);
  assert.deepEqual(monthly('0050-01').body, { error: 'Mois invalide. Format attendu: YYYY-MM.' });
  for (const month of ['0001-01', '0099-12', '0100-01', '0999-11', '9999-12']) assert.equal(getMonthBounds(month), null, month);
  assert.deepEqual(getMonthBounds('1000-01'), { start: '1000-01-01', endExclusive: '1000-02-01' });
  assert.deepEqual(getMonthBounds('9999-11'), { start: '9999-11-01', endExclusive: '9999-12-01' });
});

test('rule 28 (D-HC13): a key sent twice, or as an object, is that key\'s 400 on both endpoints', () => {
  const q = nextQuarter();
  const [m] = q.months;
  const cases = [
    [{ period: ['month', 'year'], month: m }, 'Période inconnue.'],
    [{ month: [m, m] }, 'Mois invalide. Format attendu: YYYY-MM.'],
    [{ period: 'quarter', quarter: [q.key, q.key] }, 'Trimestre invalide. Format attendu: YYYY-Qn.'],
    [{ period: 'year', year: { a: '2026' } }, 'Année invalide. Format attendu: YYYY.'],
    [{ period: 'custom', from: [`${m}-01`, `${m}-02`], to: `${m}-10` }, 'Deux dates à choisir.'],
    [{ period: 'month', month: m, propertyId: ['3', '5'] }, 'Logement inconnu.'],
    [{ period: 'month', month: m, declaration: ['todo', 'done'] }, 'Statut de déclaration inconnu.'],
  ];
  for (const [query, error] of cases) {
    for (const res of [report(query), csv(query)]) {
      assert.equal(res.statusCode, 400, JSON.stringify(query));
      assert.deepEqual(res.body, { error }, JSON.stringify(query));
    }
  }
  const view = csv({ period: 'month', month: m, view: ['night', 'night'] });
  assert.equal(view.statusCode, 400);
  assert.deepEqual(view.body, { error: 'Vue inconnue.' });
});

test('D-HC10 (declaration-month-stay-end rule 9): a tax frozen at 0 € leaves the monthly page and the report, the other stays stay', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const frozenZero = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-05`);
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(frozenZero.id);
  const kept = paidStay(WITH_ACOMPTE, `${m}-03`, `${m}-05`);
  clockAt(t, `${q.after}-10`);

  const legacy = monthly(m).body;
  assert.equal(legacy.reservations.some((r) => r.reservationId === frozenZero.id), false);
  assert.ok(legacy.reservations.some((r) => r.reservationId === kept.id));
  const data = report({ period: 'month', month: m }).body;
  assert.equal(data.stays.some((r) => r.reservationId === frozenZero.id), false);
  assert.equal(data.totals.staysCount, 1);
  assert.equal(data.totals.amount, legacy.totals.taxAmount);
  assert.equal(report({ period: 'month', month: m, declaration: 'todo' }).body.stays.some((r) => r.reservationId === frozenZero.id), false);
});

test('rule 35 (C-4): `Direct` in any case and an empty platform are ours, never « reversée »', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const upper = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-05`);
  const empty = paidStay(WITH_ACOMPTE, `${m}-03`, `${m}-05`);
  db.prepare("UPDATE reservations SET platform = 'Direct' WHERE id = ?").run(upper.id);
  db.prepare("UPDATE reservations SET platform = '' WHERE id = ?").run(empty.id);
  clockAt(t, `${q.after}-10`);

  const data = report({ period: 'month', month: m }).body;
  for (const id of [upper.id, empty.id]) {
    const row = data.stays.find((r) => r.reservationId === id);
    assert.ok(row, `stay ${id} is listed`);
    assert.equal(row.remittedBy, 'us');
  }
  assert.equal(data.totals.platformRemittedStaysCount, 0);
  assert.equal(monthly(m).body.reservations.filter((r) => [upper.id, empty.id].includes(r.reservationId)).length, 2);
});

test('declared-checkbox rule 9: a platform\'s stay cannot be ticked, a stored tick can go, a non-boolean is refused', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const theirs = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-05`, PLATFORM.remitted);
  const ours = paidStay(WITH_ACOMPTE, `${m}-03`, `${m}-05`);
  clockAt(t, `${q.after}-10`);

  const refused = tick(theirs.id, { declared: true });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: 'La plateforme reverse elle-même cette taxe.', code: 'TOURIST_TAX_REMITTED_BY_PLATFORM' });
  assert.equal(db.prepare('SELECT touristTaxDeclaredAt AS d FROM reservations WHERE id = ?').get(theirs.id).d, null);

  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = '2020-01-01 09:00:00' WHERE id = ?").run(theirs.id); // date-literal-ok: a stored stamp nothing compares with today
  assert.equal(tick(theirs.id, { declared: false }).statusCode, 200);
  assert.equal(db.prepare('SELECT touristTaxDeclaredAt AS d FROM reservations WHERE id = ?').get(theirs.id).d, null);

  for (const body of [{ declared: 'yes' }, { declared: 1 }, {}, { declared: true, addedGuests: 'x' }]) {
    const res = tick(ours.id, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { error: 'Déclaration invalide : oui ou non attendu.' });
  }
  assert.equal(tick(ours.id, { declared: true }).statusCode, 200);
});

test('rules 29 and 34: the month read is offered; the register flags the nights outside the window', (t) => {
  const q = nextQuarter();
  const [m1, m2] = q.months;
  // Starts in m1, ends in m2: attributed to m2, two of its nights in m1.
  const crossing = paidStay(NO_ACOMPTE, `${m1}-28`, `${m2}-02`);
  clockAt(t, `${q.after}-10`);

  const data = report({ period: 'month', month: m2 }).body;
  assert.ok(data.stays.some((r) => r.reservationId === crossing.id));
  assert.ok(data.choices.months.some((c) => c.value === m2));
  assert.ok(data.choices.months.some((c) => c.value === data.choices.defaultMonth));
  const before = data.nights.filter((n) => n.date < `${m2}-01`);
  assert.ok(before.length >= 2);
  assert.ok(before.every((n) => n.outsideWindow === true));
  assert.ok(data.nights.filter((n) => n.date >= `${m2}-01`).every((n) => n.outsideWindow === false));
  assert.equal(data.columns.nightsOutsideWindow, true);
  assert.equal(report({ period: 'quarter', quarter: q.key }).body.columns.nightsOutsideWindow, false);
});
