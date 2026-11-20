// specs/gift-voucher-campaigns.md rule 53 — the fiche of an outside booking: the client, the session, each line of the sale with what paid it, the payments, the terms accepted, how the
// visit went, and the journal of every event newest first — created (by whom, from which channel), slot held, paid, prepaid tender applied, terms accepted, moved, arrival, option not
// taken, no-show. It names no voucher: a line paid in advance reads the words its instrument gave.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./outsideBookingFixture');

const bath = fx.newResource();
const board = fx.newOption();
const version = fx.publishTerms();

function bookWithHold() {
  fx.offer.hold({
    resourceId: bath, date: fx.DAY, start: '18:00', end: '20:00', ref: 'fiche:hold', now: fx.NOW,
  });
  const quote = fx.offer.quote({
    resourceId: bath, date: fx.DAY, start: '18:00', coveredBand: 'day', coveredMinutes: 120,
  });
  const answer = fx.offer.bookOutside({
    resourceId: bath,
    date: fx.DAY,
    start: '18:00',
    end: '20:00',
    customer: { name: 'Léa Martin', email: 'lea@example.test', phone: '0612345678' },
    fulfilments: [{ role: 'session', ...quote.session.line }],
    lines: [{ articleRef: `option:${board}`, quantity: 1 }],
    tenders: [
      {
        method: 'prepaid', source: 'giftVoucher', ref: 'BC-2026-0001', label: 'Bon cadeau', covers: [{ role: 'session', amountCents: quote.session.coveredCents }, { articleRef: `option:${board}`, amountCents: fx.optionCents(board) }],
      },
      { method: 'card', amountCents: quote.session.supplementCents, source: 'payment-link:7' },
    ],
    holdRef: 'fiche:hold',
    channel: 'mon-bain',
    terms: { versionId: version.id, ip: '203.0.113.9', userAgent: 'test' },
    now: fx.NOW,
  });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  return { ...answer, quote };
}

const booked = bookWithHold();
const row = () => fx.bookings.rawById(booked.bookingId);
const textsOf = (fiche) => fiche.history.map((h) => h.text);

test('the fiche reads the client, the session, the lines with what paid each, the payments and the terms accepted', () => {
  const fiche = fx.fiche.ficheOf(row());
  assert.deepEqual(fiche.client, {
    name: 'Léa Martin', email: 'lea@example.test', phone: '0612345678', clientId: null,
  });
  assert.deepEqual(fiche.sessions.map((s) => [s.date, s.start, s.end, s.resourceName]), [[fx.DAY, '18:00', '20:00', 'Bain nordique']]);
  const session = fiche.lines.find((l) => l.session);
  assert.deepEqual(session.paidBy.map((p) => [p.kind, p.label, p.amountCents]), [['prepaid', 'Bon cadeau', booked.quote.session.coveredCents], ['money', 'CB', booked.quote.session.supplementCents]]);
  const option = fiche.lines.find((l) => l.label === 'Planche apéro');
  assert.deepEqual(option.paidBy.map((p) => [p.kind, p.label]), [['prepaid', 'Bon cadeau']]);
  assert.equal(fiche.totals.remainingCents, 0);
  assert.deepEqual(fiche.payments.map((p) => p.tenders.map((t) => t.label)), [['Bon cadeau'], ['CB']]);
  assert.deepEqual(fiche.terms.map((t) => [t.activity, t.version, t.channel, t.channelLabel]), [['resource', 1, 'mon-bain', 'Mon bain']]);
  assert.deepEqual(fiche.arrival, { state: 'expected', at: null });
});

test('every event of the booking is in the journal, newest first: created, slot held, prepaid applied, paid, terms accepted', () => {
  const texts = textsOf(fx.fiche.ficheOf(row())).reverse();
  assert.ok(texts[0].startsWith('Vente enregistrée'));
  const order = ['Séance réservée par Léa Martin (canal : Mon bain)', 'Créneau retenu de 18:00 à 20:00', 'réglés : Bon cadeau', 'encaissés', 'Conditions générales du bain acceptées (version 1, Mon bain)'];
  let from = 0;
  order.forEach((needle) => {
    const at = texts.findIndex((t, i) => i >= from && t.includes(needle));
    assert.ok(at >= 0, `« ${needle} » is in the journal, after the previous event`);
    from = at;
  });
  const history = fx.fiche.ficheOf(row()).history;
  assert.deepEqual(history.map((h) => h.at), [...history.map((h) => h.at)].sort().reverse(), 'newest first');
});

test('a paid session is not moved by a stroke of the pen, an unpaid one is and says so in its journal', () => {
  const refused = fx.bookings.update(booked.bookingId, { startTime: '19:00', endTime: '21:00' });
  assert.deepEqual([refused.status, refused.code], [409, 'BOOKING_PAID']);
  const made = fx.bookings.createBooking({
    resourceId: bath, date: '2026-11-17', startTime: '10:00', endTime: '12:00', clientName: 'Passant',
  });
  const fresh = fx.bookings.rawById(made.id);
  fx.visits.inTransaction((stop) => fx.visits.ensureDocument(fresh, { actor: 'admin@example.test', stop }));
  const moved = fx.bookings.update(made.id, { startTime: '11:00', endTime: '13:00' });
  assert.equal(moved.ok, true);
  assert.ok(textsOf(fx.fiche.ficheOf(fx.bookings.rawById(made.id))).includes('Séance déplacée : 2026-11-17 10:00–12:00 → 2026-11-17 11:00–13:00'));
});

test('an option not taken, the arrival and a no-show each write a line of the journal; « non pris » names the value and tells no refund', () => {
  const optionLine = fx.visits.documentOf(row()).lines.find((l) => l.label === 'Planche apéro');
  const marked = fx.visits.notTaken(row(), optionLine.id, { actor: 'admin@example.test' });
  assert.deepEqual([marked.ok, marked.valueCents], [true, fx.optionCents(board)]);
  assert.ok(textsOf(fx.fiche.ficheOf(row()))[0].startsWith('« Planche apéro » non pris'));
  assert.equal(fx.fiche.ficheOf(row()).lines.find((l) => l.label === 'Planche apéro').notTaken, true);
  assert.equal(fx.visits.notTaken(row(), optionLine.id, {}).code, 'ALREADY_MARKED');
  fx.visits.commit(row(), {}, { actor: 'admin@example.test' });
  assert.ok(textsOf(fx.fiche.ficheOf(row())).includes('Arrivée enregistrée'));
  assert.deepEqual(fx.fiche.ficheOf(row()).arrival.state, 'arrived');
  const absent = fx.bookCovered({ resourceId: bath, date: '2026-11-17', start: '15:00', ref: 'BC-2026-0003' });
  const second = fx.bookings.rawById(absent.answer.bookingId);
  fx.visits.history(second, 'Client absent');
  assert.equal(textsOf(fx.fiche.ficheOf(second))[0], 'Client absent');
});

test('a booking with no sale document still has a fiche, with its creation as the only line', () => {
  const plain = fx.bookings.createBooking({
    resourceId: bath, date: '2026-11-18', startTime: '10:00', endTime: '11:00', clientName: 'Passant', clientPhone: '0600000000',
  });
  const fiche = fx.fiche.ficheOf(fx.bookings.rawById(plain.id));
  assert.deepEqual([fiche.client.name, fiche.lines, fiche.history.map((h) => h.text)], ['Passant', [], ['Réservation créée']]);
});
