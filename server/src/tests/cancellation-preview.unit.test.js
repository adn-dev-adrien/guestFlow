// specs/payment-schedule-and-cancellation.md rule 60 (audit R43-C-M1) — the cancel dialog announced « Acompte conservé »
// and « Solde abandonné » from a React formula over the live quote: a plan with a paid échéance read 0,00 € / 0,00 €
// while the cancel kept 125 € as an indemnity and wrote 249,79 € off. GET /reservations/:id/cancel-preview now answers
// the figures the cancel writes, from the same function, for every way the money can stand: a plan, a book refund
// before the cancellation, a caisse-interne acompte, an acompte split over two methods, withheld commissions.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, inDays, rowOf, mark, ADMIN, TODAY, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, D, S, fiche, refund,
} = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const installmentsController = require('../controllers/installmentsController');
const { buildController: buildDashboardController } = require('../controllers/dashboardController');

const cents = (euros) => Math.round(Number(euros) * 100);

function preview(id) {
  const res = respond();
  cancellationController.preview({ params: { id: String(id) }, user: ADMIN }, res);
  return res;
}

async function cancel(id) {
  const res = respond();
  await cancellationController.cancel({ params: { id: String(id) }, body: { reason: 'Test' }, user: ADMIN }, res);
  return res;
}

const tableCounts = () => Object.fromEntries(['reservation_refunds', 'reservation_refund_lines', 'cancellation_compensations', 'reservation_history']
  .map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));

// The preview, then the cancel: the preview wrote nothing, and announced exactly what the cancel answered and stored.
// `soldeCommission`: what the provider withheld on a paid solde, which the indemnity holds beside the money kept (rule 55).
async function previewEqualsCancel(id, { soldeCommission = 0 } = {}) {
  const before = tableCounts();
  const shown = preview(id);
  assert.equal(shown.statusCode, 200, JSON.stringify(shown.body));
  assert.deepEqual(tableCounts(), before, 'the preview writes nothing');
  assert.equal(rowOf(id).kind, 'reservation');

  const done = await cancel(id);
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual(shown.body, {
    cancellationReason: done.body.cancellationReason,
    retainedDepositAmount: done.body.retainedDepositAmount,
    indemnityAmount: done.body.indemnityAmount,
    writtenOffBalance: done.body.writtenOffBalance,
  });
  const entry = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'cancel' ORDER BY id DESC").get(id);
  const changes = JSON.parse(entry.changedFields);
  const stored = (field) => changes.find((change) => change.field === field).to;
  assert.equal(stored('retainedDeposit'), shown.body.retainedDepositAmount, 'the history holds the figure shown');
  assert.equal(stored('writtenOffBalance'), shown.body.writtenOffBalance);
  const indemnity = db.prepare('SELECT receivedAmount FROM cancellation_compensations WHERE reservationId = ?').get(id);
  assert.equal(cents(indemnity ? indemnity.receivedAmount : 0), cents(shown.body.indemnityAmount), 'the indemnity booked is the figure shown');
  assert.equal(cents(shown.body.indemnityAmount), cents(shown.body.retainedDepositAmount) + cents(soldeCommission), 'money kept plus the withheld solde commission');
  return shown.body;
}

async function planStay(paidCount) {
  const stay = fiche(NO_ACOMPTE, 'direct');
  const put = respond();
  await installmentsController.put({ params: { id: String(stay.id) }, body: { count: 3 }, user: ADMIN }, put);
  assert.equal(put.statusCode, 200, JSON.stringify(put.body));
  const plan = db.prepare('SELECT id, amountCents FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
  for (const installment of plan.slice(0, paidCount)) {
    const res = respond();
    installmentsController.markPaid({ params: { id: String(stay.id), installmentId: String(installment.id) }, body: { paidDate: TODAY }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  return { stay, plan };
}

test('rule 60 — a plan with one paid échéance: the preview keeps it and writes the rest off, as the cancel does', async () => {
  const { stay, plan } = await planStay(1);
  const shown = await previewEqualsCancel(stay.id);
  const total = plan.reduce((sum, i) => sum + i.amountCents, 0);
  assert.equal(cents(shown.retainedDepositAmount), plan[0].amountCents, 'the paid échéance, never 0');
  assert.equal(cents(shown.writtenOffBalance), total - plan[0].amountCents, 'the unpaid échéances, never 0');
});

test('rule 60 — a plan nothing was paid on: nothing kept, the whole plan written off', async () => {
  const { stay, plan } = await planStay(0);
  const shown = await previewEqualsCancel(stay.id);
  assert.equal(shown.retainedDepositAmount, 0);
  assert.equal(cents(shown.writtenOffBalance), plan.reduce((sum, i) => sum + i.amountCents, 0));
});

test('rule 60 — an acompte paid by transfer, solde unpaid: the acompte kept, the solde written off', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const shown = await previewEqualsCancel(stay.id);
  assert.ok(shown.retainedDepositAmount > 0);
  assert.equal(shown.retainedDepositAmount, rowOf(stay.id).depositAmount);
  assert.equal(shown.writtenOffBalance, rowOf(stay.id).balanceAmount);
});

test('rule 60 — a book refund before the cancellation: the preview keeps the acompte net of it (rule 55)', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  const shown = await previewEqualsCancel(stay.id);
  assert.equal(cents(shown.retainedDepositAmount), cents(rowOf(stay.id).depositAmount) - 5000, 'never the whole acompte');
});

test('rule 60 — an acompte collected in the caisse interne: nothing requalified (D8), as the cancel books it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = cents(rowOf(stay.id).depositAmount);
  const res = mark(stay.id, { ...D, expectedAmountCents: due, tenders: [{ method: 'cash', amountCents: due, internal: true }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).depositPaidCash, 1);
  const shown = await previewEqualsCancel(stay.id);
  assert.equal(shown.retainedDepositAmount, 0);
});

test('rule 60 — an acompte split between card and transfer: kept whole, as the cancel books it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = cents(rowOf(stay.id).depositAmount);
  const res = mark(stay.id, {
    ...D, expectedAmountCents: due,
    tenders: [{ method: 'card', amountCents: 5000, internal: false }, { method: 'transfer', amountCents: due - 5000, internal: false }],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const shown = await previewEqualsCancel(stay.id);
  assert.equal(cents(shown.retainedDepositAmount), due);
});

test('rule 60 — commissions withheld on a paid acompte and solde: the preview reads them as the cancel does', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(mark(stay.id, S).statusCode, 200);
  db.prepare('UPDATE reservations SET acompteCommissionAmount = 8.22, platformCommissionAmount = 19.2 WHERE id = ?').run(stay.id);
  const shown = await previewEqualsCancel(stay.id, { soldeCommission: 19.2 });
  assert.ok(shown.retainedDepositAmount > 0);
  assert.equal(shown.writtenOffBalance, 0, 'a paid solde writes nothing off');
});

test('rule 60 — nothing collected: nothing kept, the unpaid acompte is the reason', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const shown = await previewEqualsCancel(stay.id);
  assert.equal(shown.retainedDepositAmount, 0);
  assert.equal(shown.cancellationReason, 'unpaid_deposit');
});

test('rule 60 — the preview answers the cancel\'s own refusals: platform, already cancelled, unknown', async () => {
  const platformStay = fiche(NO_ACOMPTE, PLATFORM.owner);
  const platform = preview(platformStay.id);
  assert.equal(platform.statusCode, 403);
  assert.equal(platform.body.code, 'PLATFORM_RESERVATION');

  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal((await cancel(stay.id)).statusCode, 200);
  const again = preview(stay.id);
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.code, 'ALREADY_CANCELLED');

  const unknown = preview(999999);
  assert.equal(unknown.statusCode, 404);
});

test('rule 60 — the dashboard row offering the cancellation says what the cancel would keep, or offers none', () => {
  // A direct candidate past its cancellation day (solde due 20 days ago, 7 days' grace, the request sent).
  const candidate = {
    id: 7, platform: 'direct', startDate: inDays(40), endDate: inDays(42), depositAmount: 274, depositPaid: 1,
    balanceAmount: 640, balancePaid: 0, balanceDueDate: inDays(-20), cancelAfterBalanceDueDays: 7, balanceRequestSent: 1,
  };
  const rowsOf = (answer) => {
    const controller = buildDashboardController({
      reservationsModel: { listPaymentDeadlineCandidates: () => [candidate] },
      lateInstallments: () => [],
      hasPaymentProvider: () => true,
      cancellationPreviewFor: () => answer,
      today: TODAY,
    });
    const res = respond();
    controller.paymentDeadlines({}, res);
    return res.body.rows;
  };
  const kept = rowsOf({ ok: true, retainedDepositAmount: 174, writtenOffBalance: 640 });
  assert.equal(kept[0].state, 'cancel_due');
  assert.equal(kept[0].canCancel, true);
  assert.equal(kept[0].retainedDepositAmount, 174, 'the cancel\'s figure, not the gross acompte');
  const refused = rowsOf({ error: 'PLATFORM_RESERVATION', status: 403 });
  assert.equal(refused[0].canCancel, false, 'no offer the cancel would refuse');
  assert.equal(refused[0].retainedDepositAmount, 0);
});

test('rule 60 (verification R43 N2) — a paid solde with a withheld commission and nothing kept: the indemnity shown is the commission', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, S).statusCode, 200);
  db.prepare('UPDATE reservations SET platformCommissionAmount = 19.2 WHERE id = ?').run(stay.id);
  const shown = await previewEqualsCancel(stay.id, { soldeCommission: 19.2 });
  assert.equal(shown.retainedDepositAmount, 0);
  assert.equal(shown.indemnityAmount, 19.2);
});
