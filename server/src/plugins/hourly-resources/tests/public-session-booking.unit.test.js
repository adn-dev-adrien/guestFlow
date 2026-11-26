// specs/site-outside-resource-booking.md rules 1, 3-9, 11-13, 16-17, 25-27 (§4.4) — the website's booking of a session outside a stay: the resources on offer, the free starts of a
// duration with what each costs (every hour at its own band), the recap, the confirmation that holds the slot and mints the payment link, and the bank's word that books the session.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./outsideBookingFixture');
const { createSessionOrdersModel } = require('../sessionOrdersModel');
const { createPublicSessionService } = require('../publicSessionService');
const { buildPublicSessionController } = require('../publicSessionController');
const { createOutsideOffer } = require('../outsideOffer');
const { createHoldsModel } = require('../holdsModel');

// The evening switch at 20:00, close at 22:00: external rates 50 / 45 (day, first / following hour) and 70 / 63 (evening).
const bath = fx.newResource({ hourlyEveningStart: '20:00', note: 'Au feu de bois', sessionMaxPeople: 8 });
const board = fx.newOption();
const version = fx.publishTerms();
fx.newResource({ name: 'Sauna caché', sellableExternally: 0 });
fx.newResource({ name: 'Salle', priceType: 'per_stay', showsPlanningCard: 0 });

const notices = [];
const mails = [];
const minted = [];
const withdrawn = [];
const orders = createSessionOrdersModel(fx.db, { now: () => fx.NOW });
const service = createPublicSessionService({
  db: fx.db,
  offer: fx.offer,
  orders,
  terms: fx.ctx.terms,
  payments: {
    saleLink: async (sale, options) => { minted.push({ sale, options }); return { linkId: minted.length, url: `https://pay.example.test/${minted.length}` }; },
    refreshLink: async () => 'open',
    withdrawLink: async (linkId) => { withdrawn.push(linkId); return 'cancelled'; },
  },
  engine: { quote: (request) => fx.standaloneSale.quote(request) },
  suggest: () => [{ articleRef: `option:${board}`, label: 'Planche apéro', unitCents: fx.optionCents(board), max: 4 }],
  notify: (notice) => notices.push(notice),
  sendMail: async (mail) => { mails.push(mail); },
  address: () => '1 chemin du Lac',
  companyName: () => 'Solio',
  basketSource: 'outsideSession',
  now: () => fx.NOW,
});

const SECOND_DAY = '2026-11-17'; // date-literal-ok: the suite runs on its own clock, never the real today
const visitor = { ip: '203.0.113.9', userAgent: 'test' };
const startOf = (date, clock) => `${date}T${clock}`;
const contact = {
  firstName: 'Marie', lastName: 'Dupont', email: 'marie@example.test', phone: '06 12 34 56 78', people: 3, termsVersionId: version.id, visitor,
};
const confirm = (over = {}) => service.confirm({
  resourceId: bath, start: startOf(fx.DAY, '19:00'), minutes: 120, ...contact, ...over,
});
const slotsOf = (minutes, date = fx.DAY) => service.slots({
  resourceId: bath, from: date, to: date, minutes,
}).data.days.flatMap((day) => day.slots);
const lapseOrder = (ref) => {
  fx.db.prepare("UPDATE resource_session_orders SET heldUntil = '2000-01-01T00:00:00.000Z' WHERE ref = ?").run(ref);
  fx.db.prepare("UPDATE resource_booking_holds SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE ref = ?").run(`site-session:${ref}`);
};

test('rule 1 — only a banded resource sold outside a stay is on offer, with what the page needs to ask; rule 25 — people up to the resource’s limit, 20 when none is set', () => {
  const [offered, ...others] = service.resources();
  assert.deepEqual(others, []);
  assert.deepEqual(
    [offered.id, offered.name, offered.blurb, offered.fromCents, offered.minMinutes, offered.stepMinutes, offered.maxMinutes, offered.maxPeople, offered.termsVersionId],
    [bath, 'Bain nordique', 'Au feu de bois', 5000, 60, 60, 720, 8, version.id],
  );
  assert.equal(offered.horizonUntil, '2027-02-15'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(offered.addOns.map((a) => [a.articleRef, a.label, a.unitLabel, a.linear]), [[`option:${board}`, 'Planche apéro', 'l’unité', true]]);
  assert.deepEqual(offered.addOns[0].prices.slice(0, 2), [{ qty: 1, cents: fx.optionCents(board) }, { qty: 2, cents: fx.optionCents(board, 2) }], 'the table is the engine’s: the page multiplies nothing');
  assert.equal(offered.addOns[0].maxQty, 4, 'the most the offer allows');
  const free = fx.newResource({ name: 'Bain libre' });
  assert.equal(service.resources().find((r) => r.id === free).maxPeople, 20);
});

test('rules 3, 6, 9 — the free starts of a duration, each with what the whole session costs from it and whether part of it is in the evening', () => {
  const slots = slotsOf(120);
  assert.deepEqual(slots.map((s) => s.start), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']);
  assert.equal(slots.some((s) => s.taken), false, 'nothing is taken yet');
  const at = (start) => slots.find((s) => s.start === start);
  assert.deepEqual([at('10:00').end, at('10:00').dueCents, at('10:00').evening], ['12:00', 9500, false], 'two day hours: 50 + 45');
  assert.deepEqual([at('19:00').dueCents, at('19:00').evening], [11300, true], '19-20 day first hour 50, 20-21 evening following hour 63');
  assert.deepEqual([at('20:00').dueCents, at('20:00').evening], [13300, true], 'evening first hour 70, following hour 63');
  assert.deepEqual(slotsOf(180).map((s) => s.start).slice(-1), ['19:00'], 'a longer session leaves fewer starts: it must end by closing time');
});

test('rule 3 — a duration off the resource’s grid or under its minimum is refused; rule 5 — nothing past the booking horizon', () => {
  const step = service.slots({
    resourceId: bath, from: fx.DAY, to: fx.DAY, minutes: 90,
  });
  assert.deepEqual([step.ok, step.code], [false, 'SESSION_STEP']);
  const short = service.slots({
    resourceId: bath, from: fx.DAY, to: fx.DAY, minutes: 30,
  });
  assert.equal(short.ok, false);
  const beyond = service.slots({
    resourceId: bath, from: '2027-03-01', to: '2027-03-05', minutes: 60, // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.deepEqual([beyond.code, beyond.horizonUntil], ['BEYOND_HORIZON', '2027-02-15']); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(service.slots({
    resourceId: bath, from: fx.DAY, to: '2027-03-30', minutes: 60, // date-literal-ok: the suite runs on its own clock, never the real today
  }).code, 'PERIOD_TOO_LONG');
  assert.equal(service.slots({
    resourceId: 99999, from: fx.DAY, to: fx.DAY, minutes: 60,
  }).code, 'RESOURCE_UNAVAILABLE');
});

test('rule 9 — the recap names each part with its band; rule 11 — every amount is the engine’s, VAT included', () => {
  const answer = service.quote({
    resourceId: bath, start: startOf(fx.DAY, '19:00'), minutes: 120, addOns: [{ articleRef: `option:${board}`, qty: 2 }],
  });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.data.parts, [
    { label: '19:00 – 20:00 · journée', band: 'day', cents: 5000 },
    { label: '20:00 – 21:00 · soirée', band: 'evening', cents: 6300 },
  ]);
  assert.deepEqual([answer.data.date, answer.data.start, answer.data.end], [fx.DAY, '19:00', '21:00']);
  assert.deepEqual(answer.data.extras.map((e) => [e.label, e.qty, e.cents]), [['Planche apéro', 2, fx.optionCents(board, 2)]]);
  assert.equal(answer.data.dueCents, 11300 + fx.optionCents(board, 2));
  assert.ok(answer.data.vat.length > 0 && answer.data.vat.every((row) => row.rate >= 0 && row.cents >= 0));
  assert.equal(service.quote({ resourceId: bath, start: startOf(fx.DAY, '21:00'), minutes: 120 }).code, 'SESSION_AFTER_CLOSE');
  assert.equal(service.quote({
    resourceId: bath, start: startOf(fx.DAY, '10:00'), minutes: 60, addOns: [{ articleRef: 'option:9999', qty: 1 }],
  }).code, 'ADDON_NOT_OFFERED');
});

test('rules 4, 7 — the contact, the party and the terms are judged by the server, each refusal naming its field', async () => {
  const refused = async (over) => { const r = await confirm(over); return [r.code, r.field]; };
  assert.deepEqual(await refused({ firstName: ' ' }), ['NAME_REQUIRED', 'firstName']);
  assert.deepEqual(await refused({ lastName: '' }), ['NAME_REQUIRED', 'lastName']);
  assert.deepEqual(await refused({ email: 'marie@' }), ['EMAIL_INVALID', 'email']);
  assert.deepEqual(await refused({ phone: '12' }), ['PHONE_INVALID', 'phone']);
  assert.deepEqual(await refused({ termsVersionId: null }), ['TERMS_NOT_ACCEPTED', 'terms']);
  assert.deepEqual(await refused({ people: 9 }), ['PEOPLE_INVALID', 'people']);
  assert.deepEqual(await refused({ people: 0 }), ['PEOPLE_INVALID', 'people']);
  assert.equal(minted.length, 0, 'a refused confirmation mints no link and holds nothing');
});

test('rule 12 — confirming holds the slot 15 minutes and mints the online payment link; nothing is booked before the bank confirms', async () => {
  const answer = await confirm({ returnPath: undefined, returnUrl: 'https://site.example.test/reserver/' });
  assert.equal(answer.ok, true);
  assert.deepEqual([answer.data.dueCents, answer.data.payUrl], [11300, 'https://pay.example.test/1']);
  const order = fx.db.prepare('SELECT * FROM resource_session_orders ORDER BY id DESC').get();
  assert.deepEqual([order.state, order.date, order.startTime, order.endTime, order.people, order.dueCents], ['held', fx.DAY, '19:00', '21:00', 3, 11300]);
  assert.deepEqual(minted[0].sale, {
    source: 'outsideSession', ref: order.ref, title: 'Bain nordique · lundi 16 novembre', amountCents: 11300, validityMinutes: 15,
  });
  assert.equal(minted[0].options.redirectUrl, `https://site.example.test/reserver/?gf_session=${order.ref}`);
  assert.equal(fx.holdRows(`site-session:${order.ref}`).length, 1);
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE date = ? AND startTime = ?').get(fx.DAY, '19:00').n, 0, 'no session exists yet');
  assert.ok(!slotsOf(120).filter((s) => !s.taken).some((s) => ['18:00', '19:00', '20:00'].includes(s.start)), 'the held slot is out of the free starts for everyone else');
  assert.deepEqual(slotsOf(120).filter((s) => s.taken).map((s) => [s.start, s.dueCents]), [['18:00', undefined], ['19:00', undefined], ['20:00', undefined]], 'rule 6: they are shown, taken, with no price');
  const taken = await confirm({ start: startOf(fx.DAY, '20:00'), email: 'autre@example.test' });
  assert.equal(taken.code, 'SLOT_TAKEN');
  assert.deepEqual((await service.status(order.ref)).data.state, 'held');
});

test('rules 12, 16, 17, 26, 27 — the bank’s word books the session on the channel site with its people and a card tender, and the visitor gets the mail and the return page', async () => {
  const order = fx.db.prepare("SELECT * FROM resource_session_orders WHERE state = 'held' ORDER BY id DESC").get();
  const outcome = service.paid({ ref: order.ref, linkId: 1, amountCents: order.dueCents });
  assert.deepEqual(outcome, { effect: 'session-booked' });
  const booking = fx.db.prepare('SELECT * FROM resource_bookings WHERE date = ? AND startTime = ?').get(fx.DAY, '19:00');
  assert.deepEqual([booking.people, booking.clientName, booking.endTime], [3, 'Marie Dupont', '21:00']);
  const sale = fx.visits.documentOf(fx.bookings.rawById(booking.id));
  assert.equal(sale.totals.paidCents, 11300);
  assert.equal(sale.totals.remainingCents, 0);
  const history = fx.fiche.ficheOf(fx.bookings.rawById(booking.id));
  assert.equal(history.booking.people, 3);
  assert.ok(history.history.some((h) => h.text.includes('canal : site')), 'the journal names the channel');
  assert.deepEqual(history.terms.map((t) => t.channel), ['site']);
  assert.equal(fx.holdRows(`site-session:${order.ref}`).every((h) => h.releasedAt), true, 'the hold is consumed');
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'marie@example.test');
  assert.match(mails[0].text, /19:00 à 21:00/);
  assert.match(mails[0].text, /3 personnes/);
  assert.match(mails[0].text, /113 €/);
  assert.match(mails[0].text, /1 chemin du Lac/);
  const status = (await service.status(order.ref)).data;
  assert.deepEqual([status.state, status.date, status.start, status.end, status.people, status.recap.dueCents], ['booked', fx.DAY, '19:00', '21:00', 3, 11300]);
  assert.deepEqual(service.paid({ ref: order.ref, linkId: 1, amountCents: order.dueCents }), { effect: 'session-already-booked' }, 'a second callback books nothing');
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE date = ? AND startTime = ?').get(fx.DAY, '19:00').n, 1);
});

test('rule 13 — paid after the 15 minutes lapsed: booked when the slot is still free, else the payment is owed back and the operator told', async () => {
  const late = await confirm({ start: startOf(SECOND_DAY, '10:00') });
  const lateRef = fx.db.prepare('SELECT ref FROM resource_session_orders ORDER BY id DESC').get().ref;
  lapseOrder(lateRef);
  assert.equal(service.lapseDue(), 1);
  assert.equal(fx.db.prepare('SELECT state FROM resource_session_orders WHERE ref = ?').get(lateRef).state, 'lapsed');
  assert.ok(withdrawn.length >= 1, 'the link of a lapsed order is withdrawn');
  assert.deepEqual(service.paid({ ref: lateRef, linkId: 5, amountCents: late.data.dueCents }), { effect: 'session-booked' }, 'the slot was still free');

  const lost = await confirm({ start: startOf(SECOND_DAY, '14:00'), email: 'perdu@example.test' });
  const lostRef = fx.db.prepare('SELECT ref FROM resource_session_orders ORDER BY id DESC').get().ref;
  lapseOrder(lostRef);
  service.lapseDue();
  fx.bookings.createBooking({
    resourceId: bath, date: SECOND_DAY, startTime: '14:00', endTime: '16:00', clientName: 'Passant',
  });
  notices.length = 0;
  const outcome = service.paid({ ref: lostRef, linkId: 6, amountCents: lost.data.dueCents });
  assert.deepEqual([outcome.refundOwed, outcome.reason], [true, 'créneau pris entre-temps']);
  assert.equal(fx.db.prepare('SELECT state FROM resource_session_orders WHERE ref = ?').get(lostRef).state, 'refund_owed');
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /^Paiement à rembourser · Bain nordique$/);
  assert.equal(service.paid({ ref: 'inconnue', linkId: 7, amountCents: 1 }).refundOwed, true);
  const wrong = await confirm({ start: startOf(SECOND_DAY, '17:00'), email: 'autre@example.test' });
  const wrongRef = fx.db.prepare('SELECT ref FROM resource_session_orders ORDER BY id DESC').get().ref;
  assert.equal(service.paid({ ref: wrongRef, linkId: 8, amountCents: wrong.data.dueCents - 100 }).refundOwed, true, 'an amount that is not the price is not honoured');
});

test('rule 16 — the return page of an unknown or malformed reference is a 404, nothing else', async () => {
  const unknown = await service.status('0'.repeat(32));
  assert.deepEqual([unknown.ok, unknown.status, unknown.code], [false, 404, 'ORDER_NOT_FOUND']);
  assert.equal((await service.status('1 OR 1=1')).code, 'ORDER_NOT_FOUND');
});

test('rule 8 — the confirmation asks for the proof of work and answers its refusal with a code, before anything is held', async () => {
  const calls = [];
  const sent = [];
  const controller = buildPublicSessionController({
    service: { confirm: async (request) => { calls.push(request); return { ok: true, data: {} }; } },
    proof: () => ({ ok: false }),
    respond: { ok: (res, data) => { sent.push(['ok', data]); }, fail: (res, status, code) => { sent.push(['fail', status, code]); } },
    siteOrigin: () => 'https://site.example.test',
  });
  const res = { set() {} };
  await controller.confirm({ body: { start: startOf(fx.DAY, '10:00') }, visitor }, res);
  assert.deepEqual(sent, [['fail', 422, 'PROOF_INVALID']], 'a proof refused gives its hit back to the booking-request budget, like any answer the visitor corrects');
  assert.deepEqual(calls, []);
});

test('rule 26 — the people of a session may be corrected on its fiche, as a whole number from 1 to 100, without touching its price', () => {
  const made = fx.bookings.createBooking({
    resourceId: bath, date: '2026-11-18', startTime: '10:00', endTime: '11:00', clientName: 'Passant', // date-literal-ok: the suite runs on its own clock, never the real today
  });
  const price = fx.bookings.rawById(made.id).totalPrice;
  assert.deepEqual(fx.bookings.setPeople(made.id, 5), { ok: true, people: 5 });
  assert.equal(fx.bookings.rawById(made.id).people, 5);
  assert.equal(fx.bookings.setPeople(made.id, '6').people, 6);
  assert.equal(fx.bookings.setPeople(made.id, 0).status, 400);
  assert.equal(fx.bookings.setPeople(made.id, 'beaucoup').status, 400);
  assert.equal(fx.bookings.setPeople(made.id, 101).status, 400);
  assert.equal(fx.bookings.setPeople(9999, 2).status, 404);
  assert.deepEqual(fx.bookings.setPeople(made.id, null), { ok: true, people: null });
  assert.equal(fx.bookings.rawById(made.id).people, null);
  assert.equal(fx.bookings.rawById(made.id).totalPrice, price);
  assert.equal(fx.bookings.update(made.id, { notes: 'Une note' }).ok, true);
  assert.equal(fx.bookings.setPeople(made.id, 3).ok, true);
  assert.equal(fx.bookings.update(made.id, { notes: 'Autre' }).ok, true);
  assert.equal(fx.bookings.rawById(made.id).people, 3, 'an update of the booking leaves the people alone');
});

test('rule 23 — bookOutside tells the operator of the sessions of the channels site and mon-bain once they are written, and of no other channel', () => {
  const told = [];
  const announcing = createOutsideOffer({
    db: fx.db, bookings: () => fx.bookings, occupancy: fx.occupancy, holds: createHoldsModel(fx.db), terms: fx.ctx.terms, notify: (notice) => told.push(notice), now: () => fx.NOW,
  });
  const book = (channel, start) => {
    const quote = announcing.quote({
      resourceId: bath, date: '2026-11-19', start, coveredBand: 'day', coveredMinutes: 60, extraMinutes: 0, // date-literal-ok: the suite runs on its own clock, never the real today
    });
    return announcing.bookOutside({
      resourceId: bath,
      date: '2026-11-19', // date-literal-ok: the suite runs on its own clock, never the real today
      start,
      end: quote.endTime,
      customer: { name: 'Léa Martin', email: 'lea@example.test', phone: '0612345678' },
      people: 2,
      fulfilments: [{ role: 'session', ...quote.session.line }],
      tenders: [{ method: 'card', amountCents: quote.session.totalCents, source: 'payment-link:9' }],
      channel,
      now: fx.NOW,
    });
  };
  assert.equal(book('site', '10:00').ok, true);
  assert.equal(book('mon-bain', '12:00').ok, true);
  assert.equal(book('guest-app', '14:00').ok, true);
  assert.deepEqual(told.map((t) => [t.channel, t.title, t.body.endsWith('Léa M., 2 pers. · 50 € payés')]), [
    ['online-sales', 'Séance réservée en ligne · Bain nordique', true],
    ['online-sales', 'Séance réservée en ligne · Bain nordique', true],
  ]);
  assert.match(told[0].url, /^\/passages\/\d+$/);
  const refused = announcing.bookOutside({
    resourceId: bath, date: '2026-11-19', start: '10:00', end: '11:00', customer: { name: 'Autre' }, fulfilments: [], tenders: [], channel: 'site', now: fx.NOW, // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.equal(refused.ok, false);
  assert.equal(told.length, 2, 'a booking that fails tells nobody');
});

test('rule 12 — every refusal of the confirmation is a 422, the lodging tunnel’s answer, so it gives its hit back to the booking-request budget; a failure of ours keeps its status', async () => {
  const sent = [];
  const answerOf = (result, proofOk = true) => {
    const controller = buildPublicSessionController({
      service: { confirm: async () => result },
      proof: () => ({ ok: proofOk }),
      respond: { ok: () => sent.push(['ok']), fail: (res, status, code) => sent.push([status, code]) },
      siteOrigin: () => 'https://site.example.test',
    });
    return controller.confirm({ body: { start: startOf(fx.DAY, '10:00') }, visitor }, { set() {} });
  };
  await answerOf({ ok: false, status: 409, code: 'SLOT_TAKEN', message: 'x' });
  await answerOf({ ok: false, status: 400, code: 'EMAIL_INVALID', message: 'x' });
  await answerOf({ ok: false, status: 409, code: 'BEYOND_HORIZON', message: 'x' });
  await answerOf({ ok: false, status: 409, code: 'PRICE_UNAVAILABLE', message: 'x' });
  await answerOf({ ok: false, status: 400, code: 'TERMS_NOT_ACCEPTED', message: 'x' });
  await answerOf({ ok: false, status: 502, code: 'PAYMENT_PROVIDER_ERROR', message: 'x' });
  await answerOf({ ok: true, data: {} }, false);
  assert.deepEqual(sent, [[422, 'SLOT_TAKEN'], [422, 'EMAIL_INVALID'], [422, 'BEYOND_HORIZON'], [422, 'PRICE_UNAVAILABLE'], [422, 'TERMS_NOT_ACCEPTED'], [502, 'PAYMENT_PROVIDER_ERROR'], [422, 'PROOF_INVALID']]);
});

test('rule 13 — the paid callback books and marks the order in one transaction: a failure in between leaves no session, frees the hold and flags the money', async () => {
  const flaky = {
    ...orders,
    setBooked: () => { throw new Error('disk full'); },
  };
  const failing = createPublicSessionService({
    db: fx.db,
    offer: fx.offer,
    orders: flaky,
    terms: fx.ctx.terms,
    payments: { saleLink: async () => ({ linkId: 70, url: 'https://pay.example.test/70' }), refreshLink: async () => 'open', withdrawLink: async () => 'cancelled' },
    engine: { quote: (request) => fx.standaloneSale.quote(request) },
    suggest: () => [],
    notify: (notice) => notices.push(notice),
    sendMail: async (mail) => { mails.push(mail); },
    address: () => '',
    companyName: () => 'Solio',
    basketSource: 'outsideSession',
    now: () => fx.NOW,
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    const held = await failing.confirm({
      resourceId: bath, start: startOf('2026-11-19', '17:00'), minutes: 60, ...contact, email: 'tx@example.test', // date-literal-ok: the suite runs on its own clock, never the real today
    });
    assert.equal(held.ok, true, JSON.stringify(held));
    const ref = fx.db.prepare('SELECT ref FROM resource_session_orders ORDER BY id DESC').get().ref;
    notices.length = 0;
    const before = fx.db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n;
    const outcome = failing.paid({ ref, linkId: 70, amountCents: held.data.dueCents });
    assert.equal(outcome.refundOwed, true);
    assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n, before, 'the booking written before the failure is rolled back with the rest');
    assert.equal(fx.db.prepare('SELECT state FROM resource_session_orders WHERE ref = ?').get(ref).state, 'refund_owed');
    assert.equal(fx.holdRows(`site-session:${ref}`).every((h) => h.releasedAt), true, 'rule 12 — the held slot is given back with the refusal');
    assert.equal(notices.filter((n) => n.title.startsWith('Séance réservée')).length, 0, 'a session that does not exist is not announced');
    assert.equal(notices.filter((n) => n.title.startsWith('Paiement à rembourser')).length, 1);
  } finally {
    console.error = quiet;
  }
});

test('rule 23 — nothing is announced from inside a transaction: an outer rollback sends nothing, the commit lets the caller send it once', () => {
  const told = [];
  const announcing = createOutsideOffer({
    db: fx.db, bookings: () => fx.bookings, occupancy: fx.occupancy, holds: createHoldsModel(fx.db), terms: fx.ctx.terms, notify: (notice) => told.push(notice), now: () => fx.NOW,
  });
  const book = (start) => {
    const quote = announcing.quote({
      resourceId: bath, date: '2026-11-20', start, coveredBand: 'day', coveredMinutes: 60, extraMinutes: 0, // date-literal-ok: the suite runs on its own clock, never the real today
    });
    return announcing.bookOutside({
      resourceId: bath,
      date: '2026-11-20', // date-literal-ok: the suite runs on its own clock, never the real today
      start,
      end: quote.endTime,
      customer: { name: 'Léa Martin' },
      people: 2,
      fulfilments: [{ role: 'session', ...quote.session.line }],
      tenders: [{ method: 'card', amountCents: quote.session.totalCents, source: 'payment-link:9' }],
      channel: 'site',
      now: fx.NOW,
    });
  };
  assert.throws(() => fx.db.transaction(() => {
    const done = book('10:00');
    assert.equal(done.ok, true);
    assert.equal(typeof done.announce, 'function');
    throw new Error('the caller rolls back');
  })(), /the caller rolls back/);
  assert.deepEqual(told, []);
  let kept;
  fx.db.transaction(() => { kept = book('12:00'); })();
  assert.deepEqual(told, [], 'still nothing: the transaction was the caller’s');
  kept.announce();
  assert.equal(told.length, 1);
  assert.equal(book('14:00').announce, undefined, 'outside a transaction the offer sends it itself');
  assert.equal(told.length, 2);
});

test('rule 6 — a start whose quote fails is left out of its own day alone, never of every date', () => {
  const failingOn = { ...fx.offer, quote: (args) => (args.date === fx.DAY && args.start === '12:00' ? { ok: false, code: 'SLOT_INVALID', message: 'x' } : fx.offer.quote(args)) };
  const picky = createPublicSessionService({
    db: fx.db, offer: failingOn, orders, terms: fx.ctx.terms, payments: {}, engine: { quote: (r) => fx.standaloneSale.quote(r) }, suggest: () => [], notify() {}, sendMail: async () => {}, address: () => '', companyName: () => 'Solio', basketSource: 'outsideSession', now: () => fx.NOW,
  });
  const days = picky.slots({
    resourceId: bath, from: fx.DAY, to: '2026-11-17', minutes: 60, // date-literal-ok: the suite runs on its own clock, never the real today
  }).data.days;
  const startsOf = (date) => days.find((d) => d.date === date).slots.filter((s) => !s.taken).map((s) => s.start);
  assert.equal(startsOf(fx.DAY).includes('12:00'), false);
  assert.equal(startsOf('2026-11-17').includes('12:00'), true); // date-literal-ok: the suite runs on its own clock, never the real today
});
