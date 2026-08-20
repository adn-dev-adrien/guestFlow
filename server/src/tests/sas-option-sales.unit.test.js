// Prestations sold by the arrival SAS — breakfast mornings + « Restauration » catalogue.
// See specs/sas-breakfast-and-catering-upsell.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { buildSasSaleOffers, priceOptionSale } = require('../utils/sasOptionSale');
const { buildCandidateGrid } = require('../utils/cardOccurrences');

// 2 adults + 1 teen + 1 baby = 3 billable persons; 3 nights (18 → 21 August).
const STAY = {
  startDate: '2026-08-18', endDate: '2026-08-21', checkInTime: '15:00', checkOutTime: '10:00',
};

const BREAKFAST = {
  id: 6, title: 'Petit déjeuner', description: '', price: 8, priceType: 'per_person_per_night',
  autoOptionType: 'breakfast', showsPlanningCard: 1, cardRepeat: 'once_per_day',
  planningCardTimes: ['09:00'], category: 'Restauration', displayToClient: 1, autoEnabled: 0,
};
const MEAL = {
  id: 16, title: 'Le repas des trappeurs', description: 'Repas', price: 25, priceType: 'per_person_per_night',
  showsPlanningCard: 1, cardRepeat: 'multiple_per_day', planningCardTimes: ['12:00', '19:30'],
  category: 'Restauration', displayToClient: 1, autoEnabled: 0,
};
const BOARD = {
  id: 27, title: 'Planche S', description: 'Apéro', price: 17, priceType: 'per_stay',
  showsPlanningCard: 0, cardRepeat: 'once', planningCardTimes: [], category: 'Restauration',
  displayToClient: 1, autoEnabled: 0,
};
const BEER = {
  id: 18, title: 'Blonde du Pilat', price: 6.5, priceType: 'per_stay', category: 'Boissons',
  displayToClient: 1, autoEnabled: 0, showsPlanningCard: 0,
};

// specs/cancellation-insurance.md §3.2 rule 17 — miscategorised on purpose: the guard must not
// depend on the operator filing it outside « Restauration ».
const INSURANCE = {
  id: 42, title: 'Assurance annulation', price: 4, priceType: 'percent_of_stay',
  category: 'Restauration', displayToClient: 1, autoEnabled: 0, showsPlanningCard: 0,
  isCancellationInsurance: 1,
};

function reservation(overrides = {}) {
  return {
    id: 1, propertyId: 7, adults: 2, teens: 1, children: 0, babies: 1,
    ...STAY, nights: [{}, {}, {}], options: [], ...overrides,
  };
}

// ---- offers ----

test('offers: the breakfast mornings are the nights of the stay (arrival morning out, departure in)', () => {
  const offers = buildSasSaleOffers({ reservation: reservation(), options: [BREAKFAST] });
  assert.equal(offers.persons, 3);           // baby excluded
  assert.equal(offers.breakfast.available, true);
  assert.deepEqual(offers.breakfast.mornings.map((m) => m.date), ['2026-08-19', '2026-08-20', '2026-08-21']);
  assert.equal(offers.breakfast.mornings.length, offers.nights);
  assert.equal(offers.breakfast.unitPrice, 8);
  assert.equal(offers.breakfast.perPerson, true);
});

test('offers: a departure-morning breakfast served after check-out is kept, retimed before departure', () => {
  const offers = buildSasSaleOffers({
    reservation: reservation({ checkOutTime: '08:00' }),
    options: [BREAKFAST],
  });
  const last = offers.breakfast.mornings[offers.breakfast.mornings.length - 1];
  assert.equal(last.date, '2026-08-21');
  assert.equal(last.time, '07:30');          // 30 min before check-out
});

test('offers: the breakfast step is closed when the option was booked on the fiche', () => {
  const offers = buildSasSaleOffers({
    reservation: reservation({ options: [{ optionId: 6, sasArrivalOrigin: 0, billedUnits: 9 }] }),
    options: [BREAKFAST],
  });
  assert.equal(offers.breakfast.available, false);
});

test('offers: a breakfast THIS SAS sold stays offered, pre-selected on its mornings', () => {
  const offers = buildSasSaleOffers({
    reservation: reservation({
      options: [{ optionId: 6, sasArrivalOrigin: 1, cardOccurrences: [{ date: '2026-08-19', time: '09:00' }] }],
    }),
    options: [BREAKFAST],
  });
  assert.equal(offers.breakfast.available, true);
  assert.equal(offers.breakfast.sasOrigin, true);
  assert.deepEqual(offers.breakfast.selected, [{ date: '2026-08-19', time: '09:00' }]);
});

test('offers: catering lists the Restauration catalogue only, breakfast and booked lines excluded', () => {
  const offers = buildSasSaleOffers({
    reservation: reservation({ options: [{ optionId: 27, sasArrivalOrigin: 0 }] }),
    options: [BREAKFAST, MEAL, BOARD, BEER],
  });
  assert.equal(offers.catering.available, true);
  assert.deepEqual(offers.catering.options.map((o) => o.optionId), [16]); // board booked, beer is a drink
  const meal = offers.catering.options[0];
  // multiple_per_day → one moment per (day × slot), guest presence filtered on both boundary days.
  assert.deepEqual(meal.occurrences.map((o) => `${o.date} ${o.time}`), [
    '2026-08-18 19:30',
    '2026-08-19 12:00', '2026-08-19 19:30',
    '2026-08-20 12:00', '2026-08-20 19:30',
  ]);
});

test('offers: a plain option carries the fiche default quantity (the type multiplier)', () => {
  const offers = buildSasSaleOffers({ reservation: reservation(), options: [BOARD] });
  const board = offers.catering.options.find((o) => o.optionId === 27);
  assert.equal(board.showsPlanningCard, false);
  assert.equal(board.defaultUnits, 1);       // per_stay
  const perPerson = buildSasSaleOffers({
    reservation: reservation(), options: [{ ...BOARD, priceType: 'per_person' }],
  }).catering.options[0];
  assert.equal(perPerson.defaultUnits, 3);   // per_person → the party
});

// ---- pricing ----

test('price: a card option bills occurrences × persons, exactly like the engine', () => {
  const line = priceOptionSale(BREAKFAST, {
    unitPrice: 8, persons: 3, nights: 3, stay: STAY,
    occurrences: [{ date: '2026-08-19', time: '09:00' }, { date: '2026-08-20', time: '09:00' }],
  });
  assert.equal(line.quantity, 2);            // mornings
  assert.equal(line.billedUnits, 6);         // 2 × 3 pers.
  assert.equal(line.totalPrice, 48);         // 6 × 8 €
  assert.equal(line.cardOccurrences.length, 2);
});

test('price: a moment the guest cannot attend is refused', () => {
  const line = priceOptionSale(BREAKFAST, {
    unitPrice: 8, persons: 3, nights: 3, stay: STAY,
    // The arrival morning: the guest checks in at 15:00, there is no 09:00 breakfast that day.
    occurrences: [{ date: '2026-08-18', time: '09:00' }],
  });
  assert.equal(line, null);
});

test('price: a plain option bills the units the operator picked, quantity re-derived for the engine', () => {
  const line = priceOptionSale({ ...BOARD, priceType: 'per_person' }, {
    unitPrice: 17, persons: 3, nights: 3, units: 2,
  });
  assert.equal(line.billedUnits, 2);
  assert.equal(line.quantity, 0.6667);       // 2 / 3 persons — what the fiche stores
  assert.equal(line.totalPrice, 34);
  assert.equal(line.cardOccurrences, null);
});

test('price: nothing sold → no line', () => {
  assert.equal(priceOptionSale(BOARD, { unitPrice: 17, persons: 3, nights: 3, units: 0 }), null);
  assert.equal(priceOptionSale(BREAKFAST, { unitPrice: 8, persons: 3, nights: 3, occurrences: [] }), null);
  assert.equal(priceOptionSale(BOARD, { unitPrice: 0, persons: 3, nights: 3, units: 2 }), null);
});

test('candidate grid: an untimed card option is present on every stay day', () => {
  const grid = buildCandidateGrid({ cardRepeat: 'once_per_day', planningCardTimes: [] }, STAY);
  assert.equal(grid.length, 4);              // 18, 19, 20, 21
});

// ---- commit ----

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      propertyId INTEGER, startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT,
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalExtrasBaseline TEXT, midStaySettledNotes TEXT,
      arrivalSasDoneAt TEXT, checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT DEFAULT '', autoOptionType TEXT,
      price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', category TEXT DEFAULT '',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once',
      planningCardTimes TEXT, displayToClient INTEGER NOT NULL DEFAULT 1, autoEnabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0, cardOccurrences TEXT,
      cardPersons REAL,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0, maxGuests INTEGER DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount, maxGuests) VALUES (7, 500, 6)').run();
  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime, adults, teens, babies, complementAmount)
              VALUES (1, 7, '2026-08-18', '2026-08-21', '15:00', '10:00', 2, 1, 1, 30)`).run();
  for (const date of ['2026-08-18', '2026-08-19', '2026-08-20']) {
    db.prepare('INSERT INTO reservation_nights (reservationId, date) VALUES (1, ?)').run(date);
  }
  const insertOption = db.prepare(`INSERT INTO options (id, title, description, autoOptionType, price, priceType, category, showsPlanningCard, cardRepeat, planningCardTimes)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertOption.run(6, 'Petit déjeuner', '', 'breakfast', 8, 'per_person_per_night', 'Restauration', 1, 'once_per_day', '["09:00"]');
  insertOption.run(16, 'Le repas des trappeurs', 'Repas', null, 25, 'per_person_per_night', 'Restauration', 1, 'multiple_per_day', '["12:00","19:30"]');
  insertOption.run(27, 'Planche S', 'Apéro', null, 17, 'per_stay', 'Restauration', 0, 'once', '[]');
  return db;
}

const twoMornings = [{ date: '2026-08-19', time: '09:00' }, { date: '2026-08-20', time: '09:00' }];

test('commit: a sold breakfast lands on its catalogue option, in the complement, with its mornings', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const complement = model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  assert.equal(complement, 78);              // 30 already due + 2 mornings × 3 pers. × 8 €
  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = 6').get();
  assert.equal(row.quantity, 2);
  assert.equal(row.billedUnits, 6);
  assert.equal(row.totalPrice, 48);
  assert.equal(row.inComplement, 1);
  assert.equal(row.sasArrivalOrigin, 1);
  assert.deepEqual(JSON.parse(row.cardOccurrences), twoMornings);
});

test('commit: re-running the SAS re-prices the sale instead of stacking it', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  const complement = model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: [twoMornings[0]] }] });
  assert.equal(complement, 54);              // 30 + 1 morning × 3 × 8
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = 1').get().n, 1);
});

test('commit: « Non merci » on a re-run removes the sale and its money', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  const complement = model.commitArrivalSas(1, { soldOptions: [] });
  assert.equal(complement, 30);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = 1').get().n, 0);
});

test('commit: the sale steps never touch an option sold on the fiche', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin)
              VALUES (1, 6, 3, 8, 9, 'per_person_per_night', 72, 0, 0)`).run();
  const complement = model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  assert.equal(complement, 30);              // unchanged
  const row = db.prepare('SELECT totalPrice, inComplement, sasArrivalOrigin FROM reservation_options WHERE reservationId = 1 AND optionId = 6').get();
  assert.deepEqual(row, { totalPrice: 72, inComplement: 0, sasArrivalOrigin: 0 });
});

test('commit: a meal and a board sell together, each priced its own way', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const complement = model.commitArrivalSas(1, {
    soldOptions: [
      { optionId: 16, occurrences: [{ date: '2026-08-19', time: '19:30' }] },
      { optionId: 27, units: 2 },
    ],
  });
  assert.equal(complement, 139);             // 30 + (1 × 3 × 25) + (2 × 17)
  const meal = db.prepare('SELECT quantity, billedUnits, totalPrice FROM reservation_options WHERE optionId = 16').get();
  assert.deepEqual(meal, { quantity: 1, billedUnits: 3, totalPrice: 75 });
  const board = db.prepare('SELECT quantity, billedUnits, totalPrice, cardOccurrences FROM reservation_options WHERE optionId = 27').get();
  assert.deepEqual(board, { quantity: 2, billedUnits: 2, totalPrice: 34, cardOccurrences: null });
});

test('commit: the per-property price override wins, like everywhere else', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (7, 6, 10)').run();
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  const row = db.prepare('SELECT unitPrice, totalPrice FROM reservation_options WHERE optionId = 6').get();
  assert.deepEqual(row, { unitPrice: 10, totalPrice: 60 });
});

test('commit: with no sale steps (undefined) a previously sold prestation is left alone', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  const complement = model.commitArrivalSas(1, {});
  assert.equal(complement, 78);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE optionId = 6').get().n, 1);
});

test('commit: on a collected complement the sale is written but billed at check-out', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // The complement was collected earlier in the check-in; it never moves again.
  db.prepare('UPDATE reservations SET complementPaid = 1, complementAmount = 30 WHERE id = 1').run();
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  const r = db.prepare('SELECT complementAmount, endOfStayComplementAmount, endOfStayComplementDetail, arrivalExtrasBaseline FROM reservations WHERE id = 1').get();
  assert.equal(r.complementAmount, 30);      // frozen
  assert.equal(r.endOfStayComplementAmount, 48);
  const detail = JSON.parse(r.endOfStayComplementDetail);
  assert.equal(detail[0].label, 'Petit déjeuner');
  assert.equal(detail[0].amount, 48);
  // The prestation still exists on the reservation — it has to be prepared and planned.
  const row = db.prepare('SELECT totalPrice, inComplement, sasArrivalOrigin FROM reservation_options WHERE optionId = 6').get();
  assert.deepEqual(row, { totalPrice: 48, inComplement: 1, sasArrivalOrigin: 1 });
  // …and its key stayed OUT of the arrival baseline, else the mid-stay split would swallow it.
  assert.equal(JSON.parse(r.arrivalExtrasBaseline)['opt:6'], undefined);
});

test('commit: on a collected complement, un-selling takes the money back out of the check-out total', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  // A prestation sold on the fiche during the stay is already waiting at check-out: it must survive.
  db.prepare(`UPDATE reservations SET endOfStayComplementAmount = 6.5, endOfStayComplementDetail = ?
              WHERE id = 1`).run(JSON.stringify([{ label: 'Blonde du Pilat', qty: 1, unitPrice: 6.5, amount: 6.5, source: 'midStay', key: 'opt:18' }]));
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 6, occurrences: twoMornings }] });
  assert.equal(db.prepare('SELECT endOfStayComplementAmount AS a FROM reservations WHERE id = 1').get().a, 54.5);
  model.commitArrivalSas(1, { soldOptions: [] });
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 6.5);
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((l) => l.label), ['Blonde du Pilat']);
});

test('history: the sold prestations are listed, ménage and linge de toilette excluded', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (50, 'Ménage', 'cleaning', 40, 'per_stay')").run();
  model.commitArrivalSas(1, {
    cleaningAdded: true,
    soldOptions: [{ optionId: 27, units: 1 }],
  });
  const lines = model.listSasArrivalOptionLines(1);
  assert.deepEqual(lines.map((l) => l.label), ['Planche S']);
  assert.equal(lines[0].amount, 17);
});

test('offers: the cancellation insurance is never sold at check-in — the stay has started', () => {
  const offers = buildSasSaleOffers({ reservation: reservation(), options: [BOARD, INSURANCE] });
  assert.deepEqual(offers.catering.options.map((o) => o.optionId), [27], 'the board sells, the insurance does not');
});

// ---- served persons (specs/card-option-served-persons.md) ----
// A meal or a breakfast is not always taken by the whole table: the children often skip it.

test('offers: a card option announces the party, the capacity and what this SAS sold', () => {
  const offers = buildSasSaleOffers({ reservation: reservation(), options: [BREAKFAST, MEAL], maxPersons: 6 });
  assert.equal(offers.breakfast.defaultPersons, 3);
  assert.equal(offers.breakfast.maxPersons, 6, 'a friend can join for dinner');
  assert.equal(offers.breakfast.selectedPersons, 3, 'pre-filled with the party');
  assert.deepEqual(offers.breakfast.compositionPerPerson, {
    coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: 1, cereals: 0, bread: 0.5,
  });
  const meal = offers.catering.options.find((o) => o.optionId === 16);
  assert.equal(meal.maxPersons, 6);
});

test('offers: re-opening a SAS pre-fills the covers it sold, not the party', () => {
  const offers = buildSasSaleOffers({
    reservation: reservation({
      options: [{
        optionId: 16, sasArrivalOrigin: 1, cardPersons: 2,
        cardOccurrences: [{ date: '2026-08-19', time: '19:30' }],
      }],
    }),
    options: [MEAL],
    maxPersons: 6,
  });
  const meal = offers.catering.options.find((o) => o.optionId === 16);
  assert.equal(meal.selectedPersons, 2);
  assert.equal(meal.defaultPersons, 3);
});

test('offers: the capacity never drops below the party actually staying', () => {
  const offers = buildSasSaleOffers({ reservation: reservation(), options: [MEAL], maxPersons: 2 });
  assert.equal(offers.catering.options[0].maxPersons, 3);
});

test('price: a card option is billed moments × covers, and stores only a deliberate number', () => {
  const twoSlots = [{ date: '2026-08-19', time: '19:30' }, { date: '2026-08-20', time: '19:30' }];
  const reduced = priceOptionSale(MEAL, {
    unitPrice: 25, persons: 3, nights: 3, stay: STAY, occurrences: twoSlots, servedPersons: 2, maxPersons: 6,
  });
  assert.equal(reduced.billedUnits, 4, '2 moments × 2 covers');
  assert.equal(reduced.totalPrice, 100);
  assert.equal(reduced.cardPersons, 2);

  const wholeTable = priceOptionSale(MEAL, {
    unitPrice: 25, persons: 3, nights: 3, stay: STAY, occurrences: twoSlots, servedPersons: 3, maxPersons: 6,
  });
  assert.equal(wholeTable.billedUnits, 6);
  assert.equal(wholeTable.cardPersons, null, 'equal to the party → keeps following it');

  const raised = priceOptionSale(MEAL, {
    unitPrice: 25, persons: 3, nights: 3, stay: STAY, occurrences: twoSlots, servedPersons: 99, maxPersons: 6,
  });
  assert.equal(raised.cardPersons, 6, 'clamped to the capacity');
  assert.equal(raised.billedUnits, 12);

  const absent = priceOptionSale(MEAL, {
    unitPrice: 25, persons: 3, nights: 3, stay: STAY, occurrences: twoSlots, maxPersons: 6,
  });
  assert.equal(absent.billedUnits, 6, 'no intent → the whole party');
  assert.equal(absent.cardPersons, null);
});

test('price: a fixed-price option ignores the covers', () => {
  const line = priceOptionSale(BOARD, { unitPrice: 17, persons: 3, nights: 3, units: 1, servedPersons: 2 });
  assert.equal(line.billedUnits, 1);
  assert.equal(line.cardPersons, null);
});

test('commit: the covers are stored and drive the complement', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const complement = model.commitArrivalSas(1, {
    soldOptions: [{ optionId: 16, occurrences: [{ date: '2026-08-19', time: '19:30' }], persons: 2 }],
  });
  const line = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = 16').get();
  assert.equal(line.cardPersons, 2);
  assert.equal(line.billedUnits, 2, '1 moment × 2 covers');
  assert.equal(line.totalPrice, 50);
  assert.equal(line.inComplement, 1);
  assert.equal(line.sasArrivalOrigin, 1);
  assert.equal(complement, 80, '30 € already due + 50 €');
});

test('commit: re-running the SAS with fewer covers re-prices instead of stacking', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const moment = [{ date: '2026-08-19', time: '19:30' }];
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 16, occurrences: moment }] });
  assert.equal(db.prepare('SELECT complementAmount AS a FROM reservations WHERE id = 1').get().a, 105); // 30 + 3 × 25
  const complement = model.commitArrivalSas(1, { soldOptions: [{ optionId: 16, occurrences: moment, persons: 2 }] });
  const rows = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = 16').all();
  assert.equal(rows.length, 1, 'one line, re-priced');
  assert.equal(rows[0].cardPersons, 2);
  assert.equal(rows[0].totalPrice, 50);
  assert.equal(complement, 80);
});

test('commit: raising the covers back to the party clears the stored number', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const moment = [{ date: '2026-08-19', time: '19:30' }];
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 16, occurrences: moment, persons: 2 }] });
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 16, occurrences: moment, persons: 3 }] });
  const line = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = 16').get();
  assert.equal(line.cardPersons, null);
  assert.equal(line.totalPrice, 75);
});

test('commit: the covers are capped by the capacity of the logement', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, {
    soldOptions: [{ optionId: 16, occurrences: [{ date: '2026-08-19', time: '19:30' }], persons: 20 }],
  });
  const line = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = 16').get();
  assert.equal(line.cardPersons, 6, 'the property seats 6');
  assert.equal(line.totalPrice, 150);
});

test('history: a reduced number of covers is spelled out', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, {
    soldOptions: [{ optionId: 16, occurrences: [{ date: '2026-08-19', time: '19:30' }], persons: 2 }],
  });
  const lines = model.listSasArrivalOptionLines(1);
  assert.deepEqual(lines.map((l) => l.detail), ['1 × 2 pers. servies']);
});

test('history: a prestation served to the whole table carries no detail', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { soldOptions: [{ optionId: 27, units: 1 }] });
  assert.equal(model.listSasArrivalOptionLines(1)[0].detail, undefined);
});
