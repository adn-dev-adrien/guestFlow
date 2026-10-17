// specs/hosting-h1-fleet-runtime.md — the instance side of the hosting: rule 9 (a managed instance
// never updates itself), rules 18–20 (the platform's sender, its headers, an own SMTP that wins, the
// daily quota) and H-D4 (the files an instance owns live outside a shared release). A self-hosted
// install — no GUESTFLOW_MANAGED — must see no difference at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const controller = require('../controllers/systemController');
const { createUpdateStateModel } = require('../models/updateStateModel');
const { resolvePaths, selfUpdateSupported } = require('../utils/deploymentPaths');
const { createEmailService } = require('../utils/emailService');
const platformMail = require('../utils/platformMail');
const { shapeResponse } = require('../utils/settingsResponse');
const { uploadsDir, localEnvPath, SERVER_DIR } = require('../utils/instancePaths');

const { buildVersionInfo, MANAGED_LABEL } = controller.__test;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-managed-'));
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = () => res;
  return res;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  const restore = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function fakeTransport() {
  const sent = [];
  let options = null;
  return {
    sent,
    options: () => options,
    factory: (opts) => { options = opts; return { sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } }; },
  };
}

const PLATFORM_ENV = {
  GUESTFLOW_MANAGED: '1',
  GUESTFLOW_PLATFORM_SMTP_HOST: 'smtp.platform.test',
  GUESTFLOW_PLATFORM_SMTP_PORT: '587',
  GUESTFLOW_PLATFORM_SMTP_USER: 'relay',
  GUESTFLOW_PLATFORM_SMTP_PASS: 'secret',
  GUESTFLOW_PLATFORM_SMTP_FROM: 'noreply@guestflow.test',
  GUESTFLOW_PLATFORM_MAIL_DAILY_LIMIT: '2',
};

// ----- rule 9 -----

test('rule 9 — a managed instance refuses to update itself (403) and shows only its version', async () => {
  const dir = tmp();
  try {
    const model = createUpdateStateModel(resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') }));
    const info = buildVersionInfo(model, { GUESTFLOW_MANAGED: '1' });
    assert.equal(info.managed, true);
    assert.equal(info.managedLabel, MANAGED_LABEL);
    assert.equal(MANAGED_LABEL, 'Mises à jour gérées par l’hébergeur');
    assert.equal(info.updateAvailable, false);
    assert.equal(info.selfUpdateSupported, false);

    await withEnv({ GUESTFLOW_MANAGED: '1' }, async () => {
      const res = fakeRes();
      await controller.startUpdate({ body: { targetVersion: '99.0.0' } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'MANAGED_BY_HOST');
      const check = fakeRes();
      await controller.checkNow({}, check);
      assert.equal(check.statusCode, 403);
      assert.equal(await controller.runVersionCheck({ fetchImpl: () => { throw new Error('no network call'); } }), null);
    });
    assert.equal(selfUpdateSupported({ GUESTFLOW_MANAGED: '1' }).supported, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 9 — a self-hosted install keeps its update path exactly as before', async () => {
  const dir = tmp();
  try {
    const model = createUpdateStateModel(resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') }));
    const info = buildVersionInfo(model, {});
    assert.equal(info.managed, false);
    assert.equal(info.managedLabel, null);
    await withEnv({ GUESTFLOW_MANAGED: undefined }, async () => {
      const res = fakeRes();
      await controller.startUpdate({ body: { targetVersion: '99.0.0' } }, res);
      // A dev tree is not a deployment: the historical 412, never the hosting's 403.
      assert.equal(res.statusCode, 412);
      assert.equal(res.body.error, 'SELF_UPDATE_UNSUPPORTED');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ----- rules 18–20 -----

test('rule 18 — no own SMTP on a managed instance: the platform sends, in the company’s name, Reply-To the company', async () => {
  const dir = tmp();
  const t = fakeTransport();
  const svc = createEmailService({ host: '', fromEmail: 'claire@aulnes.fr', fromName: 'Gîte des Aulnes' }, {
    env: PLATFORM_ENV, transportFactory: t.factory, counterFile: path.join(dir, 'platform-mail.json'),
  });
  try {
    assert.equal(svc.isConfigured, true);
    assert.equal(svc.viaPlatform, true);
    await svc.send({ to: 'guest@example.fr', subject: 'Bienvenue', text: 'Bonjour' });
    assert.equal(t.options().host, 'smtp.platform.test');
    assert.deepEqual(t.options().auth, { user: 'relay', pass: 'secret' });
    assert.equal(t.sent[0].from, '"Gîte des Aulnes" <noreply@guestflow.test>');
    assert.equal(t.sent[0].replyTo, 'claire@aulnes.fr');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 18 — the local mail driver writes each message into the outbox folder', async () => {
  const dir = tmp();
  try {
    const env = { GUESTFLOW_MANAGED: '1', GUESTFLOW_PLATFORM_SMTP_OUTBOX: path.join(dir, 'outbox'), GUESTFLOW_PLATFORM_SMTP_FROM: 'noreply@guestflow.test' };
    const svc = createEmailService({ host: '', fromEmail: 'claire@aulnes.fr', fromName: 'Aulnes' }, { env, counterFile: path.join(dir, 'c.json') });
    await svc.send({ to: 'g@example.fr', subject: 'S', text: 'T' });
    const files = fs.readdirSync(path.join(dir, 'outbox'));
    assert.equal(files.length, 1);
    const msg = JSON.parse(fs.readFileSync(path.join(dir, 'outbox', files[0]), 'utf8'));
    assert.equal(msg.replyTo, 'claire@aulnes.fr');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 19 — a configured SMTP always wins over the platform', async () => {
  const t = fakeTransport();
  const svc = createEmailService({ host: 'smtp.aulnes.fr', fromEmail: 'claire@aulnes.fr', fromName: 'Aulnes', user: 'claire', password: 'pw' }, {
    env: PLATFORM_ENV, transportFactory: t.factory,
  });
  assert.equal(svc.viaPlatform, false);
  await svc.send({ to: 'g@example.fr', subject: 'S', text: 'T' });
  assert.equal(t.options().host, 'smtp.aulnes.fr');
  assert.equal(t.sent[0].from, '"Aulnes" <claire@aulnes.fr>');
  assert.equal(t.sent[0].replyTo, undefined);
});

test('rule 19 — the settings payload says which sender is in use; a self-hosted install has none of it', () => {
  const row = { companyEmail: 'claire@aulnes.fr', companyName: 'Aulnes', smtpHost: '' };
  assert.deepEqual(shapeResponse(row, PLATFORM_ENV).smtp.platform, { available: true, active: true, replyTo: 'claire@aulnes.fr' });
  assert.deepEqual(shapeResponse({ ...row, smtpHost: 'smtp.aulnes.fr' }, PLATFORM_ENV).smtp.platform.active, false);
  assert.deepEqual(shapeResponse(row, {}).smtp.platform, { available: false, active: false, replyTo: '' });
});

test('rule 20 — above the daily quota the platform refuses with a clear error; the next day it sends again', async () => {
  const dir = tmp();
  const file = path.join(dir, 'platform-mail.json');
  let now = new Date('2026-10-08T10:00:00Z');
  const t = fakeTransport();
  const svc = createEmailService({ host: '', fromEmail: 'claire@aulnes.fr' }, {
    env: PLATFORM_ENV, transportFactory: t.factory, counterFile: file, now: () => now,
  });
  try {
    await svc.send({ to: 'a@x.fr', subject: '1', text: '1' });
    await svc.send({ to: 'b@x.fr', subject: '2', text: '2' });
    await assert.rejects(svc.send({ to: 'c@x.fr', subject: '3', text: '3' }), (err) => {
      assert.equal(err.code, 'PLATFORM_MAIL_DAILY_LIMIT');
      assert.match(err.message, /Limite quotidienne d’envoi par la plateforme atteinte \(2 emails\)/);
      return true;
    });
    assert.equal(t.sent.length, 2);
    assert.equal(platformMail.readCount({ file, now }), 2);
    now = new Date('2026-10-09T08:00:00Z');
    await svc.send({ to: 'd@x.fr', subject: '4', text: '4' });
    assert.equal(platformMail.readCount({ file, now }), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 18 — without GUESTFLOW_MANAGED the platform variables are ignored (Solio)', () => {
  const env = { ...PLATFORM_ENV, GUESTFLOW_MANAGED: undefined };
  assert.equal(platformMail.available(env), false);
  const svc = createEmailService({ host: '', fromEmail: 'a@b.c' }, { env });
  assert.equal(svc.isConfigured, false);
});

// ----- H-D4 -----

test('H-D4 — uploads and generated secrets leave the shared release only when the hosting says so', () => {
  assert.equal(uploadsDir({}), path.join(SERVER_DIR, 'uploads'));
  assert.equal(localEnvPath({}), path.join(SERVER_DIR, '.env.local'));
  assert.equal(uploadsDir({ GUESTFLOW_UPLOADS_DIR: '/srv/i/aulnes/uploads' }), '/srv/i/aulnes/uploads');
  assert.equal(localEnvPath({ GUESTFLOW_LOCAL_ENV: '/srv/i/aulnes/data/local.env' }), '/srv/i/aulnes/data/local.env');
});
