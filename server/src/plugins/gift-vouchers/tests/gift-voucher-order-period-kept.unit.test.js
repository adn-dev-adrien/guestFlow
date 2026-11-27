// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md K8 — an order keeps the period it was priced with, even when its campaign later stops offering that period; a lodging (amount)
// campaign prints no « à partir de » on its merchant card.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
const campaign = s.campaign('une-heure', 'day');
const parties = { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'p@x.test', language: 'fr' };

test('K8 — an order priced for the weekend is priced again for the weekend after the campaign stopped offering it', () => {
  const placed = s.api.offerService.createOrder({ request: { slug: 'une-heure', period: 'weekend' }, parties, source: 'site' });
  assert.equal(placed.ok, true, JSON.stringify(placed));
  s.api.campaigns.update(campaign.id, { ...s.api.campaigns.find(campaign.id), periods: ['week'] });
  const order = s.api.orders.find(placed.order.id);
  const again = s.api.offerService.repriceOrder(order);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.totalCents, 7000, 'the weekend price it was sold at');
  assert.equal(JSON.parse(s.db.prepare('SELECT contents FROM gift_voucher_orders WHERE id = ?').get(order.id).contents).resource.period, 'weekend');
});

test('K8 — a lodging (amount) campaign has no price of its own to print: the price the merchant card prints is none', () => {
  const status = s.api.offerService.campaignStatus(s.api.campaigns.firstLodging());
  assert.equal(status.totalCents, null, 'the controller prints a price only for a figure the engine gave');
});
