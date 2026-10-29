// specs/airbnb-mail-intake.md rule 30 (audit r3, external N5) — the messages, reminders and payouts of the
// sender, and a mail too large to read, are remembered like an intake, so the next pass skips them before
// downloading them; the pass hands the reader a `seen` predicate and a cap, and takes the mails one by one.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');

const MESSAGE = { messageId: '<msg@airbnb>', receivedAt: '2026-10-25T08:00:00.000Z', sentAt: '2026-10-25T08:00:00.000Z', subject: 'Nouveau message de Camille', text: 'Bonjour, à quelle heure ?', authenticated: true };
const HUGE = { messageId: '<huge@airbnb>', receivedAt: '2026-10-25T08:01:00.000Z', sentAt: '2026-10-25T08:01:00.000Z', subject: 'Réservation confirmée', text: '', skipped: 'tooLarge', authenticated: false };

function build(mails) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const seen = { handlers: null };
  const service = createIntakeService({
    intakes,
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'c@test', password: 'x' }),
      sender: () => 'automated@airbnb.com',
      listings: () => [[1, '1234567890123456789']],
      autoApply: () => true,
    },
    readMails: async (cfg, h) => { seen.handlers = h; for (const m of mails) if (!h.seen(m.messageId)) await h.onMail(m); },
    findReservations: () => [],
    propertyOptions: () => [],
    getReservation: () => null,
    core: {},
  });
  return { service, intakes, db, seen };
}

test('rule 30: the pass gives the reader a seen predicate and a cap of 200 mails', async () => {
  const { service, seen } = build([MESSAGE]);
  await service.runPass();
  assert.equal(seen.handlers.limit, 200);
  assert.equal(seen.handlers.seen(MESSAGE.messageId), true);
  assert.equal(seen.handlers.seen('<other@airbnb>'), false);
});

test('rule 30: a message of another kind is remembered as ignored, out of every list', async () => {
  const { service, intakes, db } = build([MESSAGE]);
  assert.deepEqual(await service.runPass(), { read: 0 });
  assert.equal(db.prepare('SELECT status FROM airbnb_intakes WHERE messageId = ?').get(MESSAGE.messageId).status, 'ignored');
  assert.deepEqual(intakes.listOpen(), []);
});

test('rule 30: a mail too large to read is remembered as ignored', async () => {
  const { service, intakes, db } = build([HUGE]);
  await service.runPass();
  assert.equal(db.prepare('SELECT status FROM airbnb_intakes WHERE messageId = ?').get(HUGE.messageId).status, 'ignored');
  assert.deepEqual(intakes.listOpen(), []);
});
