const test = require('node:test');
const assert = require('node:assert/strict');

// Header-injection guard on the settings boundary (specs/admin-account-management.md §3.4 rule 16b).
// `smtpFromName`, `smtpFromEmail` and `notificationRecipientEmail` are the three settings that end
// up VERBATIM inside an email header — `From: "<name>" <address>` and `To: <address>`. A control
// character in any of them would close the header line and let whatever follows be parsed as a new
// header (`Bcc:`, `Content-Type:`…). The controller must refuse it rather than store it, and must
// trim the surrounding whitespace the validator deliberately tolerates.

let upserted = null;

require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    upsert(payload) { upserted = payload; },
    read() { return {}; },
    updateLogoPath() {},
    smtpConfigured() { return false; },
    decryptedSmtpSettings() { return {}; },
    publicUrl() { return ''; },
  },
};

require.cache[require.resolve('../utils/settingsResponse')] = {
  exports: { shapeResponse: (row) => row },
};

const { updateSettings } = require('../controllers/settingsController');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

function call(body) {
  upserted = null;
  const res = fakeRes();
  updateSettings({ body }, res);
  return { upserted, res };
}

test('a CRLF in the SMTP display name is rejected, and nothing is written', () => {
  const { upserted: pl, res } = call({
    smtp: { fromName: 'Domaine Solio\r\nBcc: pirate@evil.com' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'SETTINGS_INVALID');
  assert.match(res.body.errors.smtpFromName, /Caractère interdit/);
  assert.equal(pl, null);
});

test('a CRLF in the sender address is rejected under its own error key', () => {
  const { upserted: pl, res } = call({
    smtp: { fromEmail: 'contact@domainesolio.com\r\nBcc: pirate@evil.com' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.errors.smtpFromEmail, /Caractère interdit/);
  assert.equal(pl, null);
});

test('a CRLF in the notification recipient is rejected too — it becomes a To: header', () => {
  const { upserted: pl, res } = call({
    notifications: { recipientEmail: 'adrien@example.com\r\nBcc: pirate@evil.com' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.errors.notificationRecipientEmail, /Caractère interdit/);
  assert.equal(pl, null);
});

test('a NUL or DEL smuggled into the display name is rejected as well', () => {
  const nul = call({ smtp: { fromName: `Domaine${String.fromCharCode(0)}Solio` } });
  assert.equal(nul.res.statusCode, 400);
  const del = call({ smtp: { fromName: `Domaine${String.fromCharCode(127)}Solio` } });
  assert.equal(del.res.statusCode, 400);
});

test('a value pasted with a trailing newline is accepted and stored trimmed', () => {
  const { upserted: pl, res } = call({
    smtp: { fromName: '  Domaine Solio\r\n', fromEmail: ' contact@domainesolio.com \n' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(pl.smtpFromName, 'Domaine Solio');
  assert.equal(pl.smtpFromEmail, 'contact@domainesolio.com');
});

test('the notification recipient is trimmed on the way in', () => {
  const { upserted: pl } = call({ notifications: { recipientEmail: '  adrien@example.com\n' } });
  assert.equal(pl.notificationRecipientEmail, 'adrien@example.com');
});

test('an ordinary accented display name is stored unchanged', () => {
  const { upserted: pl, res } = call({ smtp: { fromName: 'Gîte Solio — été' } });
  assert.equal(res.statusCode, 200);
  assert.equal(pl.smtpFromName, 'Gîte Solio — été');
});

test('clearing the display name still works (empty string is valid)', () => {
  const { upserted: pl, res } = call({ smtp: { fromName: '' } });
  assert.equal(res.statusCode, 200);
  assert.equal(pl.smtpFromName, '');
});
