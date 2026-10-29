// specs/airbnb-mail-intake.md rule 22, specs/gites-de-france-mail-intake.md rule 20 — the mailbox reader
// keeps only mails whose header From address IS the sender, and flags the ones the receiving server did
// not authenticate (DKIM pass for the sender's domain, in the header of the mailbox's own server).
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyDkim, addressMatches, parseAuthenticationResults, defaultAuthservId } = require('../plugins/sdk/mailAuthentication');
const { readMailsFrom } = require('../plugins/sdk/mailboxReader');

const ar = (value) => `Authentication-Results: ${value}\r\n`;
const OPTS = { domains: 'gdf07.com', trustedAuthservId: 'mx.example' };

test('a valid DKIM pass for the sender domain, in the trusted server header, is accepted', () => {
  assert.deepEqual(verifyDkim(ar('mx.example; dkim=pass header.i=@gdf07.com header.s=k1 header.b=abc; spf=pass smtp.mailfrom=gdf07.com'), OPTS), { ok: true, reason: 'dkim-pass' });
  assert.equal(verifyDkim(ar('mx.example; dkim=pass header.d=GDF07.com'), OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; dkim=pass (good signature) header.d=gdf07.com'), OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; dkim=pass d=gdf07.com'), OPTS).ok, false, 'the non-standard `d` alias is not a signing domain');
  assert.equal(verifyDkim(ar('mx.example; dkim=pass header.d="gdf07.com"'), OPTS).ok, true);
  assert.equal(verifyDkim(Buffer.from(ar('mx.example; dkim=pass header.d=gdf07.com')), OPTS).ok, true);
});

test('with no trusted server name nothing is authenticated', () => {
  const header = ar('mx.example; dkim=pass header.d=gdf07.com');
  assert.deepEqual(verifyDkim(header, { domains: 'gdf07.com' }), { ok: false, reason: 'no-trusted-authserv-id' });
  assert.equal(verifyDkim(header, { domains: 'gdf07.com', trustedAuthservId: '' }).ok, false);
});

test('a provider\'s own server name is known; an unknown provider has none', () => {
  assert.equal(defaultAuthservId('smtp.gmail.com'), 'mx.google.com');
  assert.equal(defaultAuthservId('SMTP.GMAIL.COM'), 'mx.google.com');
  assert.equal(defaultAuthservId('smtp.googlemail.com'), 'mx.google.com');
  assert.equal(defaultAuthservId('ssl0.ovh.net'), '');
  assert.equal(defaultAuthservId('smtp.gmail.com.attacker.tld'), '');
  assert.equal(defaultAuthservId(''), '');
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

test('only the header of the trusted server counts: a forged one above or below it is ignored', () => {
  const forgedBelow = ar('mx.example; dkim=fail header.d=gdf07.com') + ar('forger.tld; dkim=pass header.d=gdf07.com');
  assert.equal(verifyDkim(forgedBelow, OPTS).ok, false);
  const forgedAbove = ar('forger.tld; dkim=pass header.d=gdf07.com') + ar('mx.example; dkim=fail header.d=gdf07.com');
  assert.equal(verifyDkim(forgedAbove, OPTS).ok, false);
  assert.equal(verifyDkim(forgedAbove, { domains: 'gdf07.com' }).ok, false, 'an empty setting no longer falls back to the topmost header');
  assert.equal(verifyDkim(forgedBelow, { ...OPTS, trustedAuthservId: 'forger.tld' }).ok, true, 'the operator names the server');
  assert.equal(verifyDkim(ar('other.example; dkim=pass header.d=gdf07.com'), OPTS).reason, 'untrusted-authserv-id');
  assert.equal(verifyDkim(ar('MX.Example; dkim=pass header.d=gdf07.com'), OPTS).ok, true, 'server names are case-insensitive');
});

test('folded headers and comments are parsed; a comment cannot smuggle a result', () => {
  const folded = 'Authentication-Results: mx.example;\r\n\tdkim=pass\r\n header.d=gdf07.com;\r\n\tspf=pass\r\n';
  assert.equal(verifyDkim(folded, OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; dkim=fail (dkim=pass header.d=gdf07.com) header.d=attacker.tld'), OPTS).ok, false);
  assert.equal(verifyDkim(ar('mx.example; dkim=fail (nested (dkim=pass header.d=gdf07.com) still a comment) header.d=attacker.tld'), OPTS).ok, false);
});

test('RFC 8601 quoted strings: a quoted value cannot smuggle a dkim result, in a property or in a comment', () => {
  const smuggled = ar('mx.example; spf=pass smtp.mailfrom="x;dkim=pass header.d=gdf07.com;y"@attacker.tld; dkim=fail header.d=attacker.tld');
  assert.equal(verifyDkim(smuggled, OPTS).ok, false);
  const onlySmuggled = ar('mx.example; spf=pass smtp.mailfrom="x;dkim=pass header.d=gdf07.com;y"@attacker.tld');
  assert.equal(verifyDkim(onlySmuggled, OPTS).reason, 'no-dkim-result');
  assert.deepEqual(parseAuthenticationResults('mx.example; spf=pass smtp.mailfrom="x;dkim=pass header.d=gdf07.com;y"@attacker.tld').results.map((r) => r.method), ['spf']);
  const inComment = ar('mx.example; dkim=fail (reason="a) ; dkim=pass header.d=gdf07.com (") header.d=attacker.tld');
  assert.equal(verifyDkim(inComment, OPTS).ok, false);
  const reasonQuoted = ar('mx.example; dkim=pass reason="signature ok; header.d=attacker.tld" header.d=gdf07.com');
  assert.equal(verifyDkim(reasonQuoted, OPTS).ok, true, 'the real property is read, the quoted text is not');
  const escaped = ar('mx.example; dkim=fail reason="say \\"hi\\"; dkim=pass header.d=gdf07.com" header.d=attacker.tld');
  assert.equal(verifyDkim(escaped, OPTS).ok, false);
  assert.equal(verifyDkim(ar('mx.example; dkim=fail header.d="attacker.tld" header.x="gdf07.com'), OPTS).ok, false, 'an unterminated quote swallows the rest');
});

test('a list of signing domains replaces the sender domain', () => {
  const header = ar('mx.example; dkim=pass header.d=mail.gdf07.com');
  assert.equal(verifyDkim(header, OPTS).ok, false);
  assert.equal(verifyDkim(header, { ...OPTS, domains: 'gdf07.com, mail.gdf07.com' }).ok, true);
  assert.equal(verifyDkim(header, { ...OPTS, domains: [] }).reason, 'no-domain');
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
const SMTP = () => 'smtp.example.com';
const reader = (messages, extra = {}) => readMailsFrom({ host: 'imap.example.com', user: 'u', password: 'p', sender: 'resa@gdf07.com', trustedAuthservId: 'mx.example', smtpHostOf: SMTP, ImapClient: fakeImap(messages), ...extra });

test('the reader drops a display-name spoof, flags a missing or failing signature, keeps the genuine mail', async () => {
  const messages = [
    message(1, 'resa@gdf07.com', 'Gîtes', GOOD),
    message(2, 'x@attacker.tld', 'resa@gdf07.com', GOOD),
    message(3, 'resa@gdf07.com', 'Gîtes', ''),
    message(4, 'resa@gdf07.com', 'Gîtes', ar('mx.example; dkim=fail header.d=gdf07.com')),
    message(5, 'resa@gdf07.com', 'Gîtes', ar('mx.example; dkim=pass header.d=attacker.tld')),
  ];
  const mails = await reader(messages);
  assert.deepEqual(mails.map((m) => [m.messageId, m.authenticated, m.authReason]), [
    ['<1@test>', true, 'dkim-pass'],
    ['<3@test>', false, 'no-authentication-results'],
    ['<4@test>', false, 'dkim-not-pass'],
    ['<5@test>', false, 'dkim-domain-mismatch'],
  ]);
});

test('the reader honours the configured signing domains and trusted server name, and the provider default', async () => {
  const header = ar('mx.example; dkim=pass header.d=mail.gdf07.com');
  const run = (extra) => reader([message(1, 'resa@gdf07.com', '', header)], extra);
  assert.equal((await run({}))[0].authenticated, false);
  assert.equal((await run({ allowedDomains: 'mail.gdf07.com' }))[0].authenticated, true);
  assert.equal((await run({ allowedDomains: 'mail.gdf07.com', trustedAuthservId: 'other.example' }))[0].authenticated, false);
  const google = ar('mx.google.com; dkim=pass header.i=@gdf07.com');
  const viaGmail = (extra) => reader([message(1, 'resa@gdf07.com', '', google)], { trustedAuthservId: '', smtpHostOf: () => 'smtp.gmail.com', ...extra });
  assert.equal((await viaGmail({}))[0].authenticated, true, 'Gmail: mx.google.com is the default server name');
  const unknown = await reader([message(1, 'resa@gdf07.com', '', google)], { trustedAuthservId: '', smtpHostOf: () => 'ssl0.ovh.net' });
  assert.equal(unknown[0].authenticated, false, 'unknown provider and empty setting: nothing is authenticated');
});

// specs/airbnb-mail-intake.md rule 29 (audit R2, finding N3) — only the dkim results written before the first
// `smtp.*` one count: an unquoted echo of the envelope cannot add a verdict.
test('rule 29: a dkim=pass written after the first smtp.* result is not counted', () => {
  const echoed = ar('mx.example; spf=pass smtp.mailfrom=a@evil.test; dkim=pass header.d=gdf07.com');
  assert.deepEqual(verifyDkim(echoed, OPTS), { ok: false, reason: 'no-dkim-result' });
  const honest = ar('mx.example; dkim=pass header.d=gdf07.com; spf=pass smtp.mailfrom=a@evil.test');
  assert.equal(verifyDkim(honest, OPTS).ok, true);
});

test('rule 29: a header written under another server name is never trusted', () => {
  const noneFromServer = ar('forger.tld; dkim=pass header.d=gdf07.com');
  assert.equal(verifyDkim(noneFromServer, OPTS).reason, 'untrusted-authserv-id');
});

// specs/airbnb-mail-intake.md rule 29 (review of PR 859) — a bare value inside a result is an unquoted echo.
test('rule 29: a header with a bare token in a result is not believed, and the genuine layouts still pass', () => {
  const echoed = ar('mx.example; dkim=pass header.d=gdf07.com x@evil.test; spf=pass smtp.mailfrom=a@b.c');
  assert.deepEqual(verifyDkim(echoed, OPTS), { ok: false, reason: 'malformed-authentication-results' });
  const gmail = ar('mx.example; dkim=pass header.i=@gdf07.com header.s=s1 header.b=abc; spf=pass (domain of x@gdf07.com designates 1.2.3.4) smtp.mailfrom=x@gdf07.com; dmarc=pass (p=REJECT) header.from=gdf07.com');
  assert.equal(verifyDkim(gmail, OPTS).ok, true);
  assert.equal(verifyDkim(ar('mx.example; none'), OPTS).reason, 'no-dkim-result');
});

test('rule 29: auto-apply is tested on a header that puts dkim before spf (Gmail); the other order is only proposed', () => {
  const spfFirst = ar('mx.example; spf=pass smtp.mailfrom=gdf07.com; dkim=pass header.d=gdf07.com');
  assert.equal(verifyDkim(spfFirst, OPTS).ok, false);
});
