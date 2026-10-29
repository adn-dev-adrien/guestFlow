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

test('rule 32: reading 500 envelopes with 64 KB Authentication-Results headers never blocks the event loop', async () => {
  const header = `Authentication-Results: evil.test; ${'dkim=pass header.d=a.b; '.repeat(Math.floor(64 * 1024 / 24))}\r\nAuthentication-Results: mx.google.com; dkim=none\r\n`;
  const mails = Array.from({ length: 500 }, (_, i) => ({ id: `<m${i + 1}@x>`, headers: header }));
  let last = Date.now();
  let stall = 0;
  const ticker = setInterval(() => { const now = Date.now(); stall = Math.max(stall, now - last - 5); last = now; }, 5);
  await readMailsFrom({
    host: 'imap.gmail.com', user: 'u', password: 'p', sender: SENDER, smtpHostOf: () => 'smtp.gmail.com', ImapClient: fakeImap(mails), log: () => {}, onMail: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(ticker);
  assert.ok(stall < 50, `the event loop was blocked for ${Math.round(stall)} ms`);
});

test('rule 32: verifyDkim ignores an Authentication-Results header over 4 KB and still reads the trusted short one', () => {
  const forged = `Authentication-Results: mx.google.com; ${'x=y; '.repeat(1000)}dkim=pass header.d=gdf07.com\r\n`;
  const genuine = 'Authentication-Results: mx.google.com; dkim=pass header.d=gdf07.com\r\n';
  const opts = { domains: 'gdf07.com', trustedAuthservId: 'mx.google.com' };
  assert.deepEqual(verifyDkim(forged, opts), { ok: false, reason: 'untrusted-authserv-id' });
  assert.equal(verifyDkim(forged + genuine, opts).ok, true);
  assert.equal(verifyDkim(genuine, opts).ok, true);
  assert.equal(verifyDkim('Authentication-Results: mx.google.com.evil.test; dkim=pass header.d=gdf07.com\r\n', opts).ok, false);
});
