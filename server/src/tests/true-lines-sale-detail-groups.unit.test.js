// specs/pricing-components.md §3 rules 13 and 85 (mock M6) — the sale detail groups the lines of an article for display: a same-price group reads
// « 3 × 6,50 € (2 lignes) », different prices « 3 : 1 × 6,50 € + 2 × 7,00 € », an offered line stays in its group, the SAS groups per block.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSaleDetail, departureSection } = require('../utils/saleDetail');

const line = (over) => ({
  optionId: 1, title: 'Bière locale', quantity: 1, unitPrice: 6.5, totalPrice: 6.5, inComplement: 1, ...over,
});
const regime = { regime: 'subject', rate: 10 };
const detail = (optionLines, facts = {}) => buildSaleDetail({ quote: { optionLines, resourceLines: [], finalPrice: 100, nights: 2, vatRegime: regime }, facts, platformStay: false });
const keyed = (lineId, over = {}) => ({ lineId, ...(lineId === 1 ? {} : { lineKey: `line:reservation_options:${lineId}` }), ...over });

test('rule 13 — two lines of one price: the compact title « N × prix (2 lignes) »', () => {
  const d = detail([line(keyed(1)), line(keyed(2, { quantity: 2, totalPrice: 13 }))]);
  assert.equal(d.groups.length, 1);
  assert.deepEqual([d.groups[0].label, d.groups[0].count, d.groups[0].totalCents], ['Bière locale', 2, 1950]);
  assert.equal(d.groups[0].title, 'Bière locale — 3 × 6,50 € (2 lignes)');
  assert.deepEqual(d.groups[0].refs, d.lines.filter((l) => l.label === 'Bière locale').map((l) => l.ref));
  assert.deepEqual(d.lines.filter((l) => l.label === 'Bière locale').map((l) => l.groupLabel), ['1 × 6,50 €', '2 × 6,50 €'], 'each line reads on its own inside the group');
});

test('rule 13 — different prices: the detail « 3 : 1 × 6,50 € + 2 × 7,00 € »; an offered line stays in its group at 0 €', () => {
  const d = detail([line(keyed(1)), line(keyed(2, { quantity: 2, unitPrice: 7, totalPrice: 14 })), line(keyed(3, { offered: true, totalPrice: 0, originalTotalPrice: 6.5 }))]);
  assert.equal(d.groups[0].title, 'Bière locale — 4 : 1 × 6,50 € + 2 × 7,00 € + 1 × 6,50 €');
  assert.equal(d.groups[0].count, 3);
  assert.equal(d.groups[0].totalCents, 2050, 'the offered line adds nothing');
  const offered = d.lines.find((l) => l.offered);
  assert.deepEqual([offered.totalCents, offered.grossCents], [0, 650], 'struck through by the client: its catalogue amount stays beside the 0 €');
});

test('rule 13 — an article on one line has no group; hourly lines read « N séances »', () => {
  assert.deepEqual(detail([line(keyed(1))]).groups, []);
  const hours = buildSaleDetail({ quote: { optionLines: [], finalPrice: 100, nights: 2, vatRegime: regime, resourceLines: [
    { resourceId: 5, name: 'Bain nordique', quantity: 1, unitPrice: 40, totalPrice: 40, sessions: [{}], lineId: 1 },
    { resourceId: 5, name: 'Bain nordique', quantity: 1, unitPrice: 40, totalPrice: 40, sessions: [{}], lineId: 2, lineKey: 'line:reservation_resources:2' },
  ] }, facts: {} });
  assert.equal(hours.groups[0].title, 'Bain nordique — 2 séances');
});

test('rule 13 — the SAS departure section groups per block: what is left to collect, and what is already paid', () => {
  const fact = (lineId, settledCents) => ({ lineId, table: 'option', collectAt: 'departure', settledCents, source: 'fiche' });
  const facts = {
    'opt:1': fact(1, 650),
    'line:reservation_options:2': fact(2, 650),
    'line:reservation_options:3': fact(3, 0),
    'line:reservation_options:4': fact(4, 0),
    'line:reservation_options:5': fact(5, 0),
  };
  const section = departureSection(detail([line(keyed(1)), line(keyed(2)), line(keyed(3)), line(keyed(4)), line(keyed(5))], facts));
  assert.deepEqual(section.groups.map((g) => [g.block, g.count, g.totalCents]), [['due', 3, 1950], ['paid', 2, 1300]]);
  assert.deepEqual(section.lines.map((l) => l.block), ['paid', 'paid', 'due', 'due', 'due']);
  const single = departureSection(detail([line(keyed(1)), line(keyed(2))], { 'opt:1': fact(1, 650), 'line:reservation_options:2': fact(2, 0) }));
  assert.deepEqual(single.groups, [], 'one line in each block: nothing to group');
});
