// specs/hosting-h2-account-security.md rules 15, 18, 19, 20 — what a support session may not do,
// judged on the path Express really routes (any case, trailing slash), refused again by the
// controller itself; what it may not change (users, credentials); and the trace of what it reads,
// worded for the customer.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fakeRes, fakeSession, withSupportRequest, supportLink, openSupportAccess } = require('./accountSecurityFixture');
const { createSupportAudit, isForbidden } = require('../middleware/supportAudit');
const { normalizePath } = require('../utils/supportSessionPolicy');
const { buildRouter } = require('../routes/supportAccess');
const { describe, pageName } = require('../utils/supportLogLabels');

// A support session on an open access, and a second request the customer has not answered yet.
function supportSession() {
  const h = withSupportRequest();
  const accessId = openSupportAccess(h);
  const opened = h.supportAccess.consumeLink(supportLink(h, accessId));
  const session = fakeSession({ user: opened.user, supportAccessId: accessId, supportExpiresAt: opened.expiresAt });
  h.write({ requestId: 'req-2', reason: 'Deuxième demande' });
  const { pending } = h.supportAccess.banner(h.marie);
  return { ...h, accessId, pendingId: pending.id, session };
}

const ok = (req, res) => res.json({ reached: `${req.method} ${req.baseUrl}${req.path}` });

// The instance's /api as index.js mounts it: the guard before every router, the real support router,
// and stand-ins that answer 200 for the routes the guard must stop.
function app(h, { audit = true } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = h.session; req.user = h.session.user; next(); });
  if (audit) a.use('/api', createSupportAudit({ controller: h.supportAccess, isSecretSetting: (id, key) => id === 'weather-alerts' && key === 'apiKey' }));
  a.use('/api/support-access', buildRouter(() => h.supportAccess));
  const auth = express.Router();
  auth.post('/change-password', ok);
  auth.post('/2fa/start', ok);
  a.use('/api/auth', auth);
  const users = express.Router();
  users.get('/', ok);
  users.post('/', ok);
  users.put('/me', ok);
  users.put('/:id', ok);
  users.post('/:id/reset-password', ok);
  users.delete('/:id/two-factor', ok);
  a.use('/api/users', users);
  const settings = express.Router();
  settings.put('/', ok);
  a.use('/api/settings', settings);
  const plugins = express.Router();
  plugins.put('/:id/settings', ok);
  a.use('/api/plugins', plugins);
  const reservations = express.Router();
  reservations.get('/:id', ok);
  reservations.put('/:id', ok);
  a.use('/api/reservations', reservations);
  return a;
}

function call(a, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = a.listen(0, async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
          method,
          headers: body ? { 'content-type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => null);
        server.close(() => resolve({ status: res.status, body: json }));
      } catch (e) { server.close(() => reject(e)); }
    });
  });
}

test('rule 15 — the guard judges the path Express routes: odd casing, trailing slash, doubled slashes', () => {
  assert.equal(normalizePath('/SUPPORT-ACCESS//3/Decide/'), '/support-access/3/decide');
  assert.equal(normalizePath('/'), '/');
  assert.equal(isForbidden('POST', '/SUPPORT-ACCESS/3/decide'), true);
  assert.equal(isForbidden('POST', '/support-access/3/revoke/'), true);
  assert.equal(isForbidden('POST', '/auth/change-password/'), true);
  assert.equal(isForbidden('POST', '/auth/2FA/start'), true);
  assert.equal(isForbidden('PUT', '/USERS/me'), true);
  assert.equal(isForbidden('POST', '/Support-Access/page/'), false);
});

test('rule 15 — through the real router, a support session cannot self-approve nor revoke by any spelling', async () => {
  const h = supportSession();
  const a = app(h);
  for (const [method, path, body] of [
    ['POST', `/api/SUPPORT-ACCESS/${h.pendingId}/decide`, { decision: 'accept', hours: 168 }],
    ['POST', `/api/support-access/${h.pendingId}/decide/`, { decision: 'accept' }],
    ['POST', `/api/Support-Access/${h.accessId}/Revoke`, undefined],
    ['POST', '/api/auth/change-password/', { currentPassword: 'x', newPassword: 'yyyyyyyyyyyy' }],
    ['POST', '/api/auth/2FA/start', { method: 'totp' }],
    ['PUT', '/api/USERS/me', { firstName: 'S', lastName: 'G', email: 'evil@example.com' }],
    ['PUT', '/api/users/me/', { firstName: 'S', lastName: 'G', email: 'evil@example.com' }],
  ]) {
    const res = await call(a, method, path, body);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(res.body.error, 'SUPPORT_FORBIDDEN');
  }
  const states = Object.fromEntries(h.supportAccess.view().accesses.map((x) => [x.id, x.state]));
  assert.equal(states[h.pendingId], 'pending');
  assert.equal(states[h.accessId], 'open');
});

test('rule 15 — the controller refuses the support on its own, even past the guard and with a renamed account', async () => {
  const h = supportSession();
  assert.throws(() => h.supportAccess.decide(h.session.user, h.pendingId, { decision: 'accept' }), (e) => e.status === 403);
  assert.throws(() => h.supportAccess.revoke(h.session.user, h.accessId), (e) => e.status === 403);
  // No guard, and a session user that no longer says it is the support: the session marker still does.
  h.session.user = { ...h.session.user, isSupport: false, email: 'someone@else.fr' };
  const res = await call(app(h, { audit: false }), 'POST', `/api/support-access/${h.pendingId}/decide`, { decision: 'accept' });
  assert.equal(res.status, 403);
  assert.equal(h.supportAccessModel.get(h.pendingId).decision, null);
});

test('rule 18 — a support session writes nothing under /api/users and no credential, with a short French answer', async () => {
  const h = supportSession();
  const a = app(h);
  for (const [method, path, body] of [
    ['POST', '/api/users', { email: 'new@x.fr', firstName: 'N', lastName: 'X', roles: ['admin'] }],
    ['PUT', `/api/users/${h.marie.id}`, { email: 'other@x.fr' }],
    ['POST', `/api/Users/${h.marie.id}/reset-password/`, undefined],
    ['DELETE', `/api/users/${h.marie.id}/two-factor`, undefined],
    ['PUT', '/api/settings', { smtp: { password: 'p' } }],
    ['PUT', '/api/settings/', { smtp: { host: 'smtp.evil.example' } }],
    ['PUT', '/api/plugins/weather-alerts/settings', { apiKey: 'k' }],
  ]) {
    const res = await call(a, method, path, body);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(res.body.message, 'Identifiants et accès réservés au client.');
  }
  assert.equal((await call(a, 'GET', '/api/users')).status, 200, 'reading the users stays possible');
  assert.equal((await call(a, 'PUT', '/api/settings', { company: { name: 'Domaine' } })).status, 200, 'other settings stay writable');
  assert.equal((await call(a, 'PUT', '/api/plugins/weather-alerts/settings', { threshold: '3' })).status, 200, 'a plain plugin setting stays writable');
  assert.equal((await call(a, 'PUT', '/api/reservations/12', { notes: 'x' })).status, 200);

  for (const [method, path] of [
    ['GET', '/google-calendar/oauth/callback'], ['PUT', '/google-calendar/calendar'],
    ['PUT', '/payments/qonto/credentials'], ['POST', '/payments/qonto/connect-provider'],
  ]) assert.equal(isForbidden(method, path, {}), true, `${method} ${path}`);
  assert.equal(isForbidden('PUT', '/neat/settings', { clientSecret: 's' }), true);
  assert.equal(isForbidden('PUT', '/neat/settings', { marginPercent: 12 }), false);
});

test('rules 19-20 — the reads of a support session are logged once per path and minute, a refusal too, worded for the customer', async () => {
  const h = supportSession();
  let t = 0;
  const audit = createSupportAudit({ controller: h.supportAccess, now: () => t });
  const read = (path) => {
    const res = fakeRes();
    audit({ method: 'GET', path, session: h.session }, res, () => {});
    res.finish();
  };
  read('/reservations/12');
  read('/RESERVATIONS/12/');
  read('/auth/me');
  read('/support-access/banner');
  t += 61 * 1000;
  read('/reservations/12');
  read('/reservations');
  const refused = fakeRes();
  audit({ method: 'POST', path: '/users', body: {}, session: h.session }, refused, () => assert.fail('must not pass'));
  assert.equal(refused.statusCode, 403);

  // Rule 19: the raw rows — one per path and minute; the polled paths are not there.
  const raw = h.supportAccessModel.logs(h.accessId).filter((l) => l.method === 'GET').map((l) => l.path.toLowerCase().replace(/\/+$/, ''));
  assert.deepEqual(raw.filter((p) => p.endsWith('/reservations/12')).length, 2);
  assert.ok(!raw.some((p) => /me|banner/i.test(p)), 'what the application polls is not logged');
  // Rule 20 with rule 23: each minute's reads read as one line.
  const labels = h.supportAccess.logs(h.accessId).entries.map((e) => [e.label, e.outcomeLabel]);
  assert.ok(labels.some(([l]) => l === 'Consultation : Réservation 12, Réservations'), JSON.stringify(labels));
  assert.deepEqual(labels.find(([l]) => l === 'Utilisateur créé' || l === 'Modification : Utilisateurs'), ['Modification : Utilisateurs', 'Refusé']);
});

test('rule 20 — the log reads as French sentences, never a method, a path or a status', () => {
  assert.deepEqual(describe({ method: 'PUT', path: '/api/reservations/12', summary: '200' }), { label: 'Réservation 12 modifiée', outcomeLabel: 'Effectué' });
  assert.deepEqual(describe({ method: 'DELETE', path: '/api/clients/7', summary: '204' }), { label: 'Client 7 supprimé', outcomeLabel: 'Effectué' });
  assert.deepEqual(describe({ method: 'POST', path: '/api/reservations', summary: '201' }), { label: 'Réservation créée', outcomeLabel: 'Effectué' });
  assert.deepEqual(describe({ method: 'POST', path: '/api/reservations/12/payment-links', summary: '422' }), { label: 'Réservation 12 modifiée', outcomeLabel: 'Refusé' });
  assert.deepEqual(describe({ method: 'PUT', path: '/api/settings', summary: '403' }), { label: 'Modification : Paramètres', outcomeLabel: 'Refusé' });
  assert.deepEqual(describe({ method: 'POST', path: '/api/somewhere/new', summary: '200' }), { label: 'Modification', outcomeLabel: 'Effectué' });
  assert.deepEqual(describe({ method: 'PAGE', path: '/reservations/22301?tab=sas', summary: '' }), { label: 'Page ouverte : Réservation 22301', outcomeLabel: '' });
  assert.deepEqual(describe({ method: 'PAGE', path: '/plugin-page-inconnue', summary: '' }), { label: 'Page ouverte', outcomeLabel: '' });
  assert.deepEqual(describe({ method: 'LOGIN', path: '/', summary: '' }), { label: 'Connexion du support', outcomeLabel: '' });
  assert.equal(pageName('/'), 'Tableau de bord');
  assert.equal(pageName('/settings/utilisateurs'), 'Paramètres › Utilisateurs');
});

test('rule 18 — second review: Qonto OAuth, the gate secrets, plugin uninstall/turn-off and the whole SMTP group', async () => {
  for (const method of ['GET', 'POST']) {
    for (const path of ['/payments/qonto/authorize', '/Payments/Qonto/Callback/', '/payments/qonto/refresh-connection']) {
      assert.equal(isForbidden(method, path, {}), true, `${method} ${path}`);
    }
  }
  assert.equal(isForbidden('GET', '/settings/gate-connector/secrets', {}), true, 'secrets come back in clear');
  assert.equal(isForbidden('GET', '/SETTINGS/Gate-Connector/Secrets/', {}), true);
  assert.equal(isForbidden('GET', '/settings/gate-connector', {}), false, 'the masked card stays readable');
  assert.equal(isForbidden('DELETE', '/plugins/neat', {}), true);
  assert.equal(isForbidden('POST', '/Plugins/neat/Deactivate/', {}), true);
  assert.equal(isForbidden('POST', '/plugins/neat/activate', {}), false);
  assert.equal(isForbidden('POST', '/plugins/neat/install', {}), false);
  assert.equal(isForbidden('GET', '/plugins/neat', {}), false);
  assert.equal(isForbidden('GET', '/payments/qonto/status', {}), false);

  const h = supportSession();
  const res = await call(app(h), 'PUT', '/api/settings', { smtp: { fromName: 'Domaine', fromEmail: 'x@y.fr' } });
  assert.equal(res.status, 403, 'the sender identity is part of the SMTP group');
});
