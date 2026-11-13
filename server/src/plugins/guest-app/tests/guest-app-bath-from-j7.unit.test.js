// specs/guest-app.md rules 78-84 (« Mon séjour » from J-7, second message) — the nordic bath from the app, through the real routes and
// the plugin hourly-resources' own scheduler: the stay's days and the bath's own hours, the heat-up counted from now, the other uses
// of the bath, the free time at the day rate with the evening supplement, the hours the stay already holds, a crafted slot refused first.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, isoPlus, openOrdering, seedStay, sell,
} = fx;
const sdk = require('../../sdk');
const { optionalPlugin, skipWithout } = require('../../sdk/testing');

const { wallClockToDate } = sdk.coreModule('stayWindow');

const BATH = addBath({ id: 71, freeMinutes: { 1: 60 } });
sell('resource', BATH);
db.prepare(`UPDATE resources SET hourlyEveningStart = '19:00', hourlyEveningRate = 40, heatUpMinutes = 240, heatRetentionMinutes = 120,
  turnoverMinutes = 0, showsPlanningCard = 1 WHERE id = ?`).run(BATH);

const euros = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(n);

function withBath(name, fn, { stay = {}, now = null } = {}) {
  test(name, { skip: skipWithout(['hourly-resources']) }, async () => {
    // The bath has one unit: the other stays' sessions of the earlier cases would take the slots of this one.
    db.prepare('DELETE FROM resource_bookings').run();
    db.prepare('DELETE FROM reservation_resources').run();
    db.prepare('UPDATE property_resource_prices SET freeMinutes = 60 WHERE resourceId = ?').run(BATH);
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, ...stay });
    const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
    if (now) ctx.clock.now = now();
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const slotsOf = async (call, query = '') => (await call('GET', `/public/v1/guest/shop/resources/${BATH}/slots${query}`)).body.data;
const startsOn = (data, date) => ((data.days.find((d) => d.date === date) || {}).slots || []).map((s) => s.start);
const rows = (table, stayId) => db.prepare(`SELECT * FROM ${table} WHERE reservationId = ?`).all(stayId);

withBath('rules 78, 79: a week ahead the arrival evening is offered from the check-in; the stay\'s days only, each with the bath\'s opening', async ({ call }) => {
  const data = await slotsOf(call);
  assert.deepEqual(data.days.map((d) => d.date), [isoPlus(5), isoPlus(6), isoPlus(7), isoPlus(8), isoPlus(9)], 'every day of the stay, none outside');
  assert.equal(startsOn(data, isoPlus(5))[0], '16:00', 'arrival day from the check-in; the heat-up counted from now (5 days ago enough)');
  assert.deepEqual(startsOn(data, isoPlus(6)).slice(0, 2), ['08:00', '09:00'], 'the bath\'s own hours, not the check-in');
  assert.deepEqual(startsOn(data, isoPlus(9)), ['08:00', '09:00'], 'departure day: only what ends by the 10:00 check-out');
  assert.deepEqual(data.days[1].openingBands, [{ from: '00:00', to: '08:00', open: false }, { from: '08:00', to: '22:00', open: true }, { from: '22:00', to: '24:00', open: false }]);
});

withBath('rule 79: on the arrival day at 17 h with a 4 h heat-up the first cold slot is 21 h', async ({ call }) => {
  const data = await slotsOf(call);
  assert.deepEqual(startsOn(data, isoPlus(0)), ['21:00']);
}, { stay: { start: 0, end: 4 }, now: () => wallClockToDate(isoPlus(0), '17:00') });

withBath('rules 79, 80: a use of the bath by another stay or an outside booking is not offered; the slot warm after it is', async ({ call }) => {
  db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, clientName) VALUES (?, ?, '18:00', '19:00', 'Voisin')").run(BATH, isoPlus(0));
  const data = await slotsOf(call);
  const starts = startsOn(data, isoPlus(0));
  assert.ok(!starts.includes('18:00'), 'taken');
  assert.ok(starts.includes('19:00') && starts.includes('20:00'), 'warm: ended 19:00, retention 2 h, no heat-up counted');
  assert.ok(!starts.includes('17:00') && !starts.includes('16:00'), 'cold and sooner than now + 4 h: heating, not offered');
  assert.ok(JSON.stringify(data).indexOf('Voisin') < 0, 'no name leaves');
}, { stay: { start: 0, end: 4 }, now: () => wallClockToDate(isoPlus(0), '16:30') });

withBath('rules 81, 84: the free hour is offered at the day rate — « Offert », « Offert · + 10 € soirée »; once used the lodging\'s price and the evening rate', async ({ call }) => {
  const data = await slotsOf(call);
  const byStart = (start) => data.days.find((d) => d.date === isoPlus(6)).slots.find((s) => s.start === start);
  assert.deepEqual([byStart('12:00').band, byStart('12:00').priceLabel], ['day', 'Offert']);
  assert.deepEqual([byStart('20:00').band, byStart('20:00').priceLabel], ['evening', `Offert · + ${euros(10)} soirée`]);
  assert.equal(data.freeMinutesLeft, 60);
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '20:00', end: '21:00' }] }] });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.data.total, 10, 'the offered evening hour owes the evening supplement, once');
  const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '20:00', end: '21:00' }] }], payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const after = await slotsOf(call);
  const used = after.days.find((d) => d.date === isoPlus(7)).slots;
  assert.equal(used.find((s) => s.start === '12:00').priceLabel, euros(30));
  assert.equal(used.find((s) => s.start === '20:00').priceLabel, `${euros(40)} · tarif soirée`);
});

withBath('rule 82: hours the stay already holds are placed first at no charge; the evening one owes its supplement once, as a line tagged with the order (pricing-components rules 13, 25, 90.3)', async ({ stayId, call }) => {
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
              VALUES (?, ?, 2, 30, 2, 0, 1, 0, '[]')`).run(stayId, BATH);
  const data = await slotsOf(call);
  assert.equal(data.includedHoursLeft, 2);
  assert.equal(data.includedLabel, '2 h comprises dans votre séjour, à programmer');
  assert.equal(data.days.find((d) => d.date === isoPlus(6)).slots.find((s) => s.start === '12:00').priceLabel, 'Compris dans votre séjour');
  const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '20:00', end: '21:00' }] }];
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.data.total, 10);
  assert.deepEqual(quote.body.data.lines.map((l) => [l.kind, l.totalLabel]), [['resource', euros(10)]], 'the supplement is said inside the bath’s row, never a row of its own');
  const placed = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const orderId = placed.body.data.orderId;
  const [charge] = rows('reservation_custom_options', stayId);
  assert.deepEqual([charge.description, charge.amount, charge.orderRef.startsWith(`order:${orderId}:`)], ['Bain nordique — supplément soirée', 10, true], 'a line of the stay, tagged with its order (pricing-components rules 13, 25)');
  assert.equal(db.prepare('SELECT quantity FROM reservation_resources WHERE reservationId = ?').get(stayId).quantity, 2, 'the sold hours did not rise');
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(stayId).complementAmount, 10);
  // hourly rule 38 — the arrival SAS recompute does not bill the same evening again
  const model = optionalPlugin(() => require('../../hourly-resources/schedulingModel')).create(db);
  const reservation = require('../../../models/reservationsModel').getByIdWithDetails(stayId);
  assert.deepEqual(model.storedSupplements(reservation), []);
});

withBath('rule 80: a crafted session that the picker would not offer is refused first — SLOT_UNAVAILABLE (closed, past, heating, off the grid), SLOT_TAKEN (taken) — nothing written', async ({ stayId, call }) => {
  db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, clientName) VALUES (?, ?, '12:00', '13:00', 'Voisin')").run(BATH, isoPlus(6));
  const order = (session) => call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [session] }], payment: 'note' });
  const asked = [
    [{ date: isoPlus(5), start: '10:00', end: '11:00' }, 'SLOT_UNAVAILABLE'], // before the check-in
    [{ date: isoPlus(6), start: '07:00', end: '08:00' }, 'SLOT_UNAVAILABLE'], // before the bath opens
    [{ date: isoPlus(6), start: '22:00', end: '23:00' }, 'SLOT_UNAVAILABLE'], // after it closes
    [{ date: isoPlus(9), start: '10:00', end: '11:00' }, 'SLOT_UNAVAILABLE'], // the departure day, after the check-out time
    [{ date: isoPlus(10), start: '12:00', end: '13:00' }, 'SLOT_UNAVAILABLE'], // after the departure
    [{ date: isoPlus(6), start: '14:15', end: '15:15' }, 'SLOT_UNAVAILABLE'], // off the grid
    [{ date: isoPlus(6), start: '12:00', end: '13:00' }, 'SLOT_TAKEN'],
  ];
  for (const [session, code] of asked) {
    const res = await order(session);
    assert.deepEqual([res.status, res.body.error.code], [409, code], JSON.stringify(session));
  }
  assert.equal((await order({ date: isoPlus(6), start: '07:00', end: '08:00' })).body.error.message, 'Ce créneau n’est pas proposé.');
  assert.equal((await call('POST', '/public/v1/guest/orders?lang=en', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '07:00', end: '08:00' }] }], payment: 'note' })).body.error.message, 'This slot is not offered.');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stayId).n, 0);
  assert.equal(rows('reservation_resources', stayId).length, 0);
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '07:00', end: '08:00' }] }] });
  assert.equal(quote.status, 200);
  assert.deepEqual([quote.body.data.lines[0].unavailable, quote.body.data.lines[0].sessions[0].unavailable, quote.body.data.total], [true, true, 0], 'the quote says it on the session');
});
