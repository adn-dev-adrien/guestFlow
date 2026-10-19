// specs/collect-stay-payment-at-check-in.md §3.3 rule 26 — the single arrival payment (« Encaisser en
// une fois ») and the SAS stay payment share one bucket capture. When the acompte captured its per-line
// split and the solde's capture fails (stored amounts that drifted from today's engine), the solde gets
// the stored-amount split: leaving it NULL booked the whole solde on 46710000 — no revenue, no VAT
// (production stay 22224, June 2026). And whatever happens to the split, the payment is recorded.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const reservationsModel = require('../models/reservationsModel');
const { create: createAccountingModel } = require('../models/accountingModel');
const { create: createAccountingController } = require('../controllers/accountingController');
const { captureBucketSplit } = require('../utils/forceItemContribsCapture');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
const ADMIN = { role: 'admin' };
const TAX_ACCOUNT = '46710000';

function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// 100 € a night, acompte 30 %, tourist tax 1,20 € per adult and night.
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
    depositPercent, defaultCautionAmount, balanceDaysBefore)
  VALUES (1, 'Gîte', 8, 'per_day_per_person', 1.2, 1, 30, 0, 30)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Registre')").run();

let slot = 0;
function createStay() {
  const start = new Date(Date.UTC(2027, 6, 5 + 7 * slot));
  slot += 1;
  const end = new Date(start.getTime() + 3 * 86400000);
  const res = respond();
  controller.create({
    body: {
      propertyId: 1, clientId: 1, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
      checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
      adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
      depositDisabled: 0, options: [], selectedOptions: [], customPrice: '', discountPercent: 0,
      depositAmountOverride: '',
    },
    user: ADMIN,
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return Number(res.body.id);
}

const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

/** Acompte marked from the fiche (its split captured), then the stored solde drifts from the engine. */
function driftedStayWithCapturedAcompte() {
  const id = createStay();
  const res = respond();
  controller.updatePayment({ params: { id: String(id) }, body: { depositPaid: true, depositPaidDate: TODAY }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(rowOf(id).accommodationAcompteContribTtc > 0, 'the acompte captured its split');
  db.prepare('UPDATE reservations SET balanceAmount = round(balanceAmount + 30, 2), finalPrice = round(finalPrice + 30, 2), clientGrossAmount = NULL WHERE id = ?').run(id);
  return id;
}

function exportMonth(day) {
  let json = null;
  const res = { setHeader() {}, status() { return res; }, json(b) { json = b; return res; } };
  createAccountingController(createAccountingModel(db))
    .salesJson({ query: { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) } }, res);
  return json;
}

function assertSoundJournal(id) {
  const month = exportMonth(TODAY);
  assert.equal(month.totals.allBalanced, true);
  const balance = month.entries.find((e) => e.reservationId === id && e.kind === 'balance');
  assert.ok(balance, 'the solde is in the journal');
  const credits = balance.lines.filter((l) => Number(l.credit) > 0);
  assert.ok(credits.some((l) => /^706/.test(l.compte)), `revenue credited: ${JSON.stringify(balance.lines)}`);
  assert.ok(credits.some((l) => l.compte === '44571100'), 'VAT credited');
  for (const entry of month.entries.filter((e) => e.direction === 'sale' && e.kind !== 'tip')) {
    const entryCredits = entry.lines.filter((l) => Number(l.credit) > 0);
    if (entryCredits.length === 0) continue;
    assert.ok(entryCredits.some((l) => l.compte !== TAX_ACCOUNT), `entry ${entry.reservationId}/${entry.kind} credits only ${TAX_ACCOUNT}`);
  }
}

test('« Encaisser en une fois » on drifted amounts: the solde gets the stored-amount split, the journal stays sound', () => {
  const id = driftedStayWithCapturedAcompte();
  // A complement too, so the solde and it form one payment that can then be adjusted.
  db.prepare('UPDATE reservations SET complementAmount = 24 WHERE id = ?').run(id);
  const res = respond();
  controller.settleArrivalPayment({ params: { id: String(id) }, body: { mode: 'card', date: TODAY }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(id);
  assert.equal(row.balancePaid, 1);
  assert.ok(row.accommodationSoldeContribTtc > 0);
  assert.equal(row.touristTaxSoldeContribTtc, row.touristTaxTotal);
  assertSoundJournal(id);

  // …and its adjustment (a réduction accordée) keeps the journal sound.
  const adjust = respond();
  controller.settleArrivalPayment({ params: { id: String(id) }, body: { mode: 'adjust', total: row.balanceAmount + 24 - 20 }, user: ADMIN }, adjust);
  assert.equal(adjust.statusCode, 200, JSON.stringify(adjust.body));
  assertSoundJournal(id);
});

test('the SAS stay payment on drifted amounts: the stored-amount split, never all on 46710000', () => {
  const id = driftedStayWithCapturedAcompte();
  reservationsModel.commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });
  const row = rowOf(id);
  assert.equal(row.balancePaid, 1);
  assert.ok(row.accommodationSoldeContribTtc > 0);
  assertSoundJournal(id);
});

test('a stay with no contrib anywhere keeps the stored-money path: the drifted solde is left without a split', () => {
  const id = createStay();
  db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(TODAY, id);
  db.prepare('UPDATE reservations SET balanceAmount = round(balanceAmount + 30, 2), finalPrice = round(finalPrice + 30, 2) WHERE id = ?').run(id);
  reservationsModel.commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });
  const row = rowOf(id);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.accommodationSoldeContribTtc, null);
  assert.equal(row.accommodationAcompteContribTtc, null);
  const month = exportMonth(TODAY);
  assert.equal(month.totals.allBalanced, true);
  assert.ok(month.entries.some((e) => e.reservationId === id && e.kind === 'deposit'), 'the acompte entry is still booked');
});

test('every attempt failing still records the payment, with nothing half-written', () => {
  const id = driftedStayWithCapturedAcompte();
  db.exec(`CREATE TRIGGER no_solde_split BEFORE UPDATE OF accommodationSoldeContribTtc ON reservations
    BEGIN SELECT RAISE(ABORT, 'split refused'); END`);
  try {
    const res = respond();
    controller.settleArrivalPayment({ params: { id: String(id) }, body: { mode: 'card', date: TODAY }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  } finally {
    db.exec('DROP TRIGGER no_solde_split');
  }
  const row = rowOf(id);
  assert.equal(row.balancePaid, 1, 'the money is recorded');
  assert.equal(row.balancePaidDate, TODAY);
  assert.equal(row.accommodationSoldeContribTtc, null);
  assert.ok(row.accommodationAcompteContribTtc > 0, 'the acompte split is untouched');
});

test('the shared capture never throws: with no possible split it logs and returns « none »', () => {
  const logged = [];
  const outcome = captureBucketSplit({ db, reservation: null, bucket: 'balance', log: { error: (m) => logged.push(m) } });
  assert.equal(outcome, 'none');
  assert.equal(logged.length, 1);
});
