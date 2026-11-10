// specs/payment-schedule-and-cancellation.md rule 61 (audits R44-DB-M1, R44-M-L1, R44-RES-L1) — the cancellation notice
// worked out « l'acompte de X reste acquis » as `depositPaid ? depositAmount : 0`: after a book refund it told the guest
// the whole acompte was kept, on a plan it said nothing of the échéances kept. The mail now states the sum the
// cancellation itself booked (`keptFromGuest`: the indemnity plus a caisse-interne acompte kept), stored on the cancel
// entry, for every way the money can stand, in French and in English.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, rowOf, mark, ADMIN, TODAY, NO_ACOMPTE, WITH_ACOMPTE, D, S, fiche, refund,
} = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const installmentsController = require('../controllers/installmentsController');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
const { cancellationKeptForEmail } = require('../utils/cancellationKeptForEmail');
const { emailAmount } = require('../utils/emailMoney');
const { runCancellationNoticeKeptSumMigration } = require('../utils/migrateCancellationNoticeKeptSum');

const cents = (euros) => Math.round(Number(euros) * 100);

async function cancel(id, body = {}) {
  const res = respond();
  await cancellationController.cancel({ params: { id: String(id) }, body: { reason: 'Test', ...body }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

function storedKept(id) {
  const entry = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'cancel' ORDER BY id DESC").get(id);
  return JSON.parse(entry.changedFields).find((change) => change.field === 'keptFromGuest').to;
}

async function noticeOf(id, lang = 'fr') {
  const { clientId } = rowOf(id);
  db.prepare("UPDATE clients SET email = 'guest@example.invalid', emailLanguage = ? WHERE id = ?").run(lang, clientId);
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

const frSentence = (amount) => `la somme de ${emailAmount(amount, 'fr')} déjà versée reste acquise à titre d'indemnité. Aucune autre somme ne vous sera réclamée.`;

// The preview, the cancel answer, the stored entry and the mail: one figure.
async function keptEverywhere(id) {
  const preview = respond();
  cancellationController.preview({ params: { id: String(id) }, user: ADMIN }, preview);
  const shown = cancellationKeptForEmail(db, rowOf(id));
  const done = await cancel(id);
  assert.equal(done.keptFromGuest, shown, 'what a reminder states before the cancel is what the cancel keeps');
  assert.equal(storedKept(id), done.keptFromGuest, 'the cancel entry stores the figure');
  assert.equal(cancellationKeptForEmail(db, rowOf(id)), done.keptFromGuest, 'a later send reads the stored figure');
  const mail = await noticeOf(id);
  if (done.keptFromGuest > 0) assert.ok(mail.includes(frSentence(done.keptFromGuest)), mail);
  else assert.ok(!/reste acquis|réclamée/.test(mail), mail);
  return { done, mail };
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

test('rule 61 — an acompte paid by transfer: the mail states the acompte the cancel kept', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  const { done } = await keptEverywhere(stay.id);
  assert.equal(done.keptFromGuest, rowOf(stay.id).depositAmount);
  assert.equal(done.keptFromGuest, done.indemnityAmount);
});

test('rule 61 — a book refund before the cancellation: the mail states the acompte net of it, never the whole acompte', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  const { done, mail } = await keptEverywhere(stay.id);
  assert.equal(cents(done.keptFromGuest), cents(rowOf(stay.id).depositAmount) - 5000);
  assert.equal(done.keptFromGuest, done.retainedDepositAmount);
  assert.ok(!mail.includes(emailAmount(rowOf(stay.id).depositAmount, 'fr')), 'the gross acompte is never stated');
});

test('rule 61 — a plan with one paid échéance: the mail states the échéance kept', async () => {
  const { stay, plan } = await planStay(1);
  const { done } = await keptEverywhere(stay.id);
  assert.equal(cents(done.keptFromGuest), plan[0].amountCents);
});

test('rule 61 — a plan nothing was paid on: no sum stated, the dates still back on sale', async () => {
  const { stay } = await planStay(0);
  const { done, mail } = await keptEverywhere(stay.id);
  assert.equal(done.keptFromGuest, 0);
  assert.match(mail, /Vos dates sont désormais remises à la vente\./);
});

test('rule 61 — an acompte in the caisse interne: off the books (D8), yet the guest handed it over: the mail states it', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = cents(rowOf(stay.id).depositAmount);
  const res = mark(stay.id, { ...D, expectedAmountCents: due, tenders: [{ method: 'cash', amountCents: due, internal: true }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { done } = await keptEverywhere(stay.id);
  assert.equal(done.retainedDepositAmount, 0, 'nothing requalified (D8)');
  assert.equal(cents(done.keptFromGuest), due);
});

test('rule 61 — a caisse-interne acompte partly given back in the caisse interne: the mail states what is left', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = cents(rowOf(stay.id).depositAmount);
  assert.equal(mark(stay.id, { ...D, expectedAmountCents: due, tenders: [{ method: 'cash', amountCents: due, internal: true }] }).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 30 }], 'internal').statusCode, 201);
  const { done } = await keptEverywhere(stay.id);
  assert.equal(cents(done.keptFromGuest), due - 3000);
});

test('rule 61 — an acompte split between card and transfer: kept whole, stated whole', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const due = cents(rowOf(stay.id).depositAmount);
  const res = mark(stay.id, {
    ...D, expectedAmountCents: due,
    tenders: [{ method: 'card', amountCents: 5000, internal: false }, { method: 'transfer', amountCents: due - 5000, internal: false }],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { done } = await keptEverywhere(stay.id);
  assert.equal(cents(done.keptFromGuest), due);
});

test('rule 61 — commissions withheld on a paid acompte and solde: the mail states the indemnity booked', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(mark(stay.id, S).statusCode, 200);
  db.prepare('UPDATE reservations SET acompteCommissionAmount = 8.22, platformCommissionAmount = 19.2 WHERE id = ?').run(stay.id);
  const { done } = await keptEverywhere(stay.id);
  assert.equal(done.keptFromGuest, done.indemnityAmount);
  assert.equal(cents(done.keptFromGuest), cents(done.retainedDepositAmount) + 1920);
});

test('rule 61 — nothing collected: the sentence is left out, nothing is said to be kept or claimed', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  const { done } = await keptEverywhere(stay.id);
  assert.equal(done.keptFromGuest, 0);
});

test('rule 61 — the English notice states the same figure', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  const done = await cancel(stay.id);
  const mail = await noticeOf(stay.id, 'en');
  assert.ok(mail.includes(`the amount of ${emailAmount(done.keptFromGuest, 'en')} already paid is retained as compensation`), mail);
});

test('rule 61 — the notice sent by the confirm itself renders the cancel\'s figure', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  db.prepare("UPDATE clients SET email = 'guest@example.invalid', emailLanguage = 'fr' WHERE id = ?").run(rowOf(stay.id).clientId);
  const done = await cancel(stay.id, { notifyClient: true });
  const logged = db.prepare(`SELECT l.renderedBody FROM email_log l JOIN email_templates t ON t.id = l.templateId
    WHERE l.reservationId = ? AND t.stableKey = 'cancellation_notice' ORDER BY l.id DESC`).get(stay.id);
  assert.ok(logged, 'the notice was rendered');
  assert.ok(logged.renderedBody.includes(frSentence(done.keptFromGuest)), logged.renderedBody);
});

test('rule 61 — a cancellation stored before the rule (no keptFromGuest) reads its « Acompte conservé »', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stay.id);
  db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'cancel', ?)")
    .run(stay.id, JSON.stringify([{ field: 'retainedDeposit', label: 'Acompte conservé', from: null, to: 123.4 }]));
  assert.equal(cancellationKeptForEmail(db, rowOf(stay.id)), 123.4);
});

test('rule 61 — a platform booking or a devis states no sum', () => {
  assert.equal(cancellationKeptForEmail(db, { id: 1, kind: 'devis', platform: 'direct' }), 0);
  assert.equal(cancellationKeptForEmail(db, { id: 1, kind: 'reservation', platform: 'CanalPlat' }), 0);
});

test('rule 61 — the stored seeded sentence names « la somme »; a reworded body is left as it is', () => {
  const row = db.prepare("SELECT id, body, bodyEn FROM email_templates WHERE stableKey = 'cancellation_notice'").get();
  const oldFr = "l'acompte de {{retainedDepositAmount}} déjà versé reste acquis à titre d'indemnité";
  const oldEn = 'the deposit of {{retainedDepositAmount}} already paid is retained as compensation';
  db.prepare('UPDATE email_templates SET body = ?, bodyEn = ? WHERE id = ?').run(`Avant. ${oldFr}. Après.`, `Before. ${oldEn}. After.`, row.id);
  assert.equal(runCancellationNoticeKeptSumMigration(db), 2);
  const after = db.prepare('SELECT body, bodyEn FROM email_templates WHERE id = ?').get(row.id);
  assert.equal(after.body, "Avant. la somme de {{retainedDepositAmount}} déjà versée reste acquise à titre d'indemnité. Après.");
  assert.equal(after.bodyEn, 'Before. the amount of {{retainedDepositAmount}} already paid is retained as compensation. After.');
  db.prepare('UPDATE email_templates SET body = ? WHERE id = ?').run('Texte de l’exploitant.', row.id);
  assert.equal(runCancellationNoticeKeptSumMigration(db), 0);
  assert.equal(db.prepare('SELECT body FROM email_templates WHERE id = ?').get(row.id).body, 'Texte de l’exploitant.');
  db.prepare('UPDATE email_templates SET body = ?, bodyEn = ? WHERE id = ?').run(row.body, row.bodyEn, row.id);
});
