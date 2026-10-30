// specs/airbnb-mail-intake.md rule 33 — the reader keeps small records, never the sender-written envelopes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROBE = `
const { readMailsFrom } = require(${JSON.stringify(path.join(__dirname, '../plugins/sdk/mailboxReader'))});
const { Readable } = require('stream');
const N = 4000;
class Imap { async connect() {} async getMailboxLock() { return { release() {} }; } async logout() {}
  async search() { return Array.from({ length: N }, (_, i) => i + 1); }
  async *fetch(range) { for (const u of String(range).split(',').map(Number)) yield { uid: u,
    envelope: { from: [{ address: 'resa@gdf07.com' }], messageId: '<' + u + '@x>' + 'M'.repeat(5000), subject: Buffer.alloc(32 * 1024, 'S' + u).toString('latin1'), date: new Date() },
    bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date(), headers: Buffer.from('') }; }
  async download() { return { content: Readable.from([Buffer.from('x')]) }; } }
(async () => {
  global.gc(); const base = process.memoryUsage().heapUsed; let n = 0; let peak = 0; let longest = 0;
  await readMailsFrom({ host: 'imap.x', user: 'u', password: 'p', sender: 'resa@gdf07.com', ImapClient: Imap, smtpHostOf: () => 'ssl0.ovh.net', seen: () => false,
    onMail: (m) => { n += 1; longest = Math.max(longest, m.subject.length, m.messageId.length); if (n === 1) { global.gc(); peak = process.memoryUsage().heapUsed - base; } } });
  console.log(JSON.stringify({ n, peakMb: peak / 1e6, longest }));
})();`;

test('rule 33: a pass over thousands of forged mails does not retain their envelopes', () => {
  const run = spawnSync(process.execPath, ['--expose-gc', '-e', PROBE], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, run.stderr);
  const { n, peakMb, longest } = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(n, 200);
  assert.ok(peakMb < 40, `retained ${peakMb} MB (about 130 MB when envelopes are kept)`);
  assert.ok(longest <= 998, `subject / Message-ID of ${longest} chars`);
});
