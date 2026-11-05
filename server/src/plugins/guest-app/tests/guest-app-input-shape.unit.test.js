// specs/guest-app.md rules 1, 6 and 33 — the public guest routes against malformed bodies. A scan or a lookup
// whose fields are not text answers the same generic 404 as a wrong code (no oracle, never a 500); a name
// confirmation without a name is a 400 that spends no attempt of the three.
const test = require('node:test');
const assert = require('node:assert/strict');

const { addStay, enable, freshDb, startApi } = require('./guestAppFixtures');

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
