// specs/guest-email-texts-made-simple.md rule 26 — the « recette » mode: with GUESTFLOW_MAIL_OUTBOX set
// outside production, every email the instance would send (guest emails included) is written to the
// outbox and never reaches an SMTP server; production ignores the variable; an unconfigured SMTP is
// still refused, so the recette answers as the real instance would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEmailService } = require('../utils/emailService');
const { outboxDir } = require('../utils/mailOutbox');

const SMTP = { host: 'smtp.solio.example', port: 587, fromEmail: 'contact@solio.example', fromName: 'Solio', user: 'u', password: 'p' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-recette-'));
const neverConnect = () => { throw new Error('the SMTP server must not be reached'); };

test('rule 26: a configured SMTP with the outbox set writes the guest email to a file, the SMTP is never built', async () => {
  const dir = tmp();
  const svc = createEmailService(SMTP, { env: { GUESTFLOW_MAIL_OUTBOX: dir }, transportFactory: neverConnect });
  assert.equal(svc.isConfigured, true);
  await svc.send({ to: 'guest@example.com', subject: 'Votre séjour', text: 'Bonjour' });
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const mail = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  assert.equal(mail.to, 'guest@example.com');
  assert.equal(mail.subject, 'Votre séjour');
  assert.equal(mail.from.address, 'contact@solio.example');
});

test('rule 26: NODE_ENV=production ignores the outbox — real emails are never silenced by a stray variable', async () => {
  const dir = tmp();
  const sent = [];
  const svc = createEmailService(SMTP, {
    env: { GUESTFLOW_MAIL_OUTBOX: dir, NODE_ENV: 'production' },
    transportFactory: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } }),
  });
  await svc.send({ to: 'guest@example.com', subject: 's', text: 't' });
  assert.equal(sent.length, 1);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(outboxDir({ GUESTFLOW_MAIL_OUTBOX: dir, NODE_ENV: 'production' }), null);
});

test('rule 26: without an SMTP the outbox does not make sending succeed — the recette refuses like the instance', async () => {
  const dir = tmp();
  const svc = createEmailService({ host: '', fromEmail: '' }, { env: { GUESTFLOW_MAIL_OUTBOX: dir }, transportFactory: neverConnect });
  assert.equal(svc.isConfigured, false);
  await assert.rejects(() => svc.send({ to: 'guest@example.com', subject: 's', text: 't' }), /EMAIL_NOT_CONFIGURED/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('rule 26: a hosted instance sending through the platform lands in the outbox too', async () => {
  const dir = tmp();
  const env = { GUESTFLOW_MAIL_OUTBOX: dir, GUESTFLOW_MANAGED: '1', GUESTFLOW_PLATFORM_SMTP_HOST: 'smtp.platform.example', GUESTFLOW_PLATFORM_SMTP_FROM: 'noreply@platform.example' };
  const svc = createEmailService({ host: '', fromEmail: 'claire@aulnes.fr', fromName: 'Aulnes' }, {
    env, transportFactory: neverConnect, counterFile: path.join(tmp(), 'count.json'),
  });
  assert.equal(svc.viaPlatform, true);
  await svc.send({ to: 'guest@example.com', subject: 's', text: 't' });
  assert.equal(fs.readdirSync(dir).length, 1);
});
