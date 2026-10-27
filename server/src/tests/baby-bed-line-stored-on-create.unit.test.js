// specs/baby-bed-supplement.md §3 rule 19 — spec review 2026-10-27. A reservation created with a cot
// and no ticked option billed the cot (the engine's own line) without writing its row; rule 10 then
// read the booking as grandfathered and the next save dropped the supplement. The real controller on
// the boot schema, with the pricing engine stubbed to the quote it produces for such a stay.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('the cot line the price includes is stored with the reservation', () => {
  const db = require('../database');
  db.prepare("INSERT OR IGNORE INTO properties (id, name, maxGuests, maxBabies) VALUES (1, 'Lodge', 4, 2)").run();
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 3, 0, 'per_stay')").run();
  const cot = db.prepare("SELECT id FROM options WHERE autoOptionType = 'baby_bed'").get();
  assert.ok(cot, 'the cot option is seeded at boot');

  const cotLine = {
    optionId: cot.id, title: 'Lit bébé', quantity: 2, billedUnits: 2, unitPrice: 5, priceType: 'per_stay',
    totalPrice: 10, offered: false, inComplement: false,
  };
  const quote = {
    totalPrice: 300, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 310,
    depositAmount: 0, depositDueDate: null, balanceAmount: 310, balanceDueDate: null, complementAmount: 0,
    nights: 3, optionLines: [cotLine], resourceLines: [], nightlyBreakdown: [], midStayExtrasLines: [], error: null,
  };
  const controller = withMocks({
    '../utils/pricing': { calculateReservationQuote: () => ({ ...quote }) },
  }, () => {
    const p = '../controllers/reservationsController';
    delete require.cache[require.resolve(p)];
    return require(p);
  });

  const res = fakeRes();
  controller.create({
    body: {
      propertyId: 1, clientId: 1, startDate: '2027-06-24', endDate: '2027-06-27',
      adults: 2, children: 0, teens: 0, babies: 2, babyBeds: 2, singleBeds: 0, doubleBeds: 0,
      checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct', reservationOptions: [],
    },
    user: { role: 'admin' },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = db.prepare('SELECT quantity, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ?')
    .get(res.body.id, cot.id);
  assert.deepEqual({ ...row }, { quantity: 2, totalPrice: 10 });
});
