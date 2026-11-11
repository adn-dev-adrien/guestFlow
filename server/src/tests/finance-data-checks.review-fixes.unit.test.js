// Review fixes of « À vérifier » (2026-11-06): specs/finance-data-checks.md §3 rules 18, 19, 20 and 21.
//   R4-1 / D-HC10 — a tax frozen at 0 € is never listed as missing, whatever the platform's mode became;
//   R4-5 / D-HC13 — a month's « reste » is the tax page's figure, the part not declarable yet named;
//   R4-8 — a placeholder client with no name at all reads « Client sans nom »;
//   R6-11 — one read of the declaration rows per request, split by month, equal to the monthly extraction.
// Every stay lives in the future of the real calendar and the clock is moved past it.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, seed, createStay, save, mark, rowOf, ADMIN, respond } = require('./ledgerFixture');
const financeModel = require('../models/financeModel');
const dataChecks = require('../models/financeDataChecksModel');
const touristTaxReport = require('../models/touristTaxReportModel');
const installmentsController = require('../controllers/installmentsController');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const shape = require('../utils/financeDataChecks');
const { todayIso } = require('../utils/localDate');

const TODAY = todayIso();
seed();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, defaultCautionAmount)
  VALUES (3, 'Granja', 8, 'per_day_per_person', 1.2, 2, 20, 'per_night', 0)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 300)").run();
const platform = db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, ?, ?)');
platform.run('CanalPlat', 1, 1);
platform.run('CanalRev', 1, 0);
platform.run('CanalOwner', 0, 0);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (2, '', '')").run();

const finance = financeModel.buildModel(db);
const reports = touristTaxReport.buildModel(db);

const monthAfter = (iso) => {
  const [y, m] = iso.slice(0, 7).split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-15`;
};
// The first day of the first month that starts at least `days` ahead: a placement that never depends on the day of the
// month the suite runs (audit R27-S1: `inDays(40 + slot * 9)` split « the same month » on 155 days a year).
function firstOfMonthFrom(days) {
  const day = inDays(days);
  return day.endsWith('-01') ? day : `${monthAfter(day).slice(0, 7)}-01`;
}
// A test that needs stays sharing one month takes the first month at least 40 days ahead (`ownMonth`), alone in it. The
// other stays: two nights, 9 days apart, from the first of the month after it — a few consecutive months.
const OWN_MONTH = firstOfMonthFrom(40);
const SLOTS_FROM = `${monthAfter(OWN_MONTH).slice(0, 7)}-01`;
let slot = 0;
function stay(over = {}) {
  const start = addDaysToIsoDate(SLOTS_FROM, slot * 9);
  slot += 1;
  return createStay({ propertyId: 3, startDate: start, endDate: addDaysToIsoDate(start, 2), ...over });
}
const ownMonth = () => OWN_MONTH;
const lastNight = (id) => addDaysToIsoDate(rowOf(id).endDate, -1);
const fyOf = (id) => Number(lastNight(id).slice(0, 4));
function at(t, iso, run) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
  try { return run(); } finally { t.mock.timers.reset(); }
}
async function atAsync(t, iso, run) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
  try { return await run(); } finally { t.mock.timers.reset(); }
}
const dayAfter = (id) => addDaysToIsoDate(rowOf(id).endDate, 1);
const check = (data, key) => data.checks.find((c) => c.key === key);
const listed = (data, key, id) => check(data, key).items.some((i) => i.reservationId === id);
const tick = (t, id) => at(t, dayAfter(id), () => assert.equal(finance.setTouristTaxDeclared({ reservationId: id, declared: true }).ok, true));

test('rule 19: a 0 € tax frozen under a platform that remitted it is never listed, after the platform turns to reversing it', (t) => {
  const id = stay({ platform: 'CanalPlat' });
  mark(id, { balancePaid: true, balancePaidDate: TODAY });
  assert.equal(rowOf(id).touristTaxTotal, 0, 'the platform remitted it: 0 € stored');
  assert.equal(isTouristTaxFrozen(db, rowOf(id)), true, 'paid: the 0 € is frozen');
  db.prepare("UPDATE platforms SET touristTaxRemittedByPlatform = 0 WHERE name = 'CanalPlat'").run();
  try {
    const data = at(t, dayAfter(id), () => dataChecks.getDataChecks({ fiscalYear: fyOf(id) }).data);
    assert.equal(listed(data, 'tourist-tax-missing', id), false);
  } finally {
    db.prepare("UPDATE platforms SET touristTaxRemittedByPlatform = 1 WHERE name = 'CanalPlat'").run();
  }
});

test('rule 19: the same stay not frozen yet (unpaid) is still judged', (t) => {
  const id = stay({ platform: 'CanalOwner' });
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(id);
  assert.equal(isTouristTaxFrozen(db, rowOf(id)), false);
  const data = at(t, dayAfter(id), () => dataChecks.getDataChecks({ fiscalYear: fyOf(id) }).data);
  assert.equal(listed(data, 'tourist-tax-missing', id), true);
});

test('rule 21: a placeholder client with no name at all reads « Client sans nom »', (t) => {
  assert.equal(shape.placeholderClientDetail({ firstName: '', lastName: '' }), 'Client sans nom');
  assert.equal(shape.placeholderClientDetail({ firstName: null, lastName: '  ' }), 'Client sans nom');
  assert.equal(shape.placeholderClientDetail({ firstName: 'Ical', lastName: 'Booking' }), 'Client : Ical Booking');
  const id = stay({ clientId: 2 });
  const data = at(t, dayAfter(id), () => dataChecks.getDataChecks({ fiscalYear: fyOf(id) }).data);
  const item = check(data, 'guest-name-missing').items.find((i) => i.reservationId === id);
  assert.equal(item.detail, 'Client sans nom');
});

test('rule 20: « reste » is the tax page’s figure; the part a plan not fully paid holds is named « pas encore déclarables »', async (t) => {
  const first = ownMonth();
  const ticked = stay({ startDate: first, endDate: addDaysToIsoDate(first, 2) });
  mark(ticked, { balancePaid: true, balancePaidDate: TODAY });
  const paid = stay({ startDate: addDaysToIsoDate(rowOf(ticked).startDate, 3), endDate: addDaysToIsoDate(rowOf(ticked).startDate, 5) });
  mark(paid, { balancePaid: true, balancePaidDate: TODAY });
  const planned = stay({ startDate: addDaysToIsoDate(rowOf(ticked).startDate, 6), endDate: addDaysToIsoDate(rowOf(ticked).startDate, 8) });
  const res = respond();
  await installmentsController.put({ params: { id: planned }, body: { count: 2 }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  tick(t, ticked);
  const month = lastNight(planned).slice(0, 7);
  assert.equal(lastNight(ticked).slice(0, 7), month, 'the three stays share a month');
  const later = monthAfter(month);

  const page = at(t, later, () => reports.getReport({ period: 'month', month, propertyId: '3' }));
  assert.equal(page.ok, true, JSON.stringify(page));
  const data = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(planned), propertyId: '3' }).data);
  const item = check(data, 'tourist-tax-undeclared').items.find((i) => i.month === month);
  assert.ok(item);
  assert.equal(item.amount, page.data.totals.remainingAmount, 'one figure: the tax page’s « reste »');
  const planRow = page.data.stays.find((r) => r.reservationId === planned && r.remittedBy === 'us');
  assert.equal(planRow.declarable, false);
  assert.equal(item.notDeclarableAmount, planRow.taxAmount);
  assert.equal(item.stays, 2);
  assert.match(item.detail, /^Reste .+ € à déclarer · 2 séjours · dont .+ € pas encore déclarables$/);
});

test('rule 18: one read of the declaration rows per request, never the monthly extraction', async (t) => {
  const counting = { ...finance, rowsCalls: 0, extractionCalls: 0 };
  counting.getTouristTaxRows = (span) => { counting.rowsCalls += 1; return finance.getTouristTaxRows(span); };
  counting.getTouristTaxExtraction = (q) => { counting.extractionCalls += 1; return finance.getTouristTaxExtraction(q); };
  const model = dataChecks.create(db, counting);
  const last = stay();
  mark(last, { balancePaid: true, balancePaidDate: TODAY });
  const result = at(t, `${Number(lastNight(last).slice(0, 4)) + 1}-${lastNight(last).slice(5, 7)}-15`, () => model.getDataChecks({ fiscalYear: fyOf(last) }));
  assert.equal(result.ok, true);
  assert.equal(counting.rowsCalls, 1);
  assert.equal(counting.extractionCalls, 0);
});

test('rule 18: every month item equals the monthly extraction of that month (amount and stays), on every branch', async (t) => {
  // Branches of the attachment day: tax on the solde, tax collected on arrival, a plan, a row of added guests.
  const solde = stay();
  mark(solde, { balancePaid: true, balancePaidDate: TODAY });
  const arrival = stay({ platform: 'CanalOwner' });
  mark(arrival, { balancePaid: true, balancePaidDate: TODAY });
  mark(arrival, { complementPaid: true, complementPaidDate: TODAY });
  const planned = stay();
  const res = respond();
  await installmentsController.put({ params: { id: planned }, body: { count: 2 }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const over = { propertyId: 3, platform: 'CanalRev', platformGrossAmount: 600 };
  const added = stay(over);
  assert.equal((await save(added, { ...over, adults: 3 })).statusCode, 200);
  mark(added, { balancePaid: true, balancePaidDate: TODAY });
  mark(added, { complementPaid: true, complementPaidDate: TODAY });
  tick(t, added);
  mark(added, { complementPaid: false });
  assert.equal((await save(added, { ...over, adults: 4, balancePaid: true, balancePaidDate: TODAY })).statusCode, 200);
  // Collected again after the tick: the addition grown above the stamp gets a row of its own, a month later.
  const recollect = monthAfter(rowOf(added).endDate).slice(0, 7) + '-02';
  at(t, recollect, () => mark(added, { complementPaid: true, complementPaidDate: recollect }));

  const ids = [solde, arrival, planned, added];
  const firstMonth = lastNight(solde).slice(0, 7);
  const lastMonth = recollect.slice(0, 7);
  const later = monthAfter(`${lastMonth}-01`);
  const fys = [...new Set([firstMonth, lastMonth].map((m) => Number(m.slice(0, 4))))];
  const checked = new Set();
  for (const fy of fys) {
    const data = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fy }).data);
    for (const item of check(data, 'tourist-tax-undeclared').items) {
      const monthly = at(t, later, () => finance.getTouristTaxExtraction({ month: item.month }).data.reservations);
      const open = monthly.filter((r) => !r.touristTaxDeclaredAt);
      const remaining = Math.round(open.reduce((s, r) => s + Math.round(r.taxAmount * 100), 0)) / 100;
      assert.equal(item.amount, remaining, item.month);
      assert.equal(item.stays, new Set(open.filter((r) => r.taxAmount > 0).map((r) => r.reservationId)).size, item.month);
      checked.add(item.month);
    }
  }
  // Spec rule 20: a month is listed when what is left to declare in it is above 0. A ticked row alone in its month leaves
  // nothing there (audit R27-S1): every month holding an unticked row above 0 is listed, whatever the calendar day, from
  // the month of the first ticked stay on (rule 7).
  const firstTicked = db.prepare("SELECT MIN(DATE(endDate, '-1 day')) AS d FROM reservations WHERE touristTaxDeclaredAt IS NOT NULL").get().d.slice(0, 7);
  for (const id of ids) {
    const rows = at(t, later, () => finance.getTouristTaxRows({ start: `${firstMonth}-01`, endExclusive: `${later.slice(0, 7)}-01` }))
      .filter((r) => r.reservationId === id);
    assert.ok(rows.length > 0, `stay ${id} is on the page`);
    for (const row of rows.filter((r) => !r.touristTaxDeclaredAt && r.taxAmount > 0 && r.declarationDay.slice(0, 7) >= firstTicked)) {
      assert.ok(checked.has(row.declarationDay.slice(0, 7)), `stay ${id} month ${row.declarationDay} judged`);
    }
  }
  const own = at(t, later, () => finance.getTouristTaxRows({ start: `${lastMonth}-01`, endExclusive: `${later.slice(0, 7)}-01` }))
    .find((r) => r.reservationId === added && r.addedGuestsRow);
  assert.ok(own, 'the added guests have a row of their own');
  assert.equal(own.declarationDay, recollect);
});

test('rule 18: a row’s attachment day lies in the window it was read for, month by month', (t) => {
  const first = db.prepare("SELECT MIN(endDate) AS d FROM reservations WHERE kind = 'reservation'").get().d;
  const lastDay = db.prepare("SELECT MAX(endDate) AS d FROM reservations WHERE kind = 'reservation'").get().d;
  let month = addDaysToIsoDate(first, -1).slice(0, 7);
  const stop = monthAfter(monthAfter(lastDay)).slice(0, 7);
  let seen = 0;
  while (month <= stop) {
    const end = `${monthAfter(`${month}-01`).slice(0, 7)}-01`;
    const rows = at(t, `${stop}-15`, () => finance.getTouristTaxRows({ start: `${month}-01`, endExclusive: end }));
    for (const row of rows) {
      assert.ok(row.declarationDay >= `${month}-01` && row.declarationDay < end, `${row.reservationId} ${row.declarationDay} in ${month}`);
      seen += 1;
    }
    month = end.slice(0, 7);
  }
  assert.ok(seen > 0);
});
