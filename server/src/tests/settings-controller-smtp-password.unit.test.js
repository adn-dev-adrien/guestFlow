const test = require('node:test');
const assert = require('node:assert/strict');

// Spies on settingsModel.upsert via require.cache stubbing, then drives updateSettings with various
// payloads to assert the whitespace-stripping behaviour on smtp.password. The pivotal scenario:
// Adrien copy-pastes a Gmail App Password verbatim from Google's UI (`abcd efgh ijkl mnop`) — the
// transport will reject the spaces, so the controller cleans it before encryption.

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

// Stub the response shaper so updateSettings can return without doing anything fancy.
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

test('Gmail App Password 4×4 format with spaces is stored space-free', () => {
  const { upserted: pl } = call({ smtp: { password: 'abcd efgh ijkl mnop' } });
  assert.equal(pl.smtpPasswordEncrypted, 'abcdefghijklmnop');
});

test('every whitespace variant is stripped: tabs, multiple spaces, leading/trailing, line breaks', () => {
  const { upserted: pl } = call({ smtp: { password: '   abcd\tefgh\n\nijkl    mnop   ' } });
  assert.equal(pl.smtpPasswordEncrypted, 'abcdefghijklmnop');
});

test('password without whitespace passes through unchanged', () => {
  const { upserted: pl } = call({ smtp: { password: 'JustAPlainSecret1!' } });
  assert.equal(pl.smtpPasswordEncrypted, 'JustAPlainSecret1!');
});

test('explicit empty string clears the password (3-way semantics preserved)', () => {
  const { upserted: pl } = call({ smtp: { password: '' } });
  assert.equal(pl.smtpPasswordEncrypted, '');
});

test('null clears like empty string', () => {
  const { upserted: pl } = call({ smtp: { password: null } });
  assert.equal(pl.smtpPasswordEncrypted, '');
});

test('absent password property → field never set in payload (preserve existing)', () => {
  const { upserted: pl } = call({ smtp: { host: 'smtp.gmail.com' } });
  assert.equal(Object.prototype.hasOwnProperty.call(pl, 'smtpPasswordEncrypted'), false);
});

test('password that is ONLY whitespace becomes empty (treated as a clear)', () => {
  const { upserted: pl } = call({ smtp: { password: '       ' } });
  assert.equal(pl.smtpPasswordEncrypted, '');
});
