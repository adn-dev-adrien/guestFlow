// specs/gites-de-france-mail-intake.md §3 edge cases — a pass survives what goes wrong on one intake:
// an intake that throws is recorded as an error and the pass carries on with the next ones; a stay
// that has already started is refused before any client record is created; the mailbox is logged
// out even when the INBOX lock is refused.
const test = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./serviceFixtures');
const { BOOKING_MAIL, withTotals } = require('./fixtures');
const { readBookingMails } = require('../mailboxReader');

const ONE_RENT = withTotals(BOOKING_MAIL, { net: '455.00', options: '80.00', total: '535.00' });
const otherDossier = (text) => text.replace(/11773-2026/g, '11774-2026');

test('an intake that throws is recorded as an error and the intake behind it is still applied', async () => {
  let calls = 0;
  const { service, intakes, calls: recorded } = setup({
    mails: [
      { messageId: '<first>', receivedAt: '2026-10-14T08:00:00.000Z', text: ONE_RENT },
      { messageId: '<second>', receivedAt: '2026-10-14T09:00:00.000Z', text: otherDossier(ONE_RENT) },
    ],
    findReservations: () => {
      calls += 1;
      if (calls === 1) throw new Error('database is locked');
      return [{ id: 22308, propertyId: 1, platform: 'GitesDeFrance', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null }];
    },
  });
  const outcome = await service.runPass();
  assert.deepEqual(outcome, { read: 2, error: 1, applied: 1 });
  assert.equal(intakes.get(1).status, 'error');
  assert.equal(intakes.get(1).error, 'Erreur inattendue : database is locked');
  assert.equal(intakes.get(2).status, 'applied');
  assert.equal(recorded.updates.length, 1);

  // The failed intake left the open list: the next pass does not stumble on it again.
  assert.deepEqual(await service.runPass(), { read: 0 });
});

test('a stay that has started is refused before any client is created', async () => {
  const { service, intakes, calls } = setup({ mails: [{ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: ONE_RENT }], today: '2026-11-13' });
  const outcome = await service.runPass();
  assert.equal(outcome.error, 1);
  assert.equal(calls.clients.length, 0, 'no orphan client record');
  assert.equal(calls.updates.length, 0);
  assert.equal(intakes.get(1).status, 'error');
  assert.equal(intakes.get(1).error, 'Séjour commencé : fiche à saisir à la main');
});

test('the day before the stay, the fiche is still filled', async () => {
  const { service, calls } = setup({ mails: [{ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: ONE_RENT }], today: '2026-11-12' });
  assert.equal((await service.runPass()).applied, 1);
  assert.equal(calls.clients.length, 1);
});

function fakeImap({ failLock = false, failConnect = false } = {}) {
  const log = { loggedOut: 0, released: 0 };
  class FakeImap {
    async connect() { if (failConnect) throw new Error('ECONNRESET'); }
    async getMailboxLock() {
      if (failLock) throw new Error('Mailbox does not exist');
      return { release: () => { log.released += 1; } };
    }
    async search() { return []; }
    async logout() { log.loggedOut += 1; }
  }
  return { FakeImap, log };
}

const MAILBOX = { host: 'imap.test', user: 'u', password: 'p', sender: 's@test' };

test('a refused INBOX lock still logs out of the mailbox', async () => {
  const { FakeImap, log } = fakeImap({ failLock: true });
  await assert.rejects(readBookingMails({ ...MAILBOX, ImapClient: FakeImap }), /Mailbox does not exist/);
  assert.equal(log.loggedOut, 1);
  assert.equal(log.released, 0);
});

test('a failed connect still closes the client', async () => {
  const { FakeImap, log } = fakeImap({ failConnect: true });
  await assert.rejects(readBookingMails({ ...MAILBOX, ImapClient: FakeImap }), /ECONNRESET/);
  assert.equal(log.loggedOut, 1);
});

test('a normal read releases the lock and logs out once', async () => {
  const { FakeImap, log } = fakeImap();
  assert.deepEqual(await readBookingMails({ ...MAILBOX, ImapClient: FakeImap }), []);
  assert.deepEqual(log, { loggedOut: 1, released: 1 });
});
