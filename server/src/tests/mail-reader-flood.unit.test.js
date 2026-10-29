// specs/gites-de-france-mail-intake.md rule 30, specs/airbnb-mail-intake.md rule 30 (audit r3, external N5) —
// a flood of mails from the sender costs a bounded number of downloads and a bounded amount of memory:
// known Message-IDs are skipped before the body is downloaded, mails are handed over one by one, and a pass
// reads at most `limit` of them, newest first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { readMailsFrom } = require('../plugins/sdk/mailboxReader');

const SENDER = 'resa@gdf07.com';
const GOOD = 'Authentication-Results: mx.example; dkim=pass header.d=gdf07.com\r\n';
const BODY = Buffer.from(`${'Une nouvelle réservation '.padEnd(96, 'x')}\n`.repeat(2600));

function fakeImap(count, stats) {
  return class Fake {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return Array.from({ length: count }, (_, i) => i + 1); }
    async *fetch(range) {
      stats.fetches = (stats.fetches || 0) + 1;
      for (const uid of String(range).split(',')) {
        yield {
          uid: Number(uid),
          envelope: { from: [{ address: SENDER }], messageId: `<m${uid}@x>`, subject: 's', date: new Date('2026-10-14T16:00:00Z') },
          bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-14T16:00:00Z'),
          headers: Buffer.from(stats.verified && stats.verified.has(Number(uid)) ? GOOD : ''),
        };
      }
    }
    async download() { stats.downloads += 1; return { content: Readable.from([BODY]) }; }
    async logout() {}
  };
}

const read = (count, stats, extra) => readMailsFrom({
  host: 'imap.example.com', user: 'u', password: 'p', sender: SENDER, trustedAuthservId: 'mx.example', smtpHostOf: () => 'smtp.example.com', ImapClient: fakeImap(count, stats), ...extra,
});

test('plugins-phase-1-sdk.md rule 30: a known Message-ID is never downloaded', async () => {
  const stats = { downloads: 0 };
  const delivered = [];
  await read(50, stats, { seen: (id) => id !== '<m7@x>', onMail: (m) => { delivered.push(m.messageId); } });
  assert.equal(stats.downloads, 1);
  assert.deepEqual(delivered, ['<m7@x>']);
});

test('plugins-phase-1-sdk.md rule 30: a pass downloads at most `limit` mails, the newest first', async () => {
  const stats = { downloads: 0 };
  const delivered = [];
  await read(1000, stats, { limit: 5, onMail: (m) => { delivered.push(m.messageId); } });
  assert.equal(stats.downloads, 5);
  assert.deepEqual(delivered, ['<m1000@x>', '<m999@x>', '<m998@x>', '<m997@x>', '<m996@x>']);
});

test('rule 30: the default cap is 200 downloads', async () => {
  const stats = { downloads: 0 };
  await read(1000, stats, { onMail: () => {} });
  assert.equal(stats.downloads, 200);
});

test('rule 30: mails are handed over one by one — the reader keeps none (bounded heap)', async () => {
  const stats = { downloads: 0 };
  let handed = 0;
  const before = process.memoryUsage().heapUsed;
  let peak = 0;
  await read(2000, stats, { limit: 2000, onMail: (m) => { handed += 1; assert.ok(m.text.length > 200000); peak = Math.max(peak, process.memoryUsage().heapUsed - before); } });
  assert.equal(handed, 2000);
  assert.ok(peak < 150e6, `heap grew by ${Math.round(peak / 1e6)} MB`);
});

test('rule 30: an oversized part is handed over as a skipped mail, so the caller can remember it', async () => {
  class Big {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return [1]; }
    async *fetch() {
      yield { uid: 1, envelope: { from: [{ address: SENDER }], messageId: '<big@x>', subject: 's', date: new Date() }, bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date(), headers: Buffer.from('') };
    }
    async download() { return { content: Readable.from([Buffer.alloc(300 * 1024, 97)]) }; }
    async logout() {}
  }
  const delivered = [];
  await readMailsFrom({ host: 'imap.example.com', user: 'u', password: 'p', sender: SENDER, smtpHostOf: () => 'smtp.example.com', ImapClient: Big, log: () => {}, onMail: (m) => { delivered.push(m); } });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].messageId, '<big@x>');
  assert.equal(delivered[0].skipped, 'tooLarge');
  assert.equal(delivered[0].text, '');
});

// specs/gites-de-france-mail-intake.md rule 31, specs/airbnb-mail-intake.md rule 31 (review of PR #865).
test('plugins-phase-1-sdk.md rule 32: a DKIM-verified mail older than 300 forgeries is delivered in the first pass, outside the cap', async () => {
  const stats = { downloads: 0, verified: new Set([1]) };
  const delivered = [];
  await read(300, stats, { onMail: (m) => { delivered.push([m.messageId, m.authenticated]); } });
  assert.deepEqual(delivered[0], ['<m1@x>', true]);
  assert.equal(delivered.length, 201, 'the verified mail plus 200 unauthenticated ones');
  assert.equal(stats.downloads, 201);
});

test('rule 31: a sustained flood never delays a verified mail', async () => {
  const seenIds = new Set();
  for (let pass = 0; pass < 4; pass += 1) {
    const total = 1 + 250 * (pass + 1);
    const stats = { downloads: 0, verified: new Set([1]) };
    const delivered = [];
    await read(total, stats, { seen: (id) => seenIds.has(id), onMail: (m) => { seenIds.add(m.messageId); delivered.push(m.messageId); } });
    if (pass === 0) assert.ok(delivered.includes('<m1@x>'), 'handled in the very first pass');
  }
  assert.ok(seenIds.has('<m1@x>'));
});

test('rule 31: reaching the cap logs a warning with the number of mails left', async () => {
  const stats = { downloads: 0 };
  const logged = [];
  await read(250, stats, { limit: 100, onMail: () => {}, log: (l) => logged.push(l) });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /150 .*not read/);
});

test('plugins-phase-1-sdk.md rule 32: the envelopes are fetched in bulk — the request count stays bounded', async () => {
  const stats = { downloads: 0 };
  await read(5000, stats, { seen: () => true, onMail: () => {} });
  assert.equal(stats.downloads, 0);
  assert.equal(stats.fetches, 10);
});
