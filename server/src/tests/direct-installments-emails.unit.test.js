// specs/direct-installments.md rules 18-22 — the installment request email: a manual template, one « à valider »
// entry per due installment, its variables, and the send / ignore / mark-sent paths of the emails controller.
const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TEMPLATES, EVENT_TRIGGERED_STABLE_KEYS, PAYMENT_STABLE_KEYS, PLUGIN_OF_TEMPLATE } = require('../utils/defaultEmailTemplatesRegistry');
const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { buildContext } = require('../utils/emailContextBuilder');
const { requestContext } = require('../utils/installmentPlan');
const { createInstallmentRequests } = require('../utils/installmentRequests');
const { buildController } = require('../controllers/emailsController');
const { buildModel: buildLogModel } = require('../models/emailLogModel');
const { buildModel: buildQueueModel } = require('../models/emailManualQueueModel');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { createHarness, call } = require('./directInstallmentsFixtures');

const KEY = 'installment_request';

// ── The template ────────────────────────────────────────────────────────────────────────────────────
test('rule 18 — installment_request is manual, bilingual, a money template, plugin-gated and out of the date queue', () => {
  const template = DEFAULT_TEMPLATES.find((t) => t.stableKey === KEY);
  assert.equal(template.sendMode, 'manual');
  assert.ok(template.subject && template.body && template.subjectEn && template.bodyEn, 'FR + EN');
  assert.ok(PAYMENT_STABLE_KEYS.includes(KEY), 'covered by the seed test that forbids an auto money email');
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes(KEY), 'never proposed by the date-driven branches');
  assert.equal(PLUGIN_OF_TEMPLATE[KEY], 'online-payment');
});

// ── The queue ───────────────────────────────────────────────────────────────────────────────────────
async function queueFixture(count = 3) {
  const h = createHarness();
  ensureDefaultEmailTemplates(h.db, { logger: { log() {}, warn() {} } });
  await call(h.controller.put, { params: { id: h.reservationId }, body: { count } });
  const templateId = h.db.prepare('SELECT id FROM email_templates WHERE stableKey = ?').get(KEY).id;
  const logModel = buildLogModel(h.db);
  return { ...h, templateId, logModel, rows: h.installmentsModel.listFor(h.reservationId) };
}

test('rule 19 — one entry per due installment, with its own key, from its due date', async () => {
  const f = await queueFixture();
  assert.deepEqual(f.logModel.listPending({ today: '2026-10-26' }), [], 'nothing is due the day before the plan starts');
  const today = f.logModel.listPending({ today: '2026-10-27' });
  assert.equal(today.length, 1);
  assert.deepEqual([today[0].templateId, today[0].reservationId, today[0].occurrenceKey, today[0].installmentNumber],
    [f.templateId, f.reservationId, `installment:${f.rows[0].id}`, 1]);
  assert.equal(today[0].sendDate, '2026-10-27');

  const later = f.logModel.listPending({ today: '2027-05-20' });
  assert.deepEqual(later.map((r) => r.installmentNumber), [1, 2, 3], 'every unpaid installment that fell due waits, none replaces another');
  assert.equal(new Set(later.map((r) => r.occurrenceKey)).size, 3);
});

test('rule 19 — a paid, requested or ignored installment leaves the queue; the others stay', async () => {
  const f = await queueFixture();
  f.installmentsModel.markPaid(f.rows[0].id, { paidDate: '2026-10-27', method: 'cash' });
  f.installmentsModel.markRequested(f.rows[1].id, '2027-02-05T08:00:00Z');
  const today = '2027-05-20';
  assert.deepEqual(f.logModel.listPending({ today }).map((r) => r.installmentNumber), [3]);
  f.logModel.insert({
    templateId: f.templateId, reservationId: f.reservationId, status: 'acknowledged-skip',
    renderedSubject: 's', renderedBody: 'b', occurrenceKey: `installment:${f.rows[2].id}`,
  });
  assert.deepEqual(f.logModel.listPending({ today }), []);
});

test('rule 19 — the dedupe is per occurrence: a log row for installment 1 does not hide installment 2', async () => {
  const f = await queueFixture();
  f.logModel.insert({
    templateId: f.templateId, reservationId: f.reservationId, status: 'sent',
    renderedSubject: 's', renderedBody: 'b', occurrenceKey: `installment:${f.rows[0].id}`,
  });
  assert.equal(f.logModel.existsFor(f.templateId, f.reservationId, ['sent'], `installment:${f.rows[0].id}`), true);
  assert.equal(f.logModel.existsFor(f.templateId, f.reservationId, ['sent'], `installment:${f.rows[1].id}`), false);
  assert.equal(f.logModel.existsFor(f.templateId, f.reservationId, ['sent']), false, 'the plain key is another occurrence');
  assert.deepEqual(f.logModel.listPending({ today: '2027-05-20' }).map((r) => r.installmentNumber), [2, 3]);
});

test('rule 19 — an auto template, a disabled one, a platform stay and a finished stay propose nothing', async () => {
  const f = await queueFixture();
  const today = '2027-05-20';
  f.db.prepare("UPDATE email_templates SET sendMode = 'auto' WHERE id = ?").run(f.templateId);
  assert.deepEqual(f.logModel.listPending({ today }), [], 'rule 44: no scheduled task sends a money email');
  f.db.prepare("UPDATE email_templates SET sendMode = 'manual', enabled = 0 WHERE id = ?").run(f.templateId);
  assert.deepEqual(f.logModel.listPending({ today }), []);
  f.db.prepare('UPDATE email_templates SET enabled = 1 WHERE id = ?').run(f.templateId);
  assert.equal(f.logModel.listPending({ today }).length, 3);
  assert.deepEqual(f.logModel.listPending({ today: '2027-06-22' }), [], 'the stay is over');
  f.db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(f.reservationId);
  assert.deepEqual(f.logModel.listPending({ today }), []);
});

test('the queue table keeps one row per occurrence of a template on a reservation', async () => {
  const f = await queueFixture();
  const queue = buildQueueModel(f.db);
  assert.equal(queue.add(f.templateId, f.reservationId, `installment:${f.rows[0].id}`), true);
  assert.equal(queue.add(f.templateId, f.reservationId, `installment:${f.rows[1].id}`), true);
  assert.equal(queue.add(f.templateId, f.reservationId, `installment:${f.rows[1].id}`), false, 'idempotent per occurrence');
  assert.equal(queue.add(f.templateId, f.reservationId), true, 'the plain pair is yet another row');
  assert.equal(queue.remove(f.templateId, f.reservationId, `installment:${f.rows[0].id}`), true);
  assert.equal(queue.has(f.templateId, f.reservationId, `installment:${f.rows[1].id}`), true);
  assert.deepEqual(queue.listEnriched().map((r) => r.occurrenceKey).sort(), ['', `installment:${f.rows[1].id}`].sort());
});

// ── The variables ───────────────────────────────────────────────────────────────────────────────────
test('rule 21 — the variables name the installment and list the whole plan', async () => {
  const f = await queueFixture();
  f.installmentsModel.markPaid(f.rows[0].id, { paidDate: '2026-10-27', method: 'transfer' });
  const rows = f.installmentsModel.listFor(f.reservationId);
  const context = buildContext({
    reservation: f.db.prepare('SELECT * FROM reservations WHERE id = ?').get(f.reservationId),
    client: { firstName: 'Camille', lastName: 'Martin' },
    property: { name: 'La Granja' },
    installment: requestContext(rows[1], rows),
    lang: 'fr',
  });
  assert.equal(context.vars.installmentNumber, '2');
  assert.equal(context.vars.installmentCount, '3');
  assert.match(context.vars.installmentAmount, /334/);
  assert.match(context.vars.installmentDueDate, /février 2027/);
  const lines = context.vars.installmentSchedule.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Échéance 1 · .* · réglée$/);
  assert.doesNotMatch(lines[1], /réglée/);

  const english = buildContext({
    reservation: f.db.prepare('SELECT * FROM reservations WHERE id = ?').get(f.reservationId),
    client: { firstName: 'Camille' }, property: { name: 'La Granja' }, installment: requestContext(rows[1], rows), lang: 'en',
  });
  assert.match(english.vars.installmentAmount, /^€334\.00$/);
  assert.match(english.vars.installmentSchedule.split('\n')[0], /^Instalment 1 .* paid$/);

  const plain = buildContext({ reservation: {}, client: {}, property: {}, lang: 'fr' });
  assert.equal(plain.vars.installmentSchedule, '', 'empty outside an installment request');
});

// ── The controller ──────────────────────────────────────────────────────────────────────────────────
async function controllerFixture() {
  const f = await queueFixture();
  const sentMails = [];
  const links = [];
  const installmentRequests = createInstallmentRequests({
    installmentsModel: f.installmentsModel,
    paymentLinksModel: f.paymentLinksModel,
    paymentProviders: { active: () => ({ id: 'qonto' }) },
    ensureLink: async (reservationId, installmentId) => {
      const url = `https://pay.example/${installmentId}`;
      links.push(installmentId);
      f.paymentLinksModel.create({ reservationId, type: 'installment', installmentId, amountCents: f.installmentsModel.findById(installmentId).amountCents, url, providerLinkId: `ql_${installmentId}` });
      return { url };
    },
  });
  const settingsModel = {
    read: () => ({ companyName: 'Domaine', smtpHost: 'smtp', smtpFromEmail: 'from@x' }),
    smtpConfigured: () => true,
    decryptedSmtpSettings: () => ({}),
  };
  const queueModel = buildQueueModel(f.db);
  const controller = buildController({
    database: f.db,
    templatesModel: buildTemplatesModel(f.db),
    logModel: f.logModel,
    manualQueueModel: queueModel,
    settingsModel,
    paymentLinksModel: f.paymentLinksModel,
    installmentRequests,
    ledger: null,
    preferences: null,
    emailServiceFactory: () => ({ send: async (message) => { sentMails.push(message); } }),
  });
  return { ...f, controller, sentMails, links, queueModel };
}

function reply() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
}

test('rule 19 — validating an entry mints the link, sends the mail with it, logs it under its key and closes the entry', async () => {
  const f = await controllerFixture();
  const key = `installment:${f.rows[1].id}`;
  const res = reply();
  await f.controller.send({ body: { reservationId: f.reservationId, templateId: f.templateId, occurrenceKey: key } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.sentMails.length, 1);
  assert.match(f.sentMails[0].text, new RegExp(`https://pay.example/${f.rows[1].id}`));
  assert.match(f.sentMails[0].text, /échéance 2 sur 3/);
  assert.match(f.sentMails[0].text, /Échéance 1 · /, 'the whole plan rides along');
  const logged = f.db.prepare("SELECT status, occurrenceKey FROM email_log WHERE reservationId = ?").get(f.reservationId);
  assert.deepEqual({ ...logged }, { status: 'sent', occurrenceKey: key });
  assert.ok(f.installmentsModel.findById(f.rows[1].id).requestedAt, 'the row reads « Demandée le … »');
  assert.deepEqual(f.links, [f.rows[1].id]);
  assert.deepEqual(f.logModel.listPending({ today: '2027-05-20' }).map((r) => r.installmentNumber), [1, 3]);
});

test('rule 19 — the preview of an entry shows its amount and, once minted, its link', async () => {
  const f = await controllerFixture();
  const key = `installment:${f.rows[2].id}`;
  const before = reply();
  f.controller.preview({ query: { reservationId: f.reservationId, templateId: f.templateId, occurrenceKey: key } }, before);
  assert.match(before.body.subject, /Échéance 3\/3/);
  assert.match(before.body.body, /333,50/);
  assert.match(before.body.body, /Contactez-nous pour le règlement/, 'no link yet: the no-link branch');
  f.paymentLinksModel.create({ reservationId: f.reservationId, type: 'installment', installmentId: f.rows[2].id, amountCents: 33350, url: 'https://pay.example/known', providerLinkId: 'ql' });
  const after = reply();
  f.controller.preview({ query: { reservationId: f.reservationId, templateId: f.templateId, occurrenceKey: key } }, after);
  assert.match(after.body.body, /https:\/\/pay.example\/known/);
});

test('rule 19 — « Ignorer » closes one entry only; « Marquer comme envoyé » closes it and counts as asked', async () => {
  const f = await controllerFixture();
  const params = () => ({ templateId: f.templateId, reservationId: f.reservationId });
  const ignore = reply();
  f.controller.acknowledge({ params: params(), query: { occurrenceKey: `installment:${f.rows[0].id}` } }, ignore);
  assert.equal(ignore.statusCode, 200);
  const asked = reply();
  f.controller.markSent({ params: params(), query: { occurrenceKey: `installment:${f.rows[1].id}` } }, asked);
  assert.equal(asked.statusCode, 200);
  assert.ok(f.installmentsModel.findById(f.rows[1].id).requestedAt);
  assert.equal(f.installmentsModel.findById(f.rows[0].id).requestedAt, null, 'ignored is not asked');
  assert.deepEqual(f.logModel.listPending({ today: '2027-05-20' }).map((r) => r.installmentNumber), [3]);
  const replay = reply();
  f.controller.acknowledge({ params: params(), query: { occurrenceKey: `installment:${f.rows[0].id}` } }, replay);
  assert.equal(replay.body.alreadyHandled, true);
});

test('rule 18 — without a payment provider the entries are not proposed', async () => {
  const f = await controllerFixture();
  const noProvider = buildController({
    database: f.db, templatesModel: buildTemplatesModel(f.db), logModel: f.logModel, manualQueueModel: f.queueModel,
    settingsModel: { read: () => ({}) }, paymentLinksModel: f.paymentLinksModel, ledger: null, preferences: null,
    installmentRequests: createInstallmentRequests({
      installmentsModel: f.installmentsModel, paymentLinksModel: f.paymentLinksModel, paymentProviders: { active: () => null },
    }),
    emailServiceFactory: () => ({ send: async () => {} }),
  });
  const res = reply();
  noProvider.pending({ query: { today: '2027-05-20' } }, res);
  assert.deepEqual(res.body.filter((r) => r.occurrenceKey), []);
});

test('rule 19 — an entry whose installment is paid meanwhile cannot be sent', async () => {
  const f = await controllerFixture();
  f.installmentsModel.markPaid(f.rows[1].id, { paidDate: '2026-10-27', method: 'cash' });
  const res = reply();
  await f.controller.send({ body: { reservationId: f.reservationId, templateId: f.templateId, occurrenceKey: `installment:${f.rows[1].id}` } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(f.sentMails.length, 0);
});
