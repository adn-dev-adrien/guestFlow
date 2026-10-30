// specs/hosting-h2-account-security.md rule 18 (amended 2026-10-28, audit finding M3) — a support
// session cannot CHANGE the keypad code, the booking-notification recipient or the bank details printed
// on a devis. The settings page sends its whole group, so a value left as it is does not count.

const test = require('node:test');
const assert = require('node:assert/strict');
const { forbiddenReason } = require('../utils/supportSessionPolicy');
const { listenLocal } = require('./listenLocal');

const stored = { portalCode: '4821', companyIban: 'FR7612345678901234567890123', companyBic: 'BNPAFRPP', notificationRecipientEmail: 'resa@domaine-ombre.fr' };
const deps = { isSecretSetting: () => false, isSecretRoute: () => false, currentSettings: () => stored };
const put = (body) => forbiddenReason('PUT', '/settings', body, deps);

test('rule 18 — the keypad code cannot be changed by a support session', () => {
  assert.equal(put({ company: { portalCode: 'AUDIT-0000' } }), 'credentials');
  assert.equal(put({ company: { portalCode: '' } }), 'credentials', 'clearing it is a change');
});

test('rule 18 — the notification recipient cannot be redirected', () => {
  assert.equal(put({ notifications: { recipientEmail: 'audit@example.invalid' } }), 'credentials');
});

test('rule 18 — the IBAN and BIC printed on the devis cannot be changed', () => {
  assert.equal(put({ company: { iban: 'FR7699999999999999999999999' } }), 'credentials');
  assert.equal(put({ company: { bic: 'AUDITFRPP' } }), 'credentials');
});

test('rule 18 — a save that sends those fields unchanged is not refused', () => {
  assert.equal(put({ company: { name: 'Domaine', portalCode: ' 4821 ', iban: 'FR76 1234 5678 9012 3456 7890 123', bic: 'bnpafrpp' }, notifications: { recipientEmail: 'resa@domaine-ombre.fr', enabled: true } }), null);
});

test('rule 18 — other company and notification fields stay writable', () => {
  assert.equal(put({ company: { name: 'Domaine', phone: '0102030405' }, notifications: { enabled: false } }), null);
});

const bare = { ...stored, notificationRecipientEmail: '', smtpFromEmail: '', companyEmail: 'contact@domaine-ombre.fr' };
const putBare = (body, path = '/settings') => forbiddenReason('PUT', path, body, { ...deps, currentSettings: () => bare });

test('rule 18 — with no typed recipient, the company email IS the recipient: changing it is refused', () => {
  assert.equal(putBare({ company: { email: 'audit@example.invalid' } }), 'credentials');
  assert.equal(putBare({ email: 'audit@example.invalid', name: 'Domaine' }, '/onboarding/company'), 'credentials');
  assert.equal(putBare({ notifications: { recipientEmail: 'audit@example.invalid' } }), 'credentials');
});

test('rule 18 — the company email sent back as it is, or an empty recipient left empty, passes', () => {
  assert.equal(putBare({ company: { email: ' Contact@Domaine-Ombre.fr ', name: 'Domaine' }, notifications: { recipientEmail: '' } }), null);
  assert.equal(putBare({ email: 'contact@domaine-ombre.fr', name: 'Domaine' }, '/onboarding/company'), null);
});

test('rule 18 — a read of the settings is untouched', () => {
  assert.equal(forbiddenReason('GET', '/settings', {}, deps), null);
});

test('rule 18 — the refusal is answered 403, never reaches the handler, and is logged like the others', async (t) => {
  const http = require('http');
  const express = require('express');
  const { createSupportAudit } = require('../middleware/supportAudit');
  const log = [];
  const reached = [];
  const controller = { sessionAccess: () => ({ id: 1 }), record: (id, entry) => log.push(entry) };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { supportAccessId: 1, user: { isSupport: true } }; next(); });
  app.use('/api', createSupportAudit({ controller, isSecretSetting: () => false, currentSettings: () => stored }));
  app.put('/api/settings', (req, res) => { reached.push(req.body); res.json({ ok: true }); });
  const server = await listenLocal(app);
  t.after(() => server.close());
  const send = (body) => new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', signal: AbortSignal.timeout(10_000), port: server.address().port, method: 'PUT', path: '/api/settings', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end(payload);
  });
  assert.equal(await send({ company: { portalCode: 'AUDIT-0000' } }), 403);
  assert.equal(await send({ notifications: { recipientEmail: 'audit@example.invalid' } }), 403);
  assert.equal(await send({ company: { portalCode: '4821', name: 'Domaine' } }), 200);
  assert.equal(reached.length, 1, 'only the unchanged save reached the handler');
  assert.deepEqual(log.filter((e) => e.summary === '403').map((e) => e.path), ['/api/settings', '/api/settings']);
});
