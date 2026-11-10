// specs/guest-app.md rule 98 (fifth pass, 2026-11-10) — paid nordic-bath hours ordered from the guest app work on a PLATFORM stay
// exactly as on a direct one: a new resource line carries no routing flag, so the platform default sends it to the arrival complement
// (force-extras-complement-on-platform §3), finalPrice and the complement grow by the line's own amount, and nothing else moves.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { skipWithout } = require('../plugins/sdk/testing');

const db = require('../database');
const { priceOrder, commitOrder, orderCollection } = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (202, 1)').run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 60)').run();

const COLUMNS = 'finalPrice, depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount, touristTaxTotal, clientGrossAmount, platformPayoutAmount, platformCommissionAmount';
const money = (id) => db.prepare(`SELECT ${COLUMNS} FROM reservations WHERE id = ?`).get(id);
let arrival = 5;
const session = (day, start, end) => ({ date: isoPlus(arrival + day - 5), start, end });
const evening = (ref) => ({ kind: 'charge', key: `guest-order:${ref}:evening:202`, label: 'Bain nordique — supplément soirée', amount: 20 });

let sequence = 0;
function seedStay(platform, { balancePaid = 0 } = {}) {
  const start = 5 + 10 * sequence;
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, ?, 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, ?, ?)`)
    .run(isoPlus(start), isoPlus(start + 4), platform, isoPlus(start), balancePaid, `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  arrival = start;
  return id;
}

const growth = (before, after) => Object.fromEntries(Object.keys(before)
  .map((column) => [column, Math.round((Number(after[column] || 0) - Number(before[column] || 0)) * 100) / 100])
  .filter(([, delta]) => delta !== 0));

for (const platform of ['booking', 'gites_de_france', 'lodgify', 'direct']) {
  test(`rule 98 (MEDIUM 1): on a ${platform} stay the free hour, the paid hours and the evening supplement are quoted and committed — the money grows by the order's own amount`, { skip: skipWithout(['hourly-resources']) }, () => {
    const id = seedStay(platform, { balancePaid: platform === 'direct' ? 1 : 0 });
    assert.equal(orderCollection(id), 'arrival');
    const orders = [
      [[{ kind: 'resource', id: 202, sessions: [session(6, '16:00', '17:00')] }], {}],
      [[{ kind: 'resource', id: 202, sessions: [session(6, '12:00', '14:00')] }], { 'res:202': 60 }],
      [[{ kind: 'resource', id: 202, sessions: [session(7, '18:00', '19:00')] }, evening(3)], { 'res:202': 30 }],
    ];
    orders.forEach(([lines, expected], index) => {
      const before = money(id);
      const priced = priceOrder(id, lines);
      assert.equal(priced.status, 200, `${platform} quote ${index}: ${JSON.stringify(priced.body)}`);
      assert.equal(priced.collectAt, 'arrival');
      const result = commitOrder(id, { ...named(index + 1), lines });
      assert.equal(result.status, 200, `${platform} commit ${index}: ${JSON.stringify(result.body)}`);
      const charge = lines.some((l) => l.kind === 'charge') ? 20 : 0;
      const sold = Object.values(expected).reduce((sum, n) => sum + n, 0);
      assert.equal(result.total, priced.total);
      assert.equal(result.total, sold + charge, `${platform} order ${index} total`);
      const delta = growth(before, money(id));
      assert.equal(delta.finalPrice || 0, sold + charge, `${platform} order ${index}: finalPrice grows by the order's own amount`);
      assert.equal(delta.complementAmount || 0, sold + charge, `${platform} order ${index}: the arrival complement grows by the same amount`);
      ['depositAmount', 'balanceAmount', 'endOfStayComplementAmount', 'touristTaxTotal'].forEach((column) => {
        assert.equal(delta[column], undefined, `${platform} order ${index}: ${column} stays`);
      });
    });
  });
}

test('rule 98: the quote and the commit of the same session agree on a platform stay, byKey and money columns', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay('booking');
  const lines = [{ kind: 'resource', id: 202, sessions: [session(6, '12:00', '14:00')] }];
  const priced = priceOrder(id, lines);
  const before = money(id);
  assert.deepEqual(money(id), before, 'the quote writes nothing');
  const result = commitOrder(id, { ...named(9), lines });
  assert.deepEqual([result.byKey, priced.byKey], [{ 'res:202': 30 }, { 'res:202': 30 }]);
  const row = db.prepare('SELECT inComplement FROM reservation_resources WHERE reservationId = ? AND resourceId = 202').get(id);
  assert.equal(row.inComplement, 1, 'the platform default routed the new bath line to the arrival complement');
});

test('rule 98: a bath line already stored at inComplement 0 on a platform stay (an earlier order of the unreleased branch) takes a paid hour like a fresh one', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay('booking');
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions)
              VALUES (?, 202, 1, 30, 1, 0, 0, 0, ?)`).run(id, JSON.stringify([session(6, '16:00', '17:00')]));
  const before = money(id);
  const lines = [{ kind: 'resource', id: 202, sessions: [session(6, '12:00', '14:00')] }];
  const priced = priceOrder(id, lines);
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  const result = commitOrder(id, { ...named(20), lines });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(growth(before, money(id)), { finalPrice: 60, complementAmount: 60 });
});
