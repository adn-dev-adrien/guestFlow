// specs/airbnb-mail-intake.md rule 34 (audit r5, review of PR #874, R1) — a Date header imapflow cannot parse (it hands over
// the raw string) must not stop the pass, and a mail that makes the intake step throw is remembered as `ignored`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { readMailsFrom } = require('../../sdk/mailboxReader');

const NOW = new Date('2026-10-26T09:00:00.000Z');
const imap = (mails) => class {
  async connect() {}
  async getMailboxLock() { return { release() {} }; }
  async logout() {}
  async search() { return mails.map((_, i) => i + 1); }
  async *fetch(range) {
    for (const u of String(range).split(',').map(Number)) {
      const m = mails[u - 1];
      yield { uid: u, envelope: { from: [{ address: 'automated@airbnb.com' }], messageId: m.id, subject: 'Nouveau message de Camille', date: m.date }, bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-25T08:00:00Z'), headers: Buffer.from('') };
    }
  }
  async download(uid) { return { content: Readable.from([Buffer.from(mails[uid - 1].text)]) }; }
};

function build(mails, wrapInsert = (insert) => insert) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const model = buildModel(db);
  const service = createIntakeService({
    intakes: { ...model, insert: wrapInsert(model.insert) },
    settings: { mailbox: () => ({ host: 'imap.test', port: 993, user: 'c@test', password: 'x' }), sender: () => 'automated@airbnb.com', listings: () => [[1, '1234567890123456789']], autoApply: () => true },
    readMails: (cfg, h) => readMailsFrom({ ...cfg, ...h, ImapClient: imap(mails), smtpHostOf: () => 'ssl0.ovh.net', now: NOW }),
    findReservations: () => [],
    propertyOptions: () => [],
    getReservation: () => null,
    core: {},
    now: () => NOW,
  });
  return { service, db };
}

for (const [label, date] of [['Date: not a date', 'not a date'], ['a 32 KB Date', 'x'.repeat(32 * 1024)]]) {
  test(`rule 34: ${label} does not stop the pass`, async () => {
    const { service, db } = build([{ id: '<poison@x>', text: 'Bonjour', date }, { id: '<other@x>', text: 'Bonjour', date: new Date('2026-10-25T07:00:00Z') }]);
    await service.runPass();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM airbnb_intakes').get().n, 2);
  });
}

test('rule 34: a mail that makes the intake step throw is remembered as ignored with its reason and the pass goes on', async () => {
  let thrown = false;
  const { service, db } = build(
    [{ id: '<boom@x>', text: 'Bonjour', date: new Date('2026-10-25T09:00:00Z') }, { id: '<next@x>', text: 'Bonjour', date: new Date('2026-10-25T07:00:00Z') }],
    (insert) => (row) => { if (row.messageId === '<boom@x>' && !thrown) { thrown = true; throw new Error('db busy'); } return insert(row); },
  );
  await service.runPass();
  const boom = db.prepare("SELECT status, error FROM airbnb_intakes WHERE messageId = '<boom@x>'").get();
  assert.equal(boom.status, 'ignored');
  assert.match(boom.error, /db busy/);
  assert.ok(db.prepare("SELECT 1 FROM airbnb_intakes WHERE messageId = '<next@x>'").get());
});
