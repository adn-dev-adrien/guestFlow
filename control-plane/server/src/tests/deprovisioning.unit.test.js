// specs/control-plane-plans-and-access.md rule 20 — « Déprovisionner »: confirmed by the slug, the
// export first (database copy, uploads, CSV), its link emailed for 30 days, the stop step, archived,
// erased after 90 days (or earlier on a second confirmation), and reactivation before erasure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { eraseInstance } = require('../utils/eraser');
const { createInstances } = require('../utils/instances');

async function archivedCustomer() {
  const h = makeContext();
  makeInstance(h.root, 'aulnes', { installed: ['sas'] });
  fs.mkdirSync(path.join(h.root, 'aulnes', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(h.root, 'aulnes', 'uploads', 'logo.png'), 'png');
  const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  return { ...h, c };
}

test('rule 20 — the confirmation must be the slug', async () => {
  const { ctx, c } = await archivedCustomer();
  await assert.rejects(ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'Aulnes' }, 'op'), (e) => e.body.error === 'CONFIRM_SLUG');
  assert.equal(ctx.controllers.customers.view(c.id).state, 'active');
});

test('rule 20 — export, email, stop step, archived, erasure date — in that order', async () => {
  const { ctx, c, mailer, dataDir } = await archivedCustomer();
  const v = await ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.deepEqual(v.deprovisionSteps.map((s) => [s.step, s.status]), [['deprov-export', 'ok'], ['deprov-email', 'ok'], ['deprov-stop', 'todo']]);
  assert.equal(v.state, 'archived');
  assert.equal(v.eraseAt, '2026-12-28');
  assert.deepEqual(v.actions.pay, false);
  const mail = mailer.sent.find((m) => /Export/.test(m.subject));
  const token = /exports\/([A-Za-z0-9_-]+)/.exec(mail.text)[1];
  const exp = ctx.models.provisioning.getExport(token);
  assert.equal(exp.expiresAt, '2026-10-29');
  const listing = execFileSync('tar', ['-tzf', exp.path], { encoding: 'utf8' });
  for (const f of ['guestflow.db', 'reservations.csv', 'clients.csv', 'uploads/logo.png']) assert.match(listing, new RegExp(f.replace('.', '\\.')));
  const out = path.join(dataDir, 'x');
  fs.mkdirSync(out);
  execFileSync('tar', ['-xzf', exp.path, '-C', out]);
  assert.equal(fs.readFileSync(path.join(out, 'reservations.csv'), 'utf8'), 'id,guest,total\n1,"Martin, ""Jo""",420.5\n');
});

test('rule 20 — a failed export archives nothing', async () => {
  const { ctx, c, root } = await archivedCustomer();
  fs.writeFileSync(path.join(root, 'aulnes', 'data', 'guestflow.db'), 'not a database');
  const v = await ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.equal(v.deprovisionSteps[0].status, 'failed');
  assert.equal(v.state, 'active');
  assert.equal(v.archivedAt, null);
});

test('rule 20 — a customer whose instance never existed is archived with nothing to export', async () => {
  const { ctx, mailer } = makeContext();
  const c = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  const v = await ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.deepEqual(v.deprovisionSteps.map((s) => s.status), ['skipped', 'skipped', 'todo']);
  assert.equal(v.state, 'archived');
  assert.equal(mailer.sent.length, 0);
});

test('rule 20 — reactivation before erasure restores the customer and cancels the erasure', async () => {
  const { ctx, c } = await archivedCustomer();
  await ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
  const v = ctx.controllers.customers.reactivate(c.id, 'op');
  assert.equal(v.state, 'active');
  assert.equal(v.eraseAt, null);
  assert.deepEqual(v.deprovisionSteps, []);
  assert.equal(v.steps.find((s) => s.step === 'restart').status, 'todo');
});

test('rule 20 — erased after 90 days by the daily run, or earlier on a second confirmation', async () => {
  const { ctx, c, root, now } = await archivedCustomer();
  await ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
  now.set('2026-12-27T10:00:00Z');
  assert.deepEqual(ctx.controllers.customers.eraseDue('système'), []);
  now.set('2026-12-28T10:00:00Z');
  assert.equal(ctx.controllers.customers.eraseDue('système').length, 1);
  assert.equal(fs.existsSync(path.join(root, 'aulnes')), false);
  assert.throws(() => ctx.controllers.customers.view(c.id), (e) => e.status === 404);

  const other = await archivedCustomer();
  await other.ctx.controllers.customers.deprovision(other.c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.equal(other.ctx.controllers.customers.cancelErase(other.c.id, 'op').eraseAt, null);
  assert.equal(other.ctx.controllers.customers.eraseDue('système').length, 0, 'a cancelled erasure never runs');
  assert.throws(() => other.ctx.controllers.customers.eraseNow(other.c.id, { confirmSlug: 'x' }, 'op'), (e) => e.body.error === 'CONFIRM_SLUG');
  other.ctx.controllers.customers.eraseNow(other.c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.equal(fs.existsSync(path.join(other.root, 'aulnes')), false);
});

test('rule 20 — the eraser only ever removes <root>/<slug>', () => {
  const instances = createInstances({ root: '/tmp/cp-root-guard' });
  assert.throws(() => eraseInstance({ instances, slug: '../etc' }), /invalid slug/);
  assert.throws(() => eraseInstance({ instances, slug: '' }), /invalid slug/);
  assert.deepEqual(eraseInstance({ instances, slug: 'absent' }), { erased: false });
});
