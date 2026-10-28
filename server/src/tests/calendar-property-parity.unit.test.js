// specs/calendar-property-parity.md rules 1-3 — both calendars read one set: the logement calendar is the
// general calendar restricted to that logement, a disabled platform source hides nothing, and the server
// shapes every bar (label, platform name, colour, text colour, past flag).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const calendarModel = require('../models/calendarModel');
const reservationsModel = require('../models/reservationsModel');
const calendarController = require('../controllers/calendarController');
const { RESERVATION_KEEP } = require('../utils/receptionView');

const FROM = '2026-10-01';
const TO = '2026-11-30';
const TODAY = '2026-10-28';

function stay(id, propertyId, startDate, endDate, { platform = 'Airbnb', kind = 'reservation', clientId = 1, summary = null } = {}) {
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, finalPrice, totalPrice, icalOriginalSummary)
              VALUES (?, ?, ?, ?, ?, ?, ?, 2, 300, 300, ?)`).run(id, kind, clientId, propertyId, startDate, endDate, platform, summary);
}

function seed() {
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Estiva')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Martin')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (2, '', '')").run();
  stay(10, 1, '2026-10-09', '2026-10-11', { platform: 'Airbnb' });
  stay(11, 1, '2026-10-20', '2026-10-24', { platform: 'Booking' });
  stay(12, 2, '2026-10-12', '2026-10-15', { platform: 'direct' });
  stay(13, 2, '2026-11-02', '2026-11-05', { platform: 'Abritel' });
  stay(14, 1, '2026-11-10', '2026-11-12', { platform: 'Airbnb', kind: 'cancelled' });
  stay(15, 1, '2026-11-15', '2026-11-18', { platform: 'Pitchup', clientId: 2, summary: 'Reserved - Bob' });
  stay(16, 2, '2026-11-20', '2026-11-22', { platform: 'Pitchup', clientId: 2 });
  db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive, disabled) VALUES (1, 'Airbnb', '', 'airbnb', 'Airbnb', 0, 1)").run();
  db.prepare("INSERT INTO establishment_closures (id, propertyId, label, startDate, endDate) VALUES (1, NULL, 'Hiver', '2026-12-24', '2026-12-26')").run();
  db.prepare("INSERT INTO establishment_closures (id, propertyId, label, startDate, endDate) VALUES (2, 1, 'Travaux', '2026-10-11', '2026-10-13')").run();
  db.prepare("INSERT INTO establishment_closures (id, propertyId, label, startDate, endDate) VALUES (3, 2, 'Peinture', '2026-10-28', '2026-10-30')").run();
}
seed();

const general = () => calendarModel.listRange({ from: FROM, to: '2026-12-31', today: TODAY });
const forProperty = (propertyId) => calendarModel.listRange({ from: FROM, to: '2026-12-31', propertyId, today: TODAY });
const ids = (list) => list.map((s) => s.id);

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const call = (query, user = { roles: ['admin'] }) => {
  const res = fakeRes();
  calendarController.range({ query, user }, res);
  return res;
};

test('rule 1 — a logement calendar is the general calendar restricted to that logement, closures included', () => {
  const all = general();
  for (const propertyId of [1, 2]) {
    const one = forProperty(propertyId);
    assert.deepEqual(ids(one.stays), ids(all.stays.filter((s) => s.propertyId === propertyId)));
    assert.deepEqual(
      ids(one.closures),
      ids(all.closures.filter((c) => c.global || c.propertyId === propertyId)),
      'the logement\'s own closures and the global ones — never another logement\'s',
    );
  }
  assert.deepEqual(ids(forProperty(1).closures), [2, 1]);
});

test('rule 2 — the stay of a platform whose iCal source is disabled is in both calendars', () => {
  assert.ok(ids(general().stays).includes(10));
  assert.ok(ids(forProperty(1).stays).includes(10));
});

test('rule 2 — reservationsModel.list({ propertyId }) keeps it too, so the fiche date hints see the same stays', () => {
  const rm = reservationsModel.create(db);
  assert.ok(rm.list({ propertyId: 1 }).some((r) => r.id === 10));
  assert.deepEqual(
    rm.list({ propertyId: 1, from: FROM, to: '2026-12-31' }).map((r) => r.id).sort((a, b) => a - b),
    ids(forProperty(1).stays).sort((a, b) => a - b),
    'the generic list and the calendar read the same set',
  );
});

test('rule 2 — a cancelled stay is in neither calendar', () => {
  assert.ok(!ids(general().stays).includes(14));
  assert.ok(!ids(forProperty(1).stays).includes(14));
});

test('rule 3 — the server shapes the label with three fallbacks', () => {
  const byId = Object.fromEntries(general().stays.map((s) => [s.id, s]));
  assert.equal(byId[10].label, 'Camille Martin');
  assert.equal(byId[15].label, 'Reserved - Bob', 'no guest name → the iCal summary');
  assert.equal(byId[16].label, 'Réservation #16', 'neither → the number');
});

test('rule 3 — platformDisplay, colour and text colour come from the server, custom colour included', () => {
  db.prepare("INSERT INTO platforms (name, color) VALUES ('Pitchup', '#FEC700')").run();
  const byId = Object.fromEntries(general().stays.map((s) => [s.id, s]));
  assert.equal(byId[10].platformDisplay, 'Airbnb');
  assert.equal(byId[10].color, '#C93848');
  assert.equal(byId[10].textColor, '#FFFFFF');
  assert.equal(byId[11].color, '#1B3F8B');
  assert.equal(byId[12].platformDisplay, 'Direct');
  assert.equal(byId[12].color, '#2F5D46');
  assert.equal(byId[15].color, '#FEC700', 'a custom platform colour is kept');
  assert.equal(byId[15].textColor, '#27251F', 'ink on a light custom colour');
});

test('rule 3 — past is relative to the server day: a stay leaving today is past', () => {
  const run = (today) => Object.fromEntries(calendarModel.listRange({ from: FROM, to: TO, today }).stays.map((s) => [s.id, s.past]));
  assert.equal(run(TODAY)[10], true);
  assert.equal(run(TODAY)[13], false);
  assert.equal(run('2026-11-05')[13], true, 'endDate <= today');
  assert.equal(run('2026-11-04')[13], false);
});

test('rule 3 — a closure arrives with global, propertyName and label, and the reopening day keeps it in range', () => {
  const closures = calendarModel.listRange({ from: '2026-10-13', to: '2026-10-14', propertyId: 1, today: TODAY }).closures;
  assert.deepEqual(closures.map((c) => ({ id: c.id, global: c.global, propertyName: c.propertyName, label: c.label })), [
    { id: 2, global: false, propertyName: 'Granja', label: 'Travaux' },
  ]);
  const global = general().closures.find((c) => c.global);
  assert.equal(global.propertyName, null);
  assert.equal(global.global, true);
});

test('edge cases — a refused query answers 400 with a French message', () => {
  const refusals = [
    [{ from: '2026-11-02', to: '2026-11-01' }, /précéder/],
    [{ from: '2026-13-01', to: '2026-13-05' }, /AAAA-MM-JJ/],
    [{ from: '2026-10-01' }, /AAAA-MM-JJ/],
    [{ from: '2025-01-01', to: '2026-10-01' }, /400 jours/],
    [{ from: FROM, to: TO, propertyId: '999' }, /Logement inconnu/],
    [{ from: FROM, to: TO, propertyId: 'abc' }, /Logement inconnu/],
  ];
  for (const [query, message] of refusals) {
    const res = call(query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.match(res.body.error, message);
  }
  assert.equal(call({ from: FROM, to: TO, propertyId: '1' }).statusCode, 200);
  assert.equal(call({ from: '2026-01-01', to: '2027-02-04' }).statusCode, 200, '400 days is the ceiling');
});

test('edge cases — reception-only gets the finance-free whitelist plus the bar\'s shaped fields', () => {
  const res = call({ from: FROM, to: TO }, { roles: ['reception'] });
  assert.equal(res.statusCode, 200);
  const allowed = new Set([...RESERVATION_KEEP, 'label', 'platformDisplay', 'color', 'textColor', 'past',
    'arrivalSasLock', 'departureSasLock', 'checkInStatusEditable', 'checkOutStatusEditable']);
  for (const s of res.body.stays) {
    assert.deepEqual(Object.keys(s).filter((k) => !allowed.has(k)), [], 'no field outside the reception whitelist');
    assert.ok(s.label && s.color && s.textColor);
  }
});
