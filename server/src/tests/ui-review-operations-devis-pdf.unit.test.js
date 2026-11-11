// specs/ui-review-2026-10-19-operations.md rules 17-20 — the quote PDF in the « Maison » identity.
// PDFKit encodes glyph indexes, so the document is proven through its pure resolvers and a layout
// trace (`full.__trace`, test-only like `__testCompress`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { generateDevisPdf, __test } = require('../utils/devisPdf');
const { labels } = require('../utils/devisPdfLabels');
const { groupOffered, summarySchedule, PDF_PALETTE } = __test;

const SETTINGS = { companyName: 'Domaine', vatRate: 10, quoteValidityDays: 30 };

function devis(overrides = {}) {
  return {
    kind: 'devis', devisStatus: 'sent', devisNumber: '2026-10-001', createdAt: '2026-09-01', validUntil: '2026-09-30',
    startDate: '2027-05-10', endDate: '2027-05-13', checkInTime: '16:00', checkOutTime: '10:00',
    adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 300, customPrice: null, discountPercent: 0, finalPrice: 300,
    touristTaxTotal: 9, depositAmount: 92.7, depositDueDate: '2026-10-25', balanceAmount: 216.3, balanceDueDate: '2027-04-26',
    cautionAmount: 0,
    property: { id: 1, name: 'Gite' }, client: { firstName: 'Jo', lastName: 'Ng' },
    options: [], resources: [], nights: [],
    ...overrides,
  };
}

test('rule 17 — the palette is the app\'s: fir green, ink, warm paper; no navy', () => {
  assert.equal(PDF_PALETTE.brand, '#2F5D46');
  assert.equal(PDF_PALETTE.ink, '#27251F');
  assert.ok(!Object.values(PDF_PALETTE).some((c) => c.toLowerCase() === '#1a3a5c'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'devisPdf.js'), 'utf8');
  assert.ok(!/1a3a5c/i.test(source), 'no navy left in the renderer');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'fonts', 'SourceSerif4-Semibold.otf.woff2')), 'the serif ships with the server');
});

test('rule 17 — a quote renders with the embedded serif', async () => {
  const buf = await generateDevisPdf(devis(), SETTINGS, null);
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.ok(buf.toString('latin1').includes('SourceSerif4'), 'the serif is embedded');
});

test('rule 18 — offered lines become one row that names them and values them once', () => {
  assert.equal(groupOffered([]), null);
  const g = groupOffered([{ name: 'Linge de lit', real: 28 }, { name: 'Ménage', real: 30.5 }, { name: ' ', real: 9 }]);
  assert.deepEqual(g, { names: 'Linge de lit, Ménage', count: 2, value: 58.5 });
  assert.equal(labels('fr').offeredGroup, 'OFFERT AVEC LE SÉJOUR');
  assert.equal(labels('fr').offeredValue('58,50 €'), 'valeur 58,50 €');
});

test('rule 18 — grouping the offered lines moves no money: same total with or without them', async () => {
  const totals = [];
  const offered = Array.from({ length: 6 }, (_, i) => ({ optionId: i + 1, title: `Option ${i + 1}`, quantity: 1, totalPrice: 0, originalTotalPrice: 20, offered: 1 }));
  await generateDevisPdf(devis({ __trace: (e) => totals.push(e.total) }), SETTINGS, null);
  await generateDevisPdf(devis({ options: offered, __trace: (e) => totals.push(e.total) }), SETTINGS, null);
  assert.deepEqual(totals, [309, 309]);
});

test('rule 19 — the summary block with its total is drawn on page 1, even under a long table', async () => {
  const events = [];
  const many = Array.from({ length: 40 }, (_, i) => ({ optionId: i + 1, title: `Prestation ${i + 1}`, quantity: 1, totalPrice: 10, offered: 0 }));
  await generateDevisPdf(devis({ finalPrice: 700, options: many, __trace: (e) => events.push(e) }), SETTINGS, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].page, 1);
  assert.equal(events[0].total, 709);
});

test('rule 19 — the schedule: acompte then solde, or the single payment of a direct quote', () => {
  const L = labels('fr');
  assert.deepEqual(summarySchedule(devis(), L).map((l) => [l.label, l.amount, l.dueDate]), [
    ['Acompte', 92.7, '2026-10-25'], ['Solde', 216.3, '2027-04-26'],
  ]);
  assert.deepEqual(summarySchedule(devis({ depositAmount: 0, balanceAmount: 309 }), L).map((l) => l.label), ['Paiement intégral']);
  assert.deepEqual(summarySchedule(devis({ platform: 'Booking', depositAmount: 0, balanceAmount: 309 }), L).map((l) => l.label), ['Solde']);
});

test('rule 20 — an expired quote prints its date alone: no « (expiré) » label exists any more', async () => {
  assert.equal(labels('fr').expiredSuffix, undefined);
  assert.equal(labels('en').expiredSuffix, undefined);
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'devisPdf.js'), 'utf8');
  assert.ok(!/expiredSuffix|isPrintedExpired/.test(source));
  const buf = await generateDevisPdf(devis({ validUntil: '2020-01-01' }), SETTINGS, null);
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});

test('rules 17, 28 — a name outside Latin-1 stays in the serif; a glyph it lacks borrows the sans bold', async () => {
  const { serifRuns } = __test;
  assert.deepEqual(serifRuns('Domaine Solio'), [{ font: 'MaisonSerif', text: 'Domaine Solio' }]);
  assert.deepEqual(serifRuns('Łódź Ağaç Čech'), [{ font: 'MaisonSerif', text: 'Łódź Ağaç Čech' }]);
  const runs = serifRuns('Ŧarik Ĳssel');
  assert.equal(runs.map((r) => r.text).join(''), 'Ŧarik Ĳssel');
  assert.deepEqual(runs.filter((r) => r.font === 'MaisonSansBold').map((r) => r.text.trim()), ['Ŧ', 'Ĳ']);
  // A glyph no embedded face has stays in the serif run (rule 29): no standard font any more.
  assert.deepEqual(serifRuns('世 Solio'), [{ font: 'MaisonSerif', text: '世 Solio' }]);
  const buf = await generateDevisPdf(devis(), { ...SETTINGS, companyName: 'Łódź Ağaç Čech' }, null);
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});

test('rules 17, 27 — the embedded fonts ship with their real licence notices', () => {
  for (const file of ['SourceSerif4-OFL.txt', 'SourceSans3-OFL.txt']) {
    const notice = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', file), 'utf8');
    assert.match(notice.split('\n')[0], /^Copyright .*Adobe .*Reserved Font Name .Source./);
    assert.match(notice, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.ok(!/Google Inc/.test(notice.split('\n')[0]));
  }
});
