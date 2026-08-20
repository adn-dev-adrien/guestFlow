const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  findBabyBedOption,
  normalizeBabyBedCount,
  isBabyBedSupplementGrandfathered,
  resolveBillableBabyBeds,
  buildBabyBedSupplementLine,
} = require('../utils/babyBedSupplement');

// specs/baby-bed-supplement.md — 5 € per cot, for the WHOLE stay, derived by the engine from
// `reservations.babyBeds`; and never a cent added to a booking taken before the supplement existed.

const OPTION = Object.freeze({
  id: 42, title: 'Lit bébé', price: 5, priceType: 'per_stay',
  autoOptionType: 'baby_bed', autoEnabled: 1,
});

// ── The price ────────────────────────────────────────────────────────────────

test('one cot bills the unit price once, for the stay', () => {
  const line = buildBabyBedSupplementLine({ option: OPTION, babyBeds: 1 });
  assert.equal(line.optionId, 42);
  assert.equal(line.title, 'Lit bébé');
  assert.equal(line.quantity, 1);
  assert.equal(line.billedUnits, 1);
  assert.equal(line.unitPrice, 5);
  assert.equal(line.totalPrice, 5);
  assert.equal(line.priceType, 'per_stay');
  assert.equal(line.autoOptionType, 'baby_bed');
});

test('three cots bill three times the unit price', () => {
  const line = buildBabyBedSupplementLine({ option: OPTION, babyBeds: 3 });
  assert.equal(line.quantity, 3);
  assert.equal(line.billedUnits, 3);
  assert.equal(line.totalPrice, 15);
});

test('the catalogue price type is ignored — a cot is never per night or per person', () => {
  const perNight = buildBabyBedSupplementLine({
    option: { ...OPTION, priceType: 'per_person_per_night' }, babyBeds: 2,
  });
  assert.equal(perNight.priceType, 'per_stay');
  assert.equal(perNight.totalPrice, 10, 'still 5 € × 2 cots, whatever the row says');
});

test('no cot, no line', () => {
  assert.equal(buildBabyBedSupplementLine({ option: OPTION, babyBeds: 0 }), null);
  assert.equal(buildBabyBedSupplementLine({ option: OPTION, babyBeds: null }), null);
  assert.equal(buildBabyBedSupplementLine({ option: OPTION, babyBeds: '' }), null);
  assert.equal(buildBabyBedSupplementLine({ option: OPTION, babyBeds: -2 }), null);
});

test('a free cot produces NO line at all, not a 0,00 € one (§3.1 rule 4)', () => {
  assert.equal(buildBabyBedSupplementLine({ option: { ...OPTION, price: 0 }, babyBeds: 2 }), null);
  assert.equal(buildBabyBedSupplementLine({ option: OPTION, babyBeds: 2, unitPrice: 0 }), null,
    'a per-property price of 0 is the documented opt-out');
});

test('the option must be engine-managed to bill anything', () => {
  assert.equal(buildBabyBedSupplementLine({ option: { ...OPTION, autoEnabled: 0 }, babyBeds: 1 }), null);
  assert.equal(buildBabyBedSupplementLine({ option: { ...OPTION, autoOptionType: 'cleaning' }, babyBeds: 1 }), null);
  assert.equal(buildBabyBedSupplementLine({ option: null, babyBeds: 1 }), null);
});

test('a saved booking keeps the price it was sold at, on the CURRENT cot count (§3.4 rule 15)', () => {
  const line = buildBabyBedSupplementLine({
    option: { ...OPTION, price: 6 }, // the catalogue moved on…
    babyBeds: 3, // …the operator added a third cot…
    unitPrice: 4, // …but the booking was sold at 4 €.
  });
  assert.equal(line.unitPrice, 4);
  assert.equal(line.quantity, 3);
  assert.equal(line.totalPrice, 12);
});

test('cot counts are whole beds', () => {
  assert.equal(normalizeBabyBedCount(2.7), 2);
  assert.equal(normalizeBabyBedCount('2'), 2);
  assert.equal(normalizeBabyBedCount('abc'), 0);
  assert.equal(normalizeBabyBedCount(undefined), 0);
});

test('findBabyBedOption picks the engine-managed row only', () => {
  const catalogue = [
    { id: 1, autoOptionType: 'early_check_in', autoEnabled: 1 },
    { id: 2, autoOptionType: 'baby_bed', autoEnabled: 0 }, // a decoy: typed but not engine-managed
    OPTION,
  ];
  assert.equal(findBabyBedOption(catalogue).id, 42);
  assert.equal(findBabyBedOption([]), null);
  assert.equal(findBabyBedOption(undefined), null);
});

// ── The exemption (§3.3) ─────────────────────────────────────────────────────

function createBookingsDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', babyBeds INTEGER);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER, totalPrice REAL);
  `);
  const addBooking = (id, babyBeds, kind = 'reservation') => db
    .prepare('INSERT INTO reservations (id, kind, babyBeds) VALUES (?, ?, ?)').run(id, kind, babyBeds);
  const addLine = (reservationId, optionId) => db
    .prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (?, ?, 1, 5)')
    .run(reservationId, optionId);
  return { db, addBooking, addLine };
}

test('a booking stored WITH cots and WITHOUT the line is grandfathered — forever', () => {
  const { db, addBooking } = createBookingsDb();
  addBooking(1, 2);
  assert.equal(isBabyBedSupplementGrandfathered(db, 1, 42), true);
  db.close();
});

test('a booking that already carries the line is NOT grandfathered — it reprices on the count', () => {
  const { db, addBooking, addLine } = createBookingsDb();
  addBooking(1, 2);
  addLine(1, 42);
  assert.equal(isBabyBedSupplementGrandfathered(db, 1, 42), false);
  db.close();
});

test('a booking stored with NO cot is not grandfathered — adding one later is a new sale', () => {
  const { db, addBooking } = createBookingsDb();
  addBooking(1, 0);
  addBooking(2, null);
  assert.equal(isBabyBedSupplementGrandfathered(db, 1, 42), false);
  assert.equal(isBabyBedSupplementGrandfathered(db, 2, 42), false);
  db.close();
});

test('a devis is grandfathered by the very same rule (same table, same verdict)', () => {
  const { db, addBooking } = createBookingsDb();
  addBooking(7, 1, 'devis');
  assert.equal(isBabyBedSupplementGrandfathered(db, 7, 42), true);
  db.close();
});

test('an unsaved or unknown booking is never grandfathered', () => {
  const { db, addBooking } = createBookingsDb();
  addBooking(1, 2);
  assert.equal(isBabyBedSupplementGrandfathered(db, 0, 42), false, 'no id = the booking does not exist yet');
  assert.equal(isBabyBedSupplementGrandfathered(db, undefined, 42), false);
  assert.equal(isBabyBedSupplementGrandfathered(db, 999, 42), false, 'unknown id');
  assert.equal(isBabyBedSupplementGrandfathered(db, 1, 0), false, 'no option to look for');
  db.close();
});

test('a schema without the booking tables never grandfathers (nothing to protect)', () => {
  const db = new Database(':memory:');
  assert.equal(isBabyBedSupplementGrandfathered(db, 1, 42), false);
  db.close();
});

test('resolveBillableBabyBeds is the single gate: exemption wins over the current count', () => {
  const { db, addBooking, addLine } = createBookingsDb();
  addBooking(1, 2); // grandfathered
  addBooking(2, 0); // no cot stored
  addBooking(3, 1); addLine(3, 42); // already billed

  assert.equal(resolveBillableBabyBeds({ database: db, bookingId: 1, option: OPTION, babyBeds: 3 }), 0,
    'even raising the count on a grandfathered booking bills nothing');
  assert.equal(resolveBillableBabyBeds({ database: db, bookingId: 2, option: OPTION, babyBeds: 1 }), 1);
  assert.equal(resolveBillableBabyBeds({ database: db, bookingId: 3, option: OPTION, babyBeds: 2 }), 2,
    'a billed booking follows its current count');
  assert.equal(resolveBillableBabyBeds({ database: db, bookingId: undefined, option: OPTION, babyBeds: 2 }), 2,
    'a new booking bills every cot');
  assert.equal(resolveBillableBabyBeds({ database: db, bookingId: 2, option: null, babyBeds: 2 }), 0,
    'no catalogue option, nothing to bill');
  db.close();
});
