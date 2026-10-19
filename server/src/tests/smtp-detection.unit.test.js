// specs/settings-rationalization.md rule 28 (UI/UX review 2026-10-18, decision 14) — the sending
// server is deduced from the sending address: by its own domain, else by the domain's MX records,
// looked up from the server through an injected resolver (never the network in this suite). A host
// already saved always wins; a provider not found leaves the host to be typed; nothing is deduced
// without a password, so a hosted instance keeps sending through the platform
// (specs/hosting-h1-fleet-runtime.md rules 18–19).

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSmtpDetector, detectionMessage, domainOf } = require('../utils/smtpPresets');

const mx = (...exchanges) => async () => exchanges.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }));

test('rule 28: a public mailbox is recognised by its own domain, without any DNS call', async () => {
  let calls = 0;
  const detector = createSmtpDetector({ resolveMx: async () => { calls += 1; return []; } });
  const found = await detector.detect('Domaine.Solio@gmail.com');
  assert.equal(found.status, 'found');
  assert.deepEqual(found.provider, {
    id: 'google', name: 'Gmail', host: 'smtp.gmail.com', secure: true, port: 465, hint: 'Un mot de passe d’application Google (16 lettres).',
  });
  assert.equal((await detector.detect('a@orange.fr')).provider.host, 'smtp.orange.fr');
  assert.equal(calls, 0);
});

test('rule 28: a company domain is recognised by its MX, the most preferred record first', async () => {
  const detector = createSmtpDetector({ resolveMx: async () => [
    { exchange: 'mx2.mail.ovh.net', priority: 20 },
    { exchange: 'ASPMX.L.GOOGLE.COM.', priority: 1 },
  ] });
  const found = await detector.detect('contact@domainesolio.com');
  assert.equal(found.provider.id, 'google');
  assert.equal(found.domain, 'domainesolio.com');
  const ovh = await createSmtpDetector({ resolveMx: mx('mx1.mail.ovh.net') }).detect('a@gite.fr');
  assert.deepEqual([ovh.provider.host, ovh.provider.port], ['ssl0.ovh.net', 465]);
  const ms = await createSmtpDetector({ resolveMx: mx('gite-fr.mail.protection.outlook.com') }).detect('a@gite.fr');
  assert.deepEqual([ms.provider.host, ms.provider.secure, ms.provider.port], ['smtp.office365.com', false, 587]);
});

test('rule 28: a lookalike host does not count (suffix match on a label boundary)', async () => {
  const found = await createSmtpDetector({ resolveMx: mx('mail.notgoogle.com') }).detect('a@gite.fr');
  assert.equal(found.status, 'unknown');
});

test('rule 28: unknown provider, failed lookup, timeout and bad address each say what to do', async () => {
  const unknown = await createSmtpDetector({ resolveMx: mx('mx.example.net') }).detect('a@gite.fr');
  assert.deepEqual(unknown, { status: 'unknown', domain: 'gite.fr' });
  assert.equal(detectionMessage(unknown), 'Fournisseur non reconnu pour gite.fr : saisir le serveur.');
  const failed = await createSmtpDetector({ resolveMx: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } }).detect('a@gite.fr');
  assert.equal(failed.status, 'dns-failed');
  assert.equal(detectionMessage(failed), 'Domaine gite.fr injoignable : saisir le serveur.');
  const slow = await createSmtpDetector({ resolveMx: () => new Promise(() => {}), timeoutMs: 20 }).detect('a@gite.fr');
  assert.equal(slow.status, 'dns-failed');
  assert.equal((await createSmtpDetector().detect('pas une adresse')).status, 'invalid');
  assert.equal(domainOf('x@Sub.Example.FR'), 'sub.example.fr');
  assert.equal(detectionMessage({ status: 'found', provider: { name: 'Gmail', host: 'smtp.gmail.com' } }), 'Serveur trouvé : Gmail (smtp.gmail.com).');
});

test('rule 28: an answer is remembered for an hour, a failure is not', async () => {
  let calls = 0;
  let clock = 0;
  let fail = true;
  const detector = createSmtpDetector({
    now: () => clock,
    resolveMx: async () => { calls += 1; if (fail) throw new Error('down'); return [{ exchange: 'mx.zoho.eu', priority: 10 }]; },
  });
  await detector.detect('a@gite.fr');
  fail = false;
  assert.equal((await detector.detect('a@gite.fr')).provider.id, 'zoho');
  await detector.detect('b@gite.fr');
  assert.equal(calls, 2);
  clock = 61 * 60 * 1000;
  await detector.detect('a@gite.fr');
  assert.equal(calls, 3);
});

// ── The controller: what the operator types is an address and a password ─────────────────────

let stored = {};
let upserted = null;
require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    upsert(payload) { upserted = payload; stored = { ...stored, ...payload }; },
    read() { return { ...stored, smtpPasswordSet: Boolean(stored.smtpPasswordEncrypted) }; },
    updateLogoPath() {},
    smtpConfigured() { return false; },
    decryptedSmtpSettings() { return {}; },
    publicUrl() { return ''; },
  },
};
require.cache[require.resolve('../utils/settingsResponse')] = { exports: { shapeResponse: (row) => row } };
require.cache[require.resolve('../utils/vapid')] = { exports: { ensureVapid() {} } };

const controller = require('../controllers/settingsController');

const lookups = [];
controller.__test.setSmtpDetector(createSmtpDetector({
  resolveMx: async (domain) => { lookups.push(domain); return [{ exchange: 'mx1.mail.ovh.net', priority: 1 }]; },
}));

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

async function save(body, before = {}) {
  stored = { ...before };
  upserted = null;
  const r = res();
  await controller.updateSettings({ body }, r);
  return { r, upserted };
}

test('rule 28: address + password → the server fills the host and security of the provider', async () => {
  const { upserted: pl } = await save({ smtp: { password: 'secret' } }, { companyEmail: 'contact@gite.fr' });
  assert.equal(pl.smtpHost, 'ssl0.ovh.net');
  assert.equal(pl.smtpSecure, 1);
  assert.equal(pl.smtpPasswordEncrypted, 'secret');
});

test('rule 28: a host already saved or typed always wins', async () => {
  const kept = await save({ smtp: { password: 'secret' } }, { companyEmail: 'a@gmail.com', smtpHost: 'mail.perso.fr' });
  assert.equal(kept.upserted.smtpHost, undefined);
  const typed = await save({ smtp: { host: 'smtp.autre.fr', password: 'secret' } }, { companyEmail: 'a@gmail.com' });
  assert.equal(typed.upserted.smtpHost, 'smtp.autre.fr');
});

test('rule 28: no password, nothing deduced — the platform keeps sending', async () => {
  const before = lookups.length;
  const { upserted: pl } = await save({ smtp: { fromName: 'Domaine' } }, { companyEmail: 'contact@gite.fr' });
  assert.equal(pl.smtpHost, undefined);
  assert.equal(lookups.length, before);
});

test('rule 28: a saved password and a new address → the server looks the new domain up', async () => {
  const { upserted: pl } = await save({ smtp: { fromEmail: 'resa@chalet.fr' } }, { companyEmail: 'a@gite.fr', smtpPasswordEncrypted: 'blob' });
  assert.equal(pl.smtpHost, 'ssl0.ovh.net');
  assert.ok(lookups.includes('chalet.fr'));
});

test('rule 28: POST /smtp-detect proposes without writing, for the typed or the saved address', async () => {
  stored = { companyEmail: 'contact@gite.fr' };
  upserted = null;
  const typed = res();
  await controller.detectSmtp({ body: { address: 'x@gmail.com' } }, typed);
  assert.equal(typed.body.found, true);
  assert.equal(typed.body.provider.host, 'smtp.gmail.com');
  assert.equal(typed.body.message, 'Serveur trouvé : Gmail (smtp.gmail.com).');
  const saved = res();
  await controller.detectSmtp({ body: {} }, saved);
  assert.equal(saved.body.address, 'contact@gite.fr');
  assert.equal(saved.body.provider.name, 'OVHcloud');
  assert.equal(upserted, null);
});
