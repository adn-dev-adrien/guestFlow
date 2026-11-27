// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 18-21 — the two backs on a white ground (the voucher's carries the campaign's title with its period and the printed code, the
// merchant card's an empty code rectangle) and the « à partir de » price GuestFlow draws on the merchant card's front, in the corner the campaign chose, « Aucun » drawing nothing.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { requirePlugins } = require('../plugins/sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('../plugins/gift-vouchers/tests/campaignFixtures');
const campaignRules = require('../plugins/gift-vouchers/campaignRules');
const images = require('../plugins/gift-vouchers/visualImages');
const { picture } = require('../plugins/gift-vouchers/tests/visualFixtures');
const { filesDir } = require('../plugins/gift-vouchers/tests/visualFilesFixture');
const { companyDepartment } = { companyDepartment: require('../plugins/gift-vouchers/companyProfile').departmentOf };

const MM = 72 / 25.4;
const ids = fx.seedCatalogue();
const { api, db } = fx.openShop();
db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 70, hourlyExternalWeekendNextDayRate = 60 WHERE id = ?').run(ids.bath);
const insert = (over) => {
  const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, { periods: ['week', 'weekend'], ...over }), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return api.campaigns.find(api.campaigns.insert(checked.value));
};

async function recorded(run) {
  const calls = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recordedText(...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  try {
    const result = await run();
    return { result, calls, texts: calls.map(([str]) => String(str)) };
  } finally {
    PDFDocument.prototype.text = original;
  }
}

async function withVisual(campaign) {
  const bytes = await picture(1300, 1832, { format: 'png', background: '#aa5500' });
  const visualId = api.visuals.insert({ name: `Carte ${campaign.slug}`, use: 'merchant', file: { path: images.store(bytes, filesDir(), 'png'), width: 1300, height: 1832 } });
  return api.campaigns.update(campaign.id, { ...api.campaigns.find(campaign.id), merchantVisualId: visualId });
}

const priceOf = (campaign) => {
  const status = api.offerService.campaignStatus(campaign);
  return status.totalCents;
};

test('rule 21 — the merchant front carries « à partir de » and the lowest price of the campaign, the cheapest period', async () => {
  const campaign = await withVisual(insert({ slug: 'prix-un' }));
  assert.equal(priceOf(campaign), 10900, 'the week price is the lowest: 2 h and a board');
  const { texts } = await recorded(() => api.documents.merchantCardPdf(campaign, { fromCents: priceOf(campaign) }));
  assert.ok(texts.includes('à partir de'));
  assert.ok(texts.includes('109 €'), `the price is written whole: ${texts.filter((t) => /€/.test(t))}`);
});

test('rule 21 — a whole price is written without cents, and the front shows the price at the corner the campaign chose, inside the safe area', async () => {
  const campaign = await withVisual(insert({ slug: 'prix-deux', frontPricePosition: 'top-left' }));
  const { calls } = await recorded(() => api.documents.merchantCardPdf(campaign, { fromCents: 5000 }));
  const small = calls.find(([str]) => str === 'à partir de');
  const price = calls.find(([str]) => str === '50 €');
  assert.ok(small && price);
  const slug = 5 * MM;
  const trimLeft = slug + 3 * MM;
  assert.ok(small[1] >= trimLeft + 5 * MM - 0.5 && small[2] >= trimLeft + 5 * MM - 0.5, 'in the top-left corner of the safe area, never in the bleed');
});

test('rule 21 — « Aucun » draws nothing, and so does a campaign with no price', async () => {
  const none = await withVisual(insert({ slug: 'prix-trois', frontPricePosition: 'none' }));
  const { texts } = await recorded(() => api.documents.merchantCardPdf(none, { fromCents: 5000 }));
  assert.equal(texts.includes('à partir de'), false);
  const noPrice = await withVisual(insert({ slug: 'prix-quatre' }));
  assert.equal((await recorded(() => api.documents.merchantCardPdf(noPrice))).texts.includes('à partir de'), false);
});

test('rule 21 — the position is one of five, and the default is the bottom right', () => {
  const checked = (frontPricePosition) => campaignRules.validateCampaign(fx.bathCampaign(ids, { slug: 'pos', frontPricePosition }), fx.rulesContext(api));
  ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'none'].forEach((position) => assert.equal(checked(position).value.frontPricePosition, position));
  assert.equal(checked(undefined).value.frontPricePosition, 'bottom-right');
  assert.equal(checked('middle').errors[0].field, 'frontPricePosition');
});

test('rule 21 — the voucher\'s front (the mail) carries no price', async () => {
  const campaign = insert({ slug: 'bon-sans-prix' });
  const issued = api.offerService.issueDirect({
    request: { slug: campaign.slug, period: 'week' },
    parties: { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: '', language: 'fr' },
    outcome: 'paid',
    paymentMethod: 'cash',
    actor: 'user:7',
  });
  const { texts } = await recorded(() => api.documents.voucherPdf(api.vouchers.find(issued.voucherId)));
  assert.equal(texts.includes('à partir de'), false);
  assert.ok(texts.some((t) => t.includes('Un bain nordique · semaine')), 'the title of the back says the period');
});

test('rule 18 — the footer reads « company · town · department », the department from the postcode', () => {
  assert.equal(companyDepartment('12 chemin du Lac\n07120 Ruoms'), 'Ardèche');
  assert.equal(companyDepartment('1 rue\n46330 Saint-Cirq-Lapopie'), 'Lot');
  assert.equal(companyDepartment('1 rue\n20200 Bastia'), 'Haute-Corse');
  assert.equal(companyDepartment('1 rue\n20090 Ajaccio'), 'Corse-du-Sud');
  assert.equal(companyDepartment('pas d’adresse'), '');
});
