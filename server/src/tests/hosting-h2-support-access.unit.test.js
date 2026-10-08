// specs/hosting-h2-account-security.md rules 12-17 — support access with consent: the console's
// signed request becomes the banner, accepting opens a 1 h / 24 h / 7 days access, the signed link
// (2 minutes, single use, refused without an open access) opens a session as « Support GuestFlow »,
// its writes and pages are logged, expiry ends the session, and nothing exists without a licence key.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { setup, fakeRes, fakeSession, keyPair } = require('./accountSecurityFixture');
const supportTokens = require('../utils/supportAccess');
const { createSupportAudit, isForbidden } = require('../middleware/supportAudit');
const authController = require('../controllers/authController');

function withRequest({ reason = 'Vérifier la synchronisation Booking', requestId = 'req-1', slug = 'domaine-ombre', keys = keyPair() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-support-'));
  const write = (r) => fs.writeFileSync(path.join(dir, supportTokens.REQUEST_FILE), supportTokens.signRequest({ slug, requestedAt: '2026-10-08T09:00:00.000Z', ...r }, keys.privateKey));
  write({ reason, requestId });
  const readRequest = () => supportTokens.readRequest({ dataDir: dir, publicKey: keys.publicKey, slug: 'domaine-ombre' });
  const h = setup({ publicKey: keys.publicKey, readRequest });
  const marie = h.addUser('marie@domaine-ombre.fr', { firstName: 'Marie' });
  return { ...h, keys, dir, write, marie };
}

const link = (h, accessId, { jti = crypto.randomUUID(), slug = 'domaine-ombre', at = h.now() } = {}) => supportTokens.signLink({ slug, accessId, jti, now: at }, h.keys.privateKey);

function openAccess(h, hours) {
  const { pending } = h.supportAccess.banner(h.marie);
  h.supportAccess.decide(h.marie, pending.id, { decision: 'accept', hours });
  return pending.id;
}

test('rule 12 — the console\'s request shows every administrator a banner with its reason', () => {
  const h = withRequest();
  const banner = h.supportAccess.banner(h.marie);
  assert.equal(banner.pending.reason, 'Vérifier la synchronisation Booking');
  assert.equal(banner.defaultHours, 24);
  assert.deepEqual(banner.durations.map((d) => d.label), ['1 h', '24 h', '7 jours']);
  const anne = h.addUser('anne@domaine-ombre.fr', { roles: ['accountant'] });
  assert.equal(h.supportAccess.banner(anne).pending, null, 'administrators only');
});

test('rule 12 — a forged or foreign request file is ignored', () => {
  const h = withRequest({ keys: keyPair() });
  const other = keyPair();
  fs.writeFileSync(path.join(h.dir, supportTokens.REQUEST_FILE), supportTokens.signRequest({ slug: 'domaine-ombre', requestId: 'x', reason: 'forged', requestedAt: '' }, other.privateKey));
  const forged = setup({ publicKey: h.keys.publicKey, readRequest: () => supportTokens.readRequest({ dataDir: h.dir, publicKey: h.keys.publicKey, slug: 'domaine-ombre' }) });
  const admin = forged.addUser('a@x.fr');
  assert.equal(forged.supportAccess.banner(admin).pending, null);
  h.write({ requestId: 'y', reason: 'other instance', slug: 'someone-else' });
  assert.equal(supportTokens.readRequest({ dataDir: h.dir, publicKey: h.keys.publicKey, slug: 'domaine-ombre' }), null);
});

test('edge case — two requests in a row leave one pending request with the new reason', () => {
  const h = withRequest();
  h.supportAccess.banner(h.marie);
  h.write({ requestId: 'req-2', reason: 'Nouveau motif' });
  const { pending } = h.supportAccess.banner(h.marie);
  assert.equal(pending.reason, 'Nouveau motif');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM support_access').get().n, 1);
});

test('rule 13 — accepting opens 24 h by default, 1 h or 7 days on request; a refused request stays refused', () => {
  const h = withRequest();
  const id = openAccess(h);
  const [row] = h.supportAccess.view().accesses;
  assert.equal(row.state, 'open');
  assert.equal(h.supportAccessModel.get(id).expiresAt, new Date(h.now().getTime() + 24 * 3600000).toISOString());
  assert.equal(h.supportAccess.banner(h.marie).pending, null, 'the file of a decided request does not come back');
  assert.throws(() => h.supportAccess.decide(h.marie, id, { decision: 'accept', hours: 1 }), (e) => e.body.error === 'ALREADY_DECIDED');

  const week = withRequest();
  const weekId = openAccess(week, 168);
  assert.equal(week.supportAccessModel.get(weekId).expiresAt, new Date(week.now().getTime() + 168 * 3600000).toISOString());
  const odd = withRequest();
  const { pending } = odd.supportAccess.banner(odd.marie);
  assert.throws(() => odd.supportAccess.decide(odd.marie, pending.id, { decision: 'accept', hours: 48 }), (e) => e.body.error === 'INVALID_DURATION');
  odd.supportAccess.decide(odd.marie, pending.id, { decision: 'refuse' });
  assert.equal(odd.supportAccess.view().accesses[0].state, 'refused');
});

test('rule 13 — the administrator can revoke an open access at any time', () => {
  const h = withRequest();
  const id = openAccess(h);
  const view = h.supportAccess.revoke(h.marie, id);
  assert.equal(view.accesses[0].state, 'revoked');
  assert.match(view.accesses[0].revokedLabel, /^Révoqué par Marie le /);
  assert.throws(() => h.supportAccess.consumeLink(link(h, id)), (e) => e.body.error === 'INVALID_LINK');
});

test('rule 14 — the signed link opens a session as « Support GuestFlow »: signature, 2 minutes, single use', () => {
  const h = withRequest();
  const id = openAccess(h);
  const token = link(h, id);
  const opened = h.supportAccess.consumeLink(token);
  assert.equal(opened.user.email, 'support@guestflow.invalid');
  assert.equal(opened.user.isSupport, true);
  assert.deepEqual(opened.user.roles, ['admin']);
  assert.throws(() => h.supportAccess.consumeLink(token), (e) => e.body.error === 'INVALID_LINK', 'single use');

  const late = link(h, id, { at: new Date(h.now().getTime() - 2 * 60000 - 1) });
  assert.throws(() => h.supportAccess.consumeLink(late), (e) => e.body.error === 'INVALID_LINK', '2 minutes');

  const forged = supportTokens.signLink({ slug: 'domaine-ombre', accessId: id, jti: 'z', now: h.now() }, keyPair().privateKey);
  assert.throws(() => h.supportAccess.consumeLink(forged), (e) => e.body.error === 'INVALID_LINK', 'signature');

  assert.throws(() => h.supportAccess.consumeLink(link(h, id, { slug: 'another' })), (e) => e.body.error === 'INVALID_LINK', 'another instance');
});

test('rule 14 — no open access means the link is refused', () => {
  const h = withRequest();
  const { pending } = h.supportAccess.banner(h.marie);
  assert.throws(() => h.supportAccess.consumeLink(link(h, pending.id)), (e) => e.body.error === 'INVALID_LINK');
  const id = openAccess(h);
  h.now.advance(24 * 3600000 + 1);
  assert.throws(() => h.supportAccess.consumeLink(link(h, id)), (e) => e.body.error === 'INVALID_LINK');
});

test('rule 14 — the support account cannot log in with a password nor be listed', () => {
  const h = withRequest();
  const row = h.db.prepare("SELECT * FROM users WHERE email = 'support@guestflow.invalid'").get();
  assert.equal(row.isActive, 0);
  assert.equal(h.users.verifyCredentials('support@guestflow.invalid', 'anything'), null);
  assert.ok(!h.users.list().some((u) => u.isSupport));
});

test('rule 14 — GET /api/auth/support redirects into the app with the support session', () => {
  const h = withRequest();
  const id = openAccess(h);
  const c = authController.create(h.users, { supportAccess: h.supportAccess });
  const res = fakeRes();
  const session = fakeSession();
  c.supportLogin({ query: { token: link(h, id) }, session }, res, (e) => { throw e; });
  assert.equal(res.redirectedTo, '/');
  assert.equal(session.user.isSupport, true);
  assert.equal(session.supportAccessId, id);
  const bad = fakeRes();
  c.supportLogin({ query: { token: 'nope' }, session: fakeSession() }, bad, (e) => { throw e; });
  assert.equal(bad.redirectedTo, '/login?reason=support-link');
});

test('rules 15-16 — writes and pages are written to support_access_log; me carries the red bar\'s expiry', () => {
  const h = withRequest();
  const id = openAccess(h);
  const opened = h.supportAccess.consumeLink(link(h, id));
  const session = fakeSession({ user: opened.user, supportAccessId: id, supportExpiresAt: opened.expiresAt });
  const audit = createSupportAudit({ controller: h.supportAccess });

  const res = fakeRes();
  let passed = false;
  audit({ method: 'PUT', path: '/reservations/22301', session }, res, () => { passed = true; });
  assert.ok(passed);
  res.statusCode = 200;
  res.finish();
  audit({ method: 'GET', path: '/reservations/22301', session }, fakeRes(), () => {});
  h.supportAccess.record(id, { method: 'PAGE', path: '/planning', summary: '' });

  const { entries } = h.supportAccess.logs(id);
  assert.deepEqual(entries.map((e) => e.label).sort(), ['Connexion du support', 'PUT /api/reservations/22301', 'Page ouverte : /planning'].sort());
  assert.equal(entries.find((e) => e.label.startsWith('PUT')).summary, '200');

  const c = authController.create(h.users, { supportAccess: h.supportAccess });
  const me = fakeRes();
  c.me({ session }, me);
  assert.deepEqual(me.body.supportSession, { expiresAt: opened.expiresAt });
});

test('rule 15 — the support cannot decide its own access nor touch the account it borrows', () => {
  assert.equal(isForbidden('POST', '/support-access/3/decide'), true);
  assert.equal(isForbidden('POST', '/support-access/3/revoke'), true);
  assert.equal(isForbidden('POST', '/auth/change-password'), true);
  assert.equal(isForbidden('POST', '/auth/2fa/start'), true);
  assert.equal(isForbidden('PUT', '/users/me'), true);
  assert.equal(isForbidden('POST', '/support-access/page'), false);
  assert.equal(isForbidden('GET', '/support-access/3/log'), false);
  assert.equal(isForbidden('PUT', '/reservations/3'), false);
});

test('edge case — an access that expires ends the support session at the next request (401)', () => {
  const h = withRequest();
  const id = openAccess(h, 1);
  const opened = h.supportAccess.consumeLink(link(h, id));
  const session = fakeSession({ user: opened.user, supportAccessId: id });
  const audit = createSupportAudit({ controller: h.supportAccess });
  h.now.advance(3600000 + 1);
  const res = fakeRes();
  audit({ method: 'GET', path: '/dashboard', session }, res, () => assert.fail('must not pass'));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'SUPPORT_ACCESS_ENDED');
  assert.equal(session.destroyed, true);
});

test('rule 17 — without a licence key, support access does not exist', () => {
  const h = setup({ publicKey: null });
  const marie = h.addUser('marie@domaine-ombre.fr');
  assert.equal(h.supportAccess.enabled(), false);
  assert.equal(h.supportAccess.banner(marie).pending, null);
  assert.throws(() => h.supportAccess.view(), (e) => e.status === 404);
  assert.throws(() => h.supportAccess.consumeLink('x'), (e) => e.status === 404);
  const c = authController.create(h.users, { supportAccess: h.supportAccess });
  const me = fakeRes();
  c.me({ session: { user: marie } }, me);
  assert.equal(me.body.supportAccessEnabled, false);
});
