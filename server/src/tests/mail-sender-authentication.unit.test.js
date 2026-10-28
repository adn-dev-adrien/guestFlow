// specs/airbnb-mail-intake.md rule 22, specs/gites-de-france-mail-intake.md rule 20 — the mailbox reader
// keeps only mails whose envelope From address IS the sender, and flags the ones the receiving server did
// not authenticate (DKIM pass for the sender's domain).
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyDkim, addressMatches } = require('../plugins/sdk/mailAuthentication');
const { readMailsFrom } = require('../plugins/sdk/mailboxReader');

const ar = (value) => `Authentication-Results: ${value}\r\n`;
const OPTS = { domains: 'gdf07.com' };

test('a valid DKIM pass for the sender domain is accepted', () => {
  assert.deepEqual(verifyDkim(ar('mx.google.com; dkim=pass header.i=@gdf07.com header.s=k1 header.b=abc; spf=pass smtp.mailfrom=gdf07.com'), OPTS), { ok: true, reason: 'dkim-pass' });
  assert.equal(verifyDkim(ar('mx.example; dkim=pass header.d=GDF07.com'), OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; dkim=pass (good signature) d=gdf07.com'), OPTS).ok, true);
  assert.equal(verifyDkim(Buffer.from(ar('mx.example; dkim=pass header.d=gdf07.com')), OPTS).ok, true);
});

test('a missing Authentication-Results header is not authenticated', () => {
  assert.deepEqual(verifyDkim('', OPTS), { ok: false, reason: 'no-authentication-results' });
  assert.deepEqual(verifyDkim(undefined, OPTS), { ok: false, reason: 'no-authentication-results' });
  assert.equal(verifyDkim('Subject: hi\r\n', OPTS).ok, false);
});

test('dkim=fail, none, neutral or a missing dkim result are refused', () => {
  for (const result of ['fail', 'none', 'neutral', 'temperror', 'permerror']) {
    assert.equal(verifyDkim(ar(`mx.example; dkim=${result} header.d=gdf07.com`), OPTS).ok, false, result);
  }
  assert.equal(verifyDkim(ar('mx.example; spf=pass smtp.mailfrom=gdf07.com'), OPTS).reason, 'no-dkim-result');
});

test('a DKIM pass for another domain is refused (the attacker signs with his own)', () => {
  assert.deepEqual(verifyDkim(ar('mx.example; dkim=pass header.d=attacker.tld; spf=pass'), OPTS), { ok: false, reason: 'dkim-domain-mismatch' });
  assert.equal(verifyDkim(ar('mx.example; dkim=pass header.i=@gdf07.com.attacker.tld'), OPTS).ok, false);
  assert.equal(verifyDkim(ar('mx.example; dkim=pass header.d=notgdf07.com'), OPTS).ok, false);
});

test('a pass for one signature does not hide a mismatch, and any matching pass is enough', () => {
  assert.equal(verifyDkim(ar('mx.example; dkim=pass header.d=attacker.tld; dkim=pass header.d=gdf07.com'), OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; dkim=fail header.d=gdf07.com; dkim=pass header.d=attacker.tld'), OPTS).ok, false);
});

test('only the first Authentication-Results header counts: a forged one below it is ignored', () => {
  const forgedBelow = ar('mx.example; dkim=fail header.d=gdf07.com') + ar('mx.example; dkim=pass header.d=gdf07.com');
  assert.equal(verifyDkim(forgedBelow, OPTS).ok, false);
  const forgedAbove = ar('forger.tld; dkim=pass header.d=gdf07.com') + ar('mx.example; dkim=fail header.d=gdf07.com');
  // Without a configured server name the topmost header is trusted by construction (servers prepend).
  assert.equal(verifyDkim(forgedAbove, OPTS).ok, true);
  // With the mailbox's own authserv-id configured, the forged header is not the trusted one.
  assert.equal(verifyDkim(forgedAbove, { ...OPTS, trustedAuthservId: 'mx.example' }).ok, false);
  assert.equal(verifyDkim(forgedBelow, { ...OPTS, trustedAuthservId: 'forger.tld' }).reason, 'untrusted-authserv-id');
});

test('folded headers and comments are parsed; a quoted comment cannot smuggle a result', () => {
  const folded = 'Authentication-Results: mx.example;\r\n\tdkim=pass\r\n header.d=gdf07.com;\r\n\tspf=pass\r\n';
  assert.equal(verifyDkim(folded, OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; dkim=fail (dkim=pass header.d=gdf07.com) header.d=attacker.tld'), OPTS).ok, false);
});

test('a list of signing domains replaces the sender domain', () => {
  const header = ar('mx.example; dkim=pass header.d=mail.gdf07.com');
  assert.equal(verifyDkim(header, OPTS).ok, false);
  assert.equal(verifyDkim(header, { domains: 'gdf07.com, mail.gdf07.com' }).ok, true);
  assert.equal(verifyDkim(header, { domains: [] }).reason, 'no-domain');
});

test('the From address must equal the sender: a display name or a longer address does not match', () => {
  const env = (address, name) => ({ from: [{ name, address }] });
  assert.equal(addressMatches(env('resa@gdf07.com', 'Gîtes'), 'resa@gdf07.com'), true);
  assert.equal(addressMatches(env('RESA@GDF07.com', ''), 'resa@gdf07.com'), true);
  assert.equal(addressMatches(env('x@attacker.tld', 'resa@gdf07.com'), 'resa@gdf07.com'), false);
  assert.equal(addressMatches(env('noreply-resa@gdf07.com', ''), 'resa@gdf07.com'), false);
  assert.equal(addressMatches(env('resa@gdf07.com.attacker.tld', ''), 'resa@gdf07.com'), false);
  assert.equal(addressMatches({}, 'resa@gdf07.com'), false);
});

function fakeImap(messages) {
  class FakeImap {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return messages.map((m) => m.uid); }
    async fetchOne(uid) { return messages.find((m) => String(m.uid) === String(uid)); }
    async download() { return { content: (async function* body() { yield Buffer.from('corps'); }()) }; }
    async logout() {}
  }
  return FakeImap;
}

const message = (uid, address, name, headers) => ({
  uid,
  envelope: { messageId: `<${uid}@test>`, subject: 'Nouvelle réservation', date: new Date('2026-10-14T16:00:00Z'), from: [{ name, address }] },
  bodyStructure: { type: 'text/plain', part: '1' },
  internalDate: new Date('2026-10-14T16:00:01Z'),
  headers: Buffer.from(headers),
});
const GOOD = ar('mx.example; dkim=pass header.d=gdf07.com');

test('the reader drops a display-name spoof, flags a missing or failing signature, keeps the genuine mail', async () => {
  const messages = [
    message(1, 'resa@gdf07.com', 'Gîtes', GOOD),
    message(2, 'x@attacker.tld', 'resa@gdf07.com', GOOD),
    message(3, 'resa@gdf07.com', 'Gîtes', ''),
    message(4, 'resa@gdf07.com', 'Gîtes', ar('mx.example; dkim=fail header.d=gdf07.com')),
    message(5, 'resa@gdf07.com', 'Gîtes', ar('mx.example; dkim=pass header.d=attacker.tld')),
  ];
  const mails = await readMailsFrom({ host: 'h', user: 'u', password: 'p', sender: 'resa@gdf07.com', ImapClient: fakeImap(messages) });
  assert.deepEqual(mails.map((m) => [m.messageId, m.authenticated, m.authReason]), [
    ['<1@test>', true, 'dkim-pass'],
    ['<3@test>', false, 'no-authentication-results'],
    ['<4@test>', false, 'dkim-not-pass'],
    ['<5@test>', false, 'dkim-domain-mismatch'],
  ]);
});

test('the reader honours the configured signing domains and trusted authserv-id', async () => {
  const header = ar('mx.example; dkim=pass header.d=mail.gdf07.com');
  const run = (extra) => readMailsFrom({ host: 'h', user: 'u', password: 'p', sender: 'resa@gdf07.com', ...extra, ImapClient: fakeImap([message(1, 'resa@gdf07.com', '', header)]) });
  assert.equal((await run({}))[0].authenticated, false);
  assert.equal((await run({ allowedDomains: 'mail.gdf07.com' }))[0].authenticated, true);
  assert.equal((await run({ allowedDomains: 'mail.gdf07.com', trustedAuthservId: 'other.example' }))[0].authenticated, false);
});
