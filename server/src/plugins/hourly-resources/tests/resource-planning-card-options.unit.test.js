// specs/gift-vouchers/gift-voucher-campaigns.md rule 35 — the planning card of an outside booking is the preparation ticket: every option of the booking's sale, whoever paid it, and a badge per
// instrument that paid in advance, read from the label its tender carries — hourly-resources names none. The reception reads both (no amount among them).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./outsideBookingFixture');
const { toReceptionPlanningEvent } = require('../../../utils/receptionView');

const bath = fx.newResource();
const board = fx.newOption();
const drink = fx.newOption({ title: 'Boisson', price: 6.5, vatClass: 'catering' });

const eventOf = (id) => fx.bookings.listPlanningEvents('2026-11-01', '2026-12-31').find((e) => e.id === id); // date-literal-ok: the suite runs on its own clock, never the real today

test('a booking paid by a prepaid tender shows its options and the badge of the tender\'s own label', () => {
  const { answer } = fx.bookCovered({ resourceId: bath, optionId: board });
  const event = eventOf(answer.bookingId);
  assert.deepEqual(event.options, [{ label: 'Planche apéro', quantity: 1 }]);
  assert.deepEqual(event.badges, [{ label: 'Bon cadeau' }]);
});

test('every option of the sale is listed, whoever paid it: the one paid in advance and the one the client added and paid by card', () => {
  const quote = fx.offer.quote({
    resourceId: bath, date: fx.DAY, start: '13:00', coveredBand: 'day', coveredMinutes: 120,
  });
  const answer = fx.offer.bookOutside({
    resourceId: bath,
    date: fx.DAY,
    start: '13:00',
    end: '15:00',
    customer: { name: 'Léa', email: 'lea@example.test', phone: '0600000000' },
    fulfilments: [{ role: 'session', ...quote.session.line }],
    lines: [{ articleRef: `option:${board}`, quantity: 1 }, { articleRef: `option:${drink}`, quantity: 2 }],
    tenders: [
      { method: 'prepaid', source: 'giftVoucher', ref: 'BC-2026-0007', label: 'Bon cadeau', covers: [{ role: 'session', amountCents: quote.session.coveredCents }, { articleRef: `option:${board}`, amountCents: fx.optionCents(board) }] },
      { method: 'card', amountCents: fx.optionCents(drink, 2), source: 'payment-link:3' },
    ],
    channel: 'mon-bain',
    now: fx.NOW,
  });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const event = eventOf(answer.bookingId);
  assert.deepEqual(event.options, [{ label: 'Planche apéro', quantity: 1 }, { label: 'Boisson', quantity: 2 }]);
  assert.deepEqual(event.badges, [{ label: 'Bon cadeau' }]);
});

test('a booking with no sale, and one paid by card alone, carry no badge', () => {
  const plain = fx.bookings.createBooking({
    resourceId: bath, date: '2026-11-18', startTime: '10:00', endTime: '11:00', clientName: 'Passant', // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.deepEqual([eventOf(plain.id).options, eventOf(plain.id).badges], [[], []]);
  const quote = fx.offer.quote({
    resourceId: bath, date: '2026-11-18', start: '14:00', coveredBand: 'day', coveredMinutes: 60, // date-literal-ok: the suite runs on its own clock, never the real today
  });
  const card = fx.offer.bookOutside({
    resourceId: bath,
    date: '2026-11-18', // date-literal-ok: the suite runs on its own clock, never the real today
    start: '14:00',
    end: '15:00',
    customer: { name: 'Max', email: 'max@example.test', phone: '0600000001' },
    fulfilments: [{ role: 'session', ...quote.session.line }],
    tenders: [{ method: 'card', amountCents: quote.session.totalCents, source: 'payment-link:4' }],
    channel: 'mon-bain',
    now: fx.NOW,
  });
  assert.deepEqual([eventOf(card.bookingId).options, eventOf(card.bookingId).badges], [[], []]);
});

test('the reception reads the options and the badges of the card, and no amount', () => {
  const { answer } = fx.bookCovered({ resourceId: bath, optionId: board, date: '2026-11-17', start: '16:00', ref: 'BC-2026-0009' }); // date-literal-ok: the suite runs on its own clock, never the real today
  const view = toReceptionPlanningEvent(eventOf(answer.bookingId));
  assert.deepEqual([view.options, view.badges], [[{ label: 'Planche apéro', quantity: 1 }], [{ label: 'Bon cadeau' }]]);
  ['totalPrice', 'paid', 'clientPhone', 'visit'].forEach((leak) => assert.equal(leak in view, false));
});
