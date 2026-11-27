// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 28 — with the hourly plugin switched off, a bath campaign says the bath is unavailable, not « Une séance se réserve au planning ».
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');
const { withdrawHourlyResources, liveHourlyResources } = require('../../../tests/hourlyResourcesFixture');

const ids = fx.seedCatalogue();
const { api } = fx.openShop();
const id = api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, { slug: 'off' }), fx.rulesContext(api)).value);

test('the campaign has a price while the plugin is live, and says the bath is unavailable when it is not', () => {
  assert.equal(api.offerService.campaignStatus(api.campaigns.find(id)).priceable, true);
  withdrawHourlyResources();
  try {
    const status = api.offerService.campaignStatus(api.campaigns.find(id));
    assert.equal(status.priceable, false);
    assert.equal(status.reason, 'Les ressources à l’heure ne sont pas disponibles pour le moment.');
  } finally {
    liveHourlyResources();
  }
});
