// specs/airbnb-mail-intake.md rule 32 (audit r4, external N1) — a pass that hit the mail cap says how many mails it
// left unread, in its result and on the home's attention line, in short impersonal French.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { summarize } = require('../attention');

function build(capped) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const handlers = {};
  const service = createIntakeService({
    intakes: buildModel(db),
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'c@test', password: 'x' }),
      sender: () => 'automated@airbnb.com',
      listings: () => [[1, '1234567890123456789']],
      autoApply: () => true,
    },
    readMails: async (cfg, h) => { Object.assign(handlers, h); if (capped) h.onCap(capped); },
    findReservations: () => [],
    propertyOptions: () => [],
    getReservation: () => null,
    core: {},
    now: () => new Date('2026-10-26T09:00:00.000Z'),
  });
  return { service, handlers };
}

test('rule 32: a pass that hit the cap reports the mails left in its result', async () => {
  const { service, handlers } = build({ notRead: 340, limit: 200 });
  const result = await service.runPass();
  assert.equal(result.unread, 340);
  assert.equal(typeof handlers.onCap, 'function');
});

test('rule 32: a pass under the cap reports nothing', async () => {
  const { service } = build(null);
  assert.equal('unread' in await service.runPass(), false);
});

test('rule 32: the attention line says the mails not read, alone or with the mails to check', () => {
  assert.deepEqual(summarize({ items: [], unread: 340 }), { count: 1, title: 'Mails Airbnb non lus : 340 (afflux).', detail: 'Plafond de lecture atteint', severity: 'todo' });
  assert.equal(summarize({ items: [{}], unread: 340 }).detail, '1 mail · 340 non lus (afflux)');
  assert.equal(summarize({ items: [], unread: 0 }), null);
  assert.equal(summarize({ items: [{}, {}] }).detail, '2 mails');
});
