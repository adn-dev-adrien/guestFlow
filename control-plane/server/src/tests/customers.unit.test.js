// specs/control-plane-plans-and-access.md — customers in the console: rule 21 (the slug), rule 7
// (onboarding and its steps), rule 8 (the fleet and its counters), rule 15 (a payment recorded),
// rule 19 (overrides with a mandatory reason), rule 4 (add-ons follow the subscription).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');
const { slugError } = require('../utils/slug');

test('rule 21 — slug format, length, reserved names, and uniqueness including archived customers', async () => {
  const taken = (s) => s === 'solio';
  assert.match(slugError('Gîte', taken), /minuscules/);
  assert.match(slugError('ab', taken), /3 et 30/);
  assert.match(slugError('a'.repeat(31), taken), /3 et 30/);
  assert.match(slugError('-aulnes', taken), /tiret/);
  for (const r of ['app', 'www', 'auth', 'api', 'admin', 'console', 'mail', 'status', 'demo']) assert.equal(slugError(r, taken), 'Adresse réservée.');
  assert.match(slugError('solio', taken), /déjà utilisée/);
  assert.equal(slugError('les-aulnes-2', taken), null);

  const { ctx } = makeContext();
  const c = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  await ctx.controllers.customers.deprovision(c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.match(ctx.controllers.customers.preview(NEW_CUSTOMER).errors.slug, /déjà utilisée/, 'an archived slug stays taken');
  await ctx.controllers.customers.stepAction(c.id, 'deprov-stop', 'done', 'op');
  ctx.controllers.customers.eraseNow(c.id, { confirmSlug: 'aulnes' }, 'op');
  assert.equal(ctx.controllers.customers.preview(NEW_CUSTOMER).errors.slug, undefined, 'free again once erased');
});

test('rule 7 — the preview computes the end date and price server-side; errors name the field', () => {
  const { ctx } = makeContext();
  const { customers } = ctx.controllers;
  const ok = customers.preview({ ...NEW_CUSTOMER, addons: ['gate-access'] });
  assert.deepEqual(ok.errors, {});
  assert.match(ok.summary.price, /^Pro \+ Accès au portail \(Sowel\) · 61,00\s€ HT \/ mois \(facturé à l’année\)$/);
  assert.equal(ok.summary.period, 'Abonnement du 01/10/2026 au 01/10/2027.');
  assert.equal(ok.summary.url, 'https://aulnes.guestflow.test');
  const trial = customers.preview({ ...NEW_CUSTOMER, trial: true });
  assert.match(trial.summary.period, /^Essai gratuit du 01\/10\/2026 au 31\/10\/2026 ; la première période payée \(12 mois\) commence au paiement\.$/);
  const bad = customers.preview({ ...NEW_CUSTOMER, contactEmail: 'nope', length: 'custom', endsAt: '2026-09-01' });
  assert.ok(bad.errors.contactEmail && bad.errors.endsAt);
});

test('rule 7 — onboarding: licence and first admin run, the hosting steps wait for the operator', async () => {
  const { ctx, root, mailer, firstAdminCalls } = makeContext();
  makeInstance(root, 'aulnes');
  const v = await ctx.controllers.customers.create(NEW_CUSTOMER, 'adrien@adn-dev.fr');
  assert.deepEqual(v.steps.map((s) => [s.step, s.status, s.action]), [
    ['licence', 'ok', null], ['instance', 'todo', 'done'], ['process', 'todo', 'done'], ['route', 'todo', 'done'], ['admin', 'ok', null],
  ]);
  assert.equal(firstAdminCalls[0].email, 'claire@aulnes.fr');
  assert.match(firstAdminCalls[0].dbPath, /aulnes\/data\/guestflow\.db$/);
  const invite = mailer.sent.find((m) => m.to === 'claire@aulnes.fr');
  assert.match(invite.text, /Mot de passe provisoire : Tmp-Passw0rd/);
  assert.match(invite.text, /https:\/\/aulnes\.guestflow\.test\/login\?login_hint=claire%40aulnes\.fr/);
  assert.equal(v.history[0].operator, 'adrien@adn-dev.fr');
  assert.equal(v.state, 'active');
});

test('rule 7 — a failed step is retried alone once the instance exists', async () => {
  const { ctx, root, mailer } = makeContext();
  const { customers } = ctx.controllers;
  const v = await customers.create(NEW_CUSTOMER, 'op');
  assert.equal(v.steps.find((s) => s.step === 'admin').status, 'failed');
  assert.equal(mailer.sent.length, 0, 'no invitation without an instance');
  makeInstance(root, 'aulnes');
  let after = await customers.stepAction(v.id, 'instance', 'done', 'op');
  assert.equal(after.steps.find((s) => s.step === 'instance').status, 'ok');
  after = await customers.stepAction(v.id, 'admin', 'retry', 'op');
  after = await customers.stepAction(v.id, 'licence', 'retry', 'op');
  assert.deepEqual(after.steps.filter((s) => s.kind === 'auto').map((s) => s.status), ['ok', 'ok']);
  assert.equal(mailer.sent.length, 1);
  await assert.rejects(customers.stepAction(v.id, 'instance', 'retry', 'op'), /Action inconnue/);
});

test('rule 7 — an account that already exists is not invited twice', async () => {
  const { ctx, root, mailer } = makeContext({ firstAdmin: () => ({ created: false, temporaryPassword: null }) });
  makeInstance(root, 'aulnes');
  const v = await ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  assert.match(v.steps.find((s) => s.step === 'admin').detail, /existe déjà/);
  assert.equal(mailer.sent.length, 0);
});

test('rule 8 — the fleet: one row per customer and the three counters', async () => {
  const { ctx, root, now } = makeContext();
  const { customers } = ctx.controllers;
  makeInstance(root, 'aulnes', { installed: ['sas', 'linen'] });
  await customers.create(NEW_CUSTOMER, 'op');
  await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', billing: 'monthly', length: 1, startsAt: '2026-08-25' }, 'op');
  await customers.create({ ...NEW_CUSTOMER, slug: 'pinede', billing: 'monthly', length: 1, startsAt: '2026-07-01' }, 'op');
  await customers.create({ ...NEW_CUSTOMER, slug: 'granja', trial: true, startsAt: '2026-09-15' }, 'op');
  now.set('2026-09-30T10:00:00Z');
  customers.reissueAll('système');
  const fleet = customers.fleet();
  const bySlug = Object.fromEntries(fleet.rows.map((r) => [r.slug, r]));
  assert.equal(bySlug.aulnes.state, 'active');
  assert.equal(bySlug.aulnes.installedCount, 2);
  assert.equal(bySlug.moulin.installedCount, null, 'an unreadable instance is unknown, not zero');
  assert.equal(bySlug.moulin.state, 'grace');
  assert.equal(bySlug.pinede.state, 'suspended');
  assert.equal(bySlug.granja.state, 'trial');
  assert.equal(bySlug.granja.daysLeft, 15);
  assert.deepEqual(fleet.counters.map((c) => [c.key, c.count]), [['renew', 1], ['late', 1], ['suspended', 1]]);
  assert.equal(bySlug.aulnes.url, 'https://aulnes.guestflow.test');
});

test('rule 15 — a payment moves the end, sets active whatever the state, and records a paid invoice', async () => {
  const { ctx, now } = makeContext();
  const { customers } = ctx.controllers;
  const c = await customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-07-01' }, 'op');
  now.set('2026-09-29T10:00:00Z');
  assert.equal(customers.refresh(c.id).state, 'suspended');
  assert.throws(() => customers.recordPayment(c.id, { months: 3, expectedEndsAt: '2026-08-01' }, 'op'), /1 ou 12 mois/);
  assert.throws(() => customers.recordPayment(c.id, { months: 1 }, 'op'), (e) => e.body.error === 'STALE');
  const v = customers.recordPayment(c.id, { months: 1, reference: 'Virement du 28/09', expectedEndsAt: '2026-08-01' }, 'op');
  assert.throws(() => customers.recordPayment(c.id, { months: 1, expectedEndsAt: '2026-08-01' }, 'op'), (e) => e.body.error === 'STALE', 'the double click');
  assert.equal(v.state, 'active');
  assert.equal(v.endsAt, '2026-10-29');
  assert.equal(v.invoices[0].amount.replace(/\s/g, ' '), '59,00 €');
  assert.equal(v.invoices[0].status, 'paid');
  assert.match(v.history.find((h) => /Paiement/.test(h.text)).text, /Paiement enregistré \(1 mois, 59,00\s€ HT, « Virement du 28\/09 »\) : échéance au 29\/10\/2026/);
  assert.ok(v.history.some((h) => /Suspendu → Actif/.test(h.text)));
});

test('rule 19 — extending and forcing active need a reason, and are journaled with it', async () => {
  const { ctx, now } = makeContext();
  const { customers } = ctx.controllers;
  const c = await customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-08-01' }, 'op');
  now.set('2026-09-20T10:00:00Z');
  assert.equal(customers.refresh(c.id).state, 'read_only');
  assert.throws(() => customers.extend(c.id, { endsAt: '2026-10-02', expectedEndsAt: '2026-09-01' }, 'op'), (e) => e.body.error === 'REASON_REQUIRED');
  assert.throws(() => customers.extend(c.id, { endsAt: '2026-08-15', reason: 'geste', expectedEndsAt: '2026-09-01' }, 'op'), /suivre l’échéance/);
  let v = customers.forceActive(c.id, { until: '2026-09-27', reason: 'Virement annoncé' }, 'op');
  assert.equal(v.state, 'active');
  assert.equal(v.stateNote, 'forcé jusqu’au 27/09/2026');
  now.set('2026-09-28T10:00:00Z');
  assert.equal(customers.refresh(c.id).state, 'read_only', 'the calendar takes over after the date');
  v = customers.extend(c.id, { endsAt: '2026-10-02', reason: 'Geste commercial', expectedEndsAt: '2026-09-01' }, 'op');
  assert.throws(() => customers.extend(c.id, { endsAt: '2026-10-20', reason: 'bis', expectedEndsAt: '2026-09-01' }, 'op'), (e) => e.body.error === 'STALE');
  assert.equal(v.state, 'due');
  assert.equal(ctx.models.audit.overrides(c.id).map((o) => o.reason).join('|'), 'Geste commercial|Virement annoncé');
});

test('rule 4 — add-ons are part of the subscription, priced monthly, and licensed', async () => {
  const { ctx } = makeContext();
  const { customers } = ctx.controllers;
  const c = await customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, addons: ['gate-access'] }, 'op');
  assert.equal(customers.monthlyPriceCents(customers.view(c.id) && ctx.models.customers.get(c.id)), 5900 + 1200);
  const payload = JSON.parse(Buffer.from(customers.licenceDownload(c.id).token.split('.')[1], 'base64url'));
  assert.ok(payload.plugins.includes('gate-access'));
  await assert.rejects(customers.create({ ...NEW_CUSTOMER, slug: 'autre', addons: ['nope'] }, 'op'), /Option inconnue/);
});

test('rule 4 — an add-on the plan already includes is shown as included and never sold on top', async () => {
  const { ctx } = makeContext();
  const { customers } = ctx.controllers;
  const choices = customers.preview({ ...NEW_CUSTOMER, planCode: 'premium' }).addonChoices;
  assert.deepEqual(choices.map((c) => [c.pluginId, c.included]), [['gate-access', true], ['hourly-resources', true], ['neat', true]]);
  const c = await customers.create({ ...NEW_CUSTOMER, planCode: 'premium', billing: 'monthly', length: 1, addons: ['gate-access'] }, 'op');
  assert.deepEqual(customers.view(c.id).addons, []);
  assert.equal(customers.monthlyPriceCents(ctx.models.customers.get(c.id)), 9900);
  const v = customers.changePlan(c.id, { planCode: 'pro', billing: 'monthly', addons: ['gate-access'] }, 'op');
  assert.deepEqual(v.addons.map((a) => a.id), ['gate-access'], 'sold again once the plan no longer includes it');
  assert.equal(v.plans.find((p) => p.code === 'pro').addonChoices.find((x) => x.pluginId === 'gate-access').included, false);
});
