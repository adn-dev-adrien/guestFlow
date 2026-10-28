// specs/airbnb-mail-intake.md rule 22 — a mail the receiving server did not authenticate is never
// applied on its own: it becomes a proposal with a warning, and never shadows the genuine mail.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL, addSenderVerifiedColumn } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { SUBJECT, SENT_AT, bookingMail } = require('./fixtures');

const PLACEHOLDER = { id: 22326, propertyId: 1, platform: 'Airbnb', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null, cancelledAt: null };
const mail = (extra = {}) => ({ messageId: '<m1@airbnb>', receivedAt: SENT_AT, sentAt: SENT_AT, subject: SUBJECT, text: bookingMail(), ...extra });

function setup(mails) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const calls = { updates: [] };
  const service = createIntakeService({
    intakes,
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'contact@test', password: 'x' }),
      sender: () => 'automated@airbnb.com',
      authentication: () => ({ allowedDomains: 'airbnb.com', trustedAuthservId: 'mx.test' }),
      listings: () => [[1, '1234567890123456789']],
      autoApply: () => true,
    },
    readMails: async (cfg) => { calls.readWith = cfg; return mails; },
    findReservations: () => [PLACEHOLDER],
    propertyOptions: () => [],
    getReservation: () => ({ ...PLACEHOLDER, notes: '', options: [] }),
    core: {
      updateReservation: (id, patch, opts) => { calls.updates.push({ id, patch, opts }); return { status: 200, body: { ok: true } }; },
      suggestBeds: () => ({ singleBeds: 5, doubleBeds: 4 }),
      platformCommission: ({ gross, payout, touristTax }) => Math.round((gross - payout - touristTax) * 100) / 100,
      withholdsTouristTax: () => true,
    },
    now: () => new Date('2026-10-25T09:00:00.000Z'),
  });
  return { service, intakes, calls };
}

test('rule 22: a forged mail on an untouched fiche becomes a proposal, nothing is written', async () => {
  const { service, intakes, calls } = setup([mail({ authenticated: false })]);
  assert.deepEqual(await service.runPass(), { read: 1, proposed: 1 });
  assert.equal(calls.updates.length, 0);
  assert.equal(intakes.get(1).senderVerified, false);
  assert.equal(service.blockFor(PLACEHOLDER.id).senderUnverified, true);
});

test('rule 22: no authentication verdict at all counts as unverified', async () => {
  const { service, calls } = setup([mail()]);
  assert.equal((await service.runPass()).proposed, 1);
  assert.equal(calls.updates.length, 0);
});

test('rule 22: an authenticated mail still fills the untouched fiche', async () => {
  const { service, calls } = setup([mail({ authenticated: true })]);
  assert.deepEqual(await service.runPass(), { read: 1, applied: 1 });
  assert.equal(calls.updates.length, 1);
  assert.equal(service.blockFor(PLACEHOLDER.id).senderUnverified, false);
});

test('rule 22: a forged proposal does not shadow the genuine mail with the same confirmation code', async () => {
  const { service, intakes, calls } = setup([mail({ messageId: '<forged>', authenticated: false }), mail({ messageId: '<real>', authenticated: true })]);
  assert.deepEqual(await service.runPass(), { read: 2, proposed: 1, applied: 1 });
  assert.equal(intakes.get(2).status, 'applied');
  assert.equal(calls.updates.length, 1);
  assert.equal(service.blockFor(PLACEHOLDER.id).senderUnverified, false);
});

test('rule 22: the operator can apply a proposal from the banner', async () => {
  const { service, calls } = setup([mail({ authenticated: false })]);
  await service.runPass();
  assert.equal(service.applyFromBanner(1).status, 'applied');
  assert.equal(calls.updates.length, 1);
});

test('rule 22: a forged mail that does not parse leaves no row', async () => {
  const { service, intakes } = setup([mail({ authenticated: false, text: 'Réservation confirmée : rien de lisible' })]);
  await service.runPass();
  assert.equal(intakes.count(), 0);
});

test('rule 22: the authentication settings reach the mailbox reader', async () => {
  const { service, calls } = setup([]);
  await service.runPass();
  assert.equal(calls.readWith.allowedDomains, 'airbnb.com');
  assert.equal(calls.readWith.trustedAuthservId, 'mx.test');
});

test('rule 22: an intakes table created before the check gets the column, its rows stay verified', () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL.replace('    senderVerified INTEGER NOT NULL DEFAULT 1,\n', ''));
  db.prepare("INSERT INTO airbnb_intakes (messageId, receivedAt, status) VALUES ('<old>', '2026-10-01T00:00:00Z', 'applied')").run();
  addSenderVerifiedColumn(db);
  addSenderVerifiedColumn(db);
  assert.equal(buildModel(db).get(1).senderVerified, true);
});
