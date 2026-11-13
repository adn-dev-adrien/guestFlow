// Manual trial of 4.0.0, point 10 (stay 11773) — the fiche's live preview prices a COLLECTED arrival complement the way the
// save does: frozen at what was collected, so a guest added to a platform stay after the collection is announced in the
// end-of-stay complement (specs/mid-stay-extras-to-end-of-stay-complement.md rules 20 and 21), never folded into the closed
// arrival complement the ledger shows as « Perçu ».

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FAR_YEAR } = require('./farYearFixture');

const call = (fn, req) => new Promise((resolve) => {
  let code = 200;
  fn(req, { status(c) { code = c; return this; }, json: (b) => resolve({ code, body: b }), send: (b) => resolve({ code, body: b }) });
});

test('preview = save: a guest added after the arrival complement was collected reads in the end-of-stay complement', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0, 2, 20, 'per_night')`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (50, 'Panier', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 50)').run();
  const stay = {
    propertyId: 1, clientId: 1, startDate: `${FAR_YEAR}-05-04`, endDate: `${FAR_YEAR}-05-07`, checkInTime: '16:00', checkOutTime: '10:00',
    platform: 'Booking', platformGrossAmount: 300, adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  };
  const lines = [{ optionId: 50, quantity: 1, inComplement: 1 }];
  const created = await call(controller.create, { body: { ...stay, options: lines }, user: { role: 'admin' } });
  const id = created.body.id;
  assert.ok(id, JSON.stringify(created.body));
  // The 50 € arrival complement is collected at the door; then a third guest is added on the fiche (+20 € × 3 nights).
  db.prepare('UPDATE reservations SET complementPaid = 1, complementAmount = 50 WHERE id = ?').run(id);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const edited = { ...stay, adults: 3, balanceAmount: row.balanceAmount, depositAmount: row.depositAmount, complementPaid: true };

  const preview = await call(controller.calculatePrice, {
    body: { ...edited, reservationId: id, selectedOptions: lines, customOptions: [], selectedResources: [] },
    user: { role: 'admin' },
  });
  assert.equal(preview.body.error, undefined, JSON.stringify(preview.body));

  const saved = await call(controller.update, {
    params: { id: String(id) },
    body: { ...edited, options: lines, customOptions: [], resources: [] },
    user: { role: 'admin', roles: ['admin'] },
  });
  assert.ok(saved.code < 300, JSON.stringify(saved.body));
  const after = db.prepare('SELECT complementAmount, endOfStayComplementAmount FROM reservations WHERE id = ?').get(id);

  assert.equal(after.complementAmount, 50, 'the save keeps the collected complement');
  assert.equal(after.endOfStayComplementAmount, 60, 'the save bills the added guest at check-out');
  assert.equal(preview.body.complementAmount, 50, 'the preview keeps the collected complement');
  assert.equal(preview.body.endOfStayComplementTotal, 60, 'the preview announces what the save stores');
  assert.equal(preview.body.endOfStayComplementAutoTotal, 60, '« Calcul auto » says the same');
  assert.ok(preview.body.midStayExtrasLines.some((l) => l.key === 'arrivalComplementExcess' && l.amount === 60), 'the Détail lists the 60 €');
});
