// specs/gift-voucher-campaigns.md rules 4, 9, 41, 42, 54 — what the back-office screens read from the server: a campaign with its one-line contents and its two permanent paths,
// the catalogue's following-hours sentence, the offer with the means of payment, the voucher list with its contents, campaign, use and the filters by campaign and kind, the detail
// with its frozen contents lines and the amount a cancellation would refund.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');

const ids = fx.seedCatalogue();
const { api } = fx.openShop();

async function withServer(fn) {
  const server = await fx.serve(api);
  try { await fn(server); } finally { await server.close(); }
}

test('a campaign carries its contents in one line and its two permanent paths; the catalogue says each band’s following-hours rate', () => withServer(async (server) => {
  const created = await server.call('POST', '/api/gift-vouchers/campaigns', fx.bathCampaign(ids));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.summary, 'Bain nordique : 2 h en journée · Planche apéro');
  assert.deepEqual(created.body.links, { offer: '/bon-cadeau/offrir/bain-jour', use: '/bon-cadeau/utiliser' });
  const list = (await server.call('GET', '/api/gift-vouchers/campaigns')).body.items;
  const lodging = list.find((c) => c.kind === 'lodging');
  assert.match(lodging.summary, /^Montant libre de .+ à .+$/);
  const bath = (await server.call('GET', '/api/gift-vouchers/catalogue')).body.elements.find((e) => e.id === ids.bath && e.kind === 'resource');
  assert.deepEqual(bath.modes.map((m) => m.followingText), ['puis 45 €/h', 'puis 63 €/h']);
}));

test('the offer carries the means of payment of « Payé »', () => withServer(async (server) => {
  const offer = (await server.call('GET', '/api/gift-vouchers/offer')).body;
  assert.deepEqual(offer.paymentMethods.map((m) => m.value), ['card', 'cash', 'transfer']);
}));

test('the voucher list reads the contents, the campaign and the use of each voucher, filtered by campaign and kind; the detail freezes its lines and its refund', () => withServer(async (server) => {
  const campaign = api.campaigns.list().find((c) => c.slug === 'bain-jour');
  const bath = await server.call('POST', '/api/gift-vouchers', { slug: campaign.slug, outcome: 'paid', paymentMethod: 'card', senderName: 'Paul', recipientName: 'Marie' });
  assert.equal(bath.status, 201, JSON.stringify(bath.body));
  const stay = await server.call('POST', '/api/gift-vouchers', { amountCents: 15000, outcome: 'paid', paymentMethod: 'card' });
  assert.equal(stay.status, 201, JSON.stringify(stay.body));

  const all = (await server.call('GET', '/api/gift-vouchers')).body;
  const row = all.items.find((v) => v.id === bath.body.id);
  assert.deepEqual([row.kind, row.campaignName, row.usedOn, row.bookingId], ['resource', 'Bain journée', null, null]);
  assert.match(row.contentsText, /^Bain nordique : 2 h en journée · Planche apéro$/);
  assert.deepEqual(all.campaigns.map((c) => c.name).sort(), ['Bain journée', all.campaigns.find((c) => c.kind === 'lodging').name].sort());

  const byKind = (await server.call('GET', '/api/gift-vouchers?kind=resource')).body.items;
  assert.deepEqual(byKind.map((v) => v.id), [bath.body.id]);
  const byCampaign = (await server.call('GET', `/api/gift-vouchers?campaignId=${campaign.id}`)).body.items;
  assert.deepEqual(byCampaign.map((v) => v.id), [bath.body.id]);
  assert.equal((await server.call('GET', '/api/gift-vouchers?kind=other')).status, 400);
  assert.equal((await server.call('GET', '/api/gift-vouchers?campaignId=abc')).status, 400);

  assert.deepEqual(bath.body.contentLines.slice(0, 2), ['Bain nordique : 2 h en journée', 'Planche apéro']);
  assert.equal(bath.body.refundCents, bath.body.balanceCents);
  const given = await server.call('POST', '/api/gift-vouchers', { slug: campaign.slug, outcome: 'offered' });
  assert.equal(given.body.refundCents, 0, 'a voucher given away refunds nothing');
}));
