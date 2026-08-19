// Asking for the acompte at booking time (specs/payment-schedule-and-cancellation.md §3.7 rule 36).
//
// The acompte is due from the day the guest books, so the request must leave with the booking rather
// than wait for the operator to remember it. It is best-effort by design: the reservation is already
// created and answered by the time this runs, so nothing here may fail a booking.

const test = require('node:test');
const assert = require('node:assert/strict');

const { requestDepositOnBooking } = require('../utils/depositRequestOnBooking');

const RESERVATION = {
  kind: 'reservation',
  platform: 'direct',
  depositAmount: 274,
  depositPaid: 0,
  depositDisabled: 0,
  clientEmail: 'marie@example.com',
};

function deps(row, sendImpl) {
  const calls = [];
  return {
    calls,
    deps: {
      getReservation: () => row,
      sendDepositRequest: async (id) => {
        calls.push(id);
        return sendImpl ? sendImpl(id) : { httpStatus: 200 };
      },
    },
  };
}

test('a direct booking with an acompte and an email address is asked to pay', async () => {
  const { calls, deps: d } = deps(RESERVATION);
  const out = await requestDepositOnBooking(d, 42);
  assert.deepEqual(out, { sent: true, httpStatus: 200 });
  assert.deepEqual(calls, [42]);
});

test('the booking engine on our own site counts as direct', async () => {
  const { deps: d } = deps({ ...RESERVATION, platform: 'Lodgify' });
  assert.equal((await requestDepositOnBooking(d, 42)).sent, true);
});

test('nothing is asked when there is nothing to ask for', async () => {
  const cases = [
    [{ platform: 'Airbnb' }, 'platform-booking'],
    [{ depositAmount: 0 }, 'no-deposit'],
    [{ depositDisabled: 1 }, 'deposit-disabled'],
    // Converted from a devis whose acompte was already paid online.
    [{ depositPaid: 1 }, 'already-paid'],
    [{ clientEmail: '' }, 'no-email'],
    [{ clientEmail: '   ' }, 'no-email'],
    [{ kind: 'devis' }, 'not-a-reservation'],
  ];
  for (const [override, reason] of cases) {
    const { calls, deps: d } = deps({ ...RESERVATION, ...override });
    const out = await requestDepositOnBooking(d, 42);
    assert.deepEqual(out, { sent: false, reason }, `expected ${reason}`);
    assert.equal(calls.length, 0, 'no request sent');
  }
});

test('an unknown reservation is reported, not thrown', async () => {
  const out = await requestDepositOnBooking({ getReservation: () => null, sendDepositRequest: async () => ({}) }, 42);
  assert.deepEqual(out, { sent: false, reason: 'no-reservation' });
});

test('a refused send is reported with its status, never thrown', async () => {
  const { deps: d } = deps(RESERVATION, () => ({ httpStatus: 502 }));
  assert.deepEqual(await requestDepositOnBooking(d, 42), { sent: false, reason: 'send-failed', httpStatus: 502 });
});

test('a throwing sender (no SMTP, Qonto down) never escapes — the booking stands', async () => {
  const errors = [];
  const out = await requestDepositOnBooking({
    getReservation: () => RESERVATION,
    sendDepositRequest: async () => { throw new Error('QONTO_UNREACHABLE'); },
    onError: (reason, err) => errors.push([reason, err.message]),
  }, 42);
  assert.deepEqual(out, { sent: false, reason: 'send-error' });
  assert.deepEqual(errors, [['send-error', 'QONTO_UNREACHABLE']]);
});
