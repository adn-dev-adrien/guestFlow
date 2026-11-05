// specs/ui-review-2026-10-19-operations.md rule 44 — a refusal keeps its code in `error` and carries a French `message`
// (audit R23-C7: « SMTP_NOT_CONFIGURED » reached a toast, and no SMTP is the normal state of a new install).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildController } = require('../controllers/usersController');
const { checkPlanningRange } = require('../utils/planningDateRange');

const SRC = path.join(__dirname, '..');
const CODES = ['SMTP_NOT_CONFIGURED', 'PUBLIC_URL_NOT_CONFIGURED', 'LAST_ADMIN', 'SELF_ACTION_FORBIDDEN', 'RESERVATION_NOT_FOUND', 'INVALID_DATE_RANGE', 'INVALID_PAYLOAD'];

function sourcesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourcesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('rule 44: no listed code is answered alone, anywhere in the server or its plugins', () => {
  const alone = new RegExp(`json\\(\\{ error: '(${CODES.join('|')})'(, fields: [^}]*)? \\}\\)`);
  const offenders = [...sourcesUnder(path.join(SRC, 'controllers')), ...sourcesUnder(path.join(SRC, 'plugins'))]
    .filter((file) => alone.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(offenders, []);
});

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

const ADMIN = { id: 1, email: 'a@example.fr', firstName: 'A', lastName: 'B', roles: ['admin'], isActive: true };
const OTHER = { id: 2, email: 'c@example.fr', firstName: 'C', lastName: 'D', roles: ['admin'], isActive: true };

function subject({ smtp = true, publicUrl = 'https://example.fr', adminCount = 1 } = {}) {
  const users = new Map([[1, ADMIN], [2, OTHER]]);
  return buildController({
    usersModel: new Proxy({
      findById: (id) => users.get(Number(id)) || null,
      findActiveAdminCount: () => adminCount,
    }, { get: (target, key) => target[key] || (() => null) }),
    settingsModel: {
      smtpConfigured: () => smtp,
      publicUrl: () => publicUrl,
      decryptedSmtpSettings: () => ({}),
    },
    emailService: { send: async () => ({}) },
    emailTemplates: { welcomeEmailBody: () => ({}), passwordResetEmailBody: () => ({}) },
    passwordGenerator: () => 'x',
    isPluginLive: () => true,
    twoFactor: { reauthenticateForChange() {} },
  });
}

const asAdmin = (over) => ({ user: ADMIN, params: { id: '2' }, body: {}, ...over });

test('rule 44: reset with no SMTP or no public address says so in French, the code stays', () => {
  let res = fakeRes();
  subject({ smtp: false }).resetPassword(asAdmin(), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'SMTP_NOT_CONFIGURED', message: 'Envoi d’e-mails non configuré.' });
  res = fakeRes();
  subject({ publicUrl: '' }).resetPassword(asAdmin(), res);
  assert.deepEqual(res.body, { error: 'PUBLIC_URL_NOT_CONFIGURED', message: 'Adresse publique non configurée.' });
});

test('rule 44: self action and last admin say so in French', () => {
  let res = fakeRes();
  subject().softDelete(asAdmin({ params: { id: '1' } }), res);
  assert.deepEqual(res.body, { error: 'SELF_ACTION_FORBIDDEN', message: 'Action impossible sur son propre compte.' });
  res = fakeRes();
  subject().softDelete(asAdmin(), res);
  assert.deepEqual(res.body, { error: 'LAST_ADMIN', message: 'Au moins un administrateur doit rester actif.' });
});

test('rule 44: the planning range hands its message to whoever answers it', () => {
  assert.deepEqual(checkPlanningRange('x', 'y'), { status: 400, error: 'INVALID_DATE_RANGE', message: 'Période invalide.' });
  assert.deepEqual(checkPlanningRange('2030-01-02', '2030-01-01'), { status: 400, error: 'INVALID_DATE_RANGE', message: 'Période invalide.' });
  assert.equal(checkPlanningRange('2020-01-01', '2030-01-01').message, 'Période trop longue.');
});
