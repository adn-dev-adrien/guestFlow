// specs/gift-voucher-campaigns.md rules 15, 35-36 — the mini SAS of an outside visit paid in advance: the lines a prepaid tender paid are a section of their own, titled and marked with the
// words their instrument gave, counted as paid; one of them marked « non pris » is recorded, journaled and told to its instrument through the generic callback, never refunded.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./outsideBookingFixture');
const { createContext } = require('../../sdk/createContext');
const { createVisitController } = require('../visitController');
const { buildRouter } = require('../routes');

const bath = fx.newResource();
const board = fx.newOption();
const told = [];

createContext('instrument', {}).prepaid({
  source: 'giftVoucher',
  label: 'Bon cadeau',
  apply: () => ({ ok: false }),
  held: () => null,
  settle: () => null,
  release: () => {},
  unused: (args) => told.push(args),
  includedTitle: 'Compris dans le bon cadeau',
  paidMark: 'Réglé par bon',
});

const { answer } = fx.bookCovered({ resourceId: bath, optionId: board });
const row = () => fx.bookings.rawById(answer.bookingId);
const view = () => fx.visits.view(row(), { reception: false }).body;

test('the lines paid in advance are a section titled by their instrument, each marked, counted as paid in the recap', () => {
  const visit = view();
  assert.deepEqual(visit.prepaidSections.map((s) => [s.source, s.title, s.mark, s.refs.length]), [['giftVoucher', 'Compris dans le bon cadeau', 'Réglé par bon', 2]]);
  const optionLine = visit.lines.find((l) => l.label === 'Planche apéro');
  assert.deepEqual([optionLine.status, optionLine.settledCents, optionLine.prepaid.mark, optionLine.prepaid.paidCents], ['paid', fx.optionCents(board), 'Réglé par bon', fx.optionCents(board)]);
  assert.equal(visit.totals.remainingCents, 0, 'nothing left to collect: what was paid in advance is paid');
  assert.deepEqual(visit.lines.filter((l) => !l.prepaid), [], 'every line here was paid in advance, in whole or in part');
});

test('a visit with no prepaid tender has no such section', () => {
  const plain = fx.bookings.createBooking({
    resourceId: bath, date: '2026-11-18', startTime: '10:00', endTime: '11:00', clientName: 'Passant', // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.deepEqual(fx.visits.view(fx.bookings.rawById(plain.id), { reception: false }).body.prepaidSections, []);
});

test('a line paid in advance is neither offered nor removed: it is marked « non pris » instead', () => {
  const optionLine = fx.visits.documentOf(row()).lines.find((l) => l.label === 'Planche apéro');
  const offered = fx.visits.patchLine(row(), optionLine.id, { offered: true });
  assert.deepEqual([offered.status, offered.code], [409, 'LINE_PREPAID']);
  const removed = fx.visits.patchLine(row(), optionLine.id, { remove: true });
  assert.equal(removed.code, 'LINE_PREPAID');
});

test('« non pris » records the element and its value, journals it, and tells the instrument — once; the session itself cannot be marked', () => {
  const optionLine = fx.visits.documentOf(row()).lines.find((l) => l.label === 'Planche apéro');
  const sessionLine = fx.visits.documentOf(row()).lines.find((l) => l.fulfilmentRef);
  assert.equal(fx.visits.notTaken(row(), sessionLine.id, {}).code, 'SESSION_LINE');
  const marked = fx.visits.notTaken(row(), optionLine.id, { actor: 'admin@example.test' });
  assert.deepEqual([marked.ok, marked.valueCents], [true, fx.optionCents(board)]);
  assert.deepEqual(told, [{ ref: 'BC-2026-0001', label: 'Planche apéro', valueCents: fx.optionCents(board) }]);
  assert.deepEqual(fx.marks.marksOf(answer.bookingId).map((m) => [m.lineRef, m.label, m.valueCents, m.markedBy]), [[optionLine.ref, 'Planche apéro', fx.optionCents(board), 'admin@example.test']]);
  assert.equal(view().lines.find((l) => l.label === 'Planche apéro').prepaid.notTaken, true);
  assert.equal(fx.visits.notTaken(row(), optionLine.id, {}).code, 'ALREADY_MARKED');
  assert.equal(told.length, 1, 'the instrument is told once');
  assert.equal(view().totals.remainingCents, 0, 'no refund, nothing to collect');
});

test('a line that no prepaid tender paid cannot be marked « non pris »', () => {
  const plain = fx.bookCovered({ resourceId: bath, date: '2026-11-17', start: '12:00', ref: 'BC-2026-0004' }); // date-literal-ok: the suite runs on its own clock, never the real today
  const second = fx.bookings.rawById(plain.answer.bookingId);
  const sold = fx.standaloneSale.sell({ saleId: fx.visits.saleIdOf(second), lines: [{ articleRef: `option:${board}`, quantity: 1 }] });
  assert.equal(sold.status, 200);
  const extra = fx.visits.documentOf(second).lines.find((l) => l.label === 'Planche apéro');
  assert.equal(fx.visits.notTaken(second, extra.id, {}).code, 'LINE_NOT_PREPAID');
});

test('the route is the visit controller\'s: POST /:id/visit/lines/:lineId/not-taken, answering the visit', async () => {
  const controller = createVisitController({ bookings: () => fx.bookings, visits: () => fx.visits, invoicing: null });
  const stack = buildRouter(() => ({}), () => controller).stack.map((layer) => layer.route).filter(Boolean);
  assert.ok(stack.some((r) => r.path === '/:id/visit/lines/:lineId/not-taken' && r.methods.post));
  assert.ok(stack.some((r) => r.path === '/:id/fiche' && r.methods.get));
});
