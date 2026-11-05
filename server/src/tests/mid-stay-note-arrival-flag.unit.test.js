// specs/mid-stay-notes.md rules 5bis, 23 (D19) — a note on a started stay with no arrival marked stays open: the server
// says so on the note's own preview. The flag follows the baseline the engine reads, read fresh at each preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const dayAt = (n) => addDaysToIsoDate(todayIso(), n);

function modelDb(columns = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, startDate TEXT, endDate TEXT, arrivalExtrasBaseline TEXT, complementPaid INTEGER DEFAULT 0, complementPaidCash INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, arrivalSasDoneAt TEXT, updatedAt TEXT);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL DEFAULT 0, offered INTEGER DEFAULT 0);
  `);
  db.prepare('INSERT INTO reservations (id, startDate, endDate) VALUES (1, ?, ?)').run(dayAt(-2), dayAt(3));
  Object.entries(columns).forEach(([name, value]) => db.prepare(`UPDATE reservations SET ${name} = ? WHERE id = 1`).run(value));
  return db;
}

test('rule 23: started, no check-in, no SAS, nothing collected → arrival not marked, and no baseline', () => {
  const model = createReservationsModel(modelDb());
  assert.equal(model.isArrivalNotMarked(1), true);
  assert.equal(model.resolveArrivalExtrasBaseline(1), null);
});

test('rule 23: check-in, arrival SAS, a collected complement or a stored baseline → no flag', () => {
  for (const columns of [
    { checkInDone: 1 },
    { arrivalSasDoneAt: `${dayAt(-2)} 16:10:00` },
    { complementPaid: 1 },
    { complementPaidCash: 1 },
    { arrivalExtrasBaseline: '{}' },
  ]) {
    const model = createReservationsModel(modelDb(columns));
    assert.equal(model.isArrivalNotMarked(1), false, JSON.stringify(columns));
    assert.notEqual(model.resolveArrivalExtrasBaseline(1), null, JSON.stringify(columns));
  }
});

test('rule 23: an unknown stay is no flag', () => {
  assert.equal(createReservationsModel(modelDb()).isArrivalNotMarked(999), false);
});

test('rule 23: the preview answers the flag beside its amounts, read for that stay; no stay named, no flag', () => {
  const asked = [];
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/reservationsModel') {
      return new Proxy({}, { get: (_, key) => (key === 'isArrivalNotMarked' ? (rid) => { asked.push(rid); return true; } : () => null) });
    }
    return original.call(this, id);
  };
  const file = require.resolve('../controllers/reservationsController');
  const cached = require.cache[file];
  delete require.cache[file];
  let controller;
  try { controller = require(file); } finally {
    Module.prototype.require = original;
    if (cached) require.cache[file] = cached; else delete require.cache[file];
  }
  const respond = (body) => { let out; controller.previewMidStayNote({ body }, { json: (b) => { out = b; } }); return out; };
  assert.deepEqual(respond({ reservationId: 7, opening: [], current: [], checkedKeys: [] }), { items: [], total: 0, arrivalNotMarked: true });
  assert.deepEqual(asked, [7]);
  for (const reservationId of [undefined, null, 0, -1, 'abc', { toString: 1 }]) {
    assert.deepEqual(respond({ reservationId, opening: [], current: [], checkedKeys: [] }), { items: [], total: 0, arrivalNotMarked: false });
  }
  assert.deepEqual(asked, [7]);
});
