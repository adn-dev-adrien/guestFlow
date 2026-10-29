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

test('rule 22 (amended by rule 26): a forged mail that does not parse is kept as an ignored row, the same mail from a verified sender is recorded as an error', async () => {
  const unreadable = mail({ text: 'Code de confirmation : illisible. Vous gagnez : rien.' });
  const forged = setup([{ ...unreadable, authenticated: false }]);
  assert.deepEqual(await forged.service.runPass(), { read: 1 });
  assert.equal(forged.intakes.count(), 1);
  assert.equal(forged.intakes.get(1).status, 'ignored');
  assert.deepEqual(forged.service.attention(), []);
  const verified = setup([{ ...unreadable, authenticated: true }]);
  await verified.service.runPass();
  assert.equal(verified.intakes.count(), 1, 'the branch under test is reached: a parse failure of a verified mail is kept');
  assert.equal(verified.intakes.get(1).status, 'error');
});

test('rule 22: an unverified proposal reaches the dashboard, a verified one does not', async () => {
  const forged = setup([mail({ authenticated: false })]);
  await forged.service.runPass();
  assert.deepEqual(forged.service.attention().map((i) => [i.text, i.reservationId]), [['Expéditeur non vérifié', PLACEHOLDER.id]]);
  const edited = setup([mail({ authenticated: true })]);
  edited.intakes.insert({ messageId: 'x', receivedAt: SENT_AT, status: 'proposed', senderVerified: true });
  assert.deepEqual(edited.service.attention(), []);
});

test('rule 22: the authentication settings reach the mailbox reader', async () => {
  const { service, calls } = setup([]);
  await service.runPass();
  assert.equal(calls.readWith.allowedDomains, 'airbnb.com');
  assert.equal(calls.readWith.trustedAuthservId, 'mx.test');
});

test('rule 22: an intakes table created before the check gets the column: applied rows stay verified, open rows are not', () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL.replace('    senderVerified INTEGER NOT NULL DEFAULT 0,\n', ''));
  const insert = db.prepare("INSERT INTO airbnb_intakes (messageId, receivedAt, status, appliedAt) VALUES (?, '2026-10-01T00:00:00Z', ?, ?)");
  insert.run('<applied>', 'applied', '2026-10-01 10:00:00');
  insert.run('<proposed>', 'proposed', null);
  insert.run('<pending>', 'pending', null);
  addSenderVerifiedColumn(db);
  addSenderVerifiedColumn(db);
  const model = buildModel(db);
  assert.deepEqual([1, 2, 3].map((id) => model.get(id).senderVerified), [true, false, false]);
});
