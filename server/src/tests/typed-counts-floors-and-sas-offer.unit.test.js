// specs/non-card-option-served-persons.md rule 17 (audit R21-S5) — what a line sold at arrival leaves the field: an
// offered line is frozen at its count too, and a re-opened SAS reopens on what it sold, in nights as in people.

const test = require('node:test');
const assert = require('node:assert/strict');

const { arrivalLineFloors } = require('../utils/midStayExtrasWindow');
const { buildSasSaleOffers, priceOptionSale } = require('../utils/sasOptionSale');
const { todayIso } = require('../utils/localDate');
const { addDays } = require('../utils/dateDays');

const dayIn = (n) => addDays(todayIso(), n);

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

test('rule 19 — a per-night sale stores its nights and a re-opened SAS reads them back through its own offer', () => {
  const option = { id: 502, title: 'Bois', price: 5, priceType: 'per_night', category: 'Restauration' };
  const stay = { adults: 4, startDate: dayIn(30), endDate: dayIn(34), nights: [{}, {}, {}, {}] };
  const sale = priceOptionSale(option, { unitPrice: 5, persons: 4, nights: 4, units: 2 });
  assert.deepEqual(
    { quantity: sale.quantity, cardNights: sale.cardNights, billedUnits: sale.billedUnits, totalPrice: sale.totalPrice },
    { quantity: 1, cardNights: 2, billedUnits: 2, totalPrice: 10 },
  );
  const { catering } = buildSasSaleOffers({
    reservation: { ...stay, options: [{ optionId: 502, sasArrivalOrigin: 1, billedUnits: sale.billedUnits, cardNights: sale.cardNights }] },
    options: [option],
  });
  assert.equal(catering.options.find((o) => o.optionId === 502).selectedUnits, 2, 'the typed nights, not the stay');
});

test('rule 19 — a per-night sale of the whole stay follows the stay and re-opens on its nights', () => {
  const option = { id: 503, title: 'Bois', price: 5, priceType: 'per_night', category: 'Restauration' };
  const sale = priceOptionSale(option, { unitPrice: 5, persons: 4, nights: 3, units: 3 });
  assert.equal(sale.cardNights, null, 'equal to the stay: it follows');
  const { catering } = buildSasSaleOffers({
    reservation: {
      adults: 4, startDate: dayIn(30), endDate: dayIn(33), nights: [{}, {}, {}],
      options: [{ optionId: 503, sasArrivalOrigin: 1, billedUnits: sale.billedUnits, cardNights: sale.cardNights }],
    },
    options: [option],
  });
  assert.equal(catering.options.find((o) => o.optionId === 503).selectedUnits, 3);
});
