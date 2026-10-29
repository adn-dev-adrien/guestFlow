// specs/airbnb-mail-intake.md rule 26, specs/gites-de-france-mail-intake.md rule 25 (audit 2026-10-28, F2) —
// the mailbox reader never reads a part past 256 KB and turns HTML into text in linear time.
const test = require('node:test');
const assert = require('node:assert/strict');

const { htmlToText, readPart, readMailsFrom, MAX_PART_BYTES } = require('../plugins/sdk/mailboxReader');

test('rule 26: htmlToText keeps the text, the image alt, the line breaks and drops style and tags', () => {
  const html = '<style>p{color:red}</style><p>Bonjour&nbsp;Claire</p><div>Arriv&eacute;e</div><img src="x" alt="picto personnes"><td>8 adultes</td><br/>fin &amp; suite &#233;';
  const text = htmlToText(html);
  assert.ok(!text.includes('color:red'));
  assert.ok(text.includes('Bonjour Claire\n'));
  assert.ok(text.includes(' picto personnes '));
  assert.ok(text.includes('8 adultes\t'));
  assert.ok(text.includes('fin & suite é'));
});

test('rule 26: htmlToText of an unterminated tag flood is linear (the old img/alt pattern took 4 s per 160 KB)', () => {
  for (const html of ['<img alt="'.repeat(20000), `<img ${'a '.repeat(100000)}`, '<'.repeat(300000), `<style>${'<style>'.repeat(50000)}`, '<img alt="x" '.repeat(20000)]) {
    const t0 = Date.now();
    htmlToText(html);
    assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms for ${html.slice(0, 12)}`);
  }
});

const streamOf = (size) => ({ download: async () => ({ content: (async function* body() { for (let i = 0; i < size; i += 65536) yield Buffer.alloc(Math.min(65536, size - i), 97); }()) }) });

test('rule 26: a part past the cap is not read, a part under it is', async () => {
  assert.equal(await readPart(streamOf(MAX_PART_BYTES + 1), 1, '1'), null);
  assert.equal((await readPart(streamOf(MAX_PART_BYTES), 1, '1')).length, MAX_PART_BYTES);
});

test('rule 26: the reader skips the oversized mail and returns the others', async () => {
  const message = (uid) => ({
    uid, envelope: { messageId: `<${uid}@t>`, subject: 's', date: new Date('2026-10-14T16:00:00Z'), from: [{ name: '', address: 'resa@gdf07.com' }] },
    bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-14T16:00:01Z'), headers: Buffer.from(''),
  });
  class Fake {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return [1, 2]; }
    async fetchOne(uid) { return message(Number(uid)); }
    async download(uid) { return streamOf(Number(uid) === 1 ? MAX_PART_BYTES + 10 : 100).download(); }
    async logout() {}
  }
  const mails = await readMailsFrom({ host: 'imap.example.com', user: 'u', password: 'p', sender: 'resa@gdf07.com', smtpHostOf: () => 'smtp.example.com', ImapClient: Fake });
  assert.deepEqual(mails.map((m) => m.messageId), ['<2@t>']);
});
