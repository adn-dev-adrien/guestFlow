const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildWelcomePackLines } = require('../utils/welcomePack');
const propertiesModel = require('../models/propertiesModel');

// specs/welcome-pack-auto-options.md — the pack a brand-new own-channel reservation arrives with.
// Two invariants are under test everywhere below: it comes from `freeUnits` (never from an option
// name), and it NEVER emits a line the free units don't fully cover (rule 7).

// ── the pack query (rules 1-2) ───────────────────────────────────────────────────────────────

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay',
      price REAL DEFAULT 0, autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT, planningCardTimes TEXT DEFAULT '[]',
      breakfastTime TEXT DEFAULT '09:00', archivedAt TEXT, displayToClient INTEGER DEFAULT 1);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  `);
  const addOption = (id, title, extra = {}) => {
    db.prepare(`INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled,
      showsPlanningCard, cardRepeat, planningCardTimes, archivedAt, displayToClient)
      VALUES (@id, @title, @priceType, @price, @autoOptionType, @autoEnabled, @showsPlanningCard,
              @cardRepeat, @planningCardTimes, @archivedAt, @displayToClient)`).run({
      id, title, priceType: 'per_stay', price: 5, autoOptionType: null, autoEnabled: 0,
      showsPlanningCard: 0, cardRepeat: 'once', planningCardTimes: '[]', archivedAt: null,
      displayToClient: 1, ...extra,
    });
  };
  // The pack of the Lodge: 2 breakfasts (card, per person per night) + 1 juice (per stay).
  addOption(6, 'Petit déjeuner', {
    priceType: 'per_person_per_night', price: 8, autoOptionType: 'breakfast',
    showsPlanningCard: 1, cardRepeat: 'once_per_day', planningCardTimes: '["09:00"]',
  });
  addOption(21, 'Jus de pomme 1L');
  // Not in any pack: no freeUnits row at all.
  addOption(16, 'Le repas des trappeurs', { price: 25 });
  // In the pack on paper, but excluded by rule 2 / rule 1.
  addOption(30, 'Option archivée', { archivedAt: '2026-01-01' });
  addOption(31, 'Option interne', { displayToClient: 0 });
  addOption(32, 'Arrivée anticipée', { autoOptionType: 'early_check_in', autoEnabled: 1 });
  addOption(33, 'Option d’un autre logement');
  for (const optionId of [6, 21, 16, 30, 31, 32]) {
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(optionId);
  }
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (2, 33)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 6, 10, 2)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 21, 5, 1)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 16, 25, 0)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 30, 5, 1)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 31, 5, 1)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 32, 5, 1)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (2, 33, 5, 1)').run();
  return db;
}

test('the pack is the property options with freeUnits > 0, and nothing else', () => {
  const model = propertiesModel.buildModel(createDb());
  const pack = model.listWelcomePackOptions(1);
  assert.deepEqual(pack.map((o) => o.optionId), [21, 6], 'by title; archived / internal / auto / freeUnits=0 are out');
  assert.equal(pack.find((o) => o.optionId === 6).freeUnits, 2);
  assert.equal(pack.find((o) => o.optionId === 6).unitPrice, 10, 'the per-property price override wins');
  assert.equal(pack.find((o) => o.optionId === 21).freeUnits, 1);
});

test('a property with no included unit has an empty pack', () => {
  const model = propertiesModel.buildModel(createDb());
  assert.deepEqual(model.listWelcomePackOptions(2).map((o) => o.optionId), [33], 'its own pack only');
  assert.deepEqual(model.listWelcomePackOptions(3), [], 'unknown property');
  assert.deepEqual(model.listWelcomePackOptions('nope'), []);
});

// ── the lines (rules 3, 7, 8, 9) ─────────────────────────────────────────────────────────────

const PACK = [
  {
    optionId: 6, title: 'Petit déjeuner', priceType: 'per_person_per_night', autoOptionType: 'breakfast',
    showsPlanningCard: 1, cardRepeat: 'once_per_day', planningCardTimes: '["09:00"]', breakfastTime: '09:00',
    unitPrice: 10, freeUnits: 2,
  },
  { optionId: 21, title: 'Jus de pomme 1L', priceType: 'per_stay', showsPlanningCard: 0, unitPrice: 5, freeUnits: 1 },
];

const STAY = {
  startDate: '2026-08-14', endDate: '2026-08-17', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0,
};

const build = (over = {}) => buildWelcomePackLines({ packOptions: PACK, platform: 'direct', ...STAY, ...over });
const lineFor = (result, optionId) => result.lines.find((l) => l.optionId === optionId);

test('own channels get the pack, commissioned platforms get nothing', () => {
  for (const platform of ['direct', 'Direct', 'lodgify', 'Lodgify']) {
    assert.equal(build({ platform }).eligible, true, platform);
  }
  for (const platform of ['Airbnb', 'Booking', 'Abritel', 'Greengo']) {
    assert.deepEqual(build({ platform }), { eligible: false, lines: [] }, String(platform));
  }
  // An unset platform is the form's own default (`direct`), and `isDirectChannel` reads it that way.
  assert.equal(build({ platform: '' }).eligible, true);
  assert.equal(build({ platform: null }).eligible, true);
});

test('the per-stay option is granted at exactly its free quantity', () => {
  const juice = lineFor(build(), 21);
  assert.equal(juice.mode, 'quantity');
  assert.equal(juice.quantity, 1, '1 unit ordered, 1 unit free, 0 € billed');
  assert.equal(juice.freeUnits, 1);
});

test('the card option is granted on the first morning only', () => {
  const breakfast = lineFor(build(), 6);
  assert.equal(breakfast.mode, 'occurrence');
  // Breakfast at 09:00 with a 15:00 check-in: the arrival day is not served.
  assert.deepEqual(breakfast.occurrence, { date: '2026-08-15', time: '09:00' });
});

test('a per-person card line is granted at 2 guests and dropped above the free units (rule 7)', () => {
  assert.ok(lineFor(build({ adults: 2 }), 6), '2 guests = 2 units = the 2 free ones');
  assert.equal(lineFor(build({ adults: 3 }), 6), undefined, 'a 3rd guest would be billed → no line');
  assert.equal(lineFor(build({ adults: 2, children: 1 }), 6), undefined, 'children count as persons');
  assert.equal(lineFor(build({ adults: 2, teens: 1 }), 6), undefined, 'so do teens');
  assert.ok(lineFor(build({ adults: 1, teens: 1 }), 6), 'and 1 adult + 1 teen is still 2 persons');
  assert.ok(lineFor(build({ adults: 4 }), 21), 'the juice is per stay — the party size never affects it');
});

test('babies are not persons (rule 9)', () => {
  assert.ok(lineFor(buildWelcomePackLines({
    packOptions: PACK, platform: 'direct', ...STAY, adults: 2, babies: 2,
  }), 6));
});

test('the first morning follows the serving time vs the check-in hour (rule 8)', () => {
  // An option served at 18:00 with a 15:00 check-in IS served on the arrival day.
  const evening = [{ ...PACK[0], planningCardTimes: '["18:00"]', autoOptionType: null, priceType: 'per_night' }];
  const result = buildWelcomePackLines({ packOptions: evening, platform: 'direct', ...STAY });
  assert.deepEqual(result.lines[0].occurrence, { date: '2026-08-14', time: '18:00' });
});

test('a one-night stay still gets its breakfast the departure morning', () => {
  const result = build({ startDate: '2026-08-14', endDate: '2026-08-15' });
  assert.deepEqual(lineFor(result, 6).occurrence, { date: '2026-08-15', time: '09:00' });
});

test('a check-out before the breakfast hour keeps the departure morning (breakfast exception)', () => {
  const result = build({ startDate: '2026-08-14', endDate: '2026-08-15', checkOutTime: '08:00' });
  assert.deepEqual(lineFor(result, 6).occurrence, { date: '2026-08-15', time: '09:00' });
  // Any other card option would simply not be served that morning.
  const other = [{ ...PACK[0], autoOptionType: null, priceType: 'per_night' }];
  const dropped = buildWelcomePackLines({
    packOptions: other, platform: 'direct', ...STAY, startDate: '2026-08-14', endDate: '2026-08-15', checkOutTime: '08:00',
  });
  assert.deepEqual(dropped.lines, []);
});

test('without dates the card line waits, the per-stay line still applies', () => {
  const result = build({ startDate: '', endDate: '' });
  assert.equal(lineFor(result, 6), undefined);
  assert.equal(lineFor(result, 21).quantity, 1);
});

test('an empty pack is not eligible', () => {
  assert.deepEqual(buildWelcomePackLines({ packOptions: [], platform: 'direct', ...STAY }), { eligible: false, lines: [] });
  assert.deepEqual(buildWelcomePackLines({ platform: 'direct' }), { eligible: false, lines: [] });
});

test('fractional free units are floored — half a breakfast is not served', () => {
  const half = [{ ...PACK[1], freeUnits: 0.5 }];
  assert.deepEqual(buildWelcomePackLines({ packOptions: half, platform: 'direct', ...STAY }).lines, []);
});

test('a per-night option is granted for as many whole nights as the rate covers', () => {
  const perNight = [{ optionId: 40, title: 'Sauna', priceType: 'per_night', showsPlanningCard: 0, unitPrice: 20, freeUnits: 3 }];
  // 3 nights of stay, 3 free units, multiplier = 3 nights → quantity 1 (= 3 billed units, all free).
  const result = buildWelcomePackLines({ packOptions: perNight, platform: 'direct', ...STAY });
  assert.equal(result.lines[0].quantity, 1);
  // A 4-night stay would bill a 4th unit → no line at all.
  const longer = buildWelcomePackLines({ packOptions: perNight, platform: 'direct', ...STAY, endDate: '2026-08-18' });
  assert.deepEqual(longer.lines, []);
});
