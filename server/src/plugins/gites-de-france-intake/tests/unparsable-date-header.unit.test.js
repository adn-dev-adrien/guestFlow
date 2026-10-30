// specs/gites-de-france-mail-intake.md rule 34 (audit r5, review of PR #874, R1) — imapflow hands a Date header it cannot
// parse over as a raw string. One forged mail with such a header must not stop the pass: the genuine booking is applied
// on a mailbox without a trusted server (OVH) and on one with it (Gmail), and the forged mail is remembered as `ignored`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const Database = require('better-sqlite3');
const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { BOOKING_MAIL } = require('./fixtures');
const { readMailsFrom } = require('../../sdk/mailboxReader');

const PH = { id: 22308, propertyId: 1, platform: 'GitesDeFrance', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null };
const NOW = new Date('2026-10-15T08:00:00Z');

function imap(mails) {
  return class {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async logout() {}
    async search() { return mails.map((_, i) => i + 1); }
    async *fetch(range) {
      for (const u of String(range).split(',').map(Number)) {
        const m = mails[u - 1];
        yield { uid: u, envelope: { from: [{ address: 'resa@gdf07.com' }], messageId: m.id, subject: 'Nouvelle réservation', date: m.date }, bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-14T16:00:00Z'), headers: Buffer.from(m.auth || '') };
      }
    }
    async download(uid) { return { content: Readable.from([Buffer.from(mails[uid - 1].text)]) }; }
  };
}

function service(db, Imap, smtp) {
  return createIntakeService({
    intakes: buildModel(db),
    parserVersion: '1.4.7',
    now: () => NOW,
    settings: { mailbox: () => ({ host: 'imap.x', port: 993, user: 'u', password: 'p' }), sender: () => 'resa@gdf07.com', authentication: () => ({ allowedDomains: 'gdf07.com', trustedAuthservId: '' }), giteNumbers: () => ({ 1: '309700' }), autoApply: () => true },
    readMails: (cfg, h) => readMailsFrom({ ...cfg, ...h, ImapClient: Imap, smtpHostOf: () => smtp, now: NOW }),
    findReservations: ({ startDate, endDate }) => (startDate === '2026-11-13' && endDate === '2026-11-15' ? [PH] : []),
    commissionPercent: () => 10,
    propertyOptions: () => [],
    getReservation: () => ({ ...PH, options: [] }),
    today: () => '2026-10-15',
    core: { updateReservation: () => ({ status: 200, clientId: 1, body: { ok: true } }), suggestBeds: () => ({ singleBeds: 2, doubleBeds: 4 }) },
  });
}

const GMAIL = 'Authentication-Results: mx.google.com; dkim=pass header.d=gdf07.com';
for (const [mailbox, smtp, auth] of [['OVH', 'ssl0.ovh.net', ''], ['Gmail', 'smtp.gmail.com', GMAIL]]) {
  for (const [label, date] of [['Date: not a date', 'not a date'], ['a 32 KB Date', 'x'.repeat(32 * 1024)]]) {
    test(`rule 34: ${label} on ${mailbox} does not stop the pass; the genuine booking is applied`, async () => {
      const db = new Database(':memory:');
      db.exec(TABLE_SQL);
      const mails = [
        { id: '<genuine@gdf07>', text: BOOKING_MAIL, auth, date: new Date('2026-10-14T16:00:00Z') },
        { id: '<poison@x>', text: 'x', auth: '', date },
      ];
      const result = await service(db, imap(mails), smtp).runPass();
      assert.ok(result);
      assert.notEqual(db.prepare("SELECT status FROM gdf_intakes WHERE messageId = '<genuine@gdf07>'").get().status, 'pending');
      assert.equal(db.prepare("SELECT status FROM gdf_intakes WHERE messageId = '<poison@x>'").get().status, 'ignored');
    });
  }
}

test('rule 34: a mail that makes the intake step throw is remembered as ignored and the pass goes on', async () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const mails = [{ id: '<genuine@gdf07>', text: BOOKING_MAIL, auth: '', date: new Date('2026-10-14T16:00:00Z') }, { id: '<boom@x>', text: 'x', auth: '', date: new Date('2026-10-14T15:00:00Z') }];
  const model = buildModel(db);
  const insert = model.insert;
  let thrown = false;
  const Throwing = imap(mails);
  const throwing = createIntakeService({ ...{}, intakes: { ...model, insert: (row) => { if (row.messageId === '<boom@x>' && !thrown) { thrown = true; throw new Error('db busy'); } return insert(row); } }, parserVersion: '1.4.7', now: () => NOW, settings: { mailbox: () => ({ host: 'imap.x', port: 993, user: 'u', password: 'p' }), sender: () => 'resa@gdf07.com', authentication: () => ({ allowedDomains: 'gdf07.com', trustedAuthservId: '' }), giteNumbers: () => ({ 1: '309700' }), autoApply: () => true }, readMails: (cfg, h) => readMailsFrom({ ...cfg, ...h, ImapClient: Throwing, smtpHostOf: () => 'ssl0.ovh.net', now: NOW }), findReservations: () => [], commissionPercent: () => 10, propertyOptions: () => [], getReservation: () => ({ ...PH, options: [] }), today: () => '2026-10-15', core: { updateReservation: () => ({ status: 200, clientId: 1, body: {} }), suggestBeds: () => ({}) } });
  await throwing.runPass();
  const row = db.prepare("SELECT status, error FROM gdf_intakes WHERE messageId = '<boom@x>'").get();
  assert.equal(row.status, 'ignored');
  assert.match(row.error, /db busy/);
  assert.ok(db.prepare("SELECT 1 FROM gdf_intakes WHERE messageId = '<genuine@gdf07>'").get());
});
