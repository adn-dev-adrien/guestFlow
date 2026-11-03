// specs/non-card-option-served-persons.md rule 6 — towels count the people served when a number was typed
// on the option, and the whole party when nobody typed.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const { computeReservationContract } = require('../linenInventory');
const { buildModel } = require('../laundryModel');

const laundryModel = buildModel(db);

test('rule 6 — the contract counts the people served', () => {
  const towel = { towelLargePerPerson: 1, towelMediumPerPerson: 0, towelSmallPerPerson: 1 };
  const reservation = { adults: 4, teens: 0, children: 1 };
  const typed = computeReservationContract({
    reservation,
    bedLinenContext: {},
    bathroomContext: { explicitOption: towel, explicitServedSum: 3 },
    bathMatContext: { active: false },
  });
  assert.equal(typed.large, 3);
  const followed = computeReservationContract({
    reservation,
    bedLinenContext: {},
    bathroomContext: { propertyDefaultOption: towel },
    bathMatContext: { active: false },
  });
  assert.equal(followed.large, 5);
});

test('rule 6 — the laundry counts the people served', () => {
  db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (900, 'Granja', 13)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (900, 'Test', 'Client')").run();
  db.prepare("INSERT INTO options (id, title, price, priceType, countsAsBathroomLinen, towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson) VALUES (920, 'Serviettes', 8, 'per_person', 1, 1, 0, 0)").run();
  const stay = (id, start, end, cardPersons) => {
    db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults, children, teens, kind)
                VALUES (?, 900, 900, ?, ?, 5, 0, 0, 'reservation')`).run(id, start, end);
    db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardPersons)
                VALUES (?, 920, 1, 8, ?, 'per_person', 0, ?)`).run(id, cardPersons ?? 5, cardPersons);
  };
  stay(9901, '2098-06-01', '2098-06-03', 3);
  assert.equal(laundryModel.dropOffBathroomForWindow('2098-06-01', '2098-06-05').largeTowels, 3);
  stay(9902, '2098-07-01', '2098-07-03', null);
  assert.equal(laundryModel.dropOffBathroomForWindow('2098-07-01', '2098-07-05').largeTowels, 5);
});
