// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 12, 20 — the contents of a voucher name the period it was sold for, on every face that lists them (the offer, « Mon bain »,
// the frozen lines of the PDF, the mail and the fiche), the back of a campaign that sells two periods has the lines of each, and the small line of the PDF has no double colon.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');
const { createCardBack } = require('../cardBack');
const { contentLines } = require('../contentsText');

const s = f.setup();
const campaign = s.campaign('une-heure', 'day');
const company = {
  name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', department: 'Lot', website: 'https://site.example.test', logo: null,
};
const cardBack = createCardBack({ company: async () => company, linkBase: () => 'bon-cadeau', baseContents: s.api.offerService.baseContents });

test('the frozen lines of a voucher name its period', () => {
  const week = s.api.vouchers.find(s.sell('une-heure', 'week').id);
  const weekend = s.api.vouchers.find(s.sell('une-heure', 'weekend').id);
  assert.equal(contentLines(week)[0], 'Bain nordique : 1 h en journée · semaine');
  assert.equal(contentLines(weekend)[0], 'Bain nordique : 1 h en journée · week-end');
});

test('« Mon bain » and the offer list the session with its period', async () => {
  const v = s.sell('une-heure', 'weekend');
  const opened = s.api.useService.open({ code: v.code, visitor: f.VISITOR });
  assert.match(opened.data.contents[0].detail, /^1 h en journée · week-end · de /);
  const offered = (await s.api.offerService.offer()).campaigns.find((c) => c.slug === 'une-heure');
  assert.match(offered.contents[0].detail, /^1 h en journée · semaine · de /, 'the offer shows the cheapest period, « à partir de »');
});

test('the back of a campaign that sells two periods has the lines of each, the cheapest as `lines`', async () => {
  const view = (await s.api.offerService.offer()).campaigns.find((c) => c.slug === 'une-heure');
  const back = cardBack.campaign(view, campaign);
  assert.deepEqual(back.linesByPeriod.week, ['Bain nordique : 1 h en journée · semaine']);
  assert.deepEqual(back.linesByPeriod.weekend, ['Bain nordique : 1 h en journée · week-end']);
  assert.deepEqual(back.lines, back.linesByPeriod.week);
});

test('the PDF\'s contents line has a dash after « Votre bon comprend », never a second colon', async () => {
  const v = s.api.vouchers.find(s.sell('une-heure', 'weekend').id);
  const texts = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recorded(...args) { texts.push(String(args[0])); return original.apply(this, args); };
  try {
    await s.api.documents.voucherPdf(v);
  } finally {
    PDFDocument.prototype.text = original;
  }
  assert.ok(texts.some((t) => t === 'Votre bon comprend — Bain nordique : 1 h en journée · week-end'), texts.filter((t) => /comprend/.test(t)).join('|'));
  assert.ok(!texts.some((t) => /comprend : /.test(t)));
});

test('a composition refusal that concerns one period names it; one that concerns both does not', () => {
  const rulesOf = require('../campaignRules');
  const ctx = require('./campaignFixtures').rulesContext(s.api);
  s.db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 0 WHERE id = ?').run(s.ids.bath);
  try {
    const both = rulesOf.validateCampaign(require('./campaignFixtures').bathCampaign(s.ids, { slug: 'refus', periods: ['week', 'weekend'] }), ctx);
    assert.equal(both.ok, false);
    assert.match(both.errors.find((e) => e.field === 'composition.minutes').message, /^Durée incluse : \(week-end\) « Bain nordique » n’a pas de tarif extérieur pour la journée le week-end\.$/);
    const week = rulesOf.validateCampaign(require('./campaignFixtures').bathCampaign(s.ids, { slug: 'refus-semaine', periods: ['week'] }), ctx);
    assert.equal(week.ok, true, JSON.stringify(week.errors));
  } finally {
    s.db.prepare('UPDATE resources SET hourlyExternalWeekendDayRate = 70 WHERE id = ?').run(s.ids.bath);
  }
});
