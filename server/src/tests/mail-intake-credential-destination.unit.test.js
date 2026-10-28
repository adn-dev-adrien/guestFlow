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
  assert.equal(resolveImapHost('smtp.gmail.com', 'imap.gmail.com'), 'imap.gmail.com');
  assert.equal(resolveImapHost('mail.example.org', 'mail.example.org'), 'mail.example.org');
});

function assertSupportLocked(plugin) {
  registry.reset();
  plugin.register(createContext(plugin.id, { db: new Database(':memory:'), settingsModel: { get: () => '', set() {}, raw: () => '' } }));
  for (const key of ['imapHost', 'imapPort', 'senderAddress', 'senderDomains', 'trustedAuthservId']) {
    assert.equal(forbiddenReason('PUT', `/plugins/${plugin.id}/settings`, { [key]: 'x' }), 'credentials', key);
  }
  assert.equal(forbiddenReason('PUT', `/plugins/${plugin.id}/settings`, { pollEveryHours: '6' }), null);
  assert.equal(forbiddenReason('GET', `/plugins/${plugin.id}/settings`, {}), null);
}

test('airbnb-intake: the host, port, sender and signature settings are refused to a support session', { skip: skipWithout(['airbnb-intake']) }, () => assertSupportLocked(airbnb));
test('gites-de-france-intake: the host, port, sender and signature settings are refused to a support session', { skip: skipWithout(['gites-de-france-intake']) }, () => assertSupportLocked(gdf));
