/**
 * The SMTP port is not asked for any more — it is the security mode, said twice.
 * See specs/settings-one-save-and-automatic-webhook.md §3 rule 5.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { deriveSmtpPort, SMTP_FIELDS } } = require('../controllers/settingsController');
const { smtpPortForSecure } = require('../utils/settingsValidation');

// Rule 5 — the two ports the two modes imply.
test('rule 5: implicit TLS means 465, STARTTLS means 587', () => {
  assert.equal(smtpPortForSecure(true), 465);
  assert.equal(smtpPortForSecure(1), 465);
  assert.equal(smtpPortForSecure('1'), 465);
  assert.equal(smtpPortForSecure(false), 587);
  assert.equal(smtpPortForSecure(0), 587);
  assert.equal(smtpPortForSecure(undefined), 587);
});

// Rule 5 — saving the security mode writes the port that goes with it.
test('rule 5: a save that sets the security mode writes the matching port', () => {
  assert.equal(deriveSmtpPort({ secure: true }, { smtpSecure: 1 }).smtpPort, 465);
  assert.equal(deriveSmtpPort({ secure: false }, { smtpSecure: 0 }).smtpPort, 587);
});

// Rule 5 — a port sent by a client is ignored: there is no longer a field that could carry one, and
// the mapping must not grow one back by accident.
test('rule 5: the SMTP field map has no port entry, so a sent port cannot be stored', () => {
  assert.equal(SMTP_FIELDS.some((f) => f.input === 'port'), false);
  assert.equal(SMTP_FIELDS.some((f) => f.column === 'smtpPort'), false);

  // Even when the payload carries one, the derivation is what decides.
  const payload = { smtpSecure: 1 };
  assert.equal(deriveSmtpPort({ secure: true, port: 2525 }, payload).smtpPort, 465);
});

// Rule 5 edge case — an installation on a non-standard port keeps it until the card is saved.
test('rule 5: a save that does not touch the security mode leaves the stored port alone', () => {
  const payload = { smtpHost: 'smtp.example.com' };
  deriveSmtpPort({ host: 'smtp.example.com' }, payload);
  assert.equal('smtpPort' in payload, false, 'nothing about the port is written');

  const untouched = {};
  deriveSmtpPort(null, untouched);
  assert.deepEqual(untouched, {});
});
