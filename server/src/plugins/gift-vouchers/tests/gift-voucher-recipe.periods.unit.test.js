// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 10, 21 and gift-voucher-campaigns.md rule 10 — a recipe carries the periods a campaign sells and the corner of its front
// price: exported and imported again they come back; a recipe written before them imports with the defaults (both periods, bottom right).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');

const ids = fx.seedCatalogue();
const { api } = fx.openShop();
const insert = (over) => {
  const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, over), { catalogue: api.catalogue, campaigns: api.campaigns, visuals: api.visuals });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return api.campaigns.find(api.campaigns.insert(checked.value));
};
const edited = (buffer, change) => {
  const files = unzipSync(new Uint8Array(buffer));
  const recipe = JSON.parse(strFromU8(files['campaign.json']));
  change(recipe.campaign);
  delete recipe.campaign.images;
  return Buffer.from(zipSync({ ...files, 'campaign.json': strToU8(JSON.stringify(recipe)) }));
};

test('the periods and the corner of the front price round-trip through a recipe', async () => {
  const campaign = insert({ slug: 'bain-weekend', periods: ['weekend'], frontPricePosition: 'top-left' });
  const exported = api.recipe.exportCampaign(campaign);
  assert.equal(exported.ok, true);
  const recipe = JSON.parse(strFromU8(unzipSync(new Uint8Array(exported.buffer))['campaign.json']));
  assert.deepEqual(recipe.campaign.periods, ['weekend']);
  assert.equal(recipe.campaign.frontPricePosition, 'top-left');
  const result = await api.recipe.importArchive(edited(exported.buffer, (c) => { c.slug = 'bain-weekend-importe'; c.name = 'Importé'; }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.campaign.periods, ['weekend']);
  assert.equal(result.campaign.frontPricePosition, 'top-left');
});

test('a recipe written before the weekend grid imports with both periods and the default corner', async () => {
  const campaign = insert({ slug: 'bain-ancien', periods: ['week'], frontPricePosition: 'none' });
  const result = await api.recipe.importArchive(edited(api.recipe.exportCampaign(campaign).buffer, (c) => {
    delete c.periods; delete c.frontPricePosition; c.slug = 'bain-ancien-importe'; c.name = 'Ancien';
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.campaign.periods, ['week', 'weekend']);
  assert.equal(result.campaign.frontPricePosition, 'bottom-right');
});
