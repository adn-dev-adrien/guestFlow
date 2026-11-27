// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 (Q5) — the voucher's back always prints « Valable jusqu'au … »: when the room runs out under the code, the message
// then the contents give way, never the validity.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');
const { picture } = require('./visualFixtures');

const ids = fx.seedCatalogue();

async function recorded(run) {
  const texts = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recordedText(...args) {
    texts.push(String(args[0]));
    return original.apply(this, args);
  };
  try {
    return { result: await run(), texts };
  } finally {
    PDFDocument.prototype.text = original;
  }
}

async function voucherBack({ logo, title, parties }) {
  const bytes = logo ? await picture(300, 300, { format: 'png', background: '#336699' }) : null;
  const { api } = fx.openShop({
    company: async () => ({
      name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', department: 'Lot', website: 'https://site.example.test', logo: bytes,
    }),
  });
  const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, { name: title, title, slug: `back-${Math.random().toString(36).slice(2, 8)}`, periods: ['week'] }), fx.rulesContext(api));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const campaign = api.campaigns.find(api.campaigns.insert(checked.value));
  const issued = api.offerService.issueDirect({
    request: { slug: campaign.slug }, parties, outcome: 'paid', paymentMethod: 'card', actor: 'user:7',
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const voucher = api.vouchers.find(issued.voucherId);
  return recorded(() => api.documents.voucherPdf(voucher));
}

const LONG = {
  recipientFirstName: 'Marie-Charlotte', recipientLastName: 'Durand-Delacroix de Saint-Martin', senderName: 'Jean-Baptiste et Anne-Sophie de la Roche-Guyon',
  message: 'Joyeux anniversaire ma chérie, que cette parenthèse te fasse le plus grand bien, nous t’aimons très fort, à très vite', email: 'p@x.test', language: 'fr',
};

test('with a logo, a two-line title, a two-line subtitle, three lines of contents and a two-line message, the validity is still printed', async () => {
  const { texts } = await voucherBack({
    logo: true, title: 'Une longue parenthèse nordique d’exception au cœur des Cévennes', parties: LONG,
  });
  assert.ok(texts.some((t) => /^Valable jusqu’au /.test(t)), `validity missing from: ${texts.join(' | ')}`);
});

test('without a logo, with a short title, every small line is printed: contents, message and validity', async () => {
  const { texts } = await voucherBack({ logo: false, title: 'Un bain nordique', parties: { ...LONG, senderName: 'Paul', message: 'Joyeux anniversaire' } });
  assert.ok(texts.some((t) => /^Valable jusqu’au /.test(t)));
  assert.ok(texts.some((t) => /Joyeux anniversaire/.test(t)));
  assert.ok(texts.some((t) => /^Votre bon comprend/.test(t)));
});
