// specs/email-language-fr-en.md rule 11 (adversarial review of the 2026-10-27 fixes) — the payment
// request e-mail wrote {{paymentAmount}} with the French invoice formatter (« 1234,56 € », always
// « ,00 ») over the context builder's own amount, so an English guest read « 1234,56 € » and a French
// one « 1240,00 € » beside « 300 € ». The amount the link charges now travels as euros and is written
// by the e-mail formatter, in the guest's language.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pay-amount-')), 'guestflow.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const SENDER = require.resolve('../utils/reservationEmailSender');
const realSender = require(SENDER);
const captured = [];
require.cache[SENDER].exports = {
  ...realSender,
  sendReservationTemplateEmail: async (args) => { captured.push(args); return { sent: true }; },
};
const { __test } = require('../controllers/paymentsController');
require.cache[SENDER].exports = realSender;

const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');

const db = require('../database');
db.prepare("INSERT INTO properties (name) VALUES ('La Granja')").run();
const propertyId = db.prepare('SELECT MAX(id) AS id FROM properties').get().id;

function seed(lang) {
  const client = db.prepare('INSERT INTO clients (firstName, lastName, email, emailLanguage) VALUES (?, ?, ?, ?)').run('Ann', 'Lee', 'ann@x.test', lang);
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
                           VALUES ('reservation', ?, ?, '2027-08-10', '2027-08-12', 2, 1534.56, 300, 1234.56)`).run(propertyId, client.lastInsertRowid);
  return { db, reservationId: Number(info.lastInsertRowid) };
}

const fakeSettings = {
  read: () => ({ companyName: 'Solio', smtpFromName: 'Solio' }),
  decryptedSmtpSettings: () => ({ host: 'smtp', port: 587, user: 'u', password: 'p', fromEmail: 'no-reply@solio.test', fromName: 'Solio' }),
};

async function sendBalanceRequest(lang, amountCents) {
  captured.length = 0;
  await __test.requestServiceDeps(null).sendTemplate({ reservationId: 1, stableKey: 'full_request', paymentLink: 'https://pay.example/l', amountCents });
  const { extraContext } = captured[0];
  const { db, reservationId } = seed(lang);
  const sent = [];
  const r = await realSender.sendReservationTemplateEmail({
    database: db, templatesModel: emailTemplatesModel.buildModel(db), logModel: emailLogModel.buildModel(db),
    settingsModel: fakeSettings, emailServiceFactory: () => ({ send: async (m) => { sent.push(m); } }),
    reservationId, stableKey: 'full_request', extraContext,
  });
  assert.equal(r.sent, true, String(r.reason));
  return sent[0].text;
}

test('an English guest reads the requested amount the English way', async () => {
  const text = await sendBalanceRequest('en', 123456);
  assert.match(text, /Amount to pay: €1,234\.56/);
  assert.doesNotMatch(text, /1234,56/);
});

test('a French guest reads a whole amount without « ,00 », grouped like the rest of the mail', async () => {
  const text = await sendBalanceRequest('fr', 124000);
  assert.match(text, /Montant à régler : 1 240 €/);
  assert.doesNotMatch(text, /1240,00/);
});

test('the controller hands the amount as euros, never pre-formatted', () => {
  captured.length = 0;
  __test.requestServiceDeps(null).sendTemplate({ reservationId: 1, stableKey: 'full_request', paymentLink: 'x', amountCents: 9050 });
  const { extraContext } = captured[0];
  assert.equal(extraContext.amounts.paymentAmount, 90.5);
  assert.equal(extraContext.vars.paymentAmount, undefined);
});
