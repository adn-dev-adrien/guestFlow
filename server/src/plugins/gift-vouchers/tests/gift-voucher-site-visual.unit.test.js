// specs/gift-voucher-campaigns.md rule 62 — the site shows the front each campaign sells, read from GuestFlow: the offer names its version and size, the public route answers
// a web picture at a versioned address, and nothing but the front of a campaign on sale is ever served.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const { picture } = require('./visualFixtures');
const campaignRules = require('../campaignRules');
const images = require('../visualImages');
const { filesDir } = require('./visualFilesFixture');

const ids = fx.seedCatalogue();
const shop = fx.openShop();
const { api } = shop;
const bath = api.campaigns.find(api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api)).value));

// The shared fixture's front is a stub too short to decode: this suite resizes a real picture.
test.before(async () => {
  const { path: name } = api.visuals.find(bath.voucherVisualId).current;
  fs.writeFileSync(path.join(filesDir(), name), await picture(1240, 1748));
});

async function withServer(fn) {
  const server = await fx.serve(api);
  const raw = async (url) => {
    const res = await fetch(`${server.base}/public/v1/gift-vouchers${url}`);
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  };
  try { await fn(server, raw); } finally { await server.close(); }
}

const frontOf = (offer, slug) => offer.campaigns.find((c) => c.slug === slug).visual;

test('rule 62 — each campaign of the offer names the version and the web size of its front', () => withServer(async (server) => {
  const offer = (await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data;
  const visual = frontOf(offer, bath.slug);
  assert.equal(visual.versionId, api.visuals.find(bath.voucherVisualId).current.id);
  assert.deepEqual([visual.width, visual.height], [720, Math.round((1748 * 720) / 1240)]);
}));

test('rule 62 — the front is a web JPEG 720 px wide, kept for a year at its versioned address', () => withServer(async (server, raw) => {
  const { versionId } = frontOf((await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data, bath.slug);
  const res = await raw(`/campaigns/${bath.slug}/visual?v=${versionId}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const meta = await sharp(res.buffer).metadata();
  assert.deepEqual([meta.format, meta.width], ['jpeg', 720]);
}));

test('rule 62 — a new front in GuestFlow is a new address; the old one still draws today\'s card, never kept', () => withServer(async (server, raw) => {
  const before = frontOf((await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data, bath.slug).versionId;
  const file = await picture(1300, 1832, { background: '#7a2f20' });
  const checked = await images.inspect(file);
  api.visuals.addVersion(bath.voucherVisualId, { path: images.store(file, filesDir(), checked.format), width: checked.width, height: checked.height });
  const after = frontOf((await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data, bath.slug).versionId;
  assert.notEqual(after, before);
  const stale = await raw(`/campaigns/${bath.slug}/visual?v=${before}`);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('cache-control'), 'no-store');
  assert.equal((await raw(`/campaigns/${bath.slug}/visual?v=${after}`)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
}));

test('rule 62 — only the front of a campaign on sale: a draft, an unknown slug and a campaign without a front answer 404 and the offer says null', () => withServer(async (server, raw) => {
  const draft = api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, { slug: 'bain-brouillon', state: 'draft' }), fx.rulesContext(api)).value);
  assert.equal((await raw('/campaigns/bain-brouillon/visual')).status, 404);
  assert.equal((await raw('/campaigns/inconnue/visual')).status, 404);
  const lodging = api.campaigns.firstLodging();
  api.campaigns.update(lodging.id, { ...lodging, voucherVisualId: null });
  const offer = (await server.call('GET', '/public/v1/gift-vouchers/offer')).body.data;
  assert.equal(frontOf(offer, lodging.slug), null);
  assert.equal((await raw(`/campaigns/${lodging.slug}/visual`)).status, 404);
  assert.ok(api.campaigns.find(draft));
}));

test('rule 62 — WordPress proxies the front with its cache header, and the block draws it from the offer, never from a written address', () => {
  const plugin = path.join(__dirname, '../../../../../integrations/wordpress/guestflow-booking');
  const read = (file) => fs.readFileSync(path.join(plugin, file), 'utf8');
  const proxy = read('includes/class-gf-rest-proxy.php');
  assert.match(proxy, /'\/gift-vouchers\/campaigns\/\(\?P<slug>\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\)\/visual'/);
  assert.match(proxy, /strpos\(\$cache, 'immutable'\) !== false \? 'public, max-age=31536000, immutable' : 'no-store'/);
  assert.match(read('includes/class-gf-api-client.php'), /\['application\/pdf', 'image\/jpeg'\]/);
  const view = read('blocks/gift-voucher/view.js');
  assert.match(view, /'\/gift-vouchers\/campaigns\/' \+ encodeURIComponent\(campaign\.slug\) \+ '\/visual\?v=' \+ encodeURIComponent\(visual\.versionId\)/);
  assert.match(view, /img\.addEventListener\('error'/);
});
