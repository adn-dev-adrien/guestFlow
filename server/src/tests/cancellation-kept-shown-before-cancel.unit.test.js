// specs/payment-schedule-and-cancellation.md rule 60, reading of 2026-11-10 (audits R45-C-L1 = R45-RES-L2) — on an
// acompte collected in the caisse interne, the cancel dialog read « Conservé en indemnité : 0,00 € » while the notice
// it sends told the guest « la somme de 180 € déjà versée reste acquise ». The preview now answers the sum the notice
// states (`keptFromGuest`, rule 61), the very figure the cancel stores, and the dashboard's cancel_due row carries it.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, inDays, rowOf, mark, ADMIN, TODAY, WITH_ACOMPTE, D, fiche, refund,
} = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const { buildController: buildDashboardController } = require('../controllers/dashboardController');
const { cancellationKeptForEmail } = require('../utils/cancellationKeptForEmail');

const cents = (euros) => Math.round(Number(euros) * 100);

function preview(id) {
  const res = respond();
  cancellationController.preview({ params: { id: String(id) }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

async function cancel(id) {
  const res = respond();
  await cancellationController.cancel({ params: { id: String(id) }, body: { reason: '' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

function caisseAcompte(id) {
  const due = cents(rowOf(id).depositAmount);
  const res = mark(id, { ...D, expectedAmountCents: due, tenders: [{ method: 'cash', amountCents: due, internal: true }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return due;
}

test('rule 60 reading — a caisse-interne acompte: the preview answers the sum the notice states, the cancel keeps it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = caisseAcompte(stay.id);
  const shown = preview(stay.id);
  assert.equal(shown.indemnityAmount, 0, 'nothing requalified (D8)');
  assert.equal(cents(shown.keptFromGuest), due, 'the caisse acompte the guest is told is kept');
  assert.equal(shown.keptFromGuest, cancellationKeptForEmail(db, rowOf(stay.id)), 'the figure the notice states');
  const done = await cancel(stay.id);
  assert.equal(done.keptFromGuest, shown.keptFromGuest, 'what the dialog showed is what the cancel kept');
});

test('rule 60 reading — a caisse refund before the cancel: the preview answers the sum net of it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = caisseAcompte(stay.id);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }], 'internal').statusCode, 201);
  const shown = preview(stay.id);
  assert.equal(cents(shown.keptFromGuest), due - 5000);
  const done = await cancel(stay.id);
  assert.equal(done.keptFromGuest, shown.keptFromGuest);
});

test('rule 60 reading — the dashboard cancel_due row carries the sum the notice would state', () => {
  const candidate = {
    id: 7, platform: 'direct', startDate: inDays(40), endDate: inDays(42), depositAmount: 180, depositPaid: 1,
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
  const [row] = rowsOf({ ok: true, retainedDepositAmount: 0, indemnityAmount: 0, keptFromGuest: 180, writtenOffBalance: 640 });
  assert.equal(row.state, 'cancel_due');
  assert.equal(row.retainedDepositAmount, 0);
  assert.equal(row.keptFromGuest, 180);
  const [refused] = rowsOf({ error: 'PLATFORM_RESERVATION', status: 403 });
  assert.equal(refused.canCancel, false);
  assert.equal(refused.keptFromGuest, 0);
});
