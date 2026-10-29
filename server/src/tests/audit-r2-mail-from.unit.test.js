// specs/hosting-h1-fleet-runtime.md rule 36 (audit R2, finding N1) — the From display name is never quoted by
// hand: nodemailer encodes it, so no payload can rewrite the From address or the envelope sender.
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const { headers } = require('../utils/platformMail');
const { createEmailService } = require('../utils/emailService');
const { validateDisplayName } = require('../utils/settingsValidation');

const PAYLOADS = [
  'a\\", spoof@attacker.test, "b',
  'a\\" <ceo@platform.test>, "z',
  'x\\',
  'Acme\\"\r\nBcc: x@evil.test',
  'Gîte Solio',
];
const wire = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

test('rule 36: the platform From keeps the configured address and envelope whatever the display name says', async () => {
  for (const fromName of PAYLOADS) {
    const h = headers({ cfg: { from: 'noreply@platform.test' }, fromName, replyTo: 'owner@example.invalid' });
    const info = await wire.sendMail({ ...h, to: 'guest@example.invalid', subject: 's', text: 't' });
    assert.equal(info.envelope.from, 'noreply@platform.test', JSON.stringify(fromName));
    assert.deepEqual(info.envelope.to, ['guest@example.invalid']);
    const raw = info.message.toString();
    assert.equal((raw.match(/^From: /gm) || []).length, 1);
    assert.ok(!/^Bcc:/mi.test(raw));
    assert.match(raw, /^From: [\s\S]*?<noreply@platform\.test>\s*$/m);
  }
});

test('rule 36: the operator SMTP From is an { name, address } pair too', async () => {
  for (const fromName of PAYLOADS) {
    let sent;
    const svc = createEmailService(
      { host: 'smtp.example.test', fromName, fromEmail: 'contact@solio.example', user: 'u', password: 'p' },
      { env: {}, transportFactory: () => ({ sendMail: async (m) => { sent = m; return { messageId: 'x' }; } }) },
    );
    await svc.send({ to: 'guest@example.invalid', subject: 's', text: 't' });
    assert.deepEqual(sent.from, { name: fromName.trim(), address: 'contact@solio.example' });
    const info = await wire.sendMail({ ...sent, subject: 's', to: 'guest@example.invalid', text: 't' });
    assert.equal(info.envelope.from, 'contact@solio.example');
  }
});

test('rule 36: a display name is refused when it carries a control character or exceeds 120 characters', () => {
  assert.equal(validateDisplayName('Domaine Solio'), null);
  assert.equal(validateDisplayName(''), null);
  assert.match(validateDisplayName('A\r\nBcc: x@evil.test'), /Caractère interdit/);
  assert.match(validateDisplayName('a'.repeat(121)), /120/);
  assert.equal(validateDisplayName('a'.repeat(120)), null);
});
