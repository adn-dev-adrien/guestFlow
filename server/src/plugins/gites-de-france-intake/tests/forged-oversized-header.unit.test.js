// specs/gites-de-france-mail-intake.md rule 32(c) (review of PR #868) — the receiving server's own
// Authentication-Results header decides; when Gmail's own header is inflated past 4 KB by bogus DKIM signatures, a
// header the sender wrote below it must NOT verify the mail: the forged booking stays a proposal, nothing is applied.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { BOOKING_MAIL } = require('./fixtures');
const { readMailsFrom } = require('../../sdk/mailboxReader');

const PLACEHOLDER = { id: 22308, propertyId: 1, platform: 'GitesDeFrance', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null };
const bogus = Array.from({ length: 30 }, (_, i) => `dkim=neutral (body hash did not verify) header.i=@${'x'.repeat(60)}${i}.evil.example header.s=${'s'.repeat(40)} header.b=Qw3rTy12`).join(';\r\n       ');
const INFLATED = `Authentication-Results: mx.google.com;\r\n       ${bogus};\r\n       spf=softfail smtp.mailfrom=resa@gdf07.com;\r\n       dmarc=fail header.from=gdf07.com\r\n`;
const FORGED = 'Authentication-Results: mx.google.com; dkim=pass header.i=@gdf07.com header.s=sel1 header.b=x\r\n';

async function pass(headers) {
  class Imap {
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async logout() {}
    async search() { return [1]; }
    async *fetch() {
      yield { uid: 1, envelope: { from: [{ address: 'resa@gdf07.com' }], messageId: '<forged@x>', subject: 'Nouvelle réservation', date: new Date('2026-10-14T16:00:00Z') }, bodyStructure: { type: 'text/plain', part: '1' }, internalDate: new Date('2026-10-14T16:00:00Z'), headers: Buffer.from(headers) };
    }
    async download() { return { content: Readable.from([Buffer.from(BOOKING_MAIL)]) }; }
  }
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const updates = [];
  const service = createIntakeService({
    intakes: buildModel(db),
    parserVersion: 'x',
    now: () => new Date('2026-10-15T08:00:00Z'),
    settings: {
      mailbox: () => ({ host: 'imap.gmail.com', port: 993, user: 'u', password: 'p' }),
      sender: () => 'resa@gdf07.com',
      authentication: () => ({ allowedDomains: '', trustedAuthservId: '' }),
      giteNumbers: () => ({ 1: '309700' }),
      autoApply: () => true,
    },
    readMails: (cfg, h) => readMailsFrom({ ...cfg, ...h, ImapClient: Imap, smtpHostOf: () => 'smtp.gmail.com' }),
    findReservations: ({ startDate, endDate }) => (startDate === '2026-11-13' && endDate === '2026-11-15' ? [PLACEHOLDER] : []),
    commissionPercent: () => 10,
    propertyOptions: () => [],
    getReservation: () => ({ ...PLACEHOLDER, options: [] }),
    today: () => '2026-10-15',
    core: { updateReservation: (id) => { updates.push(id); return { status: 200, clientId: 1, body: { ok: true } }; }, suggestBeds: () => ({ singleBeds: 2, doubleBeds: 4 }) },
  });
  await service.runPass();
  return { row: db.prepare('SELECT status, senderVerified FROM gdf_intakes').get(), updates };
}

test('rule 32(c): an inflated server header followed by a forged one does not verify the mail, nothing is applied', async () => {
  assert.ok(INFLATED.length > 4096);
  const { row, updates } = await pass(INFLATED + FORGED);
  assert.equal(row.senderVerified, 0);
  assert.equal(row.status, 'proposed');
  assert.equal(updates.length, 0);
});
