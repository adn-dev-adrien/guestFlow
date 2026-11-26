// specs/plugins/plugins-phase-1-sdk.md rule 54 and specs/guest-app/guest-app.md rule 108 (end review R3-3) — the SDK 2.26.0 call shape of
// `coreModule('midStayOrderCommit')` still works in a minor: `priceOrder(id, lines, { pending })` is accepted, its `pending` an explicit no-op
// (told once in the log), and `commitOrder`'s answer keeps `excessCents` beside `overpaidCents`.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { priceOrder, commitOrder } = require('../plugins/sdk/midStayOrderCommit');

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();
const stay = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, platform, totalPrice, finalPrice, balanceAmount,
    depositDisabled, kind, checkInDone, checkInTime, checkOutTime, balanceDueDate, balancePaid)
  VALUES (1, 1, ?, ?, 2, 'direct', 400, 400, 400, 1, 'reservation', 1, '16:00', '10:00', ?, 1)`).run(isoPlus(-1), isoPlus(3), isoPlus(-1)).lastInsertRowid);
for (let i = -1; i < 3; i += 1) db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(stay, isoPlus(i));

test('SDK 2.26.0 — priceOrder with `pending` prices the stay as it is and says once that `pending` is ignored', () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const plain = priceOrder(stay, [{ kind: 'option', id: 102, quantity: 1 }]);
    const withPending = priceOrder(stay, [{ kind: 'option', id: 102, quantity: 1 }], { pending: [{ kind: 'option', id: 102, quantity: 2 }] });
    priceOrder(stay, [{ kind: 'option', id: 102, quantity: 1 }], { pending: [{ kind: 'option', id: 102, quantity: 2 }] });
    assert.deepEqual(withPending, plain);
    assert.equal(warnings.filter((w) => /pending/.test(w)).length, 1);
  } finally { console.warn = warn; }
});

test('SDK 2.26.0 — commitOrder answers `excessCents` beside `overpaidCents`', () => {
  const sold = commitOrder(stay, {
    source: 'shopOrder', ref: 1, history: { field: 'shopOrder', label: 'Commande', text: 'Commande #1' }, lines: [{ kind: 'option', id: 102, quantity: 1 }],
    paid: { amountCents: 1000, paidDate: isoPlus(0), reference: 'r1' },
  });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(sold.excessCents, sold.overpaidCents);
  assert.equal(sold.excessCents, 400);
});
