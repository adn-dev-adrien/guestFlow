// specs/control-plane-plans-and-access.md rule 37 — the « Création » card of a customer: no host path
// in a step's detail, and the card folds to one line once every step is done.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

test('rule 37 — a finished creation names no host path and reads as done', async () => {
  const { ctx } = makeContext();
  const v = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  assert.ok(v.steps.every((s) => !/(^|\s)\//.test(s.detail)), JSON.stringify(v.steps.map((s) => s.detail)));
  assert.equal(v.steps.find((s) => s.step === 'dir').detail, 'Créés.');
  assert.equal(v.steps.find((s) => s.step === 'licence').detail, 'Écrite.');
  assert.equal(v.stepsDone, true);
  assert.equal(v.stepsSummary, 'Terminée : 10 étapes');
});

test('rule 37 — a step recorded with a host path before the change shows no detail', async () => {
  const { ctx } = makeContext();
  const { db } = ctx;
  const v = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  db.prepare("UPDATE provisioning_steps SET detail = 'Écrite dans /srv/guestflow/data/licence.jws' WHERE customerId = ? AND step = 'licence'").run(v.id);
  db.prepare("UPDATE provisioning_steps SET detail = '/srv/guestflow/instances/aulnes' WHERE customerId = ? AND step = 'dir'").run(v.id);
  const again = ctx.controllers.customers.view(v.id);
  assert.equal(again.steps.find((s) => s.step === 'licence').detail, '');
  assert.equal(again.steps.find((s) => s.step === 'dir').detail, '');
  assert.equal(again.steps.find((s) => s.step === 'health').detail, v.steps.find((s) => s.step === 'health').detail);
});

test('rule 37 — a failed step keeps the card open, its reason in full', async () => {
  const { ctx } = makeContext({ firstAdmin: () => { throw new Error('script absent'); } });
  const v = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  assert.equal(v.stepsDone, false);
  assert.equal(v.steps.find((s) => s.step === 'admin').detail, 'Échec : script absent');
});
