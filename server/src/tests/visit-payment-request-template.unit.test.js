// specs/outside-booking-sas.md rule 42 — the visit payment request template: seeded French and English, stored manual, event-triggered,
// a money template (never auto), not an exception of autoSendPolicy, listed by no date-driven queue; and its sender: minting a link sends nothing, the e-mail leaves
// once per explicit click, logged in `email_log` with the document's `saleRef`, the document's history saying « Lien envoyé à … ».
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../utils/defaultEmailTemplatesRegistry');
const { templateAutoSends, AUTO_SEND_EXCEPTIONS } = require('../utils/autoSendPolicy');

const template = registry.DEFAULT_TEMPLATES.find((t) => t.stableKey === 'visit_payment_request');

test('rule 42: seeded in both languages, stored manual and enabled', () => {
  assert.ok(template);
  assert.equal(template.sendMode, 'manual');
  assert.ok(template.subject && template.body && template.subjectEn && template.bodyEn);
  assert.match(template.body, /\{\{paymentLink\}\}/);
  assert.match(template.bodyEn, /\{\{paymentLink\}\}/);
});

test('rule 42: it is event-triggered and a money template, so no cron and no queue ever sends it', () => {
  assert.ok(registry.EVENT_TRIGGERED_STABLE_KEYS.includes('visit_payment_request'));
  assert.ok(registry.PAYMENT_STABLE_KEYS.includes('visit_payment_request'));
  assert.equal(AUTO_SEND_EXCEPTIONS.includes('visit_payment_request'), false);
  assert.equal(templateAutoSends({ ...template, sendMode: 'auto' }), false, 'even stored auto, it does not send by itself');
});

const db = require('../database');
const registry2 = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const emailLogModel = require('../models/emailLogModel');

const beer = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Bière', 6.5, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);
registry2.configure({ isActive: () => true, allows: () => true });
createContext('online-payment', {}).paymentProvider({
  id: 'qonto', label: 'Qonto', errorCode: 'X', isReady: () => true, createLink: async () => ({ id: 'r1', url: 'https://pay.example/abc', status: 'open' }),
  getPayment: async () => ({ paid: false }), getLinkStatus: async () => 'open', cancelLink: async () => {},
});
const sent = [];
const deps = {
  emailServiceFactory: () => ({ send: async (message) => { sent.push(message); } }),
  settingsModel: { read: () => ({ companyPhone: '', companyName: 'Solio' }), decryptedSmtpSettings: () => ({}) },
};
const saleLogs = () => db.prepare('SELECT * FROM email_log WHERE saleRef IS NOT NULL ORDER BY id').all();

test('rule 42: minting a link sends nothing; the e-mail leaves once per explicit click, logged with the saleRef and the document history says so', async () => {
  const { document } = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }], customer: { email: 'client@exemple.fr', name: 'Jean Dupont' } });
  const minted = await links.mint(document.document.id);
  assert.equal(sent.length, 0, 'minting is silent');
  assert.deepEqual(saleLogs(), []);
  const first = await links.emailLink(document.document.id, minted.link.id, { deps });
  assert.deepEqual([first.status, first.sent, first.recipientEmail], [200, true, 'client@exemple.fr']);
  assert.equal(sent.length, 1);
  assert.match(JSON.stringify(sent[0]), /https:\/\/pay\.example\/abc/);
  const [log] = saleLogs();
  assert.deepEqual([log.reservationId, log.saleRef, log.status, log.recipientEmail], [null, `standalone:${document.document.id}`, 'sent', 'client@exemple.fr']);
  assert.match(log.renderedBody, /Jean/);
  assert.match(log.renderedBody, /13[^0-9]*€/);
  await links.emailLink(document.document.id, minted.link.id, { deps });
  assert.equal(sent.length, 2, 'one send per click');
  assert.equal(saleLogs().length, 2);
  assert.ok(standaloneSale.documentOf(document.document.id).history.some((h) => h.text === 'Lien envoyé à client@exemple.fr'));
});

test('rule 42: no address, no open link or a disabled template: nothing leaves', async () => {
  const anonymous = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 1 }], customer: { email: 'a@exemple.fr' } }).document;
  const minted = await links.mint(anonymous.document.id);
  db.prepare('UPDATE standalone_sales SET customerEmail = NULL WHERE id = ?').run(anonymous.document.id);
  assert.equal((await links.emailLink(anonymous.document.id, minted.link.id, { deps })).body.code, 'NO_EMAIL');
  db.prepare("UPDATE standalone_sales SET customerEmail = 'a@exemple.fr' WHERE id = ?").run(anonymous.document.id);
  db.prepare("UPDATE email_templates SET enabled = 0 WHERE stableKey = 'visit_payment_request'").run();
  assert.equal((await links.emailLink(anonymous.document.id, minted.link.id, { deps })).body.code, 'TEMPLATE_DISABLED');
  db.prepare("UPDATE email_templates SET enabled = 1 WHERE stableKey = 'visit_payment_request'").run();
  await links.withdraw(anonymous.document.id, minted.link.id);
  assert.equal((await links.emailLink(anonymous.document.id, minted.link.id, { deps })).body.code, 'LINK_NOT_OPEN');
  assert.equal(sent.length, 2, 'still only the two clicks of the first test');
});

test('rule 42: no date-driven queue and no cron ever lists it, and the template stays manual in the database', () => {
  const row = db.prepare("SELECT sendMode FROM email_templates WHERE stableKey = 'visit_payment_request'").get();
  assert.equal(row.sendMode, 'manual');
  const pending = emailLogModel.listPending({ today: '2027-03-10' });
  assert.equal(pending.some((p) => p.stableKey === 'visit_payment_request'), false);
});
