// « À vérifier » of the Suivi financier: specs/finance-data-checks.md §3 rules 1, 2, 3, 4, 5, 6, 7, 8, 9 and 10.
// Every stay lives in the future of the real calendar and the clock is moved past it, so no case depends on the
// day the suite runs (specs/server-test-isolation.md rule 6).
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, seed, createStay, save, mark, rowOf, respond } = require('./ledgerFixture');
const financeModel = require('../models/financeModel');
const dataChecks = require('../models/financeDataChecksModel');
const financeDashboardModel = require('../models/financeDashboardModel');
const controller = require('../controllers/financeDataChecksController');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { ITEM_LIMIT } = require('../utils/financeDataChecks');

seed();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, defaultCautionAmount)
  VALUES (3, 'Granja', 8, 'per_day_per_person', 1.2, 2, 20, 'per_night', 0)`).run();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, defaultCautionAmount)
  VALUES (4, 'Estiva', 8, 'per_day_per_person', 1.2, 0)`).run();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, defaultCautionAmount)
  VALUES (5, 'Sans taxe', 8, 'per_day_per_person', 0, 0)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 300), (4, 'Standard', 100), (5, 'Standard', 100)").run();
const platform = db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, ?, ?)');
platform.run('CanalRev', 1, 0);
platform.run('CanalPlat', 1, 1);
platform.run('CanalOwner', 0, 0);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (2, 'Ical', 'Booking'), (3, 'Reserved', '')").run();

const finance = financeModel.buildModel(db);

// Each stay on days of its own: two nights, 9 days apart, from 60 days ahead.
let slot = 0;
function stay(over = {}) {
  const start = 60 + slot * 9;
  slot += 1;
  return createStay({ propertyId: 3, startDate: inDays(start), endDate: inDays(start + 2), ...over });
}
const lastNight = (id) => addDaysToIsoDate(rowOf(id).endDate, -1);
const fyOf = (id) => Number(lastNight(id).slice(0, 4));
const zeroTax = (id) => db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(id);

function at(t, iso, run) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
  try { return run(); } finally { t.mock.timers.reset(); }
}
// Paid on its last night, marked the day after the stay (a payment is never dated in the future).
function paid(t, id) {
  const res = at(t, addDaysToIsoDate(rowOf(id).endDate, 1), () => mark(id, { balancePaid: true, balancePaidDate: lastNight(id) }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}
/** The panel as it reads `days` after the stay's departure, on the stay's exercise. */
function panel(t, id, { days = 1, propertyId } = {}) {
  return at(t, addDaysToIsoDate(rowOf(id).endDate, days), () => {
    const result = dataChecks.getDataChecks({ fiscalYear: fyOf(id), propertyId });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  });
}
const check = (data, key) => data.checks.find((c) => c.key === key);
const listed = (data, key, id) => check(data, key).items.some((item) => item.reservationId === id);
const nextMonthStart = (id) => {
  const [y, m] = rowOf(id).endDate.slice(0, 7).split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-15`;
};

test('rule 2: every check is in the payload, in panel order, with its severity and texts', (t) => {
  const id = stay();
  const data = panel(t, id);
  assert.deepEqual(data.checks.map((c) => [c.key, c.severity]), [
    ['tourist-tax-missing', 'fix'], ['tourist-tax-undeclared', 'fix'], ['platform-payment-missing', 'check'], ['guest-name-missing', 'check'],
  ]);
  for (const c of data.checks) {
    assert.equal(typeof c.label, 'string');
    assert.equal(typeof c.hint, 'string');
    assert.equal(c.count, c.items.length + c.moreCount);
  }
  assert.equal(data.pendingCount, data.checks.filter((c) => c.count > 0).length);
  assert.equal(data.exercise.key, fyOf(id));
});

test('rule 1: an unknown or malformed logement is the dashboard refusal, a malformed exercise falls back to the current one', (t) => {
  for (const propertyId of ['999', 'abc', '1.5']) {
    const res = respond();
    controller.getDataChecks({ query: { propertyId } }, res);
    assert.equal(res.statusCode, 400, propertyId);
    assert.deepEqual(res.body, { error: 'Logement inconnu.' });
  }
  const res = respond();
  at(t, '2031-03-10', () => controller.getDataChecks({ query: { fiscalYear: 'abc' } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.exercise.key, 2031);
  assert.equal(res.body.asOf, '2031-03-10');
});

test('rule 6: a finished stay we remit for, carrying 0 € while the logement computes a tax, is listed with that tax', (t) => {
  const id = stay();
  zeroTax(id);
  const data = panel(t, id);
  const item = check(data, 'tourist-tax-missing').items.find((i) => i.reservationId === id);
  assert.ok(item);
  assert.equal(item.detail, 'Taxe calculée : 4,80 €');
  assert.match(item.label, /Granja/);
  assert.match(item.label, /Camille Registre/);
});

test('rule 6: a stay carrying its tax is not listed', (t) => {
  const id = stay();
  assert.ok(rowOf(id).touristTaxTotal > 0);
  assert.equal(listed(panel(t, id), 'tourist-tax-missing', id), false);
});

test('rule 6: platform modes — reversed and collected at arrival are listed, a platform that remits it itself is not', (t) => {
  const reversed = stay({ platform: 'CanalRev' });
  const owner = stay({ platform: 'CanalOwner' });
  const remitted = stay({ platform: 'CanalPlat' });
  [reversed, owner, remitted].forEach(zeroTax);
  assert.equal(listed(panel(t, reversed), 'tourist-tax-missing', reversed), true);
  assert.equal(listed(panel(t, owner), 'tourist-tax-missing', owner), true);
  assert.equal(listed(panel(t, remitted), 'tourist-tax-missing', remitted), false);
});

test('rule 6: a logement whose commune levies no tax (rate 0) is not listed', (t) => {
  const id = stay({ propertyId: 5 });
  assert.equal(rowOf(id).touristTaxTotal, 0);
  assert.equal(listed(panel(t, id), 'tourist-tax-missing', id), false);
});

test('rule 6: the tax of the added guests is part of what the logement computes', async (t) => {
  const over = { propertyId: 3, platform: 'CanalRev', platformGrossAmount: 600 };
  const id = stay(over);
  assert.equal((await save(id, { ...over, adults: 3 })).statusCode, 200);
  assert.ok(rowOf(id).touristTaxAddedGuestsAmount > 0, 'the fixture adds a guest the platform did not sell');
  zeroTax(id);
  const item = check(panel(t, id), 'tourist-tax-missing').items.find((i) => i.reservationId === id);
  assert.equal(item.detail, 'Taxe calculée : 7,20 €');
});

test('rule 5: cancelled, unfinished, other logement and other exercise stays are out of every stay check', (t) => {
  const cancelled = stay({ clientId: 2, platform: 'CanalOwner' });
  zeroTax(cancelled);
  db.prepare("UPDATE reservations SET cancelledAt = datetime('now') WHERE id = ?").run(cancelled);
  const data = panel(t, cancelled);
  for (const key of ['tourist-tax-missing', 'platform-payment-missing', 'guest-name-missing']) assert.equal(listed(data, key, cancelled), false, key);

  const running = stay({ clientId: 2, platform: 'CanalOwner' });
  zeroTax(running);
  const onItsLastDay = panel(t, running, { days: 0 });
  for (const key of ['tourist-tax-missing', 'platform-payment-missing', 'guest-name-missing']) assert.equal(listed(onItsLastDay, key, running), false, `${key} on the departure day`);
  assert.equal(listed(panel(t, running), 'tourist-tax-missing', running), true, 'the day after');

  const elsewhere = panel(t, running, { propertyId: 4 });
  assert.equal(listed(elsewhere, 'tourist-tax-missing', running), false, 'another logement');
  assert.equal(elsewhere.propertyId, 4);
  assert.equal(listed(panel(t, running, { propertyId: 3 }), 'tourist-tax-missing', running), true, 'its own logement');

  const otherYear = at(t, addDaysToIsoDate(rowOf(running).endDate, 1), () => dataChecks.getDataChecks({ fiscalYear: fyOf(running) - 1 }).data);
  assert.equal(listed(otherYear, 'tourist-tax-missing', running), false, 'another exercise');
});

test('rule 8: a finished platform stay without « Montant total payé par le client » is listed; with it, or direct, it is not', (t) => {
  const missing = stay({ platform: 'CanalPlat' });
  const filled = stay({ platform: 'CanalPlat', platformGrossAmount: 500 });
  const direct = stay();
  const fromSite = stay({ platform: 'CanalPlat' });
  db.prepare("UPDATE reservations SET requestOrigin = 'public' WHERE id = ?").run(fromSite);
  const item = check(panel(t, missing), 'platform-payment-missing').items.find((i) => i.reservationId === missing);
  assert.equal(item.detail, 'Canal : CanalPlat');
  assert.equal(listed(panel(t, filled), 'platform-payment-missing', filled), false);
  assert.equal(listed(panel(t, direct), 'platform-payment-missing', direct), false);
  assert.equal(listed(panel(t, fromSite), 'platform-payment-missing', fromSite), false, 'a website request is ours');
  assert.equal(financeDashboardModel.isPlatformStay(rowOf(missing)), true, 'the dashboard reading of a platform stay');
});

test('rule 9: a finished stay still on an iCal placeholder client is listed, without the placeholder in its label', (t) => {
  const ical = stay({ clientId: 2 });
  const reserved = stay({ clientId: 3 });
  const named = stay();
  const data = panel(t, ical);
  const item = check(data, 'guest-name-missing').items.find((i) => i.reservationId === ical);
  assert.equal(item.detail, 'Client : Ical Booking');
  assert.doesNotMatch(item.label, /Ical/);
  assert.equal(listed(panel(t, reserved), 'guest-name-missing', reserved), true, 'the platform’s own words');
  assert.equal(listed(panel(t, named), 'guest-name-missing', named), false);
});

test('rule 7: a past month with a declarable row not ticked is listed with what remains, the page’s own figure', (t) => {
  const ticked = stay();
  const left = stay({ startDate: addDaysToIsoDate(rowOf(ticked).startDate, 3), endDate: addDaysToIsoDate(rowOf(ticked).startDate, 5) });
  paid(t, ticked);
  paid(t, left);
  at(t, addDaysToIsoDate(rowOf(left).endDate, 1), () => assert.equal(finance.setTouristTaxDeclared({ reservationId: ticked, declared: true }).ok, true));
  const month = lastNight(left).slice(0, 7);
  const sameMonth = month === lastNight(ticked).slice(0, 7);

  const later = nextMonthStart(left);
  const data = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(left) }).data);
  const item = check(data, 'tourist-tax-undeclared').items.find((i) => i.month === month);
  assert.ok(item, 'the month is listed');
  const page = at(t, later, () => finance.getTouristTaxExtraction({ month }).data);
  const undeclared = page.reservations.filter((r) => r.declarable && !r.touristTaxDeclaredAt);
  const remaining = Math.round(undeclared.reduce((s, r) => s + r.taxAmount, 0) * 100) / 100;
  assert.equal(item.amount, remaining, 'the same figure as the tourist-tax page');
  assert.ok(undeclared.some((r) => r.reservationId === left));
  if (sameMonth) assert.ok(!undeclared.some((r) => r.reservationId === ticked));
  assert.match(item.detail, /^Reste .+ € à déclarer · \d+ séjours?$/);
  assert.match(item.label, /^[A-ZÉÛ][a-zéû]+ \d{4}$/);

  assert.ok(check(data, 'tourist-tax-undeclared').items.every((i) => i.month < later.slice(0, 7)), 'the current month is not judged');

  const elsewhere = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(left), propertyId: 4 }).data);
  assert.equal(check(elsewhere, 'tourist-tax-undeclared').items.some((i) => i.month === month), false, 'another logement');
});

test('rule 7: an undeclared row of 0 € leaves nothing to declare: its month is not listed for it', (t) => {
  const ticked = stay();
  const zero = stay({ startDate: addDaysToIsoDate(rowOf(ticked).startDate, 3), endDate: addDaysToIsoDate(rowOf(ticked).startDate, 5) });
  paid(t, ticked);
  paid(t, zero);
  zeroTax(zero);
  at(t, addDaysToIsoDate(rowOf(zero).endDate, 1), () => assert.equal(finance.setTouristTaxDeclared({ reservationId: ticked, declared: true }).ok, true));
  const month = lastNight(zero).slice(0, 7);
  const later = nextMonthStart(zero);
  const page = at(t, later, () => finance.getTouristTaxExtraction({ month }).data.reservations);
  const row = page.find((r) => r.reservationId === zero);
  assert.ok(row && row.declarable && !row.touristTaxDeclaredAt && row.taxAmount === 0, 'the page lists it, unticked, at 0 €');
  const others = page.filter((r) => r.reservationId !== zero && r.declarable && !r.touristTaxDeclaredAt && r.taxAmount > 0);
  const data = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(zero) }).data);
  const item = check(data, 'tourist-tax-undeclared').items.find((i) => i.month === month);
  assert.equal(Boolean(item), others.length > 0);
  if (item) assert.equal(item.stays, new Set(others.map((r) => r.reservationId)).size);
  assert.equal(listed(at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(zero) }).data), 'tourist-tax-missing', zero), false, 'paid, its 0 € is frozen: not rule 6’s either (rule 19)');
});

test('rule 7: a month whose rows are all ticked, or not declarable yet, is not listed', (t) => {
  const done = stay();
  paid(t, done);
  at(t, addDaysToIsoDate(rowOf(done).endDate, 1), () => assert.equal(finance.setTouristTaxDeclared({ reservationId: done, declared: true }).ok, true));
  const unpaid = stay();
  const later = nextMonthStart(unpaid);
  const months = new Set([lastNight(done).slice(0, 7), lastNight(unpaid).slice(0, 7)]);
  const page = (month) => at(t, later, () => finance.getTouristTaxExtraction({ month }).data.reservations);
  const pending = [...months].filter((m) => page(m).some((r) => r.declarable && !r.touristTaxDeclaredAt));
  const data = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(unpaid) }).data);
  for (const m of months) {
    assert.equal(check(data, 'tourist-tax-undeclared').items.some((i) => i.month === m), pending.includes(m), m);
  }
  assert.equal(page(lastNight(unpaid).slice(0, 7)).some((r) => r.reservationId === unpaid), false, 'an unpaid stay is not on the page');
});

test('rule 7: before the first ticked stay, months are not judged', (t) => {
  const firstTicked = db.prepare("SELECT MIN(DATE(endDate, '-1 day')) AS d FROM reservations WHERE touristTaxDeclaredAt IS NOT NULL").get().d;
  const early = createStay({ propertyId: 4, startDate: inDays(5), endDate: inDays(7) });
  paid(t, early);
  assert.ok(lastNight(early) < firstTicked);
  const month = lastNight(early).slice(0, 7);
  const later = nextMonthStart(early);
  const data = at(t, later, () => dataChecks.getDataChecks({ fiscalYear: fyOf(early), propertyId: 4 }).data);
  const onPage = at(t, later, () => finance.getTouristTaxExtraction({ month }).data.reservations.some((r) => r.reservationId === early && r.declarable));
  assert.equal(onPage, true, 'the stay is declarable on the page');
  assert.ok(month < firstTicked.slice(0, 7));
  assert.equal(check(data, 'tourist-tax-undeclared').items.some((i) => i.month === month), false);
});

test('rule 4: a check lists ITEM_LIMIT items at most and tells the rest', (t) => {
  const ids = [];
  for (let i = 0; i < ITEM_LIMIT + 2; i += 1) ids.push(stay({ propertyId: 4, clientId: 2 }));
  const last = ids[ids.length - 1];
  const data = panel(t, last, { propertyId: 4 });
  const c = check(data, 'guest-name-missing');
  const inYear = ids.filter((id) => fyOf(id) === fyOf(last)).length;
  assert.equal(c.count, inYear);
  assert.equal(c.items.length, Math.min(ITEM_LIMIT, inYear));
  assert.equal(c.moreCount, Math.max(0, inYear - ITEM_LIMIT));
});

test('rule 10: the route answers the model’s payload, read-only', (t) => {
  const id = stay({ clientId: 2 });
  const before = JSON.stringify(rowOf(id));
  const res = respond();
  at(t, addDaysToIsoDate(rowOf(id).endDate, 1), () => controller.getDataChecks({ query: { fiscalYear: String(fyOf(id)), propertyId: '3' } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(listed(res.body, 'guest-name-missing', id), true);
  assert.equal(JSON.stringify(rowOf(id)), before, 'nothing written');
});
