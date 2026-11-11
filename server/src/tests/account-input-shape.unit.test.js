// specs/hosting-h2-account-security.md rule 68 (audit R22-A2, R22-A3, N4) — the account routes behind a session or a
// right password: a password or a code that is not a string is a wrong one, counted as such; identity fields are text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, fakeRes, fakeSession, withSupportRequest } = require('./accountSecurityFixture');
const authController = require('../controllers/authController');
const { createReauthGuard, MAX_FAILURES } = require('../utils/reauthGuard');
const totp = require('../utils/totp');
const { todayIso } = require('../utils/localDate');
const { buildController: buildPlanning } = require('../controllers/planningController');
const { createSupportAudit } = require('../middleware/supportAudit');
const { startApp } = require('./inputShapeApp');

const T = JSON.parse('{"toString":1}');
const PASSWORD = 'correct horse battery';
const NOT_STRINGS = [T, {}, [], ['a'], true, 1];

test('rule 68 — the guard reads a password that is not a string as wrong, and counts it', () => {
  for (const value of NOT_STRINGS) {
    const seen = [];
    const guard = createReauthGuard({ users: { verifyCredentials: (e, typed) => { seen.push(typed); return typed === 'right' ? { id: 1 } : null; } } });
    const user = { id: 1, email: 'a@b.fr' };
    for (let i = 1; i < MAX_FAILURES; i += 1) assert.equal(guard.check(user, value), null);
    assert.throws(() => guard.check(user, value), (e) => e.status === 429 && e.body.error === 'REAUTH_LOCKED', JSON.stringify(value));
    assert.ok(seen.every((typed) => typed === ''), 'the model never sees it');
  }
});

test('rule 49 stays — an empty password is not a guess', () => {
  const guard = createReauthGuard({ users: { verifyCredentials: () => null } });
  const user = { id: 1, email: 'a@b.fr' };
  for (const value of [undefined, null, '']) for (let i = 0; i < MAX_FAILURES + 2; i += 1) assert.equal(guard.check(user, value), null);
});

test('rule 68 — the code helpers never throw', () => {
  for (const value of NOT_STRINGS) {
    assert.equal(totp.normalizeCode(value), '');
    assert.equal(totp.matchTotpStep(totp.generateSecret(), value, new Date()), null);
    assert.equal(totp.verifyTotp(totp.generateSecret(), value, new Date()), false);
    assert.equal(totp.findBackupCode(value, []), null);
  }
});

function enableTotp(h, userId) {
  h.db.prepare("INSERT OR REPLACE INTO user_two_factor (userId, method, secretEncrypted, enabledAt) VALUES (?, 'totp', 'x', ?)").run(userId, h.now().toISOString());
}

function changePassword(h, body, sessionUser) {
  const c = authController.create(h.users, { passwordReset: h.passwordReset, passwordGuard: h.passwordGuard });
  const res = fakeRes();
  c.changePassword({ body, session: fakeSession({ user: sessionUser }), sessionID: 's' }, res, (err) => { throw err; });
  return res;
}

test('R22-A2 — change-password: a new password that is not a string is MISSING_FIELDS, the old one stays', () => {
  const h = setup();
  const user = h.addUser('marie@domaine-ombre.fr');
  for (const value of [{ a: 1 }, ['abcdefghijkl'], 123456789012, T, true]) {
    const res = changePassword(h, { currentPassword: PASSWORD, newPassword: value }, user);
    assert.equal(res.statusCode, 400, JSON.stringify(value));
    assert.equal(res.body.error, 'MISSING_FIELDS');
  }
  assert.ok(h.users.verifyCredentials('marie@domaine-ombre.fr', PASSWORD));
  assert.equal(h.users.verifyCredentials('marie@domaine-ombre.fr', '[object Object]'), null);
});

test('R22-A2 — change-password: a current password that is not a string is a wrong one, never equal to the new one', () => {
  const h = setup();
  const user = h.addUser('marie@domaine-ombre.fr');
  for (const value of [[PASSWORD], T, { a: 1 }, 123456789012]) {
    const res = changePassword(h, { currentPassword: value, newPassword: 'a brand new password' }, user);
    assert.equal(res.statusCode, 401, JSON.stringify(value));
    assert.equal(res.body.error, 'INVALID_CREDENTIALS');
  }
  assert.ok(h.users.verifyCredentials('marie@domaine-ombre.fr', PASSWORD));
});

test('rule 68 — the second step: a code that is not a string is a wrong code and counts toward the lock', async () => {
  const h = setup();
  const user = h.addUser('marie@domaine-ombre.fr');
  enableTotp(h, user.id);
  for (let left = 4; left > 0; left -= 1) {
    assert.throws(() => h.twoFactor.verifyLogin(user.id, { code: T }), (e) => e.status === 401 && e.body.error === 'BAD_CODE');
  }
  assert.throws(() => h.twoFactor.verifyLogin(user.id, { code: ['123456'] }), (e) => e.status === 429 && e.body.error === 'LOCKED');
});

test('rule 68 — re-authentication: a code that is not a string is BAD_CODE, not CODE_REQUIRED, and an absent one still is CODE_REQUIRED', () => {
  const h = setup();
  const user = h.addUser('marie@domaine-ombre.fr');
  enableTotp(h, user.id);
  assert.throws(() => h.twoFactor.reauthenticateForChange(user, { password: PASSWORD }), (e) => e.body.error === 'CODE_REQUIRED');
  assert.throws(() => h.twoFactor.reauthenticateForChange(user, { password: PASSWORD, code: T }), (e) => e.body.error === 'BAD_CODE');
  assert.throws(() => h.twoFactor.reauthenticateForChange(user, { password: T, code: '123456' }), (e) => e.body.error === 'BAD_PASSWORD');
});

test('rule 68 — planning cards: a tick is true / false / 1 / 0, ids and date judged by type first', () => {
  const calls = [];
  const c = buildPlanning({
    planningOptionCardsModel: { setOccurrenceDone: (args) => { calls.push(args); return { ok: true }; } },
    breakfastModel: { setFallbackDone: () => ({ ok: true }) },
  });
  const post = (body) => {
    const res = fakeRes();
    c.setOptionCardDone({ body }, res);
    return res;
  };
  const today = todayIso();
  const good = { reservationId: 1, optionId: 2, date: today, time: '08:00' };
  for (const done of ['false', 'abc', T, {}, [], 2]) {
    const res = post({ ...good, done });
    assert.equal(res.statusCode, 400, JSON.stringify(done));
    assert.equal(res.body.error, 'INVALID_PAYLOAD');
  }
  for (const bad of [{ reservationId: [1] }, { reservationId: T }, { optionId: true }, { date: T }, { date: [today] }, { time: T }, { time: 8 }]) {
    assert.equal(post({ ...good, done: true, ...bad }).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
  assert.equal(post({ ...good, done: 1 }).statusCode, 200);
  assert.equal(post({ ...good, done: 0 }).statusCode, 200);
  assert.equal(post({ ...good, done: false, reservationId: '1' }).statusCode, 200);
  assert.equal(post({ ...good }).statusCode, 200);
  assert.deepEqual(calls.map((a) => a.done), [true, false, false, false]);
});

test('R22-A3 — a support write that throws in the policy is refused and journaled', () => {
  const recorded = [];
  const audit = createSupportAudit({
    controller: { sessionAccess: () => ({ id: 7 }), record: (id, entry) => recorded.push(entry) },
  });
  for (const [path, body] of [
    ['/settings', { company: { iban: T } }],
    ['/settings', { company: { email: T } }],
    ['/settings', { notifications: { recipientEmail: T } }],
    ['/onboarding/company', { email: T }],
  ]) {
    recorded.length = 0;
    const res = fakeRes();
    let reached = false;
    audit({ method: 'PUT', path, body, session: { supportAccessId: 7, user: { isSupport: true } }, user: { isSupport: true } }, res, () => { reached = true; });
    assert.equal(reached, false, path);
    assert.equal(res.statusCode, 403, JSON.stringify(body));
    assert.equal(res.body.error, 'SUPPORT_FORBIDDEN');
    assert.deepEqual(recorded.map((e) => e.summary), ['403']);
  }
});

test('over the application: identity fields', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const admin = await app.login('admin@shape.test');
  const me = { firstName: 'Marie', lastName: 'Martin' };

  await t.test('R22-A2 — PUT /users/me refuses each wrong type with its code, nothing stored', async () => {
    for (const [body, code] of [
      [{ ...me, firstName: true }, 'FIRSTNAME_REQUIRED'], [{ ...me, firstName: T }, 'FIRSTNAME_REQUIRED'],
      [{ ...me, lastName: { a: 1 } }, 'LASTNAME_REQUIRED'], [{ ...me, lastName: 1.5 }, 'LASTNAME_REQUIRED'],
      [{ ...me, email: ['new@example.invalid'], currentPassword: app.password }, 'INVALID_EMAIL'], [{ ...me, email: T }, 'INVALID_EMAIL'],
      [{ ...me, companyName: ['x'] }, 'INVALID_FIELD'], [{ ...me, notes: 123 }, 'INVALID_FIELD'], [{ ...me, notes: T }, 'INVALID_FIELD'],
    ]) {
      const res = await app.call(admin, 'PUT', '/api/users/me', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error, code);
    }
    const [row] = app.readDb("SELECT firstName, lastName, email, companyName, notes FROM users WHERE email = 'admin@shape.test'");
    assert.equal(row.firstName, 'Marie');
    assert.equal(row.lastName, 'Martin');
    assert.ok(!row.companyName);
    assert.ok(!row.notes);
  });

  await t.test('rule 68 — the client\'s own shape still saves: strings, and null or absent for company and notes', async () => {
    for (const body of [{ ...me, companyName: 'Solio', notes: 'Bureau' }, { ...me, companyName: '', notes: '' }, { ...me, companyName: null, notes: null }, me]) {
      assert.equal((await app.call(admin, 'PUT', '/api/users/me', body)).status, 200, JSON.stringify(body));
    }
  });

  await t.test('N4 — PUT /users/:id holds the names when present, leaves them when absent', async () => {
    const [{ id }] = app.readDb("SELECT id FROM users WHERE email = 'reception@shape.test'");
    for (const [body, code] of [
      [{ firstName: null }, 'FIRSTNAME_REQUIRED'], [{ firstName: '' }, 'FIRSTNAME_REQUIRED'], [{ firstName: T }, 'FIRSTNAME_REQUIRED'], [{ firstName: true }, 'FIRSTNAME_REQUIRED'],
      [{ lastName: null }, 'LASTNAME_REQUIRED'], [{ lastName: {} }, 'LASTNAME_REQUIRED'],
      [{ companyName: {} }, 'INVALID_FIELD'], [{ notes: 1.5 }, 'INVALID_FIELD'], [{ roles: [T] }, 'UNKNOWN_ROLE'], [{ roles: [1] }, 'UNKNOWN_ROLE'],
    ]) {
      const res = await app.call(admin, 'PUT', `/api/users/${id}`, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error, code);
    }
    const [row] = app.readDb('SELECT firstName, lastName FROM users WHERE id = ?', id);
    assert.deepEqual(row, { firstName: 'Marie', lastName: 'Martin' });
    assert.equal((await app.call(admin, 'PUT', `/api/users/${id}`, { notes: 'Accueil' })).status, 200);
    const [after] = app.readDb('SELECT firstName, notes FROM users WHERE id = ?', id);
    assert.deepEqual(after, { firstName: 'Marie', notes: 'Accueil' });
  });

  await t.test('N4 — POST /users refuses each wrong type', async () => {
    const good = { firstName: 'A', lastName: 'B', email: 'a@shape.test', roles: ['admin'] };
    for (const [patch, code] of [
      [{ firstName: T }, 'FIRSTNAME_REQUIRED'], [{ lastName: 1 }, 'LASTNAME_REQUIRED'], [{ email: T }, 'INVALID_EMAIL'], [{ email: ['a@shape.test'] }, 'INVALID_EMAIL'],
      [{ companyName: {} }, 'INVALID_FIELD'], [{ notes: [] }, 'INVALID_FIELD'], [{ roles: [T] }, 'UNKNOWN_ROLE'],
    ]) {
      const res = await app.call(admin, 'POST', '/api/users', { ...good, ...patch });
      assert.equal(res.status, 400, JSON.stringify(patch));
      assert.equal(res.json.error, code);
    }
  });

  await t.test('N4 — onboarding and the site origin answer their own refusal', async () => {
    const company = await app.call(admin, 'PUT', '/api/onboarding/company', { name: T, email: T, phone: T, address: {}, siret: [] });
    assert.equal(company.status, 422);
    assert.ok(company.json.errors.name && company.json.errors.email && company.json.errors.phone && company.json.errors.address && company.json.errors.siret);
    const property = await app.call(admin, 'PUT', '/api/onboarding/property', { name: T, maxGuests: T, doubleBeds: T, singleBeds: {}, pricePerNight: T, checkIn: T, checkOut: true });
    assert.equal(property.status, 422);
    assert.ok(property.json.errors.name && property.json.errors.maxGuests);
    for (const publicSiteOrigin of [T, ['https://a.test'], 1, true]) {
      assert.equal((await app.call(admin, 'PUT', '/api/terms/public-site-origin', { publicSiteOrigin })).status, 400, JSON.stringify(publicSiteOrigin));
    }
  });
});

test('rule 68 — a support access length that is no number is INVALID_DURATION, not a throw from Number()', () => {
  const h = withSupportRequest();
  const { pending } = h.supportAccess.banner(h.marie);
  for (const hours of [T, [], {}, true]) {
    assert.throws(() => h.supportAccess.decide(h.marie, pending.id, { decision: 'accept', hours }), (e) => e.body && e.body.error === 'INVALID_DURATION', JSON.stringify(hours));
  }
  assert.equal(h.supportAccess.banner(h.marie).pending.id, pending.id, 'the request still waits');
});
