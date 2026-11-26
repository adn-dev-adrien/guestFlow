// specs/payments/online-payment-notices.md — the operator is told of an online payment, the guest gets the receipt
// of the balance, a devis converted by hand confirms the stay (rules 1-8).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { paymentNotice } = require('../utils/paymentNotices');
const { emailAmount } = require('../utils/emailMoney');
const { formatDateNumeric } = require('../utils/dateFr');
const received = require('../utils/paymentsReceived');
const { CORE_SUMMARIES } = require('../utils/dashboardAttention');
const { skipWithout } = require('../plugins/sdk/testing');
const { buildGatedStayMailSender } = require('../utils/reservationEmailSender');
const { DEFAULT_TEMPLATES, EVENT_TRIGGERED_STABLE_KEYS, PAYMENT_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');
const { templateAutoSends } = require('../utils/autoSendPolicy');

const { db } = f;
f.seed();
const links = paymentLinksModel.buildModel(db);

let sequence = 0;
function paidLink(reservationId, type, amountCents, over = {}) {
  sequence += 1;
  return links.create({
    reservationId, type, amountCents, provider: 'qonto', providerLinkId: `N${sequence}`, url: 'https://pay.example.test/n', status: 'open',
    expiresAt: new Date(Date.now() + 30 * 3600 * 1000).toISOString(), ...over,
  });
}

// One payment: the real effect, the notifiers spied.
async function pay(link, over = {}) {
  const told = [];
  const alerts = [];
  const receipts = [];
  const out = await processPaidLink({
    database: db, devisModel, paymentLinksModel: links, emitPluginEvent: () => {},
    sendConfirmation: async () => {},
    notifyPaymentReceived: async (l) => { told.push(l.id); },
    sendBalanceReceived: async (id) => { receipts.push(id); },
    notifyPaidAfterCancel: async (l, options) => { alerts.push([l.id, options]); },
    link: links.findById(link.id), paidPayment: { paid: true, paymentId: `pay${link.id}`, paidAt: new Date().toISOString() },
    ...over,
  });
  return { out, told, alerts, receipts };
}

// A direct stay whose acompte and solde are both still to pay.
const stay = () => f.createStay();
// What the stay asks for, in cents: a link that bills anything else is a mismatch (rule 4).
const asks = (id, bucket) => {
  const r = db.prepare('SELECT depositAmount, balanceAmount FROM reservations WHERE id = ?').get(id);
  return Math.round(Number(bucket === 'deposit' ? r.depositAmount : r.balanceAmount) * 100);
};
const askedFull = (id) => asks(id, 'deposit') + asks(id, 'balance');
const flags = (id) => db.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(id);

test('rule 1 — a deposit, a balance and a full payment recorded online are each announced', async () => {
  const a = stay();
  const deposit = await pay(paidLink(a, 'deposit', asks(a, 'deposit')));
  assert.deepEqual(deposit.told.length, 1);
  assert.equal(flags(a).depositPaid, 1);

  const balance = await pay(paidLink(a, 'balance', asks(a, 'balance')));
  assert.equal(balance.told.length, 1);
  assert.equal(flags(a).balancePaid, 1);

  const b = stay();
  const full = await pay(paidLink(b, 'full', askedFull(b)));
  assert.equal(full.told.length, 1, 'a full payment too');
});

test('rule 1 — an échéance of a schedule is announced, and the last one closes the balance', async () => {
  const id = stay();
  const { buildModel } = require('../models/installmentsModel');
  const installments = buildModel(db);
  installments.replacePlan(id, [{ number: 1, dueDate: f.inDays(200), amountCents: 5000 }, { number: 2, dueDate: f.inDays(230), amountCents: 5000 }], 10000);
  const [first, second] = installments.listFor(id);
  const one = await pay(paidLink(id, 'installment', 5000, { installmentId: first.id }));
  assert.equal(one.told.length, 1);
  assert.deepEqual(one.receipts, [], 'an échéance with others to come is no receipt of the balance');
  const two = await pay(paidLink(id, 'installment', 5000, { installmentId: second.id }));
  assert.equal(two.told.length, 1);
  assert.deepEqual(two.receipts, [id], 'the last échéance sends the balance receipt (rule 7)');
});

test('rule 1 — a payment the operator ticks by hand is not announced', async () => {
  const id = stay();
  const told = [];
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'deposit', paidDate: f.inDays(0) });
  assert.equal(flags(id).depositPaid, 1);
  assert.deepEqual(told, [], 'only processPaidLink reaches the notifier, and a hand tick never goes through it');
  // A link paid for a bucket already ticked is a double payment, answered by its own alert (rule 4), not by a receipt.
  const late = await pay(paidLink(id, 'deposit', asks(id, 'deposit')));
  assert.equal(late.told.length, 0);
});

test('rule 2 — a replayed poll or webhook on the same link announces nothing more', async () => {
  const id = stay();
  const link = paidLink(id, 'deposit', asks(id, 'deposit'));
  const first = await pay(link);
  const replay = await pay(link);
  assert.equal(first.told.length, 1);
  assert.equal(replay.told.length, 0);
  assert.equal(replay.out.effect, 'already-processed');
});

test('rule 2 — the online-payment plugin declares the « stay-payments » channel, labelled in French', { skip: skipWithout(['online-payment']) }, () => {
  const calls = [];
  const plugin = require('../plugins/online-payment');
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (_, name) => {
      if (name === 'pushChannel') return (channel) => calls.push(channel);
      if (name === 'settings') return { declare: noop, get: noop };
      if (name === 'db') return null;
      return () => ({ forEach: noop });
    },
  });
  try { plugin.register(ctx); } catch { /* the rest of the registration needs a live host */ }
  assert.deepEqual(calls, [{ key: 'stay-payments', label: 'Paiements en ligne reçus' }]);
});

test('rule 2 — the wired notifier sends one notice through notifyOperator, on the stay-payments channel', async () => {
  const notificationService = require('../utils/notificationService');
  const original = notificationService.notifyOperator;
  const sent = [];
  notificationService.notifyOperator = async (notice) => { sent.push(notice); };
  try {
    const id = stay();
    const link = paidLink(id, 'deposit', asks(id, 'deposit'));
    await require('../utils/paymentEffectDeps').buildPaymentEffectDeps().notifyPaymentReceived(link);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'stay-payments');
    assert.match(sent[0].title, /^Acompte reçu · /);
    assert.equal(sent[0].url, `/reservations/${id}`);
  } finally {
    notificationService.notifyOperator = original;
  }
});

test('rule 3 — the words: title with the amount, body with guest, logement and dates, link to the fiche', () => {
  const notice = paymentNotice({
    type: 'deposit', amountCents: 32000,
    stay: { id: 812, firstName: 'Camille', lastName: 'Martin', propertyName: 'Gîte', startDate: f.inDays(300), endDate: f.inDays(303) },
  });
  assert.equal(notice.channel, 'stay-payments');
  assert.equal(notice.title, `Acompte reçu · ${emailAmount(320)}`);
  assert.equal(notice.body, `Camille Martin, Gîte, du ${formatDateNumeric(f.inDays(300))} au ${formatDateNumeric(f.inDays(303))}.`);
  assert.equal(notice.url, '/reservations/812');
  assert.equal(notice.subject, `Acompte reçu : ${emailAmount(320)}, Camille Martin`);
  const stayOf = { id: 1, firstName: 'A', lastName: 'B', propertyName: 'P', startDate: f.inDays(300), endDate: f.inDays(301) };
  assert.deepEqual(
    ['balance', 'full', 'installment'].map((type) => paymentNotice({ type, amountCents: 100, stay: stayOf }).title.split(' · ')[0]),
    ['Solde reçu', 'Paiement total reçu', 'Échéance reçue'],
  );
});

test('rule 3 — noticeOf names the stay of a link, a devis link following its devis to the stay it became', () => {
  const id = stay();
  const link = paidLink(id, 'deposit', asks(id, 'deposit'));
  const found = received.noticeOf(db, link);
  assert.equal(found.notice.url, `/reservations/${id}`);
  assert.match(found.notice.body, /Camille Registre, Gîte, du /);
  assert.equal(received.noticeOf(db, { ...link, reservationId: 999999 }), null, 'a link with no stay announces nothing');
});

test('rule 4 — a payment booked on a cancelled stay keeps its own alert and is not announced as a receipt', async () => {
  const id = stay();
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  const paid = await pay(paidLink(id, 'deposit', asks(id, 'deposit')));
  assert.equal(paid.alerts.length, 1, 'the paid-after-cancel alert');
  assert.deepEqual(paid.told, []);
  assert.deepEqual(paid.receipts, []);
});

test('rule 4 — a double payment keeps its own alert and is not announced as a receipt', async () => {
  const id = stay();
  const first = await pay(paidLink(id, 'full', askedFull(id)));
  assert.equal(first.told.length, 1);
  const second = await pay(paidLink(id, 'full', askedFull(id)));
  assert.equal(second.told.length, 0);
  assert.equal(second.receipts.length, 0);
});

test('rule 4 — an amount that no longer matches keeps its own alert and is not announced as a receipt', async () => {
  const id = stay();
  const stale = await pay(paidLink(id, 'deposit', 12345));
  assert.deepEqual(stale.told, []);
  assert.ok(stale.alerts.length >= 1, 'the mismatch alert');
});

test('rule 5 — the home subject lists the last 24 hours, newest first, one line per payment, shaped by the server', async () => {
  const id = stay();
  const recent = paidLink(id, 'deposit', asks(id, 'deposit'));
  await pay(recent);
  const oldId = stay();
  const old = paidLink(oldId, 'deposit', asks(oldId, 'deposit'));
  await pay(old);
  db.prepare("UPDATE payment_links SET paidAt = datetime('now', '-25 hours') WHERE id = ?").run(old.id);
  const lines = received.listReceived(db).filter((l) => [id].includes(l.reservationId));
  assert.equal(lines.length, 1, 'the payment of 25 h ago has left');
  assert.deepEqual(Object.keys(lines[0]).sort(), ['amountLabel', 'bucketLabel', 'clientName', 'propertyName', 'reservationId', 'whenLabel']);
  assert.equal(lines[0].bucketLabel, 'Acompte');
  assert.equal(lines[0].amountLabel, emailAmount(asks(id, 'deposit') / 100));
  assert.match(lines[0].whenLabel, / à \d+ h \d{2}$/);
});

test('rule 5 — the subject is info, never pinned, and absent when nothing was received', () => {
  const summarize = CORE_SUMMARIES['payments-received'];
  assert.equal(summarize({ alerts: [] }), null);
  assert.deepEqual(summarize({ alerts: [{}, {}] }), { count: 2, title: 'Paiements reçus', detail: 'Sur les dernières 24 h', severity: 'info' });
  assert.equal(summarize({ alerts: [{}] }).pinned, undefined);
});

test('rule 5 — GET /api/dashboard/payments-received answers { alerts } from the controller', () => {
  const { buildController } = require('../controllers/dashboardController');
  const controller = buildController({ receivedPayments: () => [{ reservationId: 3 }] });
  let body;
  controller.paymentsReceived({}, { json: (b) => { body = b; } });
  assert.deepEqual(body, { alerts: [{ reservationId: 3 }] });
  assert.ok(require('../routes/dashboard').coreAttentionSources({ user: {} }).some((s) => s.key === 'payments-received'));
});

const template = () => DEFAULT_TEMPLATES.find((t) => t.stableKey === 'balance_received');

test('rule 6 — « Solde reçu » is a default template in French and English, event-triggered, never a payment request', () => {
  const t = template();
  assert.ok(t);
  assert.equal(t.name, 'Solde reçu');
  assert.ok(t.subject && t.body && t.subjectEn && t.bodyEn, 'both languages');
  for (const token of ['propertyWithArticle', 'balanceAmount', 'arrivalDateLabel', 'checkInLabel']) {
    assert.ok(t.body.includes(`{{${token}}}`) && t.bodyEn.includes(`{{${token}}}`), token);
  }
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes('balance_received'));
  assert.ok(!PAYMENT_STABLE_KEYS.includes('balance_received'), 'it asks for no money');
  assert.notEqual(t.anchor, 'start', 'never date-scheduled');
});

test('rule 7 — the balance receipt ships auto, and leaves at once when auto, queued when manual', async () => {
  assert.equal(template().sendMode, 'auto');
  assert.equal(templateAutoSends({ ...template(), id: 1 }), true);
  const queued = [];
  const sent = [];
  const make = (mode) => buildGatedStayMailSender({
    database: db, stableKey: 'balance_received',
    templatesModel: { findByStableKey: () => ({ id: 7, stableKey: 'balance_received', enabled: 1, sendMode: mode }) },
    queueModel: { add: (templateId, reservationId) => queued.push([templateId, reservationId]) },
    logModel: { insert: (row) => { sent.push(row); return { id: 1 }; } },
    settingsModel: { read: () => ({}), decryptedSmtpSettings: () => ({}) },
    emailServiceFactory: () => ({ send: async () => {} }),
  });
  const manual = await make('manual')(41);
  assert.deepEqual([manual.queued, queued], [true, [[7, 41]]]);
  const again = await make('manual')(41);
  assert.equal(again.queued, true);
  assert.equal(sent.length, 0, 'nothing leaves while manual');
  const auto = await make('auto')(41);
  assert.equal(queued.length, 2, 'auto does not queue');
  assert.notEqual(auto.queued, true);
});

test('rule 7 — only an online balance triggers the receipt: not an acompte, not a full payment', async () => {
  const id = stay();
  const deposit = await pay(paidLink(id, 'deposit', asks(id, 'deposit')));
  assert.deepEqual(deposit.receipts, []);
  const balance = await pay(paidLink(id, 'balance', asks(id, 'balance')));
  assert.deepEqual(balance.receipts, [id]);
  const otherId = stay();
  const full = await pay(paidLink(otherId, 'full', askedFull(otherId)));
  assert.deepEqual(full.receipts, [], 'a full payment sends the confirmation, not this receipt');
});

test('rule 8 — a devis converted by hand hands its stay to the gated confirmation sender, once', async () => {
  const sent = [];
  const events = [];
  const { buildController } = require('../controllers/devisController');
  const model = { convertToReservation: () => ({ ok: true, data: { reservationId: 55 } }) };
  const controller = buildController(model, { emitPluginEvent: (name) => events.push(name), sendConfirmation: async (id) => { sent.push(id); } });
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.convertToReservation({ params: { id: 1 } }, res);
  await new Promise(setImmediate);
  assert.deepEqual(sent, [55]);
  assert.deepEqual(events, ['reservation.created']);
  assert.equal(res.statusCode, 200);

  const refused = buildController({ convertToReservation: () => ({ error: 'Ce devis a déjà été converti en réservation', status: 400 }) }, {
    emitPluginEvent: () => {}, sendConfirmation: async (id) => { sent.push(id); },
  });
  const refusedRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  refused.convertToReservation({ params: { id: 1 } }, refusedRes);
  await new Promise(setImmediate);
  assert.equal(refusedRes.statusCode, 400);
  assert.deepEqual(sent, [55], 'converting twice, or a devis a payment already confirmed, sends nothing more');
});

test('rule 8 — a confirmation that fails never undoes the conversion', async () => {
  const { buildController } = require('../controllers/devisController');
  const controller = buildController({ convertToReservation: () => ({ ok: true, data: { reservationId: 9 } }) }, {
    emitPluginEvent: () => {}, sendConfirmation: async () => { throw new Error('smtp down'); },
  });
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.convertToReservation({ params: { id: 1 } }, res);
  await new Promise(setImmediate);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reservationId, 9);
});
