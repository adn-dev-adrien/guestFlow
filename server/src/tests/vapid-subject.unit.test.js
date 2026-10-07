// specs/plugins-phase-p-productisation.md rule 18 — the VAPID subject: the environment, then the
// setting, then the company email, then the SMTP sender; with none, push stays off.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSubject } = require('../utils/vapid');

test('rule 18: the order of resolution', () => {
  const settings = { vapidSubject: 'mailto:push@a.fr', companyEmail: 'hello@b.fr', smtpFromEmail: 'mail@c.fr' };
  assert.equal(resolveSubject(settings, { VAPID_SUBJECT: 'mailto:env@x.fr' }), 'mailto:env@x.fr');
  assert.equal(resolveSubject(settings, {}), 'mailto:push@a.fr');
  assert.equal(resolveSubject({ ...settings, vapidSubject: '' }, {}), 'mailto:hello@b.fr');
  assert.equal(resolveSubject({ smtpFromEmail: ' mail@c.fr ' }, {}), 'mailto:mail@c.fr');
});

test('rule 18: no address anywhere — no subject, no fallback to any domain', () => {
  assert.equal(resolveSubject({}, {}), '');
  assert.equal(resolveSubject({ companyEmail: '  ' }, { VAPID_SUBJECT: '' }), '');
});
