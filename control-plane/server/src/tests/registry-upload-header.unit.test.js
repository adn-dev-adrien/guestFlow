// specs/plugins-phase-4-registry.md rule 53 (review of #869) — an upload whose `x-file-name` is not valid
// percent-encoding is a 400 BAD_FILE_NAME with a message, not a 500.

const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { passwordHash } = require('../utils/gf');
const { createApp } = require('../app');
const { makeContext } = require('./helpers');

test('rule 53: an undecodable x-file-name answers 400 BAD_FILE_NAME', async () => {
  const h = makeContext();
  h.ctx.models.operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const code = /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
    const verified = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ code }) });
    const session = (verified.headers.get('set-cookie') || '').split(';')[0] || cookie;
    const res = await fetch(`${base}/api/registry/packages`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'linen-%E0%A4%A.tgz', cookie: session },
      body: Buffer.from('x'),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'BAD_FILE_NAME');
    assert.match(body.message, /nom/i);
  } finally {
    await new Promise((r) => server.close(r));
    h.cleanup();
  }
});
