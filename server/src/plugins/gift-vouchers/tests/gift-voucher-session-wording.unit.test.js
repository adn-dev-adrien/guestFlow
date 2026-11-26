// specs/gift-voucher-campaigns.md rules 17, 21 (fixed 2026-11-24) — a voucher for a session reads as one: its price lines name the band, never the
// placeholder hours of a dateless quote; the page after the payment draws what the voucher holds, not its amount; and the WordPress block never
// tells a bath buyer « un montant au choix… en une ou plusieurs fois ».
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sale = require('./giftVoucherFixtures');
const campaignRules = require('../campaignRules');

const ids = fx.seedCatalogue();
const shop = fx.openShop();
const { api } = shop;
const bath = api.campaigns.find(api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value));

const PLUGIN = path.join(__dirname, '../../../../../integrations/wordpress/guestflow-booking');
const read = (file) => fs.readFileSync(path.join(PLUGIN, file), 'utf8');
const CLOCK = /\d{2}:\d{2}/;

async function withServer(fn) {
  const server = await fx.serve(api);
  const site = (method, url, body, ip = '10.0.3.1') => server.call(method, `/public/v1/gift-vouchers${url}`, body, { 'x-test-ip': ip });
  try { await fn(site); } finally { await server.close(); }
}

test('rule 17 — the price of a bath voucher names its band, never the hours it was priced on', () => withServer(async (site) => {
  const priced = await site('POST', '/offer/price', { slug: bath.slug });
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  const session = priced.body.data.lines.find((line) => line.kind === 'session');
  assert.ok(session, 'a session line');
  assert.doesNotMatch(session.detail || '', CLOCK);
  assert.match(session.detail, /^Jour · 1 h × /);
}));

test('rule 21 — after the payment, a bath voucher is drawn by its title and contents, read from the voucher', () => withServer(async (site) => {
  const ip = '10.0.3.2';
  const placed = await site('POST', '/orders', {
    slug: bath.slug, recipientName: 'Marie', senderName: 'Paul', email: 'paul@example.test', language: 'fr', termsVersionId: 9, ...sale.solvedProof({ ip }),
  }, ip);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const { orderId, token } = placed.body.data;
  const { amountCents } = api.orders.find(orderId);
  assert.deepEqual(api.orderPaid({ ref: String(orderId), linkId: 31, amountCents }), { effect: 'voucher-issued' });
  const page = await site('GET', `/orders/${orderId}?token=${token}`);
  const { voucher } = page.body.data;
  assert.deepEqual([voucher.kind, voucher.title], ['resource', 'Un bain nordique']);
  assert.deepEqual(voucher.contentLines, ['Bain nordique : 2 h en journée', 'Planche apéro']);
  await api.receipt.idle();
}));

test('rules 17, 21, 66 — the WordPress block picks the session wording for a bath voucher: the intro, and a back that holds the contents, never an amount', () => {
  const blocks = read('includes/class-gf-blocks.php');
  const view = read('blocks/gift-voucher/view.js');
  assert.match(blocks, /'gvIntroSession'\s*=> __\('Valable %d mois à compter du paiement, pour une séance à réserver en ligne\.'/);
  assert.match(view, /GF\.t\(isResource \? 'gvIntroSession' : 'gvIntro', months\)/);
  assert.match(view, /var lines = \(b\.lines \|\| \[\]\)\.slice\(\)/);
  assert.match(view, /lines: voucherBack\.lines/);
  const po = read('languages/guestflow-booking-en_GB.po');
  assert.ok(po.includes('msgid "Valable %d mois à compter du paiement, pour une séance à réserver en ligne."'));
});
