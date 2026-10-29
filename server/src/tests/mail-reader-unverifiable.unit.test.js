// specs/plugins-phase-1-sdk.md rule 33, specs/gites-de-france-mail-intake.md rule 32, specs/airbnb-mail-intake.md rule 32 (audit r4, external N1 and N2) —
// on a mailbox where no DKIM verdict can be had (no trusted authserv-id), a sustained forged flood cannot starve a
// genuine mail for good, a pass that hits the cap says how many mails it left, and reading a batch of envelopes
// never blocks the event loop.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { readMailsFrom } = require('../plugins/sdk/mailboxReader');
const { verifyDkim } = require('../plugins/sdk/mailAuthentication');

const SENDER = 'resa@gdf07.com';

// `mails` is the live mailbox, oldest first: uid = index + 1.
function fakeImap(mails) {
  return class Fake {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return mails.map((_, i) => i + 1); }
    async *fetch(range) {
      for (const uid of String(range).split(',').map(Number)) {
        const m = mails[uid - 1];
        yield {
          uid,
          envelope: { from: [{ address: SENDER }], messageId: m.id, subject: 's', date: new Date('2026-10-14T16:00:00Z') },
          bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-14T16:00:00Z'),
          headers: Buffer.from(m.headers || ''),
        };
      }
    }
    async download() { return { content: Readable.from([Buffer.from('x')]) }; }
    async logout() {}
  };
}

const pass = (mails, readIds, extra = {}) => {
  const got = [];
  return readMailsFrom({
    host: 'imap.example.com', user: 'u', password: 'p', sender: SENDER, smtpHostOf: () => 'ssl0.ovh.net', ImapClient: fakeImap(mails), log: () => {},
    seen: (id) => readIds.has(id), onMail: (m) => { readIds.add(m.messageId); got.push(m.messageId); }, ...extra,
  }).then(() => got);
};

test('rule 32: with nothing to verify, a genuine mail that predates a sustained flood is read in the first pass', async () => {
  const mails = [{ id: '<genuine@gdf07>' }];
  const readIds = new Set();
  let n = 0;
  mails.push(...Array.from({ length: 250 }, () => ({ id: `<f${n++}@x>` })));
  const got = await pass(mails, readIds);
  assert.ok(got.includes('<genuine@gdf07>'), 'the oldest mail starved');
});

test('rule 32: under a +250 per pass flood, a genuine mail is read within a bounded number of passes whatever its place', async () => {
  const limit = 200;
  const half = limit / 2;
  for (const slot of [0, 60, 125, 249]) {
    const mails = [];
    const readIds = new Set();
    let n = 0;
    const flood = () => mails.push(...Array.from({ length: 250 }, () => ({ id: `<f${n++}@x>` })));
    flood();
    flood();
    const behind = mails.length;
    const fresh = Array.from({ length: 250 }, () => ({ id: `<f${n++}@x>` }));
    fresh[slot] = { id: '<genuine@gdf07>' };
    mails.push(...fresh);
    // Bound: each pass reads the oldest half-cap of what is unread, whatever arrives behind it, so a mail with
    // `older` unread mails before it is read by pass ceil((older + 1) / half). Here the older ones are the two
    // floods already waiting and the mails of its own batch that precede it.
    const bound = Math.ceil((behind + slot + 1) / half);
    let readAt = null;
    for (let p = 1; p <= bound + 3 && readAt === null; p += 1) {
      // eslint-disable-next-line no-await-in-loop
      const got = await pass(mails, readIds);
      if (got.includes('<genuine@gdf07>')) readAt = p;
      flood();
    }
    assert.ok(readAt !== null && readAt <= bound, `slot ${slot}: read at pass ${readAt}, bound ${bound}`);
  }
});

test('rule 32: the newest mails of a pass stay readable at once on an unverifiable mailbox', async () => {
  const mails = Array.from({ length: 1000 }, (_, i) => ({ id: `<m${i + 1}@x>` }));
  const got = await pass(mails, new Set());
  assert.equal(got.length, 200);
  assert.ok(got.includes('<m1000@x>') && got.includes('<m1@x>'));
});

test('rule 32: a cap that is hit is reported with the number of mails left, none when everything is read', async () => {
  const mails = Array.from({ length: 340 + 200 }, (_, i) => ({ id: `<m${i + 1}@x>` }));
  const caps = [];
  await pass(mails, new Set(), { onCap: (info) => caps.push(info) });
  assert.deepEqual(caps, [{ notRead: 340, limit: 200 }]);
  const quiet = [];
  await pass(mails.slice(0, 50), new Set(), { onCap: (info) => quiet.push(info) });
  assert.deepEqual(quiet, []);
});

test('rule 32: the event loop gets a turn between slices of a 500-envelope batch with 64 KB headers', async () => {
  const header = `Authentication-Results: evil.test; ${'dkim=pass header.d=a.b; '.repeat(Math.floor(64 * 1024 / 24))}\r\nAuthentication-Results: mx.google.com; dkim=none\r\n`;
  const mails = Array.from({ length: 500 }, (_, i) => ({ id: `<m${i + 1}@x>`, headers: header }));
  // Deterministic, whatever the load: a batch that yields lets a self-rescheduling immediate run once per slice.
  let turns = 0;
  let running = true;
  const tick = () => { turns += 1; if (running) setImmediate(tick); };
  setImmediate(tick);
  await readMailsFrom({
    host: 'imap.gmail.com', user: 'u', password: 'p', sender: SENDER, smtpHostOf: () => 'smtp.gmail.com', ImapClient: fakeImap(mails), log: () => {}, onMail: () => {},
  });
  running = false;
  assert.ok(turns >= 500 / 25 - 1, `only ${turns} event-loop turns during the batch`);
});

test('rule 32: 500 mails of 16 headers of 4 KB that all start with the trusted id (or a longer one) cost a bounded time', () => {
  const opts = { domains: 'gdf07.com', trustedAuthservId: 'mx.google.com' };
  const forged = Array.from({ length: 16 }, () => `Authentication-Results: mx.google.com.x; ${'dkim=fail header.d=a.b; '.repeat(168)}\r\n`).join('');
  const mails = Array.from({ length: 500 }, () => Buffer.from(`${forged}Authentication-Results: mx.google.com; dkim=none\r\n`));
  const before = process.cpuUsage();
  mails.forEach((m) => verifyDkim(m, opts));
  const used = process.cpuUsage(before);
  const ms = (used.user + used.system) / 1000;
  assert.ok(ms < 300, `${Math.round(ms)} ms of CPU for 500 mails (about 1200 ms when every prefixed header was tokenized)`);
});

const G = { domains: 'gdf07.com', trustedAuthservId: 'mx.google.com' };
const FORGED_BELOW = 'Authentication-Results: mx.google.com; dkim=pass header.i=@gdf07.com header.s=sel1 header.b=x\r\n';
const bogus = Array.from({ length: 30 }, (_, i) => `dkim=neutral (body hash did not verify) header.i=@${'x'.repeat(60)}${i}.evil.example header.s=${'s'.repeat(40)} header.b=Qw3rTy12`).join(';\r\n       ');
const BIG_GMAIL = `Authentication-Results: mx.google.com;\r\n       ${bogus};\r\n       spf=softfail smtp.mailfrom=resa@gdf07.com;\r\n       dmarc=fail header.from=gdf07.com\r\n`;

test('rule 32: the server\'s own header decides — an oversized one is refused, never skipped for a forged one below it', () => {
  assert.ok(BIG_GMAIL.length > 4096);
  assert.deepEqual(verifyDkim(BIG_GMAIL + FORGED_BELOW, G), { ok: false, reason: 'oversized-authentication-results' });
  assert.equal(verifyDkim(`Authentication-Results: mx.google.com; dkim=none header.from=gdf07.com\r\n${FORGED_BELOW}`, G).ok, false);
});

test('rule 32: a forged header ABOVE a short trusted one is still the first trusted header (accepted residual of rule 29)', () => {
  assert.equal(verifyDkim(`${FORGED_BELOW}Authentication-Results: mx.google.com; dkim=none\r\n`, G).ok, true);
});

test('rule 32: a longer authserv-id is not the trusted one, a comment before the id fails closed, folding and tabs still verify', () => {
  assert.deepEqual(verifyDkim('Authentication-Results: mx.google.com.evil.test; dkim=pass header.d=gdf07.com\r\n', G), { ok: false, reason: 'untrusted-authserv-id' });
  assert.deepEqual(verifyDkim('Authentication-Results: (x) mx.google.com; dkim=pass header.d=gdf07.com\r\n', G), { ok: false, reason: 'untrusted-authserv-id' });
  const gmail = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@gdf07.com header.s=sel1;\r\n       spf=pass smtp.mailfrom=resa@gdf07.com\r\n';
  assert.equal(verifyDkim(gmail, G).ok, true);
  assert.equal(verifyDkim(gmail.replace(/\r\n {7}/g, '\r\n\t'), G).ok, true);
  assert.equal(verifyDkim(gmail.replace(/\r\n/g, '\n'), G).ok, true);
  assert.equal(verifyDkim('Authentication-Results: mx.microsoft.com 1; dkim=pass header.d=gdf07.com; spf=pass smtp.mailfrom=gdf07.com\r\n', { domains: 'gdf07.com', trustedAuthservId: 'mx.microsoft.com' }).ok, true);
});
