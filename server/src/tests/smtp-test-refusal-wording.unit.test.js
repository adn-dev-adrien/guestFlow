// specs/ui-review-2026-10-19-operations.md rule 44 (R23 verification F7) — a failed test mail keeps its code and says so in
// French, never the transport's own words.
const test = require('node:test');
const assert = require('node:assert/strict');

require.cache[require.resolve('../models/settingsModel')] = {
  exports: { smtpConfigured: () => true, read: () => ({}), decryptedSmtpSettings: () => ({}) },
};
require.cache[require.resolve('../utils/emailService')] = {
  exports: { createEmailService: () => ({ sendTest: () => Promise.reject(new Error('535 auth failed at smtp.example.invalid')) }) },
};
const controller = require('../controllers/settingsController');

test('rule 44: SMTP_TEST_FAILED carries a French message', async () => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.sendSmtpTest({ user: { email: 'a@b.test' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'SMTP_TEST_FAILED', JSON.stringify(res.body));
  assert.equal(res.body.message, 'Envoi d’essai refusé par le serveur d’e-mails.');
});
