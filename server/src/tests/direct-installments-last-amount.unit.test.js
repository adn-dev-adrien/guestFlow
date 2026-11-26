// specs/direct-installments.md rules 53-60 — the last installment can be typed, what a closed plan does not cover is paid at
// the arrival, and a plan can be made beside an acompte already collected. The pure rules first, then the controller on an
// in-memory database, then the engine, the complement's detail and the money readers.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const plan = require('../utils/installmentPlan');
const { TODAY, createHarness, call } = require('./directInstallmentsFixtures');
const { calculateReservationQuote } = require('../utils/pricing');
const { __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');
const { splitComplementByPoste } = require('../utils/complementAllocation');
const { stayDueAtArrival, comptaCollected, remainingToPay } = require('../utils/reservationSettlement');
const financeModel = require('../models/financeModel');
const { readInstallmentSummary } = require('../utils/installmentSummary');

const NB = ' ';
const row = (number, amountCents, extra = {}) => ({ number, amountCents, paid: 0, amountEdited: 0, dueDate: '2027-01-01', ...extra });
const amountsOf = (result) => [...result.amounts.values()];

const put = (h, body) => call(h.controller.put, { params: { id: h.reservationId }, body });
const rowsOf = (h) => h.installmentsModel.listFor(h.reservationId);
const typeAmount = (h, index, amount) => put(h, { amounts: [{ id: rowsOf(h)[index].id, amount }] });

// A plan of 3 whose first two installments are pinned; typing the third closes it.
async function planOf3(h) {
  assert.equal((await put(h, { count: 3 })).status, 200);
  assert.equal((await typeAmount(h, 0, 300)).status, 200);
  assert.equal((await typeAmount(h, 1, 300)).status, 200);
}

// ── Rule 53 — every unpaid installment can be typed; no one adjusting = closed ─────────────────────
test('rule 53 — the last unpaid installment accepts a typed amount; with nothing left to adjust the plan is closed', () => {
  const rows = [row(1, 30000, { amountEdited: 1 }), row(2, 30000, { amountEdited: 1 }), row(3, 40150)];
  const checked = plan.validateAmount({ installments: rows, index: 2, amountEuros: 400, targetCents: 100150 });
  assert.equal(checked.error, undefined);
  assert.equal(checked.cents, 40000);
  assert.equal(checked.closes, true);
  assert.deepEqual(checked.others, []);
  assert.equal(plan.isClosed(rows), false, 'the third one still adjusts');
  assert.equal(plan.isClosed(rows.map((r) => ({ ...r, amountEdited: 1 }))), true);
});

test('rule 53 — typing the last unpaid while an earlier one still adjusts leaves the plan open: that one takes the rest', () => {
  const rows = [row(1, 33400), row(2, 33400), row(3, 33350)];
  const checked = plan.validateAmount({ installments: rows, index: 2, amountEuros: 500, targetCents: 100150 });
  assert.equal(checked.closes, false);
  assert.equal(checked.others.length, 2);
  assert.equal(checked.rest, 50150);
});

test('rule 53 — a closed plan in the payload: flag, the server\'s arrival rest, and the release offered on the last row only', async () => {
  const h = createHarness();
  await planOf3(h);
  const open = h.controller.planFor(h.reservationId);
  assert.equal(open.closed, false);
  assert.equal(open.arrivalRest, 0);
  const typed = await typeAmount(h, 2, 300);
  assert.equal(typed.status, 200);
  const closed = typed.body.installmentPlan;
  assert.equal(closed.closed, true);
  assert.equal(closed.arrivalRest, 101.5, '1 001,50 − 3 × 300');
  assert.deepEqual(closed.installments.map((i) => i.amountEditable), [true, true, true]);
  assert.deepEqual(closed.installments.map((i) => i.canRelease), [false, false, true]);
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [30000, 30000, 30000]);
});

// ── Rule 55 — a closed plan never holds more than the stay ─────────────────────────────────────────
test('rule 55 — a typed amount bringing the plan above the stay is refused, nothing changes', async () => {
  const h = createHarness();
  await planOf3(h);
  const refused = await typeAmount(h, 2, 600);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.message, `Échéance 3 : dépasse le séjour de 198,50${NB}€ (401,50${NB}€ au plus).`);
  assert.equal(refused.body.installmentId, rowsOf(h)[2].id);
  assert.deepEqual(rowsOf(h).map((r) => r.amountEdited), [1, 1, 0]);
  assert.equal(h.controller.planFor(h.reservationId).closed, false);
});

test('rule 55 — exactly the stay is accepted: nothing is left for the arrival', async () => {
  const h = createHarness();
  await planOf3(h);
  const typed = await typeAmount(h, 2, 401.5);
  assert.equal(typed.status, 200);
  assert.equal(typed.body.installmentPlan.closed, true);
  assert.equal(typed.body.installmentPlan.arrivalRest, 0);
});

// ── Rule 56 — a price change on a closed plan ──────────────────────────────────────────────────────
const closedRows = () => [row(1, 30000, { amountEdited: 1 }), row(2, 30000, { amountEdited: 1 }), row(3, 30000, { amountEdited: 1 })];

test('rule 56 — a rise or a drop the shortfall absorbs moves no installment (before any payment)', () => {
  for (const target of [120000, 100150, 90000]) {
    const result = plan.rebalance({ installments: closedRows(), targetCents: target });
    assert.deepEqual(amountsOf(result), [30000, 30000, 30000], `target ${target}`);
    assert.deepEqual(result.unpin, []);
    assert.equal(result.clearPins, false);
  }
});

test('rule 56 — a drop beyond the plan, before any payment, releases the last pin: that installment adjusts again (rule 7)', () => {
  const result = plan.rebalance({ installments: closedRows(), targetCents: 85000 });
  assert.deepEqual(amountsOf(result), [30000, 30000, 25000]);
  assert.deepEqual(result.unpin, [3]);
});

test('rule 56 — a drop beyond the plan leaving the last less than 1 € frees every pin (rule 32 floor)', () => {
  const result = plan.rebalance({ installments: closedRows(), targetCents: 60050 });
  assert.equal(result.clearPins, true);
  assert.equal(amountsOf(result).reduce((a, b) => a + b, 0), 60050);
  assert.ok(amountsOf(result).every((c) => c >= 100));
});

test('rule 56 — after a payment nothing moves: a rise goes to the complement, a drop beyond the plan shows the gap (rule 8)', () => {
  const frozen = () => [row(1, 30000, { paid: 1, amountEdited: 1 }), row(2, 30000, { amountEdited: 1 }), row(3, 30000, { amountEdited: 1 })];
  const rise = plan.rebalance({ installments: frozen(), targetCents: 120000 });
  assert.deepEqual(amountsOf(rise), [30000, 30000, 30000]);
  assert.equal(rise.gapCents, 0);
  const drop = plan.rebalance({ installments: frozen(), targetCents: 85000 });
  assert.deepEqual(amountsOf(drop), [30000, 30000, 30000]);
  assert.equal(drop.gapCents, 5000);
});

test('rule 56 — end to end: a save lowering the stay below a closed plan releases the last pin and stores the new amounts', async () => {
  const h = createHarness();
  await planOf3(h);
  await typeAmount(h, 2, 300);
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1200 });
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [30000, 30000, 30000], 'a rise: the complement carries it');
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 850 });
  assert.deepEqual(rowsOf(h).map((r) => [r.amountCents, r.amountEdited]), [[30000, 1], [30000, 1], [25000, 0]]);
  assert.equal(h.controller.planFor(h.reservationId).closed, false);
});

// ── Rule 57 — re-opening the plan ──────────────────────────────────────────────────────────────────
test('rule 57 — « Ajuster automatiquement » on the last unpaid row clears its pin, it takes the shortfall back', async () => {
  const h = createHarness();
  await planOf3(h);
  await typeAmount(h, 2, 300);
  const last = rowsOf(h)[2];
  const released = await put(h, { installmentId: last.id, releaseAmount: true });
  assert.equal(released.status, 200);
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [30000, 30000, 40150]);
  assert.equal(released.body.installmentPlan.closed, false);
  assert.equal(released.body.installmentPlan.arrivalRest, 0);
  assert.equal(released.body.installmentPlan.installments[2].canRelease, false);
});

test('rule 57 — only the pinned last unpaid installment can be released; an unknown or paid one is refused', async () => {
  const h = createHarness();
  await planOf3(h);
  await typeAmount(h, 2, 300);
  const [first, , last] = rowsOf(h);
  const notLast = await put(h, { installmentId: first.id, releaseAmount: true });
  assert.equal(notLast.status, 409);
  assert.equal((await put(h, { installmentId: 99999, releaseAmount: true })).status, 404);
  await call(h.controller.markPaid, { params: { id: h.reservationId, installmentId: first.id }, body: { paidDate: TODAY, method: 'cash' } });
  assert.equal((await put(h, { installmentId: first.id, releaseAmount: true })).status, 400);
  const released = await put(h, { installmentId: last.id, releaseAmount: true });
  assert.equal(released.status, 200, 'after a payment the last unpaid one still re-opens');
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [30000, 30000, 40150], 'it takes the shortfall back, spread as a rise (rule 8)');
});

test('rule 57 — changing the count clears every pin as before', async () => {
  const h = createHarness();
  await planOf3(h);
  await typeAmount(h, 2, 300);
  const resized = await put(h, { count: 4 });
  assert.equal(resized.status, 200);
  assert.equal(resized.body.installmentPlan.closed, false);
  assert.ok(rowsOf(h).every((r) => r.amountEdited === 0));
});

// ── Rules 54, 58 — the engine: the shortfall rides the arrival complement at once ──────────────────
function engineDb(rows) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]'
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservation_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL,
      amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, amountEdited INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore) VALUES (1, 'Maison', 30, 7)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  rows.forEach(([amountCents, paid, pinned], i) => db.prepare(
    'INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, amountEdited) VALUES (42, ?, ?, ?, ?, ?)',
  ).run(i + 1, `2026-1${i}-27`, amountCents, paid ? 1 : 0, pinned ? 1 : 0));
  return db;
}

const STAY = {
  propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-13', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, selectedOptions: [], customOptions: [], selectedResources: [],
  depositPaid: false, balancePaid: false, discountPercent: 0, customPrice: '', bookingDate: '2026-10-01', bookingId: 42,
};

test('rule 54 — a closed plan: the shortfall is on the arrival complement at once, before any payment, as « Reste de l’échéancier »', () => {
  const db = engineDb([[8000, false, true], [8000, false, true], [8000, false, true]]);
  const quote = calculateReservationQuote({ ...STAY, db });
  assert.equal(quote.preArrivalAmount, 300);
  assert.equal(quote.complementAmount, 60, '300 − 3 × 80');
  assert.deepEqual(quote.complementDetailLines.map((l) => [l.kind, l.label, l.amount]), [['installmentRest', 'Reste de l’échéancier', 60]]);
  assert.equal(quote.sejourNetTotal, 300, 'what the plan carries plus the rest: the stay once, not twice');
});

test('rule 54 — a plan that still adjusts keeps the complement at 0 (nothing changes for the open plan)', () => {
  const db = engineDb([[8000, false, true], [8000, false, true], [8000, false, false]]);
  const quote = calculateReservationQuote({ ...STAY, db });
  assert.equal(quote.complementAmount, 0);
});

test('rules 54, 56 — a closed plan after a payment: the rise rides the complement, the paid installment stays counted', () => {
  const db = engineDb([[8000, true, true], [8000, false, true], [8000, false, true]]);
  const quote = calculateReservationQuote({ ...STAY, db, endDate: '2027-07-14' });
  assert.equal(quote.preArrivalAmount, 400);
  assert.equal(quote.complementAmount, 160);
  assert.equal(quote.sejourNetTotal, 400);
});

test('rule 56 — a drop within the shortfall lowers the complement; a plan above the stay shows none', () => {
  const db = engineDb([[8000, false, true], [8000, false, true], [8000, false, true]]);
  assert.equal(calculateReservationQuote({ ...STAY, db, endDate: '2027-07-12' }).complementAmount, 0, '200 < 240: above the stay, no complement');
  const within = engineDb([[5000, false, true], [5000, false, true], [5000, false, true]]);
  assert.equal(calculateReservationQuote({ ...STAY, db: within, endDate: '2027-07-12' }).complementAmount, 50, '200 − 150');
});

test('rule 58 — the complement\'s detail names the rest and the lines still sum to the complement', () => {
  const detail = arrivalComplementDetailFromReservation({
    complementAmount: 70, installmentsTarget: 300, installmentsPaidAmount: 0, installmentsUnpaidAmount: 250,
    options: [{ inComplement: 1, title: 'Bois', quantity: 1, billedUnits: 1, unitPrice: 20, totalPrice: 20, optionId: 1 }], resources: [],
  });
  assert.deepEqual(detail.detail.map((l) => [l.kind, l.amount]), [['option', 20], ['installmentRest', 50]]);
  assert.equal(detail.detail.find((l) => l.kind === 'installmentRest').label, 'Reste de l’échéancier');
  assert.equal(detail.detail.reduce((s, l) => s + l.amount, 0), detail.amount);
});

test('rule 58 — the rest is capped by what the complement holds; a plan with no shortfall adds no line', () => {
  const capped = arrivalComplementDetailFromReservation({
    complementAmount: 30, installmentsTarget: 300, installmentsPaidAmount: 0, installmentsUnpaidAmount: 200, options: [], resources: [],
  });
  assert.deepEqual(capped.detail.map((l) => [l.kind, l.amount]), [['installmentRest', 30]]);
  const none = arrivalComplementDetailFromReservation({
    complementAmount: 30, installmentsTarget: 300, installmentsPaidAmount: 100, installmentsUnpaidAmount: 200, options: [], resources: [],
  });
  assert.deepEqual(none.detail.map((l) => l.kind), ['remainder']);
});

test('rule 58 — the SAS arrival step has both blocks: the unpaid installments (rule 36) and the complement with its line', () => {
  const stay = {
    complementAmount: 60, installmentsTarget: 300, installmentsPaidAmount: 0, installmentsUnpaidAmount: 240, options: [], resources: [],
  };
  assert.equal(stayDueAtArrival(stay).installments.due, 240);
  assert.deepEqual(arrivalComplementDetailFromReservation(stay).detail.map((l) => [l.label, l.amount]), [['Reste de l’échéancier', 60]]);
});

// ── Rule 59 — accounting ───────────────────────────────────────────────────────────────────────────
test('rule 59 — the rest books on the accommodation poste, like the auto-gap, the tourist tax staying out of it', () => {
  const detail = [
    { kind: 'tax', amount: 6 }, { kind: 'installmentRest', amount: 50 },
  ];
  assert.deepEqual(splitComplementByPoste(detail, 56), { accommodation: 50, options: 0, resources: 0, tax: 6 });
});

// ── Rule 60 — a plan beside an acompte already collected ───────────────────────────────────────────
const withAcompte = (h, extra = {}) => h.db.prepare(
  "UPDATE reservations SET depositAmount = 300, depositPaid = 1, depositPaidDate = '2026-10-20', balanceAmount = 701.5 WHERE id = ?",
).run(h.reservationId) && Object.assign(h.state.quote, { depositAmount: 300, ...extra });

test('rule 60 — an acompte collected does not forbid the plan: it splits what is left, the acompte untouched', async () => {
  const h = createHarness();
  withAcompte(h);
  const payload = h.controller.planFor(h.reservationId);
  assert.equal(payload.canCreate, true);
  const created = await put(h, { count: 3 });
  assert.equal(created.status, 200);
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [23400, 23400, 23350], '1 001,50 − 300 = 701,50 in 3');
  const stay = h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.depositAmount, stay.depositPaid, stay.depositPaidDate], [300, 1, '2026-10-20'], 'the acompte keeps its amount, its flag, its date');
  assert.equal(stay.installmentsTarget, 701.5);
  assert.equal(created.body.installmentPlan.total, 701.5);
  assert.deepEqual(created.body.installmentPlan.deposit, { amount: 300, paidDate: '2026-10-20', method: null });
});

test('rule 60 — cash variant: an acompte collected in the caisse interne counts the same', async () => {
  const h = createHarness();
  h.db.prepare('UPDATE reservations SET depositAmount = 200, depositPaidCash = 1 WHERE id = ?').run(h.reservationId);
  h.state.quote.depositAmount = 200;
  const created = await put(h, { count: 2 });
  assert.equal(created.status, 200);
  assert.equal(created.body.installmentPlan.total, 801.5);
  assert.equal(created.body.installmentPlan.deposit.method, 'cash');
});

test('rule 60 — the count can be changed while only the acompte is collected; the plan covers the same amount', async () => {
  const h = createHarness();
  withAcompte(h);
  await put(h, { count: 3 });
  const resized = await put(h, { count: 2 });
  assert.equal(resized.status, 200);
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [35100, 35050]);
});

test('rule 60 — a collected solde (or a full payment) still refuses: nothing left to split', async () => {
  const h = createHarness();
  withAcompte(h);
  h.db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = ?').run(h.reservationId);
  const payload = h.controller.planFor(h.reservationId);
  assert.equal(payload.canCreate, false);
  assert.match(payload.reason, /paiement est déjà enregistré/);
  assert.equal((await put(h, { count: 3 })).status, 409);
  assert.equal(rowsOf(h).length, 0);
});

test('rule 60 — removing the plan gives the solde back, the acompte untouched', async () => {
  const h = createHarness();
  withAcompte(h);
  await put(h, { count: 3 });
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 300, balanceAmount: 701.5, depositDueDate: null, balanceDueDate: '2027-05-15' };
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.equal(removal.status, 200);
  const stay = h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId);
  assert.deepEqual([stay.depositAmount, stay.depositPaid, stay.balanceAmount, stay.installmentsTarget], [300, 1, 701.5, 0]);
});

test('rule 60 — a save follows the plan target: the price change is shared out of what is left after the acompte', async () => {
  const h = createHarness();
  withAcompte(h);
  await put(h, { count: 3 });
  h.controller.syncAfterSave(h.reservationId, { preArrivalAmount: 1091.5 });
  assert.deepEqual(rowsOf(h).map((r) => r.amountCents), [26400, 26400, 26350], '791,50 in 3');
  assert.equal(h.db.prepare('SELECT installmentsTarget FROM reservations WHERE id = ?').get(h.reservationId).installmentsTarget, 791.5);
});

test('rule 60 — the closed plan beside the acompte: the arrival rest is the plan target less what it schedules', async () => {
  const h = createHarness();
  withAcompte(h);
  await put(h, { count: 2 });
  await typeAmount(h, 0, 300);
  const closed = (await typeAmount(h, 1, 300)).body.installmentPlan;
  assert.equal(closed.closed, true);
  assert.equal(closed.arrivalRest, 101.5, '701,50 − 600');
});

test('rule 60 — the engine keeps the paid acompte and replaces only the solde; a collected solde ignores the plan', () => {
  const db = engineDb([[10000, false, false], [10000, false, false]]);
  const quote = calculateReservationQuote({ ...STAY, db, depositPaid: true, depositAmount: 90 });
  assert.deepEqual([quote.depositAmount, quote.balanceAmount], [90, 0]);
  assert.equal(quote.sejourNetTotal, 300, 'the acompte once, the plan for the rest of the pre-arrival amount');
  const solde = calculateReservationQuote({ ...STAY, db, depositPaid: true, depositAmount: 90, balancePaid: true, balanceAmount: 210 });
  assert.deepEqual([solde.depositAmount, solde.balanceAmount], [90, 210]);
});

test('rule 45 with rule 60 — acompte collected + a plan: comptaCollected + remainingToPay === totalSejour', () => {
  const stay = {
    kind: 'reservation', finalPrice: 600, depositAmount: 200, depositPaid: 1, balanceAmount: 0,
    installmentsPaidAmount: 100, installmentsUnpaidAmount: 300, installmentsTarget: 400,
  };
  assert.equal(financeModel.helpers.totalSejour(stay), 600);
  assert.equal(comptaCollected(stay), 300);
  assert.equal(remainingToPay(stay), 300);
  assert.equal(comptaCollected(stay) + remainingToPay(stay), financeModel.helpers.totalSejour(stay));
  const closed = { ...stay, installmentsUnpaidAmount: 250, complementAmount: 50 };
  assert.equal(comptaCollected(closed) + remainingToPay(closed), financeModel.helpers.totalSejour(closed), 'with the rest on the complement too');
});

test('the summary the engine reads: closed only when an installment is unpaid and none adjusts', () => {
  assert.equal(readInstallmentSummary(engineDb([[8000, false, true], [8000, false, true]]), 42).closed, true);
  assert.equal(readInstallmentSummary(engineDb([[8000, false, true], [8000, false, false]]), 42).closed, false);
  assert.equal(readInstallmentSummary(engineDb([[8000, true, true], [8000, true, true]]), 42).closed, false, 'all paid is not closed');
});

// ── Review fixes of 2026-11-26 ─────────────────────────────────────────────────────────────────────
const { storedNetTotal } = require('../utils/quoteHeadline');
const { buildLedger } = require('../utils/reservationLedger');
const { buildContext } = require('../utils/emailContextBuilder');
const { __test: { withInstallmentRest } } = require('../utils/extraSale');
const { recordInstallmentPayment } = require('../utils/installmentPayment');
const { restampComplementFromEngine } = require('../utils/installmentSync');

test('rule 54 — the stored headline counts a closed plan for what it schedules: the rest rides the stored complement once', () => {
  assert.equal(storedNetTotal({
    finalPrice: 600, installmentsTarget: 600, installmentsPaidAmount: 0, installmentsUnpaidAmount: 500, complementAmount: 100,
  }), 600);
  assert.equal(storedNetTotal({
    finalPrice: 600, depositAmount: 200, depositPaid: 1, installmentsTarget: 400, installmentsPaidAmount: 100, installmentsUnpaidAmount: 250, complementAmount: 50,
  }), 600);
  assert.equal(storedNetTotal({
    finalPrice: 515, installmentsTarget: 300, installmentsPaidAmount: 172, installmentsUnpaidAmount: 343,
  }), 300, 'a plan above the stay is unchanged: the stay');
});

test('rule 58 — the e-mail path (sale detail) turns its adjustment line into « Reste de l’échéancier » and the notice lists it', () => {
  const lines = [{ kind: 'option', label: 'Bois', qty: 1, unitPrice: 20, amount: 20 }, { kind: 'remainder', label: 'Complément d’arrivée', qty: 1, unitPrice: 70, amount: 70 }];
  const row = { installmentsTarget: 300, installmentsPaidAmount: 0, installmentsUnpaidAmount: 250 };
  const out = withInstallmentRest(lines, row);
  assert.deepEqual(out.map((l) => [l.kind, l.amount]), [['option', 20], ['installmentRest', 50], ['remainder', 20]]);
  assert.equal(out.reduce((s, l) => s + l.amount, 0), 90);
  const alone = withInstallmentRest([{ kind: 'remainder', label: 'Complément d’arrivée', qty: 1, unitPrice: 50, amount: 50 }], row);
  assert.deepEqual(alone.map((l) => l.kind), ['installmentRest']);
  const input = (detail, lang) => ({
    reservation: { startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, complementAmount: 50, complementPaid: 0, finalPrice: 380, language: lang },
    client: { firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr' }, property: { name: 'Villa' }, options: [], resources: [], customOptions: [],
    settings: { companyName: 'X' }, arrivalComplementDetail: { amount: 50, paid: 0, detail },
  });
  const { vars } = buildContext(input(alone));
  assert.match(vars.complementNotice, /- Reste de l’échéancier : 50/);
});

test('rule 60 — the ledger keeps the collected acompte as a paid row beside the installments, first, with no undo', () => {
  const installmentPlan = {
    gap: 0,
    installments: [1, 2, 3].map((n) => ({ id: n, number: n, dueDate: `2027-0${n}-10`, amount: 234, status: 'upcoming', statusLabel: 'À venir', paidDate: null })),
  };
  const ledger = buildLedger({
    row: {
      id: 9, kind: 'reservation', platform: 'direct', startDate: '2027-06-14', endDate: '2027-06-17', finalPrice: 1001.5,
      depositAmount: 300, depositPaid: 1, depositPaidDate: '2026-10-20', balanceAmount: 0,
    },
    installmentPlan, today: TODAY,
  });
  const keys = ledger.rows.map((r) => r.key);
  assert.equal(keys[0], 'deposit');
  assert.ok(keys.includes('installment-1'));
  const deposit = ledger.rows[0];
  assert.equal(deposit.amount, 300);
  assert.equal(deposit.state, 'paid');
  assert.equal(deposit.action, null, 'beside a plan the acompte is not undone from here (the plan was sized on it)');
});

// Rule 57 (reading of 2026-11-26) — the rest collected with the arrival complement is never asked again.
async function closedAndCollected() {
  const h = createHarness();
  await planOf3(h);
  await typeAmount(h, 2, 300);
  h.db.prepare('UPDATE reservations SET complementPaid = 1, complementAmount = 101.5 WHERE id = ?').run(h.reservationId);
  return h;
}
const REST_COLLECTED = 'Le reste de l’échéancier a déjà été encaissé à l’arrivée.';

test('rule 57 reading — release, count change and removal are refused once the complement holding the rest is collected', async () => {
  const h = await closedAndCollected();
  const last = rowsOf(h)[2];
  const release = await put(h, { installmentId: last.id, releaseAmount: true });
  assert.equal(release.status, 409);
  assert.equal(release.body.message, REST_COLLECTED);
  const count = await put(h, { count: 4 });
  assert.equal(count.status, 409);
  assert.equal(count.body.message, REST_COLLECTED);
  const removal = await call(h.controller.remove, { params: { id: h.reservationId } });
  assert.equal(removal.status, 409);
  assert.equal(removal.body.message, REST_COLLECTED);
  assert.equal(rowsOf(h).length, 3);
  assert.deepEqual(rowsOf(h).map((r) => r.amountEdited), [1, 1, 1]);
});

test('rule 57 reading — payload: canRelease false and restCollected true in that state', async () => {
  const h = await closedAndCollected();
  const payload = h.controller.planFor(h.reservationId);
  assert.equal(payload.restCollected, true);
  assert.deepEqual(payload.installments.map((i) => i.canRelease), [false, false, false]);
});

test('rule 57 reading — a typed amount may not bring the installments above the target less the rest already collected', async () => {
  const h = await closedAndCollected();
  const refused = await typeAmount(h, 2, 301);
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /^Échéance 3 : dépasse le séjour de 1 € \(300 € au plus\)\./);
  const lowered = await typeAmount(h, 2, 250);
  assert.equal(lowered.status, 200, 'lowering is not a rule 55 matter');
});

test('rule 57 reading — a complement not collected leaves every gesture as before', async () => {
  const h = createHarness();
  await planOf3(h);
  await typeAmount(h, 2, 300);
  assert.equal(h.controller.planFor(h.reservationId).restCollected, false);
  assert.equal((await put(h, { count: 4 })).status, 200);
});

test('rule 54, 28 — a link paid at another amount with every other installment pinned: the complement is restamped', () => {
  const h = createHarness();
  h.state.quote = { preArrivalAmount: 1001.5, depositAmount: 0, balanceAmount: 0, depositDueDate: null, balanceDueDate: null };
  const [a, b, c] = h.installmentsModel.replacePlan(h.reservationId, [
    { number: 1, dueDate: '2026-11-10', amountCents: 30000 }, { number: 2, dueDate: '2026-12-10', amountCents: 30000 }, { number: 3, dueDate: '2027-01-10', amountCents: 30000 },
  ], 100150);
  h.db.prepare('UPDATE reservation_installments SET amountEdited = 1 WHERE reservationId = ? AND number IN (2, 3)').run(h.reservationId);
  h.db.prepare('UPDATE reservations SET complementAmount = 101.5 WHERE id = ?').run(h.reservationId);
  const out = recordInstallmentPayment({ db: h.db }, { installmentId: a.id, paidDate: TODAY, method: 'link', amountCents: 25000 });
  assert.equal(out.flipped, true);
  assert.deepEqual(h.installmentsModel.listFor(h.reservationId).map((r) => r.amountCents), [25000, 30000, 30000], 'nothing else moves');
  assert.ok(b && c);
  const { quoteStoredReservation } = require('../utils/storedReservationQuote');
  const quoted = quoteStoredReservation(h.db, h.db.prepare('SELECT * FROM reservations WHERE id = ?').get(h.reservationId));
  assert.equal(typeof quoted.complementAmount, 'number');
  assert.equal(h.db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(h.reservationId).complementAmount, quoted.complementAmount,
    'the stored complement is the engine\'s figure, not the 101,50 € of before the payment');
  assert.notEqual(quoted.complementAmount, 101.5);
});
