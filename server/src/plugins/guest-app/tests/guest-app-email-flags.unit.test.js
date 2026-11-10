// specs/guest-app.md rules 68, 70, 89, 90 — the flags the J-7 and J-2 e-mails hang their stay-app paragraph on, computed by the server:
// `hasStayAppShop` (the shop is shown, an article is sold, orders are taken for the stay now) and `hasStayAppBath` (on top, the stay
// holds the nordic bath or has free minutes of it left). A template never promises what the link does not give.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, hasHourly, openOrdering, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 951, title: 'Cidre', price: 6 });
const BATH = addBath({ id: 95, freeMinutes: {} });
db.prepare('UPDATE resources SET showsPlanningCard = 1 WHERE id = ?').run(BATH);

function withStay(name, fn, { stay = {}, skip = false } = {}) {
  test(name, { skip }, async () => {
    db.prepare('DELETE FROM guest_app_items').run();
    db.prepare('DELETE FROM property_resource_prices').run();
    db.prepare('DELETE FROM reservation_resources').run();
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, ...stay });
    const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

withStay('rule 70: the shop flag follows an article sold and orders open for the stay', async ({ stayId, api }) => {
  assert.deepEqual(api.emailFacts(stayId), { shop: false, bath: false }, 'nothing sold');
  sell('option', CIDER);
  assert.deepEqual(api.emailFacts(stayId), { shop: true, bath: false });
});

withStay('rule 70: a stay whose pre-arrival money is due orders on site — no paragraph at all', async ({ stayId, api }) => {
  sell('option', CIDER);
  assert.deepEqual(api.emailFacts(stayId), { shop: false, bath: false });
}, { stay: { balancePaid: 0 } });

withStay('rule 89: the bath clause needs the shop, a bath sold in the shop, and hours held or free minutes left', async ({ stayId, api }) => {
  sell('option', CIDER);
  sell('resource', BATH);
  assert.equal(api.emailFacts(stayId).bath, false, 'a bath sold, but neither held nor offered');
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, ?, 30, 60)').run(BATH);
  assert.equal(api.emailFacts(stayId).bath, true, 'one free hour left for the stay');
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
              VALUES (?, ?, 1, 30, 1, 0, 1, 0, ?)`).run(stayId, BATH, JSON.stringify([{ date: '2099-01-01', start: '10:00', end: '11:00' }]));
  assert.equal(api.emailFacts(stayId).bath, false, 'the free hour is used, nothing left');
  db.prepare("UPDATE reservation_resources SET quantity = 2 WHERE reservationId = ?").run(stayId);
  assert.equal(api.emailFacts(stayId).bath, true, 'a booked hour not yet placed: held by the reservation');
  db.prepare('DELETE FROM guest_app_items WHERE kind = ?').run('resource');
  assert.equal(api.emailFacts(stayId).bath, false, 'the shop no longer sells the bath');
}, { skip: !hasHourly });

withStay('rule 89: no article sold, no bath clause even when the stay holds the bath', async ({ stayId, api }) => {
  sell('resource', BATH);
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
              VALUES (?, ?, 2, 30, 2, 0, 1, 0, '[]')`).run(stayId, BATH);
  assert.equal(api.emailFacts(stayId).bath, hasHourly, 'the bath is itself an article sold');
  db.prepare('DELETE FROM guest_app_items').run();
  assert.deepEqual(api.emailFacts(stayId), { shop: false, bath: false });
});

withStay('rules 68, 90 (audit items 1, 2): a platform stay with nothing paid orders from J-7 — its J-7 carries the paragraph, the same judge as the shop', async ({ stayId, api }) => {
  sell('option', CIDER);
  assert.deepEqual(api.emailFacts(stayId), { shop: true, bath: false });
  const commit = require('../../../utils/midStayOrderCommit');
  assert.equal(commit.orderCollection(stayId), 'arrival');
}, { stay: { balancePaid: 0, platform: 'booking' } });

withStay('rule 90: the flag and the shop never disagree — whatever orderCollection refuses, emailFacts does not advertise', async ({ stayId, api }) => {
  sell('option', CIDER);
  const commit = require('../../../utils/midStayOrderCommit');
  for (const [column, value] of [['balancePaid', 0], ['kind', 'cancelled'], ['endOfStayComplementPaid', 1]]) {
    db.prepare(`UPDATE reservations SET ${column} = ? WHERE id = ?`).run(value, stayId);
    const open = ['arrival', 'departure'].includes(commit.orderCollection(stayId));
    assert.equal(api.emailFacts(stayId).shop, open, column);
    db.prepare(`UPDATE reservations SET ${column} = ? WHERE id = ?`).run(column === 'kind' ? 'reservation' : (column === 'balancePaid' ? 1 : 0), stayId);
  }
});
