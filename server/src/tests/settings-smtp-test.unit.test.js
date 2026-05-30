const test = require('node:test');
const assert = require('node:assert/strict');

// We exercise sendSmtpTest by stubbing nodemailer (so no network call) AND injecting a fake
// settings model. The controller is required AFTER the stubs are installed.

let lastSendMail = null;
let sendMailImpl = () => Promise.resolve({ messageId: 'fake' });

require.cache[require.resolve('nodemailer')] = {
  exports: {
    createTransport(opts) {
      return {
        sendMail(payload) {
          lastSendMail = payload;
          return sendMailImpl(payload);
        },
        __opts: opts,
      };
    },
  },
};

// Stub settingsModel so the controller bypasses the production DB.
let fakeSettings = {
  configured: true,
  fromEmail: 'noreply@example.com',
  fromName: 'GuestFlow Team',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'noreply@example.com',
  password: 'secret',
};

require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    smtpConfigured: () => fakeSettings.configured,
    decryptedSmtpSettings: () => ({
      host: fakeSettings.host,
      port: fakeSettings.port,
      secure: fakeSettings.secure,
      user: fakeSettings.user,
      password: fakeSettings.password,
      fromEmail: fakeSettings.fromEmail,
      fromName: fakeSettings.fromName,
    }),
    publicUrl: () => '',
  },
};

const { sendSmtpTest } = require('../controllers/settingsController');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function resetTest() {
  lastSendMail = null;
  sendMailImpl = () => Promise.resolve({ messageId: 'fake' });
  fakeSettings = {
    configured: true,
    fromEmail: 'noreply@example.com',
    fromName: 'GuestFlow',
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'noreply@example.com',
    password: 'secret',
  };
}

// The pivotal behavioural change for this branch: the test mail is sent to the SMTP sender
// (smtpFromEmail), not to the currently-authenticated admin. That avoids the trap of the seeded
// `admin@guestflow.local` (non-routable .local TLD) bouncing every test.

test('sendSmtpTest: recipient is smtpFromEmail (NOT req.user.email)', async () => {
  resetTest();
  const req = { user: { id: 1, email: 'admin@guestflow.local' } };
  const res = fakeRes();
  await sendSmtpTest(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.recipient, 'noreply@example.com', 'response advertises the sender as the recipient');
  assert.ok(lastSendMail, 'transport.sendMail was called');
  assert.equal(lastSendMail.to, 'noreply@example.com');
  assert.notEqual(lastSendMail.to, 'admin@guestflow.local', 'never falls back to the logged-in user');
  assert.equal(lastSendMail.subject, 'Email de test GuestFlow');
});

test('sendSmtpTest: 400 SMTP_NOT_CONFIGURED when smtpConfigured() is false (no send attempted)', async () => {
  resetTest();
  fakeSettings.configured = false;
  const res = fakeRes();
  await sendSmtpTest({ user: { email: 'whatever@example.com' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'SMTP_NOT_CONFIGURED');
  assert.equal(lastSendMail, null);
});

test('sendSmtpTest: 400 SMTP_TEST_FAILED when the transport rejects (detail surfaced)', async () => {
  resetTest();
  sendMailImpl = () => Promise.reject(new Error('5.7.8 Username and Password not accepted'));
  const res = fakeRes();
  await sendSmtpTest({ user: { email: 'admin@guestflow.local' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'SMTP_TEST_FAILED');
  assert.match(res.body.detail, /Username and Password not accepted/);
});

test('sendSmtpTest: succeeds even when req.user.email is missing (we use the sender, not the session)', async () => {
  resetTest();
  const res = fakeRes();
  await sendSmtpTest({ user: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recipient, 'noreply@example.com');
});
