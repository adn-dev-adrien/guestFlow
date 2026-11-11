// specs/vat-optional-mode.md rules 4, 5, 6 and 7 — which period a reservation is sold under: assigned by
// a trigger at insert (so no insert path can forget it), by booking day in Paris, by arrival, or for all;
// final once assigned; a devis never converted is resolved live. The SQL trigger and its JS twin
// (utils/vatRegime) run on the same matrix.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runVatRegimeMigration } = require('../utils/vatRegimeMigration');
const vatRegimeModel = require('../models/vatRegimeModel');
const rules = require('../utils/vatRegime');
const { todayIso, localIsoDate } = require('../utils/localDate');

function build() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      startDate TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  runVatRegimeMigration(db);
  return db;
}

const addPeriod = (db, { regime = 'not_subject', rate = 0, mention = 'art_293_b', basis, from = null }) => db.prepare(
  'INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom) VALUES (?, ?, ?, ?, ?)',
).run(regime, regime === 'subject' ? rate : 0, regime === 'subject' ? null : mention, basis, from).lastInsertRowid;

const insert = (db, createdAt, startDate, kind = 'reservation') => db.prepare(
  'INSERT INTO reservations (kind, createdAt, startDate) VALUES (?, ?, ?)',
).run(kind, createdAt, startDate).lastInsertRowid;

const periodOf = (db, id) => db.prepare('SELECT vatPeriodId FROM reservations WHERE id = ?').get(id).vatPeriodId;

test('rule 4: the trigger assigns the period whatever the insert statement', () => {
  const db = build();
  const second = addPeriod(db, { basis: 'all' });
  db.prepare("INSERT INTO reservations (startDate) VALUES ('2027-01-01')").run();
  db.prepare("INSERT INTO reservations (startDate) SELECT startDate FROM reservations WHERE id = 1").run();
  db.prepare("INSERT OR REPLACE INTO reservations (id, startDate) VALUES (50, '2027-02-01')").run();
  db.prepare("INSERT INTO reservations (kind, startDate) VALUES ('devis', '2027-02-01')").run();
  const periods = db.prepare('SELECT DISTINCT vatPeriodId FROM reservations').all().map((r) => r.vatPeriodId);
  assert.deepEqual(periods, [Number(second)]);
});

test('rule 4: a row inserted with its period keeps it', () => {
  const db = build();
  addPeriod(db, { basis: 'all' });
  db.prepare("INSERT INTO reservations (startDate, vatPeriodId) VALUES ('2027-01-01', 1)").run();
  assert.equal(periodOf(db, 1), 1);
});

test('rule 5: basis booking compares the booking day in Paris, never in UTC', () => {
  const db = build();
  const second = Number(addPeriod(db, { basis: 'booking', from: '2027-01-11' }));
  const winterBefore = insert(db, '2027-01-10 22:59:59', '2027-03-01');
  const winterAfter = insert(db, '2027-01-10 23:00:00', '2027-03-01');
  const summerBefore = insert(db, '2027-07-10 21:59:59', '2027-09-01');
  assert.deepEqual([periodOf(db, winterBefore), periodOf(db, winterAfter), periodOf(db, summerBefore)], [1, second, second]);
});

test('rule 5: basis booking, edge — 00:30 in Paris on the switch day is that day', () => {
  const db = build();
  const second = Number(addPeriod(db, { basis: 'booking', from: '2027-07-11' }));
  assert.equal(periodOf(db, insert(db, '2027-07-10 22:30:00', '2027-08-01')), second);
  assert.equal(periodOf(db, insert(db, '2027-07-10 21:59:00', '2027-08-01')), 1);
});

test('rule 5: basis arrival compares the start date; basis all applies to everything', () => {
  const db = build();
  const arrival = Number(addPeriod(db, { basis: 'arrival', from: '2027-06-01' }));
  const before = insert(db, '2027-01-01 10:00:00', '2027-05-31');
  const onDay = insert(db, '2027-01-01 10:00:00', '2027-06-01');
  assert.deepEqual([periodOf(db, before), periodOf(db, onDay)], [1, arrival]);
  const all = Number(addPeriod(db, { regime: 'subject', rate: 20, basis: 'all' }));
  assert.equal(periodOf(db, insert(db, '2020-01-01 10:00:00', '2020-02-01')), all);
});

test('rule 5: the latest period that applies wins', () => {
  const db = build();
  const a = Number(addPeriod(db, { basis: 'booking', from: '2027-02-01' }));
  const b = Number(addPeriod(db, { regime: 'subject', rate: 5, basis: 'booking', from: '2027-04-01' }));
  assert.deepEqual([
    periodOf(db, insert(db, '2027-01-15 10:00:00', '2027-08-01')),
    periodOf(db, insert(db, '2027-03-15 10:00:00', '2027-08-01')),
    periodOf(db, insert(db, '2027-05-15 10:00:00', '2027-08-01')),
  ], [1, a, b]);
});

test('rule 5: a period dated in the future leaves new reservations on the previous one', () => {
  const db = build();
  const future = localIsoDate(new Date(Date.now() + 40 * 86400000));
  addPeriod(db, { basis: 'booking', from: future });
  const id = insert(db, `${todayIso()} 10:00:00`, future);
  assert.equal(periodOf(db, id), 1);
  assert.equal(vatRegimeModel.forRow(db, { id }).regime, 'subject');
  assert.equal(vatRegimeModel.forRow(db, null).regime, 'subject');
});

test('rule 6: editing dates or status never changes the period', () => {
  const db = build();
  const second = Number(addPeriod(db, { basis: 'arrival', from: '2027-06-01' }));
  const id = insert(db, '2027-01-01 10:00:00', '2027-07-01');
  db.prepare("UPDATE reservations SET startDate = '2027-01-15' WHERE id = ?").run(id);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(id);
  db.prepare("UPDATE reservations SET kind = 'reservation' WHERE id = ?").run(id);
  assert.equal(periodOf(db, id), second);
  assert.equal(vatRegimeModel.forRow(db, { id }).periodId, second);
});

test('rule 6: the resolver answers the stored period even when the row would now fall elsewhere', () => {
  const db = build();
  const second = Number(addPeriod(db, { basis: 'arrival', from: '2027-06-01' }));
  const id = insert(db, '2027-01-01 10:00:00', '2027-07-01');
  db.prepare("UPDATE reservations SET startDate = '2027-01-15' WHERE id = ?").run(id);
  assert.equal(vatRegimeModel.forRow(db, { id, startDate: '2027-01-15' }).periodId, second);
});

test('rule 7: a devis never converted is resolved as if booked today, whatever period its row carries', () => {
  const db = build();
  const reservation = insert(db, '2027-01-01 10:00:00', '2027-09-01');
  const devis = insert(db, '2027-01-01 10:00:00', '2027-09-01', 'devis');
  const second = Number(addPeriod(db, { basis: 'booking', from: todayIso() }));
  assert.equal(periodOf(db, devis), 1);
  assert.equal(vatRegimeModel.forRow(db, { id: devis }).periodId, second);
  assert.equal(vatRegimeModel.forRow(db, { id: reservation }).periodId, 1);
});

test('rule 7: a devis re-sent after an arrival-dated switch prints the regime of its own arrival', () => {
  const db = build();
  const second = Number(addPeriod(db, { basis: 'arrival', from: '2027-06-01' }));
  const early = insert(db, '2027-01-01 10:00:00', '2027-05-01', 'devis');
  const late = insert(db, '2027-01-01 10:00:00', '2027-07-01', 'devis');
  assert.deepEqual([vatRegimeModel.forRow(db, { id: early }).periodId, vatRegimeModel.forRow(db, { id: late }).periodId], [1, second]);
});

test('rules 4 and 5: the SQL trigger and the JS predicate agree on a 48-row matrix', () => {
  const db = build();
  addPeriod(db, { basis: 'booking', from: '2027-03-01' });
  addPeriod(db, { regime: 'subject', rate: 20, basis: 'arrival', from: '2027-05-15' });
  addPeriod(db, { basis: 'booking', from: '2027-09-01', mention: 'art_261_d_4' });
  const createdAts = ['2027-02-28 22:59:59', '2027-02-28 23:00:00', '2027-03-01 08:00:00', '2027-08-31 21:59:59',
    '2027-08-31 22:00:00', '2027-12-31 23:30:00'];
  const startDates = ['2027-01-01', '2027-05-14', '2027-05-15', '2027-06-30', '2027-09-01', '2028-02-29', '2027-03-01', '2027-12-31'];
  const periods = db.prepare('SELECT * FROM vat_periods').all();
  let rows = 0;
  for (const createdAt of createdAts) {
    for (const startDate of startDates) {
      const id = insert(db, createdAt, startDate);
      const expected = rules.pickPeriod(periods, { bookingDay: rules.bookingDayOf(createdAt), startDate }).id;
      assert.equal(periodOf(db, id), expected, `${createdAt} → ${startDate}`);
      rows += 1;
    }
  }
  assert.equal(rows, 48);
});

test('rule 5: bookingDayOf reads a stored timestamp as UTC and a bare date as the day itself', () => {
  assert.equal(rules.bookingDayOf('2027-01-10 23:00:00'), '2027-01-11');
  assert.equal(rules.bookingDayOf('2027-07-10 21:59:59'), '2027-07-10');
  assert.equal(rules.bookingDayOf('2027-07-10'), '2027-07-10');
  assert.equal(rules.bookingDayOf('2027-07-10T21:59:59Z'), '2027-07-10');
  assert.equal(rules.bookingDayOf(''), null);
  assert.equal(rules.bookingDayOf('not a date'), null);
});
