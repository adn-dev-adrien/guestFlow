// specs/guest-app-bath-home-scheduling.md rules 1-7, 10, 15, 17-18 — the home's bath card, the « à la suite » blocks and the quote's
// breakdown, through the real routes (the stays start in five days: rule 7, the card from J-7) and the plugin hourly-resources' own scheduler. The grid of these cases: 30 € in the day, 40 € from
// 19:00, one hour offered on La Granja.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { skipWithout } = require('../../sdk/testing');

const BATH = addBath({ id: 4721, freeMinutes: { 1: 60 } });
sell('resource', BATH, { maxQuantity: 6 });
db.prepare(`UPDATE resources SET hourlyEveningStart = '19:00', hourlyEveningRate = 40, heatUpMinutes = 0, heatRetentionMinutes = 0,
  turnoverMinutes = 0, showsPlanningCard = 1 WHERE id = ?`).run(BATH);

function withBath(name, fn, { stay = {} } = {}) {
  test(name, { skip: skipWithout(['hourly-resources']) }, async () => {
    db.prepare('DELETE FROM resource_bookings').run();
    db.prepare('DELETE FROM reservation_resources').run();
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, ...stay });
    const ctx = await openOrdering(stayId);
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

// Hours the stay holds, as guest-app-bath-from-j7 writes them: an included line (offered, 0 €), so placing them never moves the stay's
// collected price (an order that lowered it would be refused OVERPAID).
const hold = (stayId, hours, sessions = []) => db.prepare(`INSERT INTO reservation_resources
  (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
  VALUES (?, ?, ?, 30, ?, 0, 1, 0, ?)`).run(stayId, BATH, hours, hours, JSON.stringify(sessions));

const meOf = async (call) => {
  const me = await call('GET', '/public/v1/guest/me');
  assert.equal(me.status, 200, JSON.stringify(me.body));
  return me.body.data;
};
const quoteOf = async (call, sessions) => {
  const quoted = await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'resource', id: BATH, sessions }] });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  return quoted.body.data;
};
const parts = (q) => q.lines[0].breakdown.map((b) => [b.key, b.amount]);
const sum = (q) => Math.round(q.lines[0].breakdown.reduce((s, b) => s + b.amount, 0) * 100) / 100;

withBath('rules 1, 4-5 — the offered hour alone: « 1 h offerte à programmer », the evening supplement named', async ({ call }) => {
  const [card] = (await meOf(call)).bath;
  assert.deepEqual([card.resourceId, card.state, card.title, card.ownedMinutes], [BATH, 'toSchedule', '1 h offerte à programmer', 60]);
  assert.equal(card.detail.replace(/\s/g, ' '), 'En journée, ou en soirée avec 10 € de supplément');
});

withBath('rule 1 — hours the stay holds plus no offered minute left: « 2 h à programmer »', async ({ stayId, call }) => {
  hold(stayId, 2);
  const [card] = (await meOf(call)).bath;
  assert.deepEqual([card.title, card.heldMinutes, card.offeredMinutes], ['2 h à programmer', 120, 0], 'the held line consumed the offered hour');
});

withBath('rules 2, 5 — everything placed: « Vos séances » lists the sessions to come', async ({ stayId, call }) => {
  hold(stayId, 1, [{ date: isoPlus(6), start: '18:00', end: '19:00' }]);
  const [card] = (await meOf(call)).bath;
  assert.equal(card.state, 'scheduled');
  assert.deepEqual(card.upcoming.map((s) => [s.date, s.start]), [[isoPlus(6), '18:00']]);
  assert.deepEqual(card.actions.map((a) => a.key), ['add', 'change']);
});

withBath('rule 6 — while the card shows, no home highlight speaks of the bath', async ({ call }) => {
  const me = await meOf(call);
  assert.equal(me.bath.length, 1);
  assert.notEqual(me.highlight && me.highlight.key, 'bath');
}, { stay: { start: -1, end: 3, checkedIn: 1 } });

withBath('rule 10 — blocks of 2 h: chained free slots, a taken hour breaks them, the evening counted', async ({ stayId, call }) => {
  const other = seedStay({ start: 5, end: 9, checkedIn: 0 });
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
    VALUES (?, ?, 1, 30, 1, 30, 0, 0, ?)`).run(other, BATH, JSON.stringify([{ date: isoPlus(6), start: '15:00', end: '16:00' }]));
  const answer = await call('GET', `/public/v1/guest/shop/resources/${BATH}/blocks?hours=2`);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const day = answer.body.data.days.find((d) => d.date === isoPlus(6));
  const starts = day.starts.map((s) => s.start);
  assert.ok(!starts.includes('14:00') && !starts.includes('15:00'), 'no block across the taken 15:00');
  assert.ok(starts.includes('16:00'));
  const late = day.starts.find((s) => s.start === '18:00');
  assert.deepEqual([late.end, late.eveningMinutes], ['20:00', 60]);
  assert.ok(stayId);
});

withBath('rule 10 — a nonsense number of hours is refused', async ({ call }) => {
  const answer = await call('GET', `/public/v1/guest/shop/resources/${BATH}/blocks?hours=1`);
  assert.equal(answer.status, 400);
});

withBath('rule 15 — the offered hour in the day: 0 €, said « Offerte »', async ({ call }) => {
  const q = await quoteOf(call, [{ date: isoPlus(6), start: '14:00', end: '15:00' }]);
  assert.equal(q.total, 0);
  assert.deepEqual(parts(q), [['offered', 0]]);
});

withBath('rule 15 — the offered hour in the evening: the supplement alone, the parts add up to the total', async ({ call }) => {
  const q = await quoteOf(call, [{ date: isoPlus(6), start: '20:00', end: '21:00' }]);
  assert.equal(q.total, 10);
  assert.deepEqual(parts(q), [['offered', 0], ['evening', 10]]);
  assert.equal(sum(q), q.total);
});

withBath('rule 15 — hours the stay holds placed in the evening: their supplement, nothing else', async ({ stayId, call }) => {
  hold(stayId, 2);
  const q = await quoteOf(call, [{ date: isoPlus(6), start: '19:00', end: '21:00' }]);
  assert.equal(q.total, 20);
  assert.deepEqual(parts(q), [['held', 0], ['evening', 20]]);
});

withBath('rule 15 — one offered hour + one hour more, 18:00-20:00 in a row: the total does not depend on which hour is the offered one', async ({ call }) => {
  const q = await quoteOf(call, [{ date: isoPlus(6), start: '18:00', end: '20:00' }]);
  // 30 € + 40 € gross, the offered hour worth the day rate.
  assert.equal(q.total, 40);
  assert.equal(sum(q), q.total);
  assert.deepEqual(q.lines[0].breakdown.map((b) => b.key).filter((k) => k !== 'evening'), ['offered', 'extra']);
});

withBath('rules 17-18 — the order stores no breakdown, and placing held hours in the day sells nothing', async ({ stayId, call }) => {
  hold(stayId, 1);
  const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(7), start: '11:00', end: '12:00' }] }];
  const placed = await call('POST', '/public/v1/guest/orders', { lines, payment: 'none' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const order = await call('GET', `/public/v1/guest/orders/${placed.body.data.orderId}`);
  assert.equal(order.body.data.lines[0].breakdown, undefined);
  const row = db.prepare('SELECT quantity, sessions FROM reservation_resources WHERE reservationId = ?').all(stayId);
  assert.deepEqual(row.map((r) => [r.quantity, JSON.parse(r.sessions).length]), [[1, 1]], 'the held line got its session, no hour sold');
  const [card] = (await meOf(call)).bath;
  assert.equal(card.state, 'scheduled', 'the card follows: nothing left to schedule');
});

// Review of 2026-11-15 — one « à la suite » block longer than the hours the stay holds: the held hours are placed, only the hours beyond are sold,
// and the two halves make one continuous bath (no turnover between them, with the production's 15 minutes of reset).
const withTurnover = async (minutes, fn) => {
  db.prepare('UPDATE resources SET turnoverMinutes = ? WHERE id = ?').run(minutes, BATH);
  try { await fn(); } finally { db.prepare('UPDATE resources SET turnoverMinutes = 0 WHERE id = ?').run(BATH); }
};

withBath('rule 10 — 2 held hours + 1 more in one 3 h block: 30 €, not 90 €', async ({ stayId, call }) => withTurnover(15, async () => {
  hold(stayId, 2);
  const q = await quoteOf(call, [{ date: isoPlus(6), start: '11:00', end: '14:00' }]);
  assert.equal(q.total, 30);
  assert.deepEqual(parts(q), [['held', 0], ['extra', 30]]);
  assert.equal(sum(q), q.total);
}));

withBath('rule 10 — the 3 h block placed: the held line takes 11-13, a line of its own sells 13-14, nothing left to schedule', async ({ stayId, call }) => withTurnover(15, async () => {
  hold(stayId, 2);
  const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '11:00', end: '14:00' }] }];
  const placed = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const rows = db.prepare('SELECT quantity, totalPrice, sessions FROM reservation_resources WHERE reservationId = ? ORDER BY rowid').all(stayId);
  assert.deepEqual(rows.map((r) => [r.quantity, JSON.parse(r.sessions).map((s) => `${s.start}-${s.end}`)]), [[2, ['11:00-13:00']], [1, ['13:00-14:00']]]);
  assert.equal(rows[1].totalPrice, 30, 'only the hour beyond the held ones is sold');
  const [card] = (await meOf(call)).bath;
  assert.equal(card.state, 'scheduled');
}));
