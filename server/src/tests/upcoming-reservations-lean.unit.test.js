const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/upcomingReservationsController');
const { toArrivalCard, CARD_FIELDS } = require('../utils/upcomingArrivals');

// specs/inte-performance.md rule 12 — « Réservations à venir » answers what its cards render, not the
// whole fiche (about 60 columns and 3 joined lists per stay). A field the card does not read must not
// come back; a field it reads must not be lost.

const FICHE = {
  id: 7, startDate: '2026-11-06', endDate: '2026-11-08', clientId: 150, firstName: 'Camille', lastName: 'Martin', propertyName: 'Le Gîte',
  platform: 'Booking', checkInTime: '20:00', checkInReady: 0, adults: 2, children: 1, teens: 0, babies: 0,
  doubleBeds: 1, singleBeds: 1, babyBeds: null, notes: 'RAS', complementAmount: 40, complementPaid: 0, complementDeferredToCheckout: 0,
  cautionAmount: 500, cautionReceived: 0, bedLinenAlert: { type: 'no_linen' }, arrivalSasDoneAt: null,
  // what the card never reads:
  email: 'c@example.fr', phone: '0600000000', totalPrice: 638, finalPrice: 686.02, depositAmount: 0, balanceAmount: 710.02,
  sourceIcalEventUid: 'x@booking.com', icalOriginalSummary: 'CLOSED', propertyPhoto: '/uploads/p.jpg', checkoutComplement: { amount: 1 },
  complementAdjustment: { floor: 1 }, touristTaxTotal: 24, createdAt: '2026-10-22', updatedAt: '2026-10-22',
  options: [{ optionId: 3, title: 'Linge', billedUnits: 2, quantity: 2, unitPrice: 8, totalPrice: 16, description: 'long', cardOccurrences: [] }],
  resources: [{ resourceId: 4, name: 'Bain nordique', billedUnits: 1.5, quantity: 1, unitPrice: 30, totalPrice: 45 }],
};

test('rule 12: a card carries exactly the fields it reads, options and resources by name and quantity', () => {
  const card = toArrivalCard(FICHE);
  assert.deepEqual(Object.keys(card).sort(), [...CARD_FIELDS.filter((f) => !['arrivalSasLock', 'checkInStatusEditable'].includes(f)), 'options', 'resources'].sort());
  assert.deepEqual(card.options, [{ title: 'Linge', billedUnits: 2, quantity: 2 }]);
  assert.deepEqual(card.resources, [{ name: 'Bain nordique', billedUnits: 1.5, quantity: 1 }]);
  for (const field of ['email', 'phone', 'totalPrice', 'finalPrice', 'depositAmount', 'sourceIcalEventUid', 'propertyPhoto', 'checkoutComplement', 'touristTaxTotal']) {
    assert.equal(field in card, false, `${field} must not come back`);
  }
});

test('rule 12: the reception locks pass through when a view adds them, and are absent otherwise', () => {
  assert.equal('arrivalSasLock' in toArrivalCard(FICHE), false);
  const locked = toArrivalCard({ ...FICHE, arrivalSasLock: 'future', checkInStatusEditable: false });
  assert.equal(locked.arrivalSasLock, 'future');
  assert.equal(locked.checkInStatusEditable, false);
});

test('rule 12: the endpoint groups and counts as before, and answers the lean cards', () => {
  const model = { arrivalIdsFrom: () => [7, 8], arrivalIdsOn: () => [] };
  const controller = buildController({ model, detailOf: (id) => ({ ...FICHE, id, checkInReady: id === 7 ? 1 : 0 }), today: () => '2026-11-01' });
  let body;
  controller.upcoming({ query: {} }, { json: (b) => { body = b; return b; } });
  assert.equal(body.days.length, 1);
  assert.equal(body.days[0].readyCount, 1);
  assert.equal(body.days[0].total, 2);
  assert.equal(body.days[0].reservations[0].email, undefined);
  assert.ok(JSON.stringify(body).length < JSON.stringify([FICHE, FICHE]).length);
});
