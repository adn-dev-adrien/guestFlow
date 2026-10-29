// specs/airbnb-mail-intake.md rule 23, specs/gites-de-france-mail-intake.md rule 22, specs/hosting-h2-account-security.md
// rule 18 — the SMTP password is only offered over TLS, only to a host of the SMTP server's domain, and the
// settings that decide where it goes (or who vouches for a sender) are refused to a support session.
const test = require('node:test');
const assert = require('node:assert/strict');

const { connectionOptions, resolveImapHost, testConnection, readMailsFrom } = require('../plugins/sdk/mailboxReader');
const { forbiddenReason } = require('../utils/supportSessionPolicy');
const registry = require('../plugins/sdk/registry');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const airbnb = optionalPlugin(() => require('../plugins/airbnb-intake'));
const gdf = optionalPlugin(() => require('../plugins/gites-de-france-intake'));
const { createContext } = require('../plugins/sdk/createContext');
const Database = require('better-sqlite3');

const CREDS = { host: 'imap.example.com', user: 'owner@example.com', password: 'OWNER-SECRET' };

test('993 is implicit TLS, any other port must upgrade with STARTTLS — never plaintext', () => {
  const tls = connectionOptions({ ...CREDS, port: 993 });
  assert.equal(tls.secure, true);
  for (const port of [143, 14399, '143']) {
    const o = connectionOptions({ ...CREDS, port });
    assert.equal(o.secure, false);
    assert.equal(o.doSTARTTLS, true, `port ${port} requires STARTTLS`);
  }
});

test('the reader and the connection test both build their client with those options', async () => {
  const seen = [];
  class Capture {
    constructor(options) { seen.push(options); }
    async connect() { throw new Error('stop'); }
    async logout() {}
  }
  await assert.rejects(readMailsFrom({ ...CREDS, port: 143, sender: 'a@b.c', ImapClient: Capture }), /stop/);
  await testConnection({ ...CREDS, port: 143, ImapClient: Capture });
  assert.equal(seen.length, 2);
  for (const o of seen) assert.equal(o.doSTARTTLS, true);
});

test('the password goes only to a host of the SMTP server\'s domain', () => {
  assert.equal(resolveImapHost('smtp.example.com', ''), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'mail.example.com'), 'mail.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'IMAP.Example.com'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'example.com'), 'example.com');
  assert.equal(resolveImapHost('smtp.example.com', '127.0.0.1'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'attacker.tld'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'example.com.attacker.tld'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'notexample.com'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', 'a.b.example.com'), 'imap.example.com', 'two labels away is another machine');
  assert.equal(resolveImapHost('ssl0.ovh.net', 'vps-x.vps.ovh.net'), 'ssl0.ovh.net', 'a shared provider domain does not open every host under it');
  assert.equal(resolveImapHost('smtp.example.co.uk', 'imap.other.co.uk'), 'imap.example.co.uk');
  assert.equal(resolveImapHost('smtp.co.uk', 'evil.co.uk'), 'imap.co.uk', 'a public suffix is never a parent');
  assert.equal(resolveImapHost('203.0.113.7', '203.0.113.8'), '203.0.113.7', 'an IP only matches itself');
  assert.equal(resolveImapHost('smtp.example.com', '203.0.113.8'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.example.com', '[::1]'), 'imap.example.com');
  assert.equal(resolveImapHost('smtp.gmail.com', 'imap.gmail.com'), 'imap.gmail.com');
  assert.equal(resolveImapHost('mail.example.org', 'mail.example.org'), 'mail.example.org');
});

test('the reader and the connection test pin the host themselves, whatever the caller passes', async () => {
  const seen = [];
  class Capture {
    constructor(options) { seen.push(options.host); }
    async connect() { throw new Error('stop'); }
    async logout() {}
  }
  const smtpHostOf = () => 'smtp.example.com';
  await assert.rejects(readMailsFrom({ ...CREDS, host: '127.0.0.1', sender: 'a@b.c', ImapClient: Capture, smtpHostOf }), /stop/);
  await assert.rejects(readMailsFrom({ ...CREDS, host: 'imap.attacker.tld', sender: 'a@b.c', ImapClient: Capture, smtpHostOf }), /stop/);
  await testConnection({ ...CREDS, host: 'imap.attacker.tld', ImapClient: Capture, smtpHostOf });
  await assert.rejects(readMailsFrom({ ...CREDS, host: 'mail.example.com', sender: 'a@b.c', ImapClient: Capture, smtpHostOf }), /stop/);
  assert.deepEqual(seen, ['imap.example.com', 'imap.example.com', 'imap.example.com', 'mail.example.com']);
});

test('a support session cannot roll a plugin back, nor update it to a chosen version', () => {
  assert.equal(forbiddenReason('POST', '/plugins/airbnb-intake/rollback', {}), 'credentials');
  assert.equal(forbiddenReason('POST', '/Plugins/airbnb-intake/Rollback/', {}), 'credentials');
  assert.equal(forbiddenReason('POST', '/plugins/airbnb-intake/update', { version: '1.0.2' }), 'credentials');
  assert.equal(forbiddenReason('POST', '/plugins/airbnb-intake/update', {}), null, 'the newest version stays allowed');
  assert.equal(forbiddenReason('POST', '/plugins/update-all', {}), null);
});

function assertSupportLocked(plugin, fullForm) {
  registry.reset();
  plugin.register(createContext(plugin.id, { db: new Database(':memory:'), settingsModel: { get: () => '', set() {}, raw: () => '' } }));
  const pluginSettingsModel = require('../models/pluginSettingsModel');
  const originalRaw = pluginSettingsModel.raw;
  const stored = { senderAddress: fullForm.senderAddress, imapHost: '', imapPort: '', senderDomains: '', trustedAuthservId: '' };
  pluginSettingsModel.raw = (id, key) => (id === plugin.id && key in stored ? stored[key] : '');
  try {
    const put = (body) => forbiddenReason('PUT', `/plugins/${plugin.id}/settings`, body);
    // The card sends every key on save, locked ones included: unchanged values pass (the defaults count as stored).
    assert.equal(put({ ...fullForm, pollEveryHours: '6' }), null, 'a realistic full-form save with nothing locked changed');
    assert.equal(put({ ...fullForm, imapPort: '993', imapHost: ' ' }), null);
    for (const [key, value] of [['imapHost', 'imap.attacker.tld'], ['imapPort', '143'], ['senderAddress', 'x@attacker.tld'], ['senderDomains', 'attacker.tld'], ['trustedAuthservId', 'forger.tld']]) {
      assert.equal(put({ ...fullForm, [key]: value }), 'credentials', key);
      assert.equal(put({ [key]: value }), 'credentials', `${key} alone`);
    }
    assert.equal(put({ pollEveryHours: '6' }), null);
    assert.equal(forbiddenReason('GET', `/plugins/${plugin.id}/settings`, {}), null);
  } finally {
    pluginSettingsModel.raw = originalRaw;
  }
}

const AIRBNB_FORM = { senderAddress: 'automated@airbnb.com', imapHost: '', imapPort: '993', pollEveryHours: '3', listings: '{}', autoApply: '1', senderDomains: '', trustedAuthservId: '' };
const GDF_FORM = { senderAddress: 'resa@gdf07.com', imapHost: '', imapPort: '993', pollEveryHours: '3', giteNumbers: '{}', autoApply: '1', senderDomains: '', trustedAuthservId: '' };

test('airbnb-intake: locked settings refuse a change from a support session, not an unchanged full form', { skip: skipWithout(['airbnb-intake']) }, () => assertSupportLocked(airbnb, AIRBNB_FORM));
test('gites-de-france-intake: locked settings refuse a change from a support session, not an unchanged full form', { skip: skipWithout(['gites-de-france-intake']) }, () => assertSupportLocked(gdf, GDF_FORM));

function imapHostValidator(plugin) {
  registry.reset();
  plugin.register(createContext(plugin.id, { db: new Database(':memory:'), settingsModel: { get: () => '', set() {}, raw: () => '' } }));
  return registry.get(plugin.id).settings.find((k) => k.key === 'imapHost').validate;
}

function assertImapHostValidation(plugin) {
  const settingsModel = require('../models/settingsModel');
  const MESSAGE = 'Un serveur du même domaine que le serveur d’envoi.';
  const withSmtp = (host, run) => {
    const original = settingsModel.decryptedSmtpSettings;
    settingsModel.decryptedSmtpSettings = () => ({ host, user: 'u', password: 'p' });
    try { run(imapHostValidator(plugin)); } finally { settingsModel.decryptedSmtpSettings = original; }
  };
  withSmtp('smtp.gmail.com', (validate) => {
    assert.equal(validate('imap.attacker.tld'), MESSAGE);
    assert.equal(validate('imap.gmail.com'), null);
    assert.equal(validate(''), null);
  });
  withSmtp('', (validate) => {
    assert.equal(validate('imap.gmail.com'), MESSAGE);
  });
}

test('airbnb-intake: the IMAP host must belong to the SMTP server\'s domain', { skip: skipWithout(['airbnb-intake']) }, () => assertImapHostValidation(airbnb));
test('gites-de-france-intake: the IMAP host must belong to the SMTP server\'s domain', { skip: skipWithout(['gites-de-france-intake']) }, () => assertImapHostValidation(gdf));
