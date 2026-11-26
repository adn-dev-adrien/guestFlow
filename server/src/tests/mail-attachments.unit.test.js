// specs/gift-vouchers/gift-voucher-campaigns.md rule 37 (SDK 2.33.0) — `ctx.mail.send` forwards `attachments: [{ filename, content, contentType }]` to the
// operator's mail service, and the service hands them to the transport; without attachments the message is what it always was.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createContext } = require('../plugins/sdk/createContext');
const { createEmailService } = require('../utils/emailService');

const PDF = { filename: 'bon-cadeau.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' };

test('ctx.mail.send passes the attachments to the mail service', async () => {
  const sent = [];
  const ctx = createContext('mail-attach-probe', { mailService: () => ({ send: async (message) => { sent.push(message); return { messageId: 'm1' }; } }) });
  const out = await ctx.mail.send({
    to: 'a@b.test', subject: 'Votre bon', text: 'Voir la pièce jointe', key: 'voucher', attachments: [PDF],
  });
  assert.deepEqual(out, { messageId: 'm1' });
  assert.deepEqual(sent[0].attachments, [PDF]);
});

test('without attachments nothing new is sent along', async () => {
  const sent = [];
  const ctx = createContext('mail-attach-none', { mailService: () => ({ send: async (message) => { sent.push(message); return {}; } }) });
  await ctx.mail.send({ to: 'a@b.test', subject: 's', text: 't', attachments: [] });
  assert.equal('attachments' in sent[0], false);
});

test('the email service gives the attachments to the transport, the message otherwise unchanged', async () => {
  const payloads = [];
  const service = createEmailService(
    { host: 'smtp.test', fromEmail: 'from@x.test' },
    { transportFactory: () => ({ sendMail: async (payload) => { payloads.push(payload); return { messageId: 'x' }; } }), env: {} },
  );
  await service.send({
    to: 'a@b.test', subject: 's', text: 't', attachments: [PDF],
  });
  await service.send({ to: 'a@b.test', subject: 's', text: 't' });
  assert.deepEqual(payloads[0].attachments, [PDF]);
  assert.equal('attachments' in payloads[1], false);
});

test('the development outbox composes the MIME when there are attachments, so they can be read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-outbox-'));
  try {
    const service = createEmailService({ host: 'smtp.test', fromEmail: 'from@x.test' }, { env: { GUESTFLOW_MAIL_OUTBOX: dir } });
    await service.send({
      to: 'a@b.test', subject: 's', text: 't', attachments: [PDF],
    });
    const [file] = fs.readdirSync(dir);
    const written = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.match(written.mime, /filename=bon-cadeau\.pdf/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
