// specs/gift-voucher-campaigns.md rule 9 — `GET /public/v1/gift-vouchers/links/:slug`: the target a permanent link `/<base>/offrir/<slug>` leads to, asked by the WordPress connector.
// The purchase page opened on the campaign; nothing for a campaign that is unknown, a one-shot, a draft or closed (the connector then falls back to the purchase page itself).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');

const ids = fx.seedCatalogue();
const { api } = fx.openShop();
const add = (over) => api.campaigns.find(api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, over), fx.rulesContext(api)).value));
add();
add({ name: 'Brouillon', slug: 'brouillon', state: 'draft' });
add({ name: 'Fermé', slug: 'ferme', state: 'closed' });

test('a campaign on sale leads to the purchase page, opened on that campaign', async () => {
  const server = await fx.serve(api);
  try {
    const answer = await server.call('GET', '/public/v1/gift-vouchers/links/bain-jour');
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body.data, { target: 'https://site.example.test/bon-cadeau#campagne=bain-jour' });
  } finally {
    await server.close();
  }
});

test('an unknown, draft or closed campaign has no target: 404', async () => {
  const server = await fx.serve(api);
  try {
    for (const slug of ['nope', 'brouillon', 'ferme']) {
      const answer = await server.call('GET', `/public/v1/gift-vouchers/links/${slug}`);
      assert.equal(answer.status, 404, slug);
      assert.equal(answer.body.error.code, 'CAMPAIGN_UNKNOWN', slug);
    }
  } finally {
    await server.close();
  }
});

test('a campaign whose site has no purchase page address has no target either', async () => {
  const { api: bare } = fx.openShop({ pageUrl: () => '' });
  const server = await fx.serve(bare);
  try {
    assert.equal((await server.call('GET', '/public/v1/gift-vouchers/links/sejour')).status, 404);
  } finally {
    await server.close();
  }
});
