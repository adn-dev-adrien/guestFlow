// specs/airbnb-mail-intake.md rules 18, 19, 20 (audit 2026-10-27) — a started stay creates no client,
// a throwing intake does not stop the pass, the tax mode is the fiche's own platform's.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { SUBJECT, SENT_AT, bookingMail } = require('./fixtures');

const R = { id: 1, propertyId: 1, platform: 'Airbnb Lodge', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null, cancelledAt: null };
const MAIL = { messageId: '<a>', receivedAt: SENT_AT, sentAt: SENT_AT, subject: SUBJECT, text: bookingMail() };

function setup({ mails = [MAIL], today = '2026-10-25', findReservations = () => [R], withholds = () => true } = {}) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const calls = { clients: [], updates: [], withholds: [] };
  const service = createIntakeService({
    intakes: buildModel(db),
    settings: { mailbox: () => ({ host: 'h', user: 'u', password: 'p' }), sender: () => 's', listings: () => [[1, '1234567890123456789']], autoApply: () => true },
    readMails: async () => mails,
    findReservations,
    propertyOptions: () => [],
    getReservation: () => ({ ...R, options: [], notes: '' }),
    core: {
      updateReservation: (id) => { calls.updates.push(id); return { status: 200 }; },
      suggestBeds: () => ({ singleBeds: 1, doubleBeds: 1 }),
      platformCommission: () => 1,
      withholdsTouristTax: (propertyId, platform) => { calls.withholds.push([propertyId, platform]); return withholds(); },
      findOrCreateClient: (c) => { calls.clients.push(c); return { id: 9 }; },
    },
    today: () => today,
  });
  return { service, db, calls };
}

test('rule 18: a stay that already started is refused before any client is created', async () => {
  const { service, db, calls } = setup({ today: '2026-12-26' });
  assert.deepEqual(await service.runPass(), { read: 1, error: 1 });
  assert.deepEqual(calls.clients, []);
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(db.prepare('SELECT status, error, reservationId FROM airbnb_intakes').get(),
    { status: 'error', error: 'Séjour commencé : fiche à saisir à la main', reservationId: 1 });
});

test('rule 19: one intake that throws is recorded as an error and the next one is still applied', async () => {
  const second = { ...MAIL, messageId: '<b>', receivedAt: '2026-10-24T09:00:00.000Z', text: bookingMail().replace(/HMTEST1234/g, 'HMTEST9999') };
  let n = 0;
  const { service, db, calls } = setup({
    mails: [MAIL, second],
    findReservations: () => { n += 1; if (n === 1) throw new Error('database is locked'); return [R]; },
  });
  assert.deepEqual(await service.runPass(), { read: 2, error: 1, applied: 1 });
  assert.deepEqual(calls.updates, [1]);
  assert.deepEqual(db.prepare('SELECT status, error FROM airbnb_intakes ORDER BY status').all(), [
    { status: 'applied', error: null },
    { status: 'error', error: 'Erreur inattendue : database is locked' },
  ]);
});

test('rule 20: the tax mode is asked for the fiche’s own platform, not a hard-coded key', async () => {
  const { service, calls } = setup();
  await service.runPass();
  assert.deepEqual(calls.withholds[0], [1, 'Airbnb Lodge']);
});
