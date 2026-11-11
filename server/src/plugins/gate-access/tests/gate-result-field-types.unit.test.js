// specs/gate-access-sowel-connector.md §3.2 rules 10-11 — the fields Sowel posts back are typed
// before they are filed: `state` a status word, `code` a short string, `url` an https link (both end
// up in the guest's e-mails), `error` / `message` strings. An entry that breaks a type is skipped
// like any entry that cannot be filed, and a batch is filed all or nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, addStay, addUser, fakePush, silent } = require('./gateKeysFixtures');
const { parseResult, receiveResults } = require('../results');

const NOW = new Date('2026-09-27T18:00:00.000Z');
const ok = (over = {}) => ({
  reservationId: 7, action: 'create', ok: true, state: 'not_yet', code: '4K7M-9QT2', url: 'https://acces.example.org/#i=4K7M9QT2', ...over,
});
const ko = (over = {}) => ({ reservationId: 7, action: 'create', ok: false, error: 'unknown_profile', message: 'not granted', ...over });

test('a well-typed success and failure are filed as sent', () => {
  assert.deepEqual(parseResult(ok()), {
    reservationId: 7, action: 'create', ok: true, state: 'not_yet', code: '4K7M-9QT2',
    url: 'https://acces.example.org/#i=4K7M9QT2', error: null, message: null,
  });
  assert.deepEqual(parseResult(ko()), {
    reservationId: 7, action: 'create', ok: false, state: null, code: null, url: null, error: 'unknown_profile', message: 'not granted',
  });
});

test('code and url stay optional: a profile without a code, a house without a public address', () => {
  const parsed = parseResult(ok({ code: null, url: undefined, state: '' }));
  assert.deepEqual([parsed.state, parsed.code, parsed.url], [null, null, null]);
});

for (const [label, over] of [
  ['an object code', { code: { toString: () => '1234' } }],
  ['a numeric code', { code: 1234 }],
  ['a code past 64 characters', { code: 'A'.repeat(65) }],
  ['a code with a line break', { code: '12\n34' }],
  ['an http link', { url: 'http://acces.example.org/#i=1' }],
  ['a javascript: link', { url: 'javascript:alert(1)' }],
  ['a link that is not a URL', { url: 'acces.example.org' }],
  ['an object link', { url: { href: 'https://x.example' } }],
  ['an array state', { state: ['live'] }],
  ['a state that is not a status word', { state: 'Live <b>' }],
]) {
  test(`a success with ${label} cannot be filed`, () => {
    assert.equal(parseResult(ok(over)), null);
  });
}

test('a failure with an object message or error cannot be filed; a missing error reads « unknown »', () => {
  assert.equal(parseResult(ko({ message: { text: 'x' } })), null);
  assert.equal(parseResult(ko({ error: 42 })), null);
  assert.equal(parseResult(ko({ error: undefined })).error, 'unknown');
});

test('a typed-out entry is skipped and the rest of the batch is filed', async () => {
  const { db, model } = freshDb();
  const a = addStay(db);
  const b = addStay(db);
  const res = await receiveResults({ model, pushService: fakePush(), logger: silent, now: NOW }, {
    results: [ok({ reservationId: a.id }), ok({ reservationId: b.id, url: 'http://evil.example/' })],
  });
  assert.deepEqual(res, { status: 200, body: { stored: 1 } });
  assert.equal(model.get(a.id).url, 'https://acces.example.org/#i=4K7M9QT2');
  assert.equal(model.get(b.id), null);
});

test('a batch that throws half-way files nothing and pushes nothing', async () => {
  const { db, model } = freshDb();
  addUser(db, { id: 1, roles: ['admin'] });
  const a = addStay(db);
  const b = addStay(db);
  const push = fakePush();
  let filed = 0;
  const failingModel = {
    ...model,
    upsertResult(result) {
      filed += 1;
      if (filed === 2) throw new Error('disk I/O error');
      return model.upsertResult(result);
    },
  };
  await assert.rejects(receiveResults({ model: failingModel, pushService: push, logger: silent, now: NOW }, {
    results: [ko({ reservationId: a.id }), ko({ reservationId: b.id })],
  }), /disk I\/O error/);
  assert.equal(model.get(a.id), null, 'the first result was rolled back');
  assert.equal(push.calls.length, 0);
});
