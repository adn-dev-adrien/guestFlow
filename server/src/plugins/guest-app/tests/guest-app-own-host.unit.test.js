// specs/guest-app.md rule 58 (audit R36 A36-2 = R36-CON-M1 = R36-P1) — the guest host is never GuestFlow's own address:
// the save refuses the host of its public URL and the hosts the saving request came through (its Host, its Origin),
// 400 with the reason; the generic plugin settings route cannot write it at all; a stored value equal to GuestFlow's
// own address is ignored (no link, no app on it), so the back office stays reachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { freshDb, startApi } = require('./guestAppFixtures');
const { memorySettings } = require('..');
const settings = require('../settings');

const OWN = 'C’est l’adresse de GuestFlow : en choisir une autre, par exemple sejour.domainesolio.com.';

async function withStudio(fn) {
  const store = memorySettings();
  const ctx = await startApi(freshDb(), { settingsStore: () => store, publicUrl: () => 'https://gf.example.test/' });
  const put = (body, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: new URL(ctx.base).port, path: '/api/guest-app/studio/settings', method: 'PUT',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(data);
  });
  try {
    await fn({ put, store });
  } finally {
    await ctx.close();
  }
}

test('rule 58: the save refuses the request’s own host, its Origin and the public URL’s host — the auditor’s lockout', () => withStudio(async ({ put, store }) => {
  const refusals = [
    await put({ guestHost: 'admin.example.test' }, { host: 'admin.example.test:8443' }),
    await put({ guestHost: 'Admin.Example.test' }, { host: 'admin.example.test' }),
    await put({ guestHost: 'lan.example.test' }, { origin: 'https://lan.example.test' }),
    await put({ guestHost: 'gf.example.test' }),
  ];
  refusals.forEach((res) => {
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: OWN, field: 'guestHost' });
  });
  assert.equal(store.get('guestHost'), null, 'nothing stored');
  const ok = await put({ guestHost: 'sejour.example.test' }, { host: 'admin.example.test' });
  assert.equal(ok.status, 200);
  assert.equal(store.get('guestHost'), 'sejour.example.test');
}));

test('rule 58: the generic plugin settings route cannot write the guest host, and its GET leaves it out', () => {
  const declared = settings.DECLARED.find((d) => d.key === 'guestHost');
  assert.equal(declared.internal, true);
});

test('rule 58: a stored guest host equal to GuestFlow’s own address is ignored, case and trailing path aside', () => {
  assert.equal(settings.effectiveGuestHost('GF.example.test', 'https://gf.example.test/login'), null);
  assert.equal(settings.effectiveGuestHost('sejour.example.test', 'https://gf.example.test'), 'sejour.example.test');
  assert.equal(settings.effectiveGuestHost('', 'https://gf.example.test'), null);
  assert.equal(settings.effectiveGuestHost('sejour.example.test', ''), 'sejour.example.test');
});
