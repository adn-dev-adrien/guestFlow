// specs/gift-voucher-campaigns.md rule 12 — a voucher pays only for its kind: a `lodging` voucher is refused on a resource, a `resource` voucher on a stay and on any other
// resource than its own, each with its sentence (the resource's name is read). The plugin's `apply` receives the consumer's kind — `lodging` from the booking engine (the
// default, so the engine needs no change), `resource:<id>` from a resource's page — through the core's generic `prepaidSources.apply`. (The « Mon bain » booking is a later step.)
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sdk = require('../../sdk');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const campaignRules = require('../campaignRules');
const prepaidSources = require('../../../utils/prepaidSources');

const ids = fx.seedCatalogue();
const { api } = fx.openShop();
api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), { catalogue: api.catalogue, campaigns: api.campaigns }).value);

const issue = (request) => {
  const out = api.offerService.issueDirect({
    request, parties: { recipientName: '', senderName: 'Paul', message: '', email: '', language: 'fr' }, outcome: 'paid', paymentMethod: 'cash', actor: 'user:7',
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  const read = sdk.coreModule('encryption').safeDecrypt(api.vouchers.find(out.voucherId).codeEncrypted);
  return { id: out.voucherId, code: read.value };
};
const lodgingVoucher = issue({ amountCents: 15000 });
const bathVoucher = issue({ slug: 'bain-jour' });
const apply = (voucher, consumer) => api.redemption.apply({
  devisId: 1, input: { code: voucher.code }, capCents: 20000, visitor: { ip: '10.0.0.9' }, dryRun: true, ...(consumer === undefined ? {} : { consumer }),
});

test('a lodging voucher pays a stay — by default, as the booking engine asks — and is refused on a resource, naming it', () => {
  assert.equal(apply(lodgingVoucher).ok, true);
  assert.equal(apply(lodgingVoucher, 'lodging').ok, true);
  assert.deepEqual(apply(lodgingVoucher, `resource:${ids.bath}`), {
    ok: false, status: 409, code: 'VOUCHER_WRONG_KIND', message: 'Ce bon est valable pour un séjour dans nos logements, pas pour « Bain nordique ».',
  });
});

test('a composed voucher is refused on a stay, and on any other resource than its own; its own resource passes the kind check', () => {
  assert.deepEqual(apply(bathVoucher), {
    ok: false, status: 409, code: 'VOUCHER_WRONG_KIND', message: 'Ce bon est valable pour « Bain nordique », pas pour un séjour.',
  });
  assert.equal(apply(bathVoucher, 'lodging').code, 'VOUCHER_WRONG_KIND');
  assert.equal(apply(bathVoucher, `resource:${ids.sauna}`).message, 'Ce bon est valable pour « Bain nordique », pas pour « Sauna sans carte ».');
  assert.equal(apply(bathVoucher, `resource:${ids.bath}`).code, undefined, 'the kind is right: what the page does with it is the later step');
});

test('a refusal holds nothing: no movement is written on the voucher', () => {
  const before = api.movements.list(bathVoucher.id).length;
  api.redemption.apply({
    devisId: 5, input: { code: bathVoucher.code }, capCents: 20000, visitor: { ip: '10.0.0.9' }, consumer: 'lodging',
  });
  assert.equal(api.movements.list(bathVoucher.id).length, before);
  assert.equal(api.vouchers.find(bathVoucher.id).balanceCents, api.vouchers.find(bathVoucher.id).amountCents);
});

test('the core carries the consumer to the plugin that owns the instrument, and reads a stay when none is named', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('gift-vouchers', {}).prepaid({
    source: 'giftVoucher',
    label: 'Bon cadeau',
    apply: (args) => api.redemption.apply(args),
    held: () => null,
    settle: () => null,
    release: () => {},
  });
  const ask = (voucher, options = {}) => prepaidSources.apply(null, { kind: 'giftVoucher', code: voucher.code }, {
    capCents: 20000, visitor: { ip: '10.0.0.9' }, dryRun: true, ...options,
  });
  assert.equal(ask(lodgingVoucher).ok, true);
  assert.equal(ask(bathVoucher).code, 'VOUCHER_WRONG_KIND');
  assert.equal(ask(bathVoucher, { consumer: `resource:${ids.bath}` }).ok, true);
  assert.equal(ask(lodgingVoucher, { consumer: `resource:${ids.bath}` }).code, 'VOUCHER_WRONG_KIND');
});

test('the public check says the kind of a usable code, so a page can send the visitor to the right place', async () => {
  const server = await fx.serve(api);
  try {
    const sale = require('./giftVoucherFixtures');
    const check = async (voucher, ip) => (await server.call('POST', '/public/v1/gift-vouchers/check', { code: voucher.code, ...sale.solvedProof({ ip }) }, { 'x-test-ip': ip })).body.data;
    assert.deepEqual([(await check(lodgingVoucher, '10.0.2.1')).kind, (await check(bathVoucher, '10.0.2.2')).kind], ['lodging', 'resource']);
  } finally {
    await server.close();
  }
});
