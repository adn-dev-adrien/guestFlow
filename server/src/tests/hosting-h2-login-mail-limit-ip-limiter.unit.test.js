// specs/hosting-h2-account-security.md rule 62 — a right password met by the code mail limit (429
// RESEND_TOO_SOON / TOO_MANY_SENDS) does not count toward the per-IP login failure limiter; a wrong
// password still does.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { loginLimiter } = require('../middleware/rateLimiters');
const { listenLocal } = require('./listenLocal');

function serve(handler) {
  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', loginLimiter, handler);
  return listenLocal(app);
}

const post = (server) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/auth/login' }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  });
  req.end();
});

test('rule 62 — twelve code-mail refusals after a right password never trip the IP limiter', async (t) => {
  const server = await serve((req, res) => {
    res.locals.codeMailLimited = true;
    res.status(429).json({ error: 'RESEND_TOO_SOON' });
  });
  t.after(() => server.close());
  for (let i = 0; i < 12; i += 1) assert.equal((await post(server)).body.error, 'RESEND_TOO_SOON');
});

test('rule 62 — wrong passwords still trip it after ten', async (t) => {
  const server = await serve((req, res) => res.status(401).json({ error: 'INVALID_CREDENTIALS' }));
  t.after(() => server.close());
  let last;
  for (let i = 0; i < 11; i += 1) last = await post(server);
  assert.equal(last.body.error, 'TOO_MANY_ATTEMPTS');
});

test('rule 62 — the auth controller flags the two refusals', async () => {
  const { setup, fakeRes, fakeSession } = require('./accountSecurityFixture');
  const authController = require('../controllers/authController');
  const h = setup();
  const user = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(user, { method: 'email', password: 'correct horse battery' });
  h.twoFactor.confirm(user, { code: /Code : (\d{6})/.exec(h.mailer.sent[0].text)[1] });
  h.now.advance(120000);
  const c = authController.create(h.users, { twoFactor: h.twoFactor, now: h.now, passwordGuard: h.passwordGuard });
  const run = async () => {
    const res = fakeRes();
    res.locals = {};
    const done = new Promise((resolve) => { res.json = function json(b) { this.body = b; resolve(); return this; }; });
    c.login({ body: { email: 'marie@domaine-ombre.fr', password: 'correct horse battery' }, session: fakeSession(), headers: {} }, res, (e) => { throw e; });
    await done;
    return res;
  };
  assert.equal((await run()).locals.codeMailLimited, undefined, 'the first login mails');
  h.twoFactor.verifyLogin(user.id, { code: /Code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1] });
  const second = await run();
  assert.equal(second.statusCode, 429);
  assert.equal(second.locals.codeMailLimited, true);
});
