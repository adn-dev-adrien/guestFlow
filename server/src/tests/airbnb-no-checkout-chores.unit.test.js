// specs/airbnb-no-checkout-chores.md — a channel that forbids checkout chores (Airbnb) is a platform
// setting, `platforms.forbidsGuestChores`: the guest e-mails and the departure commit read it, never a
// platform name. The SAS read is pinned by plugins/sas/tests/sas-chore-free-channel.unit.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { isChoreFreeChannel, setChoreFreeChannels, refreshChoreFreeChannels } = require('../utils/platformNameFormat');
const { buildContext } = require('../utils/emailContextBuilder');
const { create: createReservationsModel } = require('../models/reservationsModel');
const { applyChoreFreeChannelsSchema, runChoreFreeChannelsMigration } = require('../utils/choreFreeChannelsMigration');

// The operator ticked « Sans corvées de départ » on Airbnb.
setChoreFreeChannels(['Airbnb']);

// specs/airbnb-no-checkout-chores.md rules 2, 8
test('isChoreFreeChannel follows the ticked platforms, whatever the recorded casing', () => {
  assert.equal(isChoreFreeChannel('Airbnb'), true);
  assert.equal(isChoreFreeChannel(' airbnb '), true);
  assert.equal(isChoreFreeChannel('AIRBNB'), true);
  assert.equal(isChoreFreeChannel('AirbnbTente'), false, 'a platform row of its own, ticked on its own');
  assert.equal(isChoreFreeChannel('Booking'), false);
  assert.equal(isChoreFreeChannel(null), false);
  assert.equal(isChoreFreeChannel(''), false);
});

// specs/airbnb-no-checkout-chores.md rule 8 — nothing is ticked by name on a new database.
test('a channel nobody ticked forbids nothing, even when it is called Airbnb', () => {
  setChoreFreeChannels([]);
  try {
    assert.equal(isChoreFreeChannel('Airbnb'), false);
    const ctx = buildContext({
      reservation: { id: 1, startDate: '2026-12-01', endDate: '2026-12-03', adults: 2, propertyId: 1, platform: 'Airbnb' },
      client: { firstName: 'A' }, property: { id: 1, name: 'La Granja' }, options: [], settings: {}, stayFacts: {},
    });
    assert.equal(ctx.flags.hasCleaningOption, false);
  } finally {
    setChoreFreeChannels(['Airbnb']);
  }
});

// specs/airbnb-no-checkout-chores.md rule 9 — the one-shot migration ticks the rows the code used to
// recognise by name (slugged prefix), once, and the cache follows the column.
test('migration chore_free_channels_v1: ticks every Airbnb row of an existing database, once', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, appliedAt TEXT)');
  db.exec('CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)');
  for (const name of ['Airbnb', 'AirbnbTente', 'Booking', 'direct']) db.prepare('INSERT INTO platforms (name) VALUES (?)').run(name);
  applyChoreFreeChannelsSchema(db);
  applyChoreFreeChannelsSchema(db);
  assert.deepEqual(runChoreFreeChannelsMigration(db), { action: 'migrated', ticked: 2 });
  const ticked = () => db.prepare('SELECT name FROM platforms WHERE forbidsGuestChores = 1 ORDER BY name').all().map((r) => r.name);
  assert.deepEqual(ticked(), ['Airbnb', 'AirbnbTente']);

  // The operator unticks one: a later boot never ticks it back.
  db.prepare("UPDATE platforms SET forbidsGuestChores = 0 WHERE name = 'AirbnbTente'").run();
  assert.deepEqual(runChoreFreeChannelsMigration(db), { action: 'skipped' });
  assert.deepEqual(ticked(), ['Airbnb']);

  try {
    refreshChoreFreeChannels(db);
    assert.equal(isChoreFreeChannel('AirbnbTente'), false);
    assert.equal(isChoreFreeChannel('Airbnb'), true);
  } finally {
    setChoreFreeChannels(['Airbnb']);
  }
});

// specs/airbnb-no-checkout-chores.md rule 6
test('e-mails: the Airbnb cleaning line is a booked ménage, and an Airbnb guest is never told the ménage is theirs', () => {
  const ctx = (reservation, customOptions = []) => buildContext({
    reservation: { id: 1, startDate: '2026-12-01', endDate: '2026-12-03', adults: 2, propertyId: 1, ...reservation },
    client: { firstName: 'A' }, property: { id: 1, name: 'La Granja' }, options: [], customOptions, settings: {}, stayFacts: {},
  });
  const paid = ctx({ platform: 'Airbnb' }, [{ description: 'Frais de ménage (Airbnb)', amount: 122 }]);
  assert.equal(paid.flags.hasCleaningOption, true, 'J-1: no « il reste à votre charge »');
  assert.match(paid.vars.cleaningParagraph, /option ménage/);

  const unpaid = ctx({ platform: 'Airbnb' });
  assert.equal(unpaid.flags.hasCleaningOption, true);
  assert.equal(unpaid.vars.cleaningParagraph, '', 'J-2: no written chore request');

  const booking = ctx({ platform: 'Booking' });
  assert.equal(booking.flags.hasCleaningOption, false, 'other channels unchanged');
  assert.match(booking.vars.cleaningParagraph, /rendre le logement comme vous l'avez trouvé/);
});

function makeDepartureDb(platform) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT,
      breakfastNote TEXT, departureHandoverNote TEXT,
      touristTaxInComplement INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', propertyId INTEGER, note TEXT);
    CREATE TABLE reservation_resources (
      reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 1,
      unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0, totalPrice REAL DEFAULT 0,
      offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare('INSERT INTO reservations (id, propertyId, adults, platform) VALUES (1, 7, 2, ?)').run(platform);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (9, 'Ménage', 'cleaning', 80, 'per_stay')").run();
  return db;
}


// specs/airbnb-no-checkout-chores.md rule 7
test('departure commit: the ménage line is dropped on a chore-free channel', () => {
  const commit = (platform) => {
    const db = makeDepartureDb(platform);
    createReservationsModel(db).commitDepartureSas(1, {
      endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', qty: 1, unitPrice: 80, amount: 80 }],
    });
    return db.prepare('SELECT endOfStayComplementAmount FROM reservations WHERE id = 1').get().endOfStayComplementAmount;
  };
  assert.equal(commit('Airbnb'), 0, 'the line is dropped whatever the client sends');
  assert.equal(commit('Booking'), 80);
});
