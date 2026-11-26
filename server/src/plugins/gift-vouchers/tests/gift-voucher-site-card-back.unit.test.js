// specs/gift-voucher-campaigns.md rule 66 (2026-11-26) — the site draws the voucher's back as the PDF does and writes nothing of it itself: the offer carries the PDF's own
// dimensions and words, each campaign its lines and validity, the preview's QR code points at the site's home, the order status carries the real redemption QR code, and the
// company's logo is served at a hashed address. A company with no website sends no back at all, and the offer still answers.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sale = require('./giftVoucherFixtures');
const campaignRules = require('../campaignRules');
const rules = require('../voucherRules');
const { BACK_LAYOUT, BACK_TEXTS, redeemUrl } = require('../voucherPdf');
const { contentLines } = require('../contentsText');
const sdk = require('../../sdk');

const ORIGIN = 'https://site.example.test';
const ids = fx.seedCatalogue();
const company = { name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', website: ORIGIN, logo: null };
const shop = fx.openShop({ company: async () => company });
const { api, clock } = shop;
const bath = api.campaigns.find(api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value));
const lodging = api.campaigns.firstLodging();

// The company is read once a minute: a suite that changes it moves its clock past that.
const companyChanged = () => { clock.at = new Date(clock.at.getTime() + 5 * 60 * 1000); };

async function withServer(fn) {
  const server = await fx.serve(api);
  const site = (method, url, body, ip = '10.0.6.1') => server.call(method, `/public/v1/gift-vouchers${url}`, body, { 'x-test-ip': ip });
  const raw = async (url) => {
    const res = await fetch(`${server.base}/public/v1/gift-vouchers${url}`);
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  };
  try { await fn(site, raw); } finally { await server.close(); }
}

const offerOf = async (site) => (await site('GET', '/offer')).body.data;
const svgOf = (url) => QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });

async function buy(site, slug, extra = {}) {
  const ip = `10.0.6.${Math.floor(Math.random() * 200) + 2}`;
  const placed = await site('POST', '/orders', {
    slug, recipientName: 'Marie', senderName: 'Paul', email: 'paul@example.test', language: 'fr', termsVersionId: slug === 'bain-jour' ? 9 : 4, ...extra, ...sale.solvedProof({ ip }),
  }, ip);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const { orderId, token } = placed.body.data;
  const { amountCents } = api.orders.find(orderId);
  assert.deepEqual(api.orderPaid({ ref: String(orderId), linkId: 40 + orderId, amountCents }), { effect: 'voucher-issued' });
  return (await site('GET', `/orders/${orderId}?token=${token}`)).body.data;
}

test('rule 66 — the offer sends the PDF\'s own dimensions and words, and the company the back prints', () => withServer(async (site) => {
  const { back } = await offerOf(site);
  assert.deepEqual(back.layout, BACK_LAYOUT);
  assert.deepEqual(back.texts, BACK_TEXTS);
  assert.deepEqual([back.layout.safeMm, back.layout.legalStripMm, back.layout.qrMm, back.layout.logoMm], [5, 5, 23, 12]);
  assert.equal(back.companyName, 'Domaine Solio');
  assert.equal(back.identity, 'Domaine Solio · Saint-Cirq-Lapopie');
  assert.equal(back.website, 'site.example.test');
  assert.equal(back.link, 'site.example.test/bon-cadeau/utiliser');
  assert.equal(back.logoUrl, null);
}));

test('rule 66 — the preview\'s QR code encodes the site\'s home page, never a voucher link', () => withServer(async (site) => {
  const { back } = await offerOf(site);
  assert.equal(back.previewQrSvg, await svgOf(ORIGIN));
  assert.match(back.previewQrSvg, /^<svg/);
}));

test('rule 66 — a campaign\'s lines are the PDF\'s own contentLines of a voucher issued from it', () => withServer(async (site) => {
  const offered = (await offerOf(site)).campaigns.find((c) => c.slug === bath.slug);
  const voucher = (await buy(site, bath.slug)).voucher;
  assert.deepEqual(offered.back.lines, voucher.contentLines);
  assert.deepEqual(offered.back.lines, ['Bain nordique : 2 h en journée', 'Planche apéro']);
}));

test('rule 66 — a lodging campaign sends a template; filled with the amount it is the PDF\'s line', () => withServer(async (site) => {
  const offered = (await offerOf(site)).campaigns.find((c) => c.kind === 'lodging');
  assert.equal(offered.back.lines, undefined);
  const issued = (await buy(site, lodging.slug, { amountCents: 15000 })).voucher;
  assert.deepEqual([offered.back.lineTemplate.replace('{amount}', rules.formatEuros(15000))], issued.contentLines);
  assert.deepEqual(contentLines({ contents: JSON.stringify({ kind: 'lodging' }), amountCents: 15000 }), issued.contentLines);
}));

test('rule 66 — « Valable jusqu\'au » is the issuance\'s expiry for a purchase made today in Paris', () => withServer(async (site) => {
  const offer = await offerOf(site);
  const today = rules.parisDate(clock.at);
  offer.campaigns.forEach((c) => {
    assert.equal(c.back.validUntil, rules.formatFrDate(rules.expiryFor(today, c.validityMonths)), c.slug);
  });
  assert.equal(offer.campaigns.find((c) => c.slug === bath.slug).back.validUntil, '15/11/2027');
}));

test('rule 66 — the order status carries the real redemption QR code, the code only in its fragment', () => withServer(async (site) => {
  const { voucher } = await buy(site, bath.slug);
  const url = redeemUrl({ origin: ORIGIN, linkBase: 'bon-cadeau' }, voucher.code.replace(/-/g, ''));
  assert.equal(voucher.back.qrSvg, await svgOf(url));
  assert.equal(voucher.back.link, 'site.example.test/bon-cadeau/utiliser');
  assert.ok(!voucher.back.link.includes(voucher.code));
  assert.deepEqual(voucher.back.lines, voucher.contentLines);
  assert.equal(voucher.back.validUntil, rules.formatFrDate(voucher.expiresOn));
  assert.notEqual(voucher.back.qrSvg, (await offerOf(site)).back.previewQrSvg);
}));

test('rule 66 — /logo answers 404 without a logo', () => withServer(async (site, raw) => {
  assert.equal((await raw('/logo')).status, 404);
}));

test('rule 66 — /logo answers the PNG at a hashed address, kept for a year; another hash is answered, never kept', () => withServer(async (site, raw) => {
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#336' } }).png().toBuffer();
  company.logo = png;
  companyChanged();
  const { back } = await offerOf(site);
  assert.match(back.logoUrl, /^\/public\/v1\/gift-vouchers\/logo\?v=[0-9a-f]{16}$/);
  const res = await raw(back.logoUrl.replace('/public/v1/gift-vouchers', ''));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(res.buffer, png);
  const stale = await raw('/logo?v=old');
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('cache-control'), 'no-store');
  company.logo = null;
}));

test('rule 66 — a company with no website sends no back, and the offer and the status still answer', () => withServer(async (site) => {
  const { voucher: before } = await buy(site, bath.slug);
  assert.ok(before.back);
  company.website = '';
  companyChanged();
  const offer = await site('GET', '/offer');
  assert.equal(offer.status, 200);
  assert.equal(offer.body.data.back, undefined);
  offer.body.data.campaigns.forEach((c) => assert.equal(c.back, undefined, c.slug));
  const { voucher } = await buy(site, bath.slug);
  assert.equal(voucher.back, undefined);
  assert.ok(voucher.code);
  company.website = ORIGIN;
}));

test('rule 66 — the line pitch the page uses is the one pdfkit sets for the PDF\'s faces', () => {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: [300, 400], margin: 0 });
  const F = sdk.coreModule('pdfFonts').registerFaces(doc);
  const pitch = (face) => Math.round(doc.font(face).fontSize(1000).currentLineHeight()) / 1000;
  assert.equal(pitch(F.regular), BACK_LAYOUT.lineHeight.sans);
  assert.equal(pitch(F.bold), BACK_LAYOUT.lineHeight.sans);
  assert.equal(pitch(F.italic), BACK_LAYOUT.lineHeight.sans);
  assert.equal(pitch(F.serif), BACK_LAYOUT.lineHeight.serif);
});

test('rule 66 — the status also names the campaign and its front, so the page after payment can turn the card to it', () => withServer(async (site) => {
  const { voucher } = await buy(site, bath.slug);
  assert.equal(voucher.back.slug, bath.slug);
  assert.equal(voucher.back.visual.versionId, api.visuals.find(bath.voucherVisualId).current.id);
}));
