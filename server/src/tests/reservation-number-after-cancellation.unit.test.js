// specs/reservation-number-and-search.md rules 13 and 14 — a cancelled stay keeps its number, so the
// generator must step over it. Before the fix, cancelling the latest stay of the month made the next
// creation reuse that number: the unique index refused the write (HTTP 500), the row was left behind
// without a number, devis conversions and iCal imports failed the same way until the month changed.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Database = require('better-sqlite3');

const {
  monthPrefix, nextNumberForPrefix, repairNumberlessReservations,
} = require('../utils/reservationNumber');
const reservationsModelFactory = require('../models/reservationsModel');
const devisModelFactory = require('../models/devisModel');
const propertyIcalModel = require('../models/propertyIcalModel');
const { globalFetch } = require('./icalFetchFixture');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const PREFIX = monthPrefix(new Date());
/** `YYYY-MM-DD`, `days` after today: a stay the controller creates is never in the past (specs/server-test-isolation.md rule 6). */
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

function realSchemaDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.exec('CREATE UNIQUE INDEX ux_reservations_reservationNumber ON reservations(reservationNumber) WHERE reservationNumber IS NOT NULL');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return db;
}

function minimalDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', reservationNumber TEXT)");
  return db;
}

// The boot database (DB_PATH=:memory:, every migration applied), seeded once with a property and a
// client — the iCal engine and the controller read columns the bare schema.sql does not carry.
function bootDb() {
  const db = require('../database');
  db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return db;
}

// Two stays this month, the second one cancelled: it holds the highest number of the month.
function seedCancelledMax(db) {
  db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, reservationNumber)
              VALUES ('reservation', 1, 1, '2027-03-01', '2027-03-04', ?)`).run(`${PREFIX}001`);
  db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, reservationNumber)
              VALUES ('cancelled', 1, 1, '2027-03-10', '2027-03-14', ?)`).run(`${PREFIX}002`);
}

const QUOTE = {
  totalPrice: 300, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 300,
  depositAmount: 0, depositDueDate: null, balanceAmount: 300, balanceDueDate: null, complementAmount: 0,
};
const NIGHT_BLOCKS = { blocksPreviousNight: 0, blocksNextNight: 0 };

// ── rule 13: the generator ───────────────────────────────────────────────────

test('rule 13 — the next number steps over a cancelled stay that holds the max', () => {
  const db = realSchemaDb();
  seedCancelledMax(db);
  assert.equal(nextNumberForPrefix(db, PREFIX), `${PREFIX}003`);
});

test('rule 13 — the max is numeric: the 1000th stay of a month follows the 999th', () => {
  const db = minimalDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '202603999')").run();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '2026031000')").run();
  assert.equal(nextNumberForPrefix(db, '202603'), '2026031001');
});

test('rule 13 — an operator number that is not prefix + digits is ignored', () => {
  const db = minimalDb();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '202603-PERSO')").run();
  db.prepare("INSERT INTO reservations (kind, reservationNumber) VALUES ('reservation', '202603004')").run();
  assert.equal(nextNumberForPrefix(db, '202603'), '202603005');
});

test('rule 13 — the model creates a stay after a cancellation instead of colliding', () => {
  const db = realSchemaDb();
  seedCancelledMax(db);
  const model = reservationsModelFactory.create(db);
  const id = model.insertReservation(
    { propertyId: 1, clientId: 1, startDate: '2027-04-01', endDate: '2027-04-03', adults: 2, platform: 'direct' },
    QUOTE, NIGHT_BLOCKS,
  );
  assert.equal(model.getReservationNumber(id), `${PREFIX}003`);
});

test('rule 13 — a devis converted after a cancellation gets the next free number', () => {
  const db = realSchemaDb();
  seedCancelledMax(db);
  const devis = db.prepare(`
    INSERT INTO reservations (kind, devisNumber, devisStatus, propertyId, clientId, startDate, endDate, adults, totalPrice, finalPrice)
    VALUES ('devis', '2026-10-001', 'sent', 1, 1, '2027-05-01', '2027-05-04', 2, 300, 300)
  `).run();
  const out = devisModelFactory.buildModel(db).convertToReservation(devis.lastInsertRowid);
  assert.equal(out.ok, true, JSON.stringify(out));
  const row = db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(out.data.reservationId);
  assert.equal(row.reservationNumber, `${PREFIX}003`);
});

test('rule 13 — an iCal booking imported after a cancellation is created and numbered', async () => {
  const db = bootDb();
  db.prepare('DELETE FROM reservations').run();
  seedCancelledMax(db);
  db.prepare("INSERT OR IGNORE INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Booking', 'http://feed.test/ical', 'booking', 'Booking')").run();
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:B1', 'DTSTART;VALUE=DATE:20270610',
      'DTEND;VALUE=DATE:20270613', 'SUMMARY:CLOSED - Not available', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
  });
  try {
    const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };
    const result = await propertyIcalModel.buildModel(db, { fetchImpl: globalFetch }).syncSource(source);
    assert.equal(result.createdCount, 1);
  } finally {
    global.fetch = origFetch;
  }
  const row = db.prepare("SELECT reservationNumber FROM reservations WHERE sourceIcalEventUid = 'B1'").get();
  assert.equal(row.reservationNumber, `${PREFIX}003`);
  db.prepare('DELETE FROM reservations').run();
});

// ── rule 13: the creation is one write ───────────────────────────────────────

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// The real controller on the real boot schema (DB_PATH=:memory:), with only the pricing engine stubbed.
function loadController() {
  const quote = {
    ...QUOTE, nights: 3, optionLines: [], resourceLines: [], nightlyBreakdown: [], midStayExtrasLines: [], error: null,
  };
  return withMocks({
    '../utils/pricing': { calculateReservationQuote: () => ({ ...quote }) },
  }, () => {
    const p = '../controllers/reservationsController';
    delete require.cache[require.resolve(p)];
    return require(p);
  });
}

const BODY = {
  propertyId: 1, clientId: 1, adults: 2, children: 0, teens: 0, babies: 0,
  checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
  singleBeds: 0, doubleBeds: 0, babyBeds: 0,
};

test('rule 13 — create after a cancellation answers 200 with the next number (real controller)', () => {
  const controller = loadController();
  const db = bootDb();
  const created = [];
  for (const dates of [[inDays(244), inDays(247)], [inDays(253), inDays(256)]]) {
    const res = fakeRes();
    controller.create({ body: { ...BODY, startDate: dates[0], endDate: dates[1] }, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    created.push(res.body);
  }
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(created[1].id);

  const res = fakeRes();
  controller.create({ body: { ...BODY, startDate: inDays(263), endDate: inDays(266) }, user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const last = Number(String(created[1].reservationNumber).slice(6));
  assert.equal(res.body.reservationNumber, `${PREFIX}${String(last + 1).padStart(3, '0')}`);
});

test('rule 13 — a creation that fails half-way leaves no stay behind', () => {
  const controller = loadController();
  const db = bootDb();
  const reservationsModel = require('../models/reservationsModel');
  const before = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const original = reservationsModel.insertNights;
  reservationsModel.insertNights = () => { throw new Error('disk full'); };
  try {
    assert.throws(() => controller.create(
      { body: { ...BODY, startDate: inDays(275), endDate: inDays(278) }, user: { role: 'admin' } }, fakeRes(),
    ), /disk full/);
  } finally {
    reservationsModel.insertNights = original;
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, before, 'the insert was rolled back');
});

// ── rule 14: the one-shot repair ─────────────────────────────────────────────

test('rule 14 — numberless stays get a number, a history line, and are reported; devis and cancelled untouched', () => {
  const db = realSchemaDb();
  seedCancelledMax(db);
  const ghost = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, createdAt)
                            VALUES ('reservation', 1, 1, '2027-03-20', '2027-03-22', datetime('now'))`).run().lastInsertRowid;
  db.prepare(`INSERT INTO reservations (kind, devisNumber, propertyId, clientId, startDate, endDate, createdAt)
              VALUES ('devis', '2026-10-004', 1, 1, '2027-03-25', '2027-03-27', datetime('now'))`).run();

  const repaired = repairNumberlessReservations(db);
  assert.deepEqual(repaired, [{
    id: Number(ghost), reservationNumber: `${PREFIX}003`, propertyId: 1, startDate: '2027-03-20', endDate: '2027-03-22',
  }]);
  const history = db.prepare('SELECT eventType, changedFields FROM reservation_history WHERE reservationId = ?').get(ghost);
  assert.equal(history.eventType, 'update');
  assert.match(JSON.parse(history.changedFields)[0].to, new RegExp(`^${PREFIX}003`));
  assert.equal(db.prepare("SELECT reservationNumber FROM reservations WHERE kind = 'devis'").get().reservationNumber, null);

  assert.deepEqual(repairNumberlessReservations(db), [], 'idempotent');
});
