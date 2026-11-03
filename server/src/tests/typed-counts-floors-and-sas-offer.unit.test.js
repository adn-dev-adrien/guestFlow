// specs/non-card-option-served-persons.md rule 17 (audit R21-S5) — what a line sold at arrival leaves the field: an
// offered line is frozen at its count too, and a re-opened SAS reopens on what it sold, in nights as in people.

const test = require('node:test');
const assert = require('node:assert/strict');

const { arrivalLineFloors } = require('../utils/midStayExtrasWindow');
const { buildSasSaleOffers } = require('../utils/sasOptionSale');

test('rule 17 — an offered line keeps its floor in what the field shows', () => {
  const lines = [{ optionId: 500, quantity: 1, totalPrice: 0, offered: 1, typedCount: 3 }];
  const floors = arrivalLineFloors({ 'opt:999': 1 }, lines);
  assert.equal(floors['opt:500'].reason, 'offered');
  assert.equal(floors['opt:500'].minTypedCount, 3);
  const noCount = arrivalLineFloors({ 'opt:999': 1 }, [{ optionId: 500, quantity: 2, totalPrice: 0, offered: 1 }]);
  assert.equal('minTypedCount' in noCount['opt:500'], false);
});

test('rule 19 — a re-opened SAS shows the nights it sold', () => {
  const { catering } = buildSasSaleOffers({
    reservation: {
      adults: 4, startDate: '2099-03-01', endDate: '2099-03-04', nights: [{}, {}, {}],
      options: [{ optionId: 501, sasArrivalOrigin: 1, billedUnits: 2, cardNights: 2 }],
    },
    options: [{ id: 501, title: 'Bois', price: 5, priceType: 'per_night', category: 'Restauration' }],
  });
  const offer = catering.options.find((o) => o.optionId === 501);
  assert.equal(offer.sasOrigin, true);
  assert.equal(offer.selectedUnits, 2);
});
