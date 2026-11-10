// specs/payment-schedule-and-cancellation.md rule 62 (verification R44 L2) — a cancelled stay's notice sent after a
// refund made since the cancel (D3: book money from the indemnity, caisse money in the caisse interne): the sum stated is
// the one the cancel kept less what those refunds took from it, never below 0. Before, a cancel without notice, a 40 €
// goodwill refund, then « Envoyer un email » told the guest 180 € were kept while 140 € were.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, rowOf, mark, ADMIN, WITH_ACOMPTE, D, S, C, fiche, refund, register,
} = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
const { cancellationKeptForEmail } = require('../utils/cancellationKeptForEmail');
const { emailAmount } = require('../utils/emailMoney');

const cents = (euros) => Math.round(Number(euros) * 100);

async function cancel(id) {
  const res = respond();
  await cancellationController.cancel({ params: { id: String(id) }, body: { reason: 'Test', notifyClient: false }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

async function noticeOf(id) {
  db.prepare("UPDATE clients SET email = 'guest@example.invalid', emailLanguage = 'fr' WHERE id = ?").run(rowOf(id).clientId);
  const sent = [];
  const result = await sendReservationTemplateEmail({
    database: db,
    templatesModel: require('../models/emailTemplatesModel'),
    logModel: require('../models/emailLogModel'),
    settingsModel: require('../models/settingsModel'),
    emailServiceFactory: () => ({ send: async (message) => { sent.push(message.text); } }),
    reservationId: id,
    stableKey: 'cancellation_notice',
  });
  assert.equal(result.sent, true, JSON.stringify(result));
  return sent[0];
}

const keptSentence = (amount) => `la somme de ${emailAmount(amount, 'fr')} déjà versée reste acquise`;

function laterRefund(id, key, amountTtc, method = 'transfer') {
  const res = refund(id, [{ key, amountTtc }], method);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.refund.afterCancellation, 1);
}

test('rule 62 — a book refund from the indemnity after the cancel: the notice states the acompte less it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const done = await cancel(stay.id);
  laterRefund(stay.id, 'accommodation', 40);
  const kept = (cents(done.keptFromGuest) - 4000) / 100;
  assert.equal(cancellationKeptForEmail(db, rowOf(stay.id)), kept);
  const mail = await noticeOf(stay.id);
  assert.ok(mail.includes(keptSentence(kept)), mail);
  assert.ok(!mail.includes(keptSentence(done.keptFromGuest)), mail);
});

test('rule 62 — the whole indemnity given back after the cancel: 0, the sentence is left out', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const done = await cancel(stay.id);
  laterRefund(stay.id, 'accommodation', done.keptFromGuest);
  assert.equal(cancellationKeptForEmail(db, rowOf(stay.id)), 0);
  const mail = await noticeOf(stay.id);
  assert.ok(!/reste acquis|réclamée/.test(mail), mail);
});

test('rule 62 — a refund of a paid solde after the cancel takes nothing from the sum kept', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(mark(stay.id, S).statusCode, 200);
  const done = await cancel(stay.id);
  assert.ok(done.keptFromGuest > 0);
  laterRefund(stay.id, 'accommodation', 100);
  assert.equal(cancellationKeptForEmail(db, rowOf(stay.id)), done.keptFromGuest);
});

test('rule 62 — a caisse-interne acompte kept, then a caisse refund after the cancel: the notice states what is left', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const deposit = cents(rowOf(stay.id).depositAmount);
  assert.equal(mark(stay.id, { ...D, expectedAmountCents: deposit, tenders: [{ method: 'cash', amountCents: deposit, internal: true }] }).statusCode, 200);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit);
  laterRefund(stay.id, 'accommodation', 30, 'internal');
  assert.equal(cents(cancellationKeptForEmail(db, rowOf(stay.id))), deposit - 3000);
});

test('rule 62 — a caisse refund after the cancel is taken from the other caisse money first', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [{ customKey: 'Z', description: 'Z', amount: 80, offered: false, inComplement: 1 }] });
  const deposit = cents(rowOf(stay.id).depositAmount);
  assert.equal(mark(stay.id, { ...D, expectedAmountCents: deposit, tenders: [{ method: 'cash', amountCents: deposit, internal: true }] }).statusCode, 200);
  const complement = cents(rowOf(stay.id).complementAmount);
  assert.equal(mark(stay.id, { ...C, expectedAmountCents: complement, tenders: [{ method: 'cash', amountCents: complement, internal: true }] }).statusCode, 200);
  const done = await cancel(stay.id);
  assert.equal(cents(done.keptFromGuest), deposit);
  const key = register(stay.id).refundableLines.find((line) => line.label === 'Z').key;
  laterRefund(stay.id, key, 50, 'internal');
  assert.equal(cents(cancellationKeptForEmail(db, rowOf(stay.id))), deposit);
});

test('rule 62 — an entry stored before rule 61 holds no caisse acompte: a later caisse refund takes nothing from it', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const deposit = cents(rowOf(stay.id).depositAmount);
  assert.equal(mark(stay.id, { ...D, expectedAmountCents: deposit, tenders: [{ method: 'cash', amountCents: deposit, internal: true }] }).statusCode, 200);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stay.id);
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'cancel', ?)")
    .run(stay.id, JSON.stringify([{ field: 'retainedDeposit', label: 'Acompte conservé', from: null, to: 100 }]));
  laterRefund(stay.id, 'accommodation', 30, 'internal');
  assert.equal(cancellationKeptForEmail(db, rowOf(stay.id)), 100);
});
