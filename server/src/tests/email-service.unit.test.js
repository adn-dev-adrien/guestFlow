const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmailService } = require('../utils/emailService');

// Stubs nodemailer via the `transportFactory` override so no network call is made. We assert the
// transport options + the sendMail payload (from / to / subject / text), plus the misconfigured +
// transport-failure error paths.

function makeFakeTransport({ failWith = null } = {}) {
  const calls = { transportOptions: null, sendMail: [] };
  const transport = {
    sendMail(payload) {
      calls.sendMail.push(payload);
      if (failWith) return Promise.reject(failWith);
      return Promise.resolve({ messageId: 'fake-1' });
    },
  };
  const transportFactory = (opts) => {
    calls.transportOptions = opts;
    return transport;
  };
  return { transportFactory, calls };
}

test('isConfigured = false when host is missing → send/sendTest throw EMAIL_NOT_CONFIGURED', async () => {
  const svc = createEmailService({ host: '', fromEmail: 'a@b.c' });
  assert.equal(svc.isConfigured, false);
  await assert.rejects(svc.send({ to: 'x@y.z', subject: 's', text: 't' }), /EMAIL_NOT_CONFIGURED/);
  await assert.rejects(svc.sendTest('x@y.z'), /EMAIL_NOT_CONFIGURED/);
});

test('isConfigured = false when fromEmail is missing → send/sendTest throw EMAIL_NOT_CONFIGURED', async () => {
  const svc = createEmailService({ host: 'smtp.example.com', fromEmail: '' });
  assert.equal(svc.isConfigured, false);
  await assert.rejects(svc.send({ to: 'x@y.z', subject: 's', text: 't' }), /EMAIL_NOT_CONFIGURED/);
});

test('send builds the transport lazily and forwards from/to/subject/text correctly', async () => {
  const { transportFactory, calls } = makeFakeTransport();
  const svc = createEmailService({
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'noreply@example.com',
    password: 'secret',
    fromEmail: 'noreply@example.com',
    fromName: 'GuestFlow Team',
  }, { transportFactory });

  assert.equal(svc.isConfigured, true);
  assert.equal(calls.transportOptions, null, 'transport not built before first send');

  await svc.send({ to: 'marie@example.org', subject: 'Bienvenue', text: 'Hello' });

  assert.deepEqual(calls.transportOptions, {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    auth: { user: 'noreply@example.com', pass: 'secret' },
  });
  assert.equal(calls.sendMail.length, 1);
  assert.deepEqual(calls.sendMail[0], {
    from: '"GuestFlow Team" <noreply@example.com>',
    to: 'marie@example.org',
    subject: 'Bienvenue',
    text: 'Hello',
  });
});

test('fromName defaults to "GuestFlow" when missing', async () => {
  const { transportFactory, calls } = makeFakeTransport();
  const svc = createEmailService({
    host: 'smtp.example.com',
    fromEmail: 'a@b.c',
  }, { transportFactory });
  await svc.send({ to: 'x@y.z', subject: 's', text: 't' });
  assert.equal(calls.sendMail[0].from, '"GuestFlow" <a@b.c>');
});

test('sendTest uses the testEmailBody template and lands as a normal send call', async () => {
  const { transportFactory, calls } = makeFakeTransport();
  const svc = createEmailService({
    host: 'smtp.example.com', fromEmail: 'noreply@example.com',
  }, { transportFactory });
  await svc.sendTest('admin@example.org');
  assert.equal(calls.sendMail.length, 1);
  assert.equal(calls.sendMail[0].to, 'admin@example.org');
  assert.equal(calls.sendMail[0].subject, 'Email de test GuestFlow');
});

test('transport failure bubbles up to the caller', async () => {
  const failure = new Error('5.7.8 Authentication failed');
  const { transportFactory } = makeFakeTransport({ failWith: failure });
  const svc = createEmailService({
    host: 'smtp.example.com', fromEmail: 'a@b.c',
  }, { transportFactory });
  await assert.rejects(svc.send({ to: 'x@y.z', subject: 's', text: 't' }), /Authentication failed/);
});

test('send rejects without a recipient', async () => {
  const { transportFactory } = makeFakeTransport();
  const svc = createEmailService({
    host: 'smtp.example.com', fromEmail: 'a@b.c',
  }, { transportFactory });
  await assert.rejects(svc.send({ to: '', subject: 's', text: 't' }), /EMAIL_RECIPIENT_REQUIRED/);
});
