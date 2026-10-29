// specs/reservation-save-keeps-pricing.md rule 4 — review of #847, point 2: the trop-perçu a collected
// complement holds (#22224 +21 €, #22226 +28 €, Lodgify = direct channel) reaches the fiche: the preview
// announces it, with the postes the refund dialog offers.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

test('rule 4 — the fiche preview of a stay with an over-collected complement announces the trop-perçu', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  const stayBody = {
    propertyId: 1, clientId: 1, startDate: '2099-05-04', endDate: '2099-05-07', checkInTime: '16:00', checkOutTime: '10:00',
    platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [],
  };
  const created = await new Promise((resolve) => {
    controller.create({ body: stayBody, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  const id = created.id;
  // Solde 300 paid, then a 100 € complement collected on arrival for a line the stay no longer carries.
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = 300, complementPaid = 1, complementAmount = 100 WHERE id = ?').run(id);

  const quote = await new Promise((resolve) => {
    controller.calculatePrice({
      body: { ...stayBody, reservationId: id, selectedOptions: [], customOptions: [], selectedResources: [], depositDisabled: 1 },
      user: { role: 'admin' },
    }, { status() { return this; }, json: resolve });
  });
  assert.equal(quote.error, undefined, JSON.stringify(quote));
  assert.equal(quote.overpaymentTtc, 100, 'the 100 € complement is above the stay total');
  assert.ok(quote.overpaymentLines.length > 0, 'the refund dialog has a poste to offer');
});
