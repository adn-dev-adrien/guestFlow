// specs/gites-de-france-mail-intake.md rule 30, specs/airbnb-mail-intake.md rule 30 (audit r3, external N5) —
// a flood of mails from the sender costs a bounded number of downloads and a bounded amount of memory:
// known Message-IDs are skipped before the body is downloaded, mails are handed over one by one, and a pass
// reads at most `limit` of them, newest first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { readMailsFrom } = require('../plugins/sdk/mailboxReader');

const SENDER = 'resa@gdf07.com';
const BODY = Buffer.from(`${'Une nouvelle réservation '.padEnd(96, 'x')}\n`.repeat(2600));

function fakeImap(count, stats) {
  return class Fake {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return Array.from({ length: count }, (_, i) => i + 1); }
    async fetchOne(uid) {
      return {
        envelope: { from: [{ address: SENDER }], messageId: `<m${uid}@x>`, subject: 's', date: new Date('2026-10-14T16:00:00Z') },
        bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-14T16:00:00Z'), headers: Buffer.from(''),
      };
    }
    async download() { stats.downloads += 1; return { content: Readable.from([BODY]) }; }
    async logout() {}
  };
}

const read = (count, stats, extra) => readMailsFrom({
  host: 'imap.example.com', user: 'u', password: 'p', sender: SENDER, smtpHostOf: () => 'smtp.example.com', ImapClient: fakeImap(count, stats), ...extra,
});

test('rule 30: a known Message-ID is never downloaded', async () => {
  const stats = { downloads: 0 };
  const delivered = [];
  await read(50, stats, { seen: (id) => id !== '<m7@x>', onMail: (m) => { delivered.push(m.messageId); } });
  assert.equal(stats.downloads, 1);
  assert.deepEqual(delivered, ['<m7@x>']);
});

test('rule 30: a pass downloads at most `limit` mails, the newest first', async () => {
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
    async fetchOne() {
      return { envelope: { from: [{ address: SENDER }], messageId: '<big@x>', subject: 's', date: new Date() }, bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date(), headers: Buffer.from('') };
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
