// specs/deposit-blocks-the-dates.md rule 19 (D23, Adrien 2026-11-09; audits R33-M-M1 = R33-DB-M1, R33-DB-L1, R33-M-L1),
// specs/payment-schedule-and-cancellation.md rule 56 and rule 5 (amended 2026-11-09).
// A devis with an acompte for a stay 31 to `30 + validity` days out had its solde due BEFORE its acompte (the acompte
// is due on the validity date, the solde on start − 30), and the conversion copied both onto the reservation: the
// dashboard asked for the solde, then offered to cancel, before the acompte the guest was promised fell due.
// Such a devis now carries NO acompte and owes ONE full payment due on its validity date — one condition in the
// engine (start − balanceDaysBefore <= validUntil). The devis, its live quote (new or saved), its read, its PDF, its
// e-mail tokens, its payment-link quote, the site's public quote, its conversion (both ways) and the dashboard
// deadlines read the same schedule; payment-schedule rule 47 for reservations is unchanged.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const { computeValidUntil, readQuoteValidityDays } = require('../utils/devisValidity');
const { owesSinglePaymentByValidity } = require('../utils/paymentSchedule');
const { buildPaymentDeadlineRow } = require('../utils/paymentDeadlines');
const { buildContext } = require('../utils/emailContextBuilder');
const devisPdf = require('../utils/devisPdf');
const { labels } = require('../utils/devisPdfLabels');
const directQuote = require('../utils/directQuote');
const { resolvePublicPaymentMode } = require('../utils/publicPaymentMode');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const { db, inDays, respond, ADMIN } = f;
const TODAY = todayIso();
f.seed();

const pick = (r) => ({
  depositAmount: Number(r.depositAmount || 0),
  depositDueDate: r.depositDueDate || null,
  balanceAmount: Number(r.balanceAmount || 0),
  balanceDueDate: r.balanceDueDate || null,
});
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const devisBody = (startIn) => f.stayBody({ startDate: inDays(startIn), endDate: inDays(startIn + 2) });
const setValidity = (days) => db.prepare('UPDATE app_settings SET quoteValidityDays = ? WHERE id = 1').run(days);
// A stay holds its nights: every case starts with none, so each one can use the same dates (failed or not).
test.beforeEach(() => {
  db.prepare("DELETE FROM reservation_nights WHERE reservationId IN (SELECT id FROM reservations WHERE kind != 'devis')").run();
  db.prepare("DELETE FROM reservations WHERE kind != 'devis'").run();
});

async function calculate(body) {
  const res = respond();
  await f.controller.calculatePrice({ body, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

// The pure condition, at the edges, the setting 0 included (a 0-day quote is valid on its issue day only).
test('D23 — the condition: the solde deadline on or before the validity date', () => {
  const at = (startIn, days) => owesSinglePaymentByValidity({
    startDate: inDays(startIn),
    validUntil: computeValidUntil({ createdAtIsoDate: TODAY, startDateIso: inDays(startIn), quoteValidityDays: days }),
    balanceDaysBefore: 30,
  });
  const table = [
    [30, 15, true], [31, 15, true], [44, 15, true], [45, 15, true], [46, 15, false], [59, 15, false], [60, 15, false],
    [30, 30, true], [31, 30, true], [44, 30, true], [45, 30, true], [59, 30, true], [60, 30, true], [61, 30, false],
    [30, 0, true], [31, 0, false], [44, 0, false], [60, 0, false],
  ];
  for (const [startIn, days, single] of table) assert.equal(at(startIn, days), single, `+${startIn} d, validity ${days}`);
  assert.equal(owesSinglePaymentByValidity({ startDate: inDays(40), validUntil: null }), false, 'no validity date: no switch');
  assert.equal(owesSinglePaymentByValidity({ startDate: null, validUntil: inDays(10) }), false, 'no start: no switch');
});

// [start in days, the « Validité des devis » setting]. The stored 0 reads as 30 (the settings accept 1 to 365).
const CASES = [];
for (const days of [15, 30, 0]) for (const startIn of [30, 31, 44, 45, 59, 60, 61]) CASES.push([startIn, days]);

for (const [startIn, days] of CASES) {
  test(`D23 — devis at +${startIn} days, validity setting ${days}: one schedule everywhere, never an acompte after the solde`, async () => {
    setValidity(days);
    const validity = readQuoteValidityDays(db);
    const validUntil = computeValidUntil({ createdAtIsoDate: TODAY, startDateIso: inDays(startIn), quoteValidityDays: validity });
    const single = owesSinglePaymentByValidity({ startDate: inDays(startIn), validUntil, balanceDaysBefore: 30 });

    // R33-M-L1 — the live quote of the NEW devis is the devis its create stores.
    const live = await calculate({ ...devisBody(startIn), kind: 'devis' });
    const created = devisModel.create(devisBody(startIn));
    assert.ok(created.data, JSON.stringify(created));
    const id = created.data.id;
    const stored = rowOf(id);
    assert.equal(stored.validUntil, validUntil);
    assert.deepEqual(pick(live), pick(stored), 'new devis: live quote = create');
    assert.equal(live.validUntil, stored.validUntil, 'new devis: the live quote announces the validity the create writes');

    if (single) {
      assert.equal(stored.depositAmount, 0, 'no acompte');
      assert.equal(stored.depositDueDate, null);
      assert.equal(stored.balanceDueDate, validUntil, 'one payment, due on the validity date');
    } else {
      assert.ok(stored.depositAmount > 0, 'an acompte');
      assert.equal(stored.depositDueDate, validUntil, 'acompte due on the validity date');
      assert.equal(stored.balanceDueDate, inDays(startIn - 30), 'solde due start − 30');
    }
    if (stored.depositDueDate) assert.ok(stored.depositDueDate <= stored.balanceDueDate, `acompte ${stored.depositDueDate} after solde ${stored.balanceDueDate}`);

    // Saved devis: its live quote, its unchanged save, its read, the link's quote, the PDF and the e-mail tokens.
    assert.deepEqual(pick(await calculate({ ...devisBody(startIn), devisId: id })), pick(stored), 'saved devis: live quote');
    const saved = devisModel.update(id, devisBody(startIn));
    assert.ok(!saved.error, JSON.stringify(saved));
    assert.deepEqual(pick(rowOf(id)), pick(stored), 'an unchanged save stores the same schedule');
    const read = devisModel.findById(id);
    assert.deepEqual(pick(read), pick(stored), 'read');
    assert.deepEqual(pick(devisModel.recomputeQuote(id)), pick(stored), 'the payment link and PDF quote');
    const lines = devisPdf.__test.summarySchedule(read, labels('fr'));
    assert.deepEqual(lines.map((l) => [l.label, l.dueDate]), single
      ? [['Paiement intégral', validUntil]]
      : [['Acompte', validUntil], ['Solde', inDays(startIn - 30)]], 'PDF schedule');
    const mail = buildContext({ reservation: rowOf(id), client: {}, property: {} });
    assert.equal(mail.vars.balanceDueDate === mail.vars.validUntil, single, 'e-mail: the single payment is due on the validity date');

    // The site's quote of the same stay is the devis its request creates (payment mode included).
    const site = directQuote.buildEngineQuote({ propertyId: 1, startDate: inDays(startIn), endDate: inDays(startIn + 2),
      checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0, babyBeds: 0, options: [] });
    assert.deepEqual(pick(site), pick(stored), 'public quote = devis');
    assert.equal(resolvePublicPaymentMode(db, 1, Math.round(site.depositAmount * 100)), single ? 'full' : 'deposit');

    // R33-DB-L1 — the conversion keeps the devis's schedule, and so do the reservation's preview and save.
    const converted = devisModel.convertToReservation(id);
    assert.ok(converted.ok, JSON.stringify(converted));
    const rid = converted.data.reservationId;
    assert.deepEqual(pick(rowOf(rid)), pick(stored), 'conversion');
    assert.deepEqual(pick(await f.liveQuote(rid)), pick(stored), 'the reservation\'s live quote');
    const resaved = await f.save(rid);
    assert.equal(resaved.statusCode, 200, JSON.stringify(resaved.body));
    assert.deepEqual(pick(rowOf(rid)), pick(stored), 'the reservation\'s unchanged save');

    // The dashboard asks for nothing before the deadline promised on the devis, and never offers to cancel.
    if (single) {
      const before = buildPaymentDeadlineRow(rowOf(rid), addDaysToIsoDate(validUntil, -1));
      assert.ok(!before || !['balance_to_request', 'balance_overdue', 'cancel_due'].includes(before.state), JSON.stringify(before));
      const due = buildPaymentDeadlineRow(rowOf(rid), validUntil);
      assert.ok(due && due.state === 'balance_to_request', JSON.stringify(due));
    }
  });
}

test('D23 — a converted single payment moved to other dates takes the reservation rules', async () => {
  setValidity(15);
  const id = devisModel.create(devisBody(35)).data.id;
  const rid = devisModel.convertToReservation(id).data.reservationId;
  assert.equal(rowOf(rid).depositAmount, 0);
  const moved = await f.save(rid, { startDate: inDays(120), endDate: inDays(122) });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  const row = rowOf(rid);
  assert.ok(row.depositAmount > 0, 'the usual acompte');
  assert.equal(row.balanceDueDate, inDays(90));
  assert.ok(row.depositDueDate <= row.balanceDueDate);
});

test('D23 — an expired single-payment devis converted late owes its payment from today, never in the past', () => {
  setValidity(15);
  const id = devisModel.create(devisBody(20)).data.id;
  db.prepare('UPDATE reservations SET validUntil = ? WHERE id = ?').run(inDays(-2), id);
  const rid = devisModel.convertToReservation(id, { allowConflict: true }).data.reservationId;
  const row = rowOf(rid);
  assert.equal(row.depositAmount, 0);
  assert.equal(row.balanceDueDate, TODAY);
});

test('D23 — a devis stored with an acompte inside the window (before the rule) reads, converts and quotes as one payment', async () => {
  setValidity(15);
  const id = devisModel.create(devisBody(36)).data.id;
  const row = rowOf(id);
  const total = row.balanceAmount;
  db.prepare('UPDATE reservations SET depositAmount = 60, balanceAmount = ?, depositDueDate = ?, balanceDueDate = ? WHERE id = ?')
    .run(total - 60, row.validUntil, inDays(6), id);
  const read = devisModel.findById(id);
  assert.deepEqual(pick(read), { depositAmount: 0, depositDueDate: null, balanceAmount: total, balanceDueDate: row.validUntil });
  assert.deepEqual(pick(devisModel.recomputeQuote(id)), pick(read), 'the link quote agrees with the read');
  const rid = devisModel.convertToReservation(id).data.reservationId;
  assert.deepEqual(pick(rowOf(rid)), pick(read), 'the conversion copies the read, not the stale columns');
});

test('D23 — « Transformer en devis » on a stay inside the window gives a devis with one payment', () => {
  setValidity(15);
  const rid = f.createStay({ startDate: inDays(38), endDate: inDays(40) });
  const reservation = rowOf(rid);
  assert.ok(reservation.depositAmount > 0, 'the reservation keeps its acompte (rule 47)');
  assert.ok(reservation.depositDueDate <= reservation.balanceDueDate, 'rule 47 unchanged: the acompte never after the solde');
  const made = devisModel.convertFromReservation(rid);
  assert.ok(made.ok, JSON.stringify(made));
  const devis = rowOf(made.data.id);
  assert.equal(devis.depositAmount, 0);
  assert.equal(devis.depositDueDate, null);
  assert.equal(devis.balanceDueDate, devis.validUntil);
  assert.equal(devis.balanceAmount, reservation.depositAmount + reservation.balanceAmount);
  assert.deepEqual(pick(devisModel.findById(made.data.id)), pick(devis), 'stored = read');
});

test('D23 — rule 47 for reservations unchanged: a reservation created 35 days out keeps an acompte capped at its solde', () => {
  const rid = f.createStay({ startDate: inDays(35), endDate: inDays(37) });
  const row = rowOf(rid);
  assert.ok(row.depositAmount > 0);
  assert.equal(row.balanceDueDate, inDays(5));
  assert.equal(row.depositDueDate, inDays(5));
});
