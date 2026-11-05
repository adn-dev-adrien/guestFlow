// specs/guest-app.md rules 1, 6, 33, 28, 40 and 41 — the guest routes against malformed bodies. A scan or a lookup
// whose fields are not text answers the same generic 404 as a wrong code (no oracle, never a 500); a name
// confirmation without a name is a 400 that spends no attempt of the three; the service hours, the delivery times
// and the slots answer a field of the wrong type with a 400, never a 500.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, addStay, enable, freshDb, livePlugins, sell, startApi,
} = require('./guestAppFixtures');

const NOT_TEXT = [['a number', 12], ['an array', ['x']], ['an object', { $gt: '' }], ['null', null], ['blank', '   '], ['too long', 'x'.repeat(121)]];

async function withApi(fn) {
  const db = freshDb();
  const ctx = await startApi(db);
  const code = enable(ctx.api, db);
  try {
    await fn({ db, code, ...ctx });
  } finally {
    await ctx.close();
  }
}

test('rule 1: a scan whose code is not text answers the unknown-code 404', () => withApi(async ({ call }) => {
  for (const [label, lodgingCode] of NOT_TEXT) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', '/public/v1/guest/sessions', { lodgingCode });
    assert.equal(res.status, 404, label);
    assert.equal(res.body.error.code, 'LODGING_NOT_FOUND', label);
  }
  assert.equal((await call('POST', '/public/v1/guest/sessions')).status, 404, 'no body');
}));

test('rule 6: a lookup whose fields are not text answers the one generic error', () => withApi(async ({ call, db }) => {
  addStay(db);
  for (const [label, value] of NOT_TEXT.slice(0, 4)) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', '/public/v1/guest/sessions/lookup', { lastName: value, reservationNumber: value });
    assert.equal(res.status, 404, label);
    assert.equal(res.body.error.code, 'STAY_NOT_FOUND', label);
  }
}));

test('rule 33: a confirmation without a name is a 400 and spends no attempt', () => withApi(async ({ call, db, code }) => {
  addStay(db);
  await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
  for (const [label, lastName] of NOT_TEXT) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', '/public/v1/guest/me/confirm-name', { lastName });
    assert.equal(res.status, 400, label);
    assert.equal(res.body.error.code, 'INVALID_INPUT', label);
  }
  const wrong = await call('POST', '/public/v1/guest/me/confirm-name', { lastName: 'Martin' });
  assert.equal(wrong.body.error.attemptsLeft, 2, 'the malformed bodies spent nothing');
}));

test('rule 40: a service-hours PUT whose fields have the wrong type is a 400', () => withApi(async ({ call }) => {
  const wrong = [
    ['an array body', [{ weekly: {} }]],
    ['weekly as a list', { weekly: [[]], exceptions: [] }],
    ['a day as text', { weekly: { 1: '08:00-12:00' }, exceptions: [] }],
    ['a range as text', { weekly: { 1: ['08:00'] }, exceptions: [] }],
    ['an hour as a number', { weekly: { 1: [{ from: 8, to: 12 }] }, exceptions: [] }],
    ['an hour as an object', { weekly: { 1: [{ from: { $gt: '' }, to: '12:00' }] }, exceptions: [] }],
    ['exceptions as an object', { weekly: {}, exceptions: { date: 'x' } }],
    ['an exception date as a number', { weekly: {}, exceptions: [{ date: 20991231, closed: true }] }],
    ['closed as text', { weekly: {}, exceptions: [{ date: 'x', closed: 'yes' }] }],
    ['ranges as an object', { weekly: {}, exceptions: [{ date: 'x', ranges: { from: '08:00' } }] }],
  ];
  for (const [label, body] of wrong) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('PUT', '/api/guest-app/service-hours', body);
    assert.equal(res.status, 400, label);
    assert.equal(typeof res.body.error, 'string', label);
  }
}));

test('rules 28, 41: delivery times and slots answer a malformed cart or id with a 400 INVALID_INPUT', async () => {
  const teardown = livePlugins();
  try {
    await withApi(async ({ call, db, code }) => {
      addStay(db);
      addOption(db, { id: 1, title: 'Cidre' });
      sell(db, 'option', 1, { needsStaff: 1 });
      await call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
      const carts = [
        ['no lines', {}],
        ['lines as text', { lines: 'cidre' }],
        ['an empty cart', { lines: [] }],
        ['21 lines', { lines: Array.from({ length: 21 }, () => ({ kind: 'option', id: 1 })) }],
        ['a null line', { lines: [null] }],
        ['a kind as a number', { lines: [{ kind: 1, id: 1 }] }],
        ['an id as text', { lines: [{ kind: 'option', id: '1' }] }],
        ['an id as an object', { lines: [{ kind: 'option', id: { $gt: 0 } }] }],
        ['an unknown key', { lines: [{ kind: 'option', id: 1 }], deliverAt: 'x' }],
      ];
      for (const [label, body] of carts) {
        // eslint-disable-next-line no-await-in-loop
        const res = await call('POST', '/public/v1/guest/shop/delivery-slots', body);
        assert.equal(res.status, 400, label);
        assert.equal(res.body.error.code, 'INVALID_INPUT', label);
      }
      for (const id of ['abc', '1.5', '-1', '0']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await call('GET', `/public/v1/guest/shop/resources/${id}/slots`);
        assert.equal(res.status, 400, id);
        assert.equal(res.body.error.code, 'INVALID_INPUT', id);
      }
      assert.equal((await call('GET', '/public/v1/guest/shop/resources/1/slots?from=2099-07-07&from=2099-07-08')).status, 400, 'a date given twice');
    });
  } finally {
    teardown();
  }
});
