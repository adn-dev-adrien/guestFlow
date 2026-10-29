// specs/reservation-refunds.md rule 38 + reservation-save-keeps-pricing.md rule 16 — audit R3 N1: the live
// preview of a platform stay (Airbnb, Gîtes de France) never announces a trop-perçu, whatever the edit.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const call = (fn, req) => new Promise((resolve) => fn(req, { status() { return this; }, json: resolve }));

['Airbnb', 'Gîtes de France'].forEach((platform, index) => {
  test(`rule 16 — ${platform}: the solde paid, the price lowered, the live preview holds no trop-perçu`, async () => {
    const db = require('../database');
    const controller = require('../controllers/reservationsController');
    db.prepare(`INSERT OR IGNORE INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
                VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0)`).run();
    if (!index) db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
    db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
    const body = (extra = {}) => ({
      propertyId: 1, clientId: 1, startDate: `2099-0${3 + index}-01`, endDate: `2099-0${3 + index}-04`, checkInTime: '16:00', checkOutTime: '10:00',
      platform, adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [], ...extra,
    });
    const created = await call(controller.create, { body: body(), user: { role: 'admin' } });
    assert.ok(created.id, JSON.stringify(created));
    db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = date('now') WHERE id = ?").run(created.id);
    for (const edit of [{ discountPercent: 30 }, { customPrice: 150 }]) {
      const live = await call(controller.calculatePrice, {
        body: { ...body(edit), reservationId: created.id, selectedOptions: [], customOptions: [], selectedResources: [] }, user: { role: 'admin' },
      });
      assert.equal(live.error, undefined, JSON.stringify(live));
      assert.equal(live.overpaymentTtc, 0, `${JSON.stringify(edit)} leaves no trop-perçu`);
      assert.deepEqual(live.overpaymentLines, []);
    }
  });
});
