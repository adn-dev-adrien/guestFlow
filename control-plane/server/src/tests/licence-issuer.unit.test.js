// specs/control-plane-plans-and-access.md rule 9 — the licence the console issues: its fields, its
// signature verified by the instance's own reader (rule 30), its atomic delivery to the instance's
// data directory, and the download when that directory does not exist yet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { licence: gfLicence } = require('../utils/gf');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');

test('rule 9 — the licence carries the plan, plugins, planOf, quotas and state, signed for the instance', async () => {
  const { ctx, root, publicKey } = makeContext();
  const dataDir = makeInstance(root, 'aulnes');
  const c = await ctx.controllers.customers.create({ ...NEW_CUSTOMER, addons: ['gate-access'] }, 'op');
  const file = path.join(dataDir, 'licence.jws');
  assert.ok(fs.existsSync(file));
  const reader = gfLicence.createLicenceReader({ dataDir, publicKey, managed: true, now: () => new Date('2026-09-30T10:00:00Z') });
  const lic = reader.current();
  assert.equal(lic.valid, true, lic.reason);
  const p = lic.payload;
  assert.equal(p.slug, 'aulnes');
  assert.equal(p.plan, 'pro');
  assert.equal(p.planName, 'Pro');
  assert.equal(p.catalogueVersion, 1);
  assert.deepEqual([...p.plugins].sort(), ['accounting-export', 'gate-access', 'google-calendar', 'linen', 'online-payment', 'sas', 'school-holidays', 'weather-alerts', 'website-booking'].sort());
  assert.deepEqual(p.planOf, { 'hourly-resources': 'Premium', neat: 'Premium', 'tariff-recipes': 'Premium' });
  assert.deepEqual(p.quotas, { units: 6, users: 5 });
  assert.equal(p.state, 'active');
  assert.equal(p.endsAt, '2027-10-01');
  assert.equal(p.payUrl, null);
  assert.equal(new Date(p.expiresAt) - new Date(p.issuedAt), 7 * 86400000);
  assert.equal(reader.allowsPlugin('gate-access'), true);
  assert.equal(reader.planFor('neat'), 'Premium');
  assert.equal(ctx.controllers.customers.view(c.id).steps.find((s) => s.step === 'licence').status, 'ok');
});

test('rule 9 — no temporary file is left behind; a re-issue replaces the licence', async () => {
  const { ctx, root } = makeContext();
  const dataDir = makeInstance(root, 'aulnes');
  const c = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  const before = fs.readFileSync(path.join(dataDir, 'licence.jws'), 'utf8');
  ctx.now.set('2026-09-30T10:00:00Z');
  ctx.controllers.customers.refresh(c.id);
  assert.notEqual(fs.readFileSync(path.join(dataDir, 'licence.jws'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.endsWith('.tmp')), []);
});

test('rule 9 — without the instance directory the step fails with its reason, and the licence can be downloaded', async () => {
  const { ctx, publicKey } = makeContext();
  const c = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  const step = ctx.controllers.customers.view(c.id).steps.find((s) => s.step === 'licence');
  assert.equal(step.status, 'failed');
  assert.match(step.detail, /introuvable.*Téléchargez-la/);
  assert.equal(step.action, 'retry');
  const { filename, token } = ctx.controllers.customers.licenceDownload(c.id);
  assert.equal(filename, 'licence-aulnes.jws');
  assert.equal(gfLicence.verifyJws(token, publicKey).slug, 'aulnes');
});

test('rule 9 — a licence signed by another key is refused by the instance', async () => {
  const crypto = require('crypto');
  const { ctx, root } = makeContext();
  const dataDir = makeInstance(root, 'aulnes');
  await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  const other = crypto.generateKeyPairSync('ed25519').publicKey;
  const reader = gfLicence.createLicenceReader({ dataDir, publicKey: other, managed: true, log: () => {} });
  assert.equal(reader.current().valid, false);
  assert.equal(reader.effectiveState(), 'read_only');
});
