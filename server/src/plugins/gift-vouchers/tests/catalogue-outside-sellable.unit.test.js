// specs/gift-vouchers/gift-voucher-campaigns.md rule 65 (completes rules 4 and 64; specs/pricing/pricing-components.md rule 124) — the catalogue says what the engine sells outside a stay: a per-person,
// per-night, percentage or progressive option with no planning card is greyed with the engine's reason; with a planning card it is counted in units and stays sellable. A campaign that
// already carries one is reported (`withdrawn`), never repaired: nothing is removed from it and its save stays refused until the operator removes the option.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');

const ids = fx.seedCatalogue();
const progressive = fx.option({ title: 'Atelier', priceType: 'per_participant_progressive', optionProgressiveTiers: JSON.stringify([{ from: 1, price: 20 }]) });
const perPersonCard = fx.option({ title: 'Massage', priceType: 'per_person', showsPlanningCard: 1, price: 40 });
const { api } = fx.openShop();
const reasonOf = (label) => `Le prix « ${label} » a besoin d’un séjour : il ne se vend pas seul.`;
const byRef = (ref) => api.catalogue.element(ref);

test('rule 65 — a per-person or progressive option with no planning card is greyed with the engine’s reason; with a planning card it stays sellable', () => {
  assert.deepEqual([byRef(`option:${ids.perPerson}`).sellable, byRef(`option:${ids.perPerson}`).reason], [false, reasonOf('par personne')]);
  assert.deepEqual([byRef(`option:${progressive}`).sellable, byRef(`option:${progressive}`).reason], [false, reasonOf('dégressif participants')]);
  assert.deepEqual([byRef(`option:${perPersonCard}`).sellable, byRef(`option:${perPersonCard}`).reason], [true, null]);
  assert.equal(byRef(`option:${ids.drink}`).sellable, true);
});

test('rule 65 — the campaign read reports the options the catalogue no longer sells, in the campaign’s order, and removes nothing', async () => {
  const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, { name: 'Ancienne', slug: 'ancienne' }), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const stored = api.campaigns.find(api.campaigns.insert({
    ...checked.value,
    addOns: [`option:${ids.drink}`, `option:${ids.perPerson}`],
    composition: { ...checked.value.composition, options: [{ articleRef: `option:${progressive}`, qty: 1 }] },
  }));
  const server = await fx.serve(api);
  try {
    const expected = [
      { articleRef: `option:${ids.perPerson}`, label: 'Peignoir', reason: reasonOf('par personne') },
      { articleRef: `option:${progressive}`, label: 'Atelier', reason: reasonOf('dégressif participants') },
    ];
    const read = await server.call('GET', `/api/gift-vouchers/campaigns/${stored.id}`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.withdrawn, expected);
    const list = (await server.call('GET', '/api/gift-vouchers/campaigns')).body.items;
    assert.deepEqual(list.find((c) => c.id === stored.id).withdrawn, expected);
    assert.deepEqual(list.find((c) => c.kind === 'lodging').withdrawn, []);
    assert.deepEqual(read.body.addOns, [`option:${ids.drink}`, `option:${ids.perPerson}`], 'the campaign is never repaired');
    assert.deepEqual(read.body.composition.options, [{ articleRef: `option:${progressive}`, qty: 1 }]);
    const save = await server.call('PUT', `/api/gift-vouchers/campaigns/${stored.id}`, { name: 'Ancienne' });
    assert.equal(save.status, 422, 'the save stays refused until the option is removed (rule 4)');
    const fixed = await server.call('PUT', `/api/gift-vouchers/campaigns/${stored.id}`, { addOns: [`option:${ids.drink}`], composition: { ...stored.composition, options: [] } });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.deepEqual(fixed.body.withdrawn, []);
  } finally {
    await server.close();
  }
});
