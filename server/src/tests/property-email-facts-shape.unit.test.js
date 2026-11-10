// specs/settings-input-guards.md rule 64 (audit R42-INJ-L1, 2026-11-10) — through the real application: on POST and PUT
// /api/properties the e-mail facts are judged with the rest, before the first write. `emailHook` / `emailHookEn` text of
// 300 characters at most (as PUT /properties/email-hooks), `hasWifi` / `depositEnabled` a switch, `cleaningIncluded` /
// `towelsProvided` / `bedLinenProvided` a switch or `options`. They used to store « [object Object] » in a guest e-mail,
// or throw after the logement was saved (PUT) or created (POST, a ghost logement counted in the plan quota).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');

let app;
let admin;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

const count = () => app.readDb('SELECT COUNT(*) AS n FROM properties')[0].n;
const stored = () => app.readDb('SELECT name, maxGuests, emailHook, hasWifi, cleaningIncluded FROM properties WHERE id = ?', app.ids.property)[0];
const url = () => `/api/properties/${app.ids.property}`;
async function multipart(method, path, pairs) {
  const form = new FormData();
  for (const [key, value] of pairs) form.append(key, value);
  const res = await fetch(app.base + path, { method, headers: { cookie: admin, origin: app.base }, body: form });
  return { status: res.status, text: await res.text() };
}

const WRONG = [
  ['emailHook', { a: 1 }], ['emailHook', ['x', 'y']], ['emailHook', 12], ['emailHook', 'h'.repeat(301)],
  ['emailHookEn', { a: 1 }], ['emailHookEn', JSON.parse('{"toString":1}')],
  ['hasWifi', 'yes'], ['hasWifi', { a: 1 }], ['depositEnabled', ['1']], ['depositEnabled', 2],
  ['cleaningIncluded', 'yes'], ['cleaningIncluded', { a: 1 }], ['towelsProvided', JSON.parse('{"toString":1}')], ['bedLinenProvided', 'maybe'],
];

test('rule 64 — PUT: a wrong e-mail fact is 400 naming it, and nothing of the logement moves', async () => {
  const before = stored();
  for (const [key, value] of WRONG) {
    const res = await app.call(admin, 'PUT', url(), { name: 'Changé', maxGuests: 3, [key]: value });
    assert.equal(res.status, 400, `${key} ${JSON.stringify(value).slice(0, 40)}: ${res.text}`);
    assert.equal(res.json.error, 'PROPERTY_INVALID');
    assert.ok(res.json.errors[key], `${key}: ${res.text}`);
  }
  const bracketed = await multipart('PUT', url(), [['name', 'Changé'], ['maxGuests', '3'], ['emailHook[a]', 'x']]);
  assert.equal(bracketed.status, 400, bracketed.text);
  assert.deepEqual(stored(), before);
});

test('rule 64 — POST: a wrong e-mail fact is 400, no logement created', async () => {
  const before = count();
  for (const [key, value] of WRONG) {
    const res = await app.call(admin, 'POST', '/api/properties', { name: 'Fantôme', maxGuests: 2, doubleBeds: 1, [key]: value });
    assert.equal(res.status, 400, `${key} ${JSON.stringify(value).slice(0, 40)}: ${res.text}`);
  }
  for (const field of ['emailHook[a]', 'cleaningIncluded[a]']) {
    const res = await multipart('POST', '/api/properties', [['name', 'Fantôme'], ['maxGuests', '2'], ['doubleBeds', '1'], [field, 'x']]);
    assert.equal(res.status, 400, `${field}: ${res.text}`);
  }
  assert.equal(count(), before);
});

test('rule 64 — what the page and a JSON caller send still saves: a hook of 300, the switches as text or booleans, « options »', async () => {
  const ok = await app.call(admin, 'PUT', url(), {
    name: 'Ombre', maxGuests: 4, emailHook: 'h'.repeat(300), emailHookEn: '', hasWifi: false, depositEnabled: true,
    cleaningIncluded: 'options', towelsProvided: '1', bedLinenProvided: 0,
  });
  assert.equal(ok.status, 200, ok.text);
  const row = stored();
  assert.equal(row.emailHook.length, 300);
  assert.equal(row.hasWifi, 0);
  assert.equal(row.cleaningIncluded, null);
  const form = await multipart('PUT', url(), [['name', 'Ombre'], ['maxGuests', '4'], ['hasWifi', 'true'], ['depositEnabled', 'false'], ['cleaningIncluded', '1']]);
  assert.equal(form.status, 200, form.text);
  assert.equal(stored().hasWifi, 1);
  assert.equal(stored().cleaningIncluded, 1);
});
