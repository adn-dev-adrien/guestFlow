// specs/payment-link-lifecycle.md rules 35 (the refusal on taken dates), 43 and 65 — the acompte reminder of a stay
// whose nights another stay took is never proposed in « Emails à envoyer », and the operator's send is refused
// (409 DATES_UNAVAILABLE, traced once as a `failed` row that never hides the reminder once the nights are free again),
// before any link is minted; the refusal asks for the guest notice, which leaves once at most. Made-up stays; nothing
// leaves the process.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, bookingFeed, providerReads } = require('./datesTakenFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const templatesModel = require('../models/emailTemplatesModel');
const logModel = require('../models/emailLogModel');
const { buildController } = require('../controllers/emailsController');
const { buildDatesTakenNotice } = require('../utils/datesTakenNotice');
const { fakeProvider } = require('./paymentLinkLifecycleFixture');

const settingsModel = { read: () => ({ companyName: 'Demo' }), smtpConfigured: () => true, decryptedSmtpSettings: () => ({}) };

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
}

function harness() {
  const mails = [];
  const minted = [];
  const emailServiceFactory = () => ({ isConfigured: true, send: async (m) => { mails.push(m); } });
  const notice = buildDatesTakenNotice({ database: db, settingsModel, emailServiceFactory, push: async () => {}, logger: { log: () => {}, warn: () => {} } });
  const ctl = buildController({
    database: db, templatesModel, logModel, settingsModel, paymentLinksModel, emailServiceFactory,
    paymentRequests: { available: () => true, ensureLink: async (id, type) => { minted.push([id, type]); return { url: 'https://pay.example.test/fresh', expiresAt: new Date(Date.now() + 36 * 3600e3).toISOString() }; } },
    datesTakenNotice: notice,
  });
  const reminderId = templatesModel.findByStableKey('deposit_reminder').id;
  return {
    mails, minted, notice,
    async send(reservationId) { const r = res(); await ctl.send({ body: { reservationId, templateId: reminderId } }, r); return r; },
    preview(reservationId) { const r = res(); ctl.preview({ query: { reservationId, templateId: reminderId } }, r); return r; },
    pending() { const r = res(); ctl.pending({ query: {} }, r); return r.body; },
  };
}

// An unpaid direct reservation whose acompte falls due today, its request sent; `taken` puts a Booking stay on it.
async function reminderDue({ start, taken = true, withLink = true }) {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(start), end: inDays(start + 3), extra: { depositDueDate: inDays(0) } });
  const requestId = templatesModel.findByStableKey('deposit_request').id;
  logModel.insert({ templateId: requestId, reservationId: stay, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'lina@example.test' });
  const linkId = withLink ? addLink(stay) : null;
  if (taken) await bookingFeed(propertyId).sync([{ uid: `r${stay}@booking`, start: inDays(start + 1), end: inDays(start + 2) }]);
  if (linkId) await providerReads(linkId, fakeProvider());
  return { stay, linkId, propertyId };
}

const proposed = (rows, stay) => rows.some((r) => Number(r.reservationId) === stay && r.templateName && /acompte/i.test(r.templateName));

test('rule 65 — « Emails à envoyer » never proposes the acompte reminder on taken dates, and still does on free ones', async () => {
  const h = harness();
  const taken = await reminderDue({ start: 300 });
  const free = await reminderDue({ start: 310, taken: false });
  const rows = h.pending();
  assert.equal(proposed(rows, taken.stay), false);
  assert.equal(proposed(rows, free.stay), true);
});

test('rule 35 — the reminder on taken dates is refused before any mint, traced once, and the guest told once', async () => {
  const h = harness();
  const { stay } = await reminderDue({ start: 320 });
  const r = await h.send(stay);
  assert.equal(r.statusCode, 409);
  assert.deepEqual(r.body, { error: 'DATES_UNAVAILABLE', message: 'Dates déjà prises par une autre réservation : relance non envoyée.' });
  assert.deepEqual(h.minted, []);
  const skipped = db.prepare("SELECT l.status, l.errorMessage FROM email_log l JOIN email_templates t ON t.id = l.templateId WHERE l.reservationId = ? AND t.stableKey = 'deposit_reminder'").all(stay);
  assert.deepEqual(skipped.map((s) => ({ ...s })), [{ status: 'failed', errorMessage: 'DATES_UNAVAILABLE' }]);
  await h.notice.idle();
  assert.equal(h.mails.length, 1, 'the notice, and only the notice');
  assert.match(h.mails[0].subject, /ne sont plus disponibles/);

  const again = await h.send(stay);
  assert.equal(again.statusCode, 409);
  await h.notice.idle();
  assert.equal(h.mails.length, 1, 'a second refusal sends nothing more');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log l JOIN email_templates t ON t.id = l.templateId WHERE l.reservationId = ? AND t.stableKey = 'deposit_reminder'").get(stay).n, 1);
});

test('rule 35 — the preview says the refusal before « Envoyer » (rule 60)', async () => {
  const h = harness();
  const { stay } = await reminderDue({ start: 330 });
  const r = h.preview(stay);
  assert.deepEqual(r.body.refusal, { error: 'DATES_UNAVAILABLE', message: 'Dates déjà prises par une autre réservation : relance non envoyée.' });
  assert.doesNotMatch(r.body.body, /lien de paiement créé à l'envoi/);
});

test('rule 43 — a reminder refused on a stay that never held a link claims nothing: no link withdrawn, no notice', async () => {
  const h = harness();
  const { stay } = await reminderDue({ start: 340, withLink: false });
  const r = await h.send(stay);
  assert.equal(r.statusCode, 409);
  await h.notice.idle();
  assert.equal(h.mails.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM dates_taken_notices WHERE reservationId = ?').get(stay).n, 0);
});

test('rule 65 (review of #912, m2) — once the nights are free again, the refused reminder is proposed as before', async () => {
  const h = harness();
  const { stay, propertyId } = await reminderDue({ start: 350 });
  assert.equal((await h.send(stay)).statusCode, 409);
  await h.notice.idle();
  assert.equal(proposed(h.pending(), stay), false);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE propertyId = ? AND id != ?").run(propertyId, stay);
  assert.equal(proposed(h.pending(), stay), true, 'the refusal trace never dedups the queue');
  const history = logModel.history({ reservationId: stay, today: inDays(0) });
  assert.ok(history.rows.some((r) => r.status === 'failed' && r.errorMessage === 'DATES_UNAVAILABLE'));
});
