// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 — the back of a voucher for a stay says how a stay voucher is used (its code fills itself in on the booking page), not
// « Choisissez votre créneau en ligne »: the PDF and the website's back (the lodging campaign's and the issued voucher's) read the same three steps.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const { BACK_TEXTS } = require('../voucherPdf');
const { createCardBack } = require('../cardBack');

fx.seedCatalogue();
const company = {
  name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', department: 'Lot', website: 'https://site.example.test', logo: null,
};
const { api } = fx.openShop({ company: async () => company });
const lodging = api.campaigns.firstLodging();
const cardBack = createCardBack({ company: async () => company, linkBase: () => 'bon-cadeau', baseContents: api.offerService.baseContents });

test('the PDF of a stay voucher prints the stay steps; a session voucher keeps its own', async () => {
  const issued = api.offerService.issueDirect({
    request: { slug: lodging.slug, amountCents: 15000 }, parties: { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'p@x.test', language: 'fr' }, outcome: 'paid', paymentMethod: 'card', actor: 'user:7',
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const texts = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recorded(...args) { texts.push(String(args[0])); return original.apply(this, args); };
  try {
    await api.documents.voucherPdf(api.vouchers.find(issued.voucherId));
  } finally {
    PDFDocument.prototype.text = original;
  }
  BACK_TEXTS.lodgingSteps.forEach((step) => assert.ok(texts.includes(step), step));
  assert.ok(!texts.includes('Choisissez votre créneau en ligne'));
});

test('the website\'s back of a stay sends the stay steps, for the lodging campaign and for the issued voucher', async () => {
  const view = { kind: 'lodging', validityMonths: 12 };
  assert.deepEqual(cardBack.campaign(view, lodging).steps, BACK_TEXTS.lodgingSteps);
  const issued = api.offerService.issueDirect({
    request: { slug: lodging.slug, amountCents: 15000 }, parties: { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'p@x.test', language: 'fr' }, outcome: 'paid', paymentMethod: 'card', actor: 'user:7',
  });
  const back = await cardBack.voucher(api.vouchers.find(issued.voucherId), 'ABCD-EFGH-IJKL-MNOP');
  assert.deepEqual(back.steps, BACK_TEXTS.lodgingSteps);
});
