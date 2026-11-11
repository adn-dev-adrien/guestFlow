// specs/control-plane-plans-and-access.md — the plan catalogue: rule 1 (three ordered plans with
// prices and quotas), rule 2 (nested plans, the refusal), rule 3 (the decided allocation), rule 5
// (impact before saving, grandfathering, available not installed), rule 6 (versions, the price a
// customer was sold under).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeInstance, NEW_CUSTOMER } = require('./helpers');

test('rules 1 and 3 — three ordered plans, the decided plugins, prices and quotas', () => {
  const { ctx } = makeContext();
  const v = ctx.controllers.catalogue.view();
  assert.deepEqual(v.plans.map((p) => [p.name, p.priceMonthlyCents, p.priceYearlyCents, p.maxUnits, p.maxUsers]), [
    ['Essentiel', 2900, 2400, 2, 2], ['Pro', 5900, 4900, 6, 5], ['Premium', 9900, 8300, 15, null],
  ]);
  assert.equal(v.lowest.sas, 'essentiel', 'the SAS is in the base plan (§9 Q2)');
  assert.equal(v.lowest['website-booking'], 'pro');
  assert.equal(v.lowest['gate-access'], 'premium');
  const sas = v.matrix.find((r) => r.pluginId === 'sas');
  assert.deepEqual(sas.cells.map((c) => c.status), ['own', 'inherited', 'inherited']);
  assert.equal(sas.cells[2].tooltip, 'Inclus via Essentiel');
  assert.equal(v.version, 1);
});

test('rule 2 — removing from a higher plan while a lower one holds it is refused', () => {
  const { ctx } = makeContext();
  const { catalogue } = ctx.controllers;
  const lowest = catalogue.view().lowest;
  assert.throws(() => catalogue.toggle({ lowest, pluginId: 'sas', planCode: 'pro' }),
    (e) => e.status === 409 && /inclus via Essentiel/.test(e.body.message));
});

test('rule 2 — adding to a lower plan cascades up; removing moves it up, then to à la carte', () => {
  const { ctx } = makeContext();
  const { catalogue } = ctx.controllers;
  let { lowest } = catalogue.view();
  let r = catalogue.toggle({ lowest, pluginId: 'neat', planCode: 'pro' });
  assert.equal(r.lowest.neat, 'pro');
  assert.match(r.message, /descend en Pro/);
  r = catalogue.toggle({ lowest: r.lowest, pluginId: 'neat', planCode: 'pro' });
  assert.equal(r.lowest.neat, 'premium');
  r = catalogue.toggle({ lowest: r.lowest, pluginId: 'neat', planCode: 'premium' });
  assert.equal(r.lowest.neat, null);
  assert.match(r.message, /option à la carte/);
  r = catalogue.toggle({ lowest: r.lowest, pluginId: 'neat', planCode: 'essentiel' });
  assert.match(r.message, /par emboîtement/);
  lowest = r.lowest;
  assert.deepEqual(r.matrix.find((x) => x.pluginId === 'neat').cells.map((c) => c.status), ['own', 'inherited', 'inherited']);
});

test('rule 5 — the impact names who gains and who keeps, before saving', async () => {
  const { ctx, root } = makeContext();
  makeInstance(root, 'aulnes', { installed: ['tariff-recipes', 'neat'] });
  await ctx.controllers.customers.create({ ...NEW_CUSTOMER, planCode: 'premium' }, 'op');
  await ctx.controllers.customers.create({ ...NEW_CUSTOMER, slug: 'moulin', planCode: 'pro' }, 'op');
  const { catalogue } = ctx.controllers;
  const lowest = { ...catalogue.view().lowest, 'tariff-recipes': null, linen: 'essentiel' };
  const { lines } = catalogue.impact({ lowest });
  assert.ok(lines.some((l) => /1 client Premium garde Recettes tarifaires déjà installé/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /0 client Essentiel gagne Linge/.test(l)), lines.join('\n'));
  assert.equal(catalogue.view().lowest['tariff-recipes'], 'premium', 'impact saves nothing');
});

test('rule 5 — a removed plugin stays licensed for who installed it; an added one is available, not installed', async () => {
  const { ctx, root } = makeContext();
  makeInstance(root, 'aulnes', { installed: ['tariff-recipes'] });
  const created = await ctx.controllers.customers.create({ ...NEW_CUSTOMER, planCode: 'premium' }, 'op');
  makeInstance(root, 'moulin', { installed: [] });
  const other = await ctx.controllers.customers.create({ ...NEW_CUSTOMER, slug: 'moulin', planCode: 'premium' }, 'op');
  const { catalogue } = ctx.controllers;
  const lowest = { ...catalogue.view().lowest, 'tariff-recipes': null, linen: 'essentiel' };
  const saved = catalogue.save({ lowest, reason: 'Recettes en option' }, 'adrien@adn-dev.fr');
  assert.equal(saved.version, 2);
  const lic = (id) => JSON.parse(Buffer.from(ctx.controllers.customers.licenceDownload(id).token.split('.')[1], 'base64url'));
  assert.ok(lic(created.id).plugins.includes('tariff-recipes'), 'grandfathered for the customer who installed it');
  assert.ok(!lic(other.id).plugins.includes('tariff-recipes'), 'withdrawn where it was not installed');
  assert.ok(ctx.controllers.customers.view(created.id).grandfathered.some((g) => g.id === 'tariff-recipes'));
  // A plan change is where grandfathered plugins go.
  ctx.controllers.customers.changePlan(created.id, { planCode: 'premium', billing: 'yearly', addons: [] }, 'op');
  assert.ok(!lic(created.id).plugins.includes('tariff-recipes'));
});

test('rule 6 — every save is a version with its author and reason; a customer keeps the price sold', async () => {
  const { ctx } = makeContext();
  const { catalogue, customers } = ctx.controllers;
  const c = await customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1 }, 'op');
  assert.throws(() => catalogue.save({ lowest: catalogue.view().lowest }, 'op'), (e) => e.body.error === 'REASON_REQUIRED');
  catalogue.save({ plans: [{ code: 'pro', priceMonthlyCents: 6900 }], reason: 'Hausse 2027' }, 'adrien@adn-dev.fr');
  const v = catalogue.view();
  assert.equal(v.plans.find((p) => p.code === 'pro').priceMonthlyCents, 6900);
  assert.equal(v.versions[0].reason, 'Hausse 2027');
  assert.equal(v.versions[0].changedBy, 'adrien@adn-dev.fr');
  assert.match(customers.view(c.id).priceLabel, /^59,00\s€ HT/, 'the customer keeps the v1 price');
  const later = await customers.create({ ...NEW_CUSTOMER, slug: 'later', billing: 'monthly', length: 1 }, 'op');
  assert.match(customers.view(later.id).priceLabel, /^69,00\s€ HT/);
});

test('rule 1 — quotas are whole numbers or unlimited; prices are never negative', () => {
  const { ctx } = makeContext();
  const { catalogue } = ctx.controllers;
  assert.throws(() => catalogue.save({ plans: [{ code: 'pro', maxUnits: 0 }], reason: 'x' }, 'op'), /Quota invalide/);
  assert.throws(() => catalogue.save({ plans: [{ code: 'pro', priceMonthlyCents: -1 }], reason: 'x' }, 'op'), /Prix invalide/);
  catalogue.save({ plans: [{ code: 'pro', maxUsers: null }], reason: 'Comptes illimités en Pro' }, 'op');
  assert.equal(catalogue.view().plans.find((p) => p.code === 'pro').maxUsers, null);
});

test('rules 3, 6 — prices and quotas are read on the server as typed: an emptied price or « 1,5 » is refused', () => {
  const { ctx } = makeContext();
  const { catalogue } = ctx.controllers;
  const pro = (fields) => ({ plans: [{ code: 'pro', ...fields }], reason: 'x' });
  assert.throws(() => catalogue.save(pro({ monthly: '' }), 'op'), /Prix mensuel de Pro invalide/);
  assert.throws(() => catalogue.save(pro({ monthly: '0' }), 'op'), /Prix mensuel de Pro invalide/);
  assert.throws(() => catalogue.save(pro({ units: '1,5' }), 'op'), /Quota de logements de Pro invalide/);
  assert.throws(() => catalogue.save(pro({ users: 'dix' }), 'op'), /Quota de comptes de Pro invalide/);
  assert.throws(() => catalogue.save({ addons: [{ pluginId: 'neat', price: 'neuf' }], reason: 'x' }, 'op'), /Prix de .* invalide/);
  const v = catalogue.save(pro({ monthly: '64,5', yearly: '54 €', units: '', users: '7' }), 'op');
  const p = v.plans.find((x) => x.code === 'pro');
  assert.deepEqual([p.priceMonthlyCents, p.priceYearlyCents, p.maxUnits, p.maxUsers], [6450, 5400, null, 7]);
  assert.deepEqual([p.monthly, p.yearly, p.units, p.users], ['64,5', '54', '', '7'], 'shown back as the operator types them');
});

test('rules 5, 6 — the impact says every price and quota a draft changes, before saving', () => {
  const { ctx } = makeContext();
  const lines = ctx.controllers.catalogue.impact({
    lowest: ctx.models.catalogue.lowest(),
    plans: [{ code: 'pro', monthly: '69', units: '8' }],
    addons: [{ pluginId: 'neat', price: '9' }],
  }).lines.map((l) => l.replace(/\s/g, ' '));
  assert.deepEqual(lines, [
    'Pro : 59,00 € → 69,00 € HT / mois (nouveaux clients uniquement).',
    'Pro : logements 6 → 8 (tous ses clients).',
    'Option Accès au portail (Sowel) retirée de la vente.',
    'Option Ressources à l’heure retirée de la vente.',
  ]);
});
