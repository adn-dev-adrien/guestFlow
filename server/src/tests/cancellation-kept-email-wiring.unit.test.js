// specs/payment-schedule-and-cancellation.md rule 61 (verification R44 L3) — the sum kept reaches every sender of a
// guest e-mail, not only `reservationEmailSender`: the fiche's preview and manual send (`loadReservationGraph`, the
// emails controller) and the daily auto pass (`emailAutoSendRunner`). Removing `cancellationKept` from either fails here.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, rowOf, mark, ADMIN, TODAY, WITH_ACOMPTE, D, fiche, refund,
} = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const { buildController: buildEmails } = require('../controllers/emailsController');
const { performAutoEmailPass } = require('../utils/emailAutoSendRunner');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const settingsModel = require('../models/settingsModel');
const { emailAmount } = require('../utils/emailMoney');

const cents = (euros) => Math.round(Number(euros) * 100);
const keptSentence = (amount) => `la somme de ${emailAmount(amount, 'fr')} déjà versée reste acquise`;

function guestEmail(id) {
  db.prepare("UPDATE clients SET email = 'guest@example.invalid', emailLanguage = 'fr' WHERE id = ?").run(rowOf(id).clientId);
}

// An acompte paid by transfer, 50 € given back before: the cancel keeps the acompte less 50 €.
function stayWithRefundBefore() {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  guestEmail(stay.id);
  return { stay, kept: (cents(rowOf(stay.id).depositAmount) - 5000) / 100 };
}

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    Promise.resolve(handler({ body: {}, params: {}, query: {}, user: ADMIN, ...req }, res));
  });
}

const templateIdOf = (stableKey) => db.prepare('SELECT id FROM email_templates WHERE stableKey = ?').get(stableKey).id;

test('rule 61 — the preview of a cancelled stay\'s notice states the sum the cancel kept', async () => {
  const { stay, kept } = stayWithRefundBefore();
  const res = respond();
  await cancellationController.cancel({ params: { id: String(stay.id) }, body: { reason: 'Test', notifyClient: false }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.keptFromGuest, kept);

  const emails = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel,
    emailServiceFactory: () => ({ send: async () => {} }),
  });
  const preview = await call(emails.preview, { query: { reservationId: String(stay.id), templateId: String(templateIdOf('cancellation_notice')) } });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.body.includes(keptSentence(kept)), preview.body.body);
});

test('rule 61 — the auto pass renders the live stay\'s sum kept, the one the cancel would book', async () => {
  const { stay, kept } = stayWithRefundBefore();
  const start = rowOf(stay.id).startDate;
  const offset = -Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86400000);
  const info = db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled, anchor)
    VALUES ('r44b_kept_wiring', 'Sonde', 'Sonde', 'Conservé : {{retainedDepositAmount}}{{#if hasRetainedDeposit}} (oui){{/if}}', ?, 'auto', 1, 'start')`).run(offset);
  try {
    const sent = [];
    const result = await performAutoEmailPass({
      database: db,
      templatesModel: emailTemplatesModel.buildModel(db),
      logModel: emailLogModel.buildModel(db),
      settingsModel,
      emailServiceFactory: () => ({ send: async (message) => { sent.push(message.text); } }),
      today: TODAY,
    });
    const mine = result.results.find((entry) => entry.reservationId === stay.id && entry.templateId === Number(info.lastInsertRowid));
    assert.ok(mine && mine.status === 'sent', JSON.stringify(result.results));
    const body = db.prepare('SELECT renderedBody FROM email_log WHERE id = ?').get(mine.emailLogId).renderedBody;
    assert.equal(body, `Conservé : ${emailAmount(kept, 'fr')} (oui)`);
  } finally {
    db.prepare('DELETE FROM email_log WHERE templateId = ?').run(Number(info.lastInsertRowid));
    db.prepare('DELETE FROM email_templates WHERE id = ?').run(Number(info.lastInsertRowid));
  }
});

test('rule 61 — the operator reads the two tokens by what they carry: a sum kept, not only an acompte', () => {
  const { VARIABLES, FLAGS } = require('../utils/templateTokens');
  const labelOf = (list, name) => list.find((entry) => entry.name === name).label;
  assert.equal(labelOf(VARIABLES, 'retainedDepositAmount'), 'Somme conservée');
  assert.equal(labelOf(FLAGS, 'hasRetainedDeposit'), 'Si somme conservée');
});
