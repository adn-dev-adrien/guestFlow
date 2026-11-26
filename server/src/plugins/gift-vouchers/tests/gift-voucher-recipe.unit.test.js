// specs/gift-vouchers/gift-voucher-campaigns.md rule 10 — a campaign as a recipe: a .zip holding campaign.json and its images, naming the elements and the tariff mode by their names (never a
// price, never an id); imported all-or-nothing through the same rules as the form — an unknown name is « Article introuvable : … » — the images joining the visual library.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');
const { picture, sendForm } = require('./visualFixtures');

const ids = fx.seedCatalogue();
const shop = fx.openShop();
const { api, db } = shop;
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const snapshot = () => [count('gift_voucher_campaigns'), count('gift_voucher_visuals'), count('gift_voucher_visual_versions')];
const files = () => require('fs').readdirSync(require('./visualFilesFixture').filesDir()).length;

const made = new Map();
/** The bath campaign with its fronts, written once per variant (a slug is taken once). */
function bathWithFronts({ same = false } = {}) {
  if (!made.has(same)) made.set(same, createBath({ same }));
  return made.get(same);
}

async function createBath({ same }) {
  const voucherJpeg = await picture(1300, 1832, { background: '#2f5d50' });
  const merchantPng = await picture(1300, 1832, { format: 'png', background: '#aa5500' });
  const voucherVisual = api.visuals.insert({
    name: 'Façade', use: same ? 'both' : 'voucher', file: { path: require('../visualImages').store(voucherJpeg, require('./visualFilesFixture').filesDir(), 'jpeg'), width: 1300, height: 1832 },
  });
  const merchantVisual = same ? voucherVisual : api.visuals.insert({
    name: 'Carte', use: 'merchant', file: { path: require('../visualImages').store(merchantPng, require('./visualFilesFixture').filesDir(), 'png'), width: 1300, height: 1832 },
  });
  const checked = campaignRules.validateCampaign({
    ...fx.bathCampaign(ids, { slug: same ? 'bain-un' : 'bain-deux' }), voucherVisualId: voucherVisual, merchantVisualId: merchantVisual,
  }, { catalogue: api.catalogue, campaigns: api.campaigns, visuals: api.visuals });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return { campaign: api.campaigns.find(api.campaigns.insert(checked.value)), voucherJpeg, merchantPng };
}

/** The recipe of `campaign` as the files of its archive. */
const unpack = (buffer) => Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buffer))));
const recipeOf = (files) => JSON.parse(strFromU8(files['campaign.json']));
const pack = (recipe, files = {}) => Buffer.from(zipSync({ 'campaign.json': strToU8(JSON.stringify(recipe)), ...files }));
const edited = (exported, change) => {
  const files = unpack(exported);
  const recipe = recipeOf(files);
  change(recipe.campaign);
  return pack(recipe, Object.fromEntries(Object.entries(files).filter(([name]) => name !== 'campaign.json')));
};

test('export: campaign.json names the resource, the options, the add-ons and the band — no price, no id — and the images travel in the archive as uploaded', async () => {
  const { campaign, voucherJpeg, merchantPng } = await bathWithFronts();
  const out = api.recipe.exportCampaign(campaign);
  assert.equal(out.ok, true);
  assert.equal(out.filename, 'bain-deux.zip');
  const files = unpack(out.buffer);
  assert.deepEqual(Object.keys(files).sort(), ['campaign.json', 'images/merchant.png', 'images/voucher.jpg']);
  assert.deepEqual(Buffer.from(files['images/voucher.jpg']), voucherJpeg, 'the image bytes are the uploaded ones');
  assert.deepEqual(Buffer.from(files['images/merchant.png']), merchantPng);
  const recipe = recipeOf(files);
  assert.deepEqual(recipe.campaign, {
    name: 'Bain journée',
    title: 'Un bain nordique',
    kind: 'resource',
    slug: 'bain-deux',
    validityMonths: 12,
    composition: { resource: 'Bain nordique', band: 'day', minutes: 120, options: [{ option: 'Planche apéro', qty: 1 }] },
    addOns: ['Boisson'],
    extraTimeMaxMinutes: 120,
    images: {
      voucher: { name: 'Façade', use: 'voucher', file: 'images/voucher.jpg' },
      merchant: { name: 'Carte', use: 'merchant', file: 'images/merchant.png' },
    },
  });
  const text = strFromU8(files['campaign.json']);
  ['articleRef', 'resourceId', 'Cents', 'price', 'unitCents', 'totalCents'].forEach((word) => assert.equal(text.includes(word), false, word));
});

test('export: a front used for both faces travels once; a lodging or one-shot campaign has no recipe', async () => {
  const { campaign } = await bathWithFronts({ same: true });
  const files = unpack(api.recipe.exportCampaign(campaign).buffer);
  assert.deepEqual(Object.keys(files).sort(), ['campaign.json', 'images/voucher.jpg']);
  assert.deepEqual(recipeOf(files).campaign.images, { voucher: { name: 'Façade', use: 'both', file: 'images/voucher.jpg' } });
  const refused = api.recipe.exportCampaign(api.campaigns.firstLodging());
  assert.deepEqual([refused.ok, refused.code], [false, 'RECIPE_NOT_AVAILABLE']);
  assert.equal(api.recipe.exportCampaign({ ...campaign, oneShot: true }).ok, false);
});

test('import: the names are resolved to this instance’s catalogue, the campaign is a draft, the images join the library and are picked', async () => {
  const { campaign } = await bathWithFronts();
  const exported = api.recipe.exportCampaign(campaign).buffer;
  const before = snapshot();
  const result = await api.recipe.importArchive(edited(exported, (c) => { c.slug = 'bain-importe'; c.name = 'Bain importé'; }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const made = result.campaign;
  assert.deepEqual([made.name, made.slug, made.state, made.kind, made.validityMonths], ['Bain importé', 'bain-importe', 'draft', 'resource', 12]);
  assert.deepEqual(made.composition, { resourceId: ids.bath, band: 'day', minutes: 120, options: [{ articleRef: `option:${ids.board}`, qty: 1 }] });
  assert.deepEqual(made.addOns, [`option:${ids.drink}`]);
  assert.deepEqual(snapshot(), [before[0] + 1, before[1] + 2, before[2] + 2]);
  const voucher = api.visuals.find(made.voucherVisualId);
  const merchant = api.visuals.find(made.merchantVisualId);
  assert.deepEqual([voucher.name, voucher.use, merchant.name, merchant.use], ['Façade', 'voucher', 'Carte', 'merchant']);
  assert.deepEqual([voucher.current.width, voucher.current.height], [1300, 1832]);
});

test('import: a front for both faces is one visual picked for both', async () => {
  const { campaign } = await bathWithFronts({ same: true });
  const before = snapshot();
  const result = await api.recipe.importArchive(edited(api.recipe.exportCampaign(campaign).buffer, (c) => { c.slug = 'bain-meme'; }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.campaign.voucherVisualId, result.campaign.merchantVisualId);
  assert.deepEqual(snapshot(), [before[0] + 1, before[1] + 1, before[2] + 1]);
});

test('import is all-or-nothing: an unknown name is « Article introuvable : … » on its field and nothing is written — no campaign, no visual, no file', async () => {
  const { campaign } = await bathWithFronts();
  const exported = api.recipe.exportCampaign(campaign).buffer;
  const before = snapshot();
  const filesBefore = files();
  const refuse = async (change) => {
    const result = await api.recipe.importArchive(edited(exported, (c) => { c.slug = 'bain-refuse'; change(c); }));
    assert.equal(result.ok, false);
    return result.errors.map((e) => [e.field, e.message]);
  };
  assert.deepEqual(await refuse((c) => { c.composition.resource = 'Jacuzzi du roi'; }), [['composition.resource', 'Article introuvable : Jacuzzi du roi']]);
  assert.deepEqual(await refuse((c) => { c.composition.options[0].option = 'Caviar'; }), [['composition.options[0]', 'Article introuvable : Caviar']]);
  assert.deepEqual(await refuse((c) => { c.addOns = ['Boisson', 'Champagne']; }), [['addOns[1]', 'Article introuvable : Champagne']]);
  assert.deepEqual(await refuse((c) => { c.composition.resource = 'Jacuzzi'; c.addOns = ['Rien']; }), [['composition.resource', 'Article introuvable : Jacuzzi'], ['addOns[0]', 'Article introuvable : Rien']], 'every problem is reported');
  assert.deepEqual(snapshot(), before);
  assert.equal(files(), filesBefore);
});

test('import: the rules of the form apply — a taken slug, a band not offered, a bad validity — and an unfit image is named; nothing is written', async () => {
  const { campaign } = await bathWithFronts();
  const exported = api.recipe.exportCampaign(campaign).buffer;
  const before = snapshot();
  const taken = await api.recipe.importArchive(exported);
  assert.deepEqual(taken.errors.map((e) => e.field), ['slug'], 'the original is still there');
  const months = await api.recipe.importArchive(edited(exported, (c) => { c.slug = 'x-mois'; c.validityMonths = 0; }));
  assert.deepEqual(months.errors.map((e) => e.field), ['validityMonths']);
  const band = await api.recipe.importArchive(edited(exported, (c) => { c.slug = 'x-bande'; c.composition.band = 'night'; }));
  assert.deepEqual(band.errors.map((e) => e.field), ['composition.band']);
  const small = Buffer.from(zipSync({
    'campaign.json': strToU8(JSON.stringify({ ...recipeOf(unpack(exported)), campaign: { ...recipeOf(unpack(exported)).campaign, slug: 'x-petit' } })),
    'images/voucher.jpg': new Uint8Array(await picture(600, 800)),
    'images/merchant.png': new Uint8Array(await picture(1300, 1832, { format: 'png' })),
  }));
  const tooSmall = await api.recipe.importArchive(small);
  assert.deepEqual(tooSmall.errors.map((e) => [e.field, e.message]), [['images.voucher', 'images/voucher.jpg : Image trop petite ou mal proportionnée : 600 × 800 px. Il faut au moins 1240 × 1748 px, format A6 portrait.']]);
  const missing = await api.recipe.importArchive(pack({ ...recipeOf(unpack(exported)), campaign: { ...recipeOf(unpack(exported)).campaign, slug: 'x-absent' } }));
  assert.deepEqual(missing.errors.map((e) => e.field), ['images.voucher', 'images.merchant'], 'the archive lacks the images it names');
  const traversal = await api.recipe.importArchive(edited(exported, (c) => { c.slug = 'x-chemin'; c.images.voucher.file = '../../etc/passwd'; }));
  assert.equal(traversal.errors[0].field, 'images.voucher');
  assert.deepEqual(snapshot(), before);
});

test('import: what is not a recipe is refused with a sentence', async () => {
  const refused = async (buffer) => (await api.recipe.importArchive(buffer)).errors.map((e) => [e.field, e.message]);
  assert.deepEqual(await refused(Buffer.from('plain text')), [['archive', 'Ce fichier n’est pas une recette : une archive .zip est attendue.']]);
  assert.deepEqual(await refused(Buffer.from(zipSync({ 'other.txt': strToU8('x') }))), [['archive', 'Cette archive ne contient pas de campaign.json lisible.']]);
  assert.deepEqual(await refused(Buffer.from(zipSync({ 'campaign.json': strToU8('{oops') }))), [['archive', 'campaign.json n’est pas un JSON valide.']]);
  assert.match((await refused(pack({ format: 'tariff-recipe', version: 1, campaign: {} })))[0][1], /n’est pas une recette de campagne/);
});

test('the routes: the recipe downloads as a .zip, an import answers the draft with 201 or the field of each problem with 422', async () => {
  const { campaign } = await bathWithFronts();
  const server = await fx.serve(api);
  try {
    const down = await fetch(`${server.base}/api/gift-vouchers/campaigns/${campaign.id}/recipe.zip`);
    assert.equal(down.status, 200);
    assert.equal(down.headers.get('content-type'), 'application/zip');
    assert.match(down.headers.get('content-disposition'), /bain-deux\.zip/);
    const archive = Buffer.from(await down.arrayBuffer());
    const up = (file) => sendForm(server, 'POST', '/api/gift-vouchers/campaigns/import', { file, filename: 'recette.zip', type: 'application/zip' });
    const refused = await up(edited(archive, (c) => { c.slug = 'bain-http'; c.composition.resource = 'Inconnu'; }));
    assert.deepEqual([refused.status, refused.body.error, refused.body.errors[0].field], [422, 'Article introuvable : Inconnu', 'composition.resource']);
    const made = await up(edited(archive, (c) => { c.slug = 'bain-http'; }));
    assert.deepEqual([made.status, made.body.state, made.body.slug, made.body.pricing.priceable], [201, 'draft', 'bain-http', true]);
    assert.equal((await sendForm(server, 'POST', '/api/gift-vouchers/campaigns/import', {})).status, 400);
    const lodging = await fetch(`${server.base}/api/gift-vouchers/campaigns/${api.campaigns.firstLodging().id}/recipe.zip`);
    assert.equal(lodging.status, 409);
  } finally {
    await server.close();
  }
});
