// specs/ical-export-closures.md — the establishment closures that apply to a property must leave
// through its public iCal feed, so the platforms stop selling a period declared closed.
//
// Dates are all relative to today: the "not over yet" filter (rule 2) is the one rule a fixed
// calendar would silently stop exercising.
//
// Rule 10 is covered by its testable half — no existing event changes shape. Its other half, that
// this makes the change a Y and not an X, is a versioning judgement no assertion can hold.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalModel = require('../models/icalModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT, platform TEXT, adults INTEGER, children INTEGER
  );
  CREATE TABLE ical_tokens (propertyId INTEGER, token TEXT);
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT, startDate TEXT, endDate TEXT,
    createdAt TEXT, updatedAt TEXT
  );
`;

const GRANJA = 1;
const ESTIVA = 2;

function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function compact(isoDate) {
  return isoDate.replace(/-/g, '');
}

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (?, 'La Granja'), (?, 'L''Estiva')").run(GRANJA, ESTIVA);
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Vasseur', 'm.vasseur@example.fr')").run();
  db.prepare(`
    INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, adults, children)
    VALUES ('reservation', ?, 1, ?, ?, 'booking', 2, 0)
  `).run(GRANJA, day(20), day(24));
  return { db, model: icalModel.buildModel(db) };
}

function addClosure(db, { propertyId = null, label = 'Fermeture hivernale', startDate, endDate }) {
  const result = db.prepare(`
    INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, ?, ?, ?)
  `).run(propertyId, label, startDate, endDate);
  return result.lastInsertRowid;
}

// Splits the feed into its VEVENT blocks, each as an array of lines.
function events(ics) {
  return ics.split('\r\nBEGIN:VEVENT\r\n').slice(1).map((block) => block.split('\r\nEND:VEVENT')[0].split('\r\n'));
}

function closureEvents(ics) {
  return events(ics).filter((lines) => lines.some((l) => l.startsWith('UID:closure-')));
}

function valueOf(lines, key) {
  const line = lines.find((l) => l.startsWith(`${key}:`));
  return line === undefined ? null : line.slice(key.length + 1);
}

test('rules 1 + 4 + 7 — a closure of the property is exported with its stored dates, untouched', () => {
  const { db, model } = freshModel();
  const start = day(40);
  const end = day(47);
  const id = addClosure(db, { propertyId: GRANJA, label: 'Ravalement de façade', startDate: start, endDate: end });

  const [closure] = closureEvents(model.exportProperty(GRANJA));

  assert.ok(closure, 'the closure must produce a VEVENT');
  assert.equal(valueOf(closure, 'UID'), `closure-${id}@guestflow.local`);
  assert.equal(valueOf(closure, 'DTSTART'), compact(start));
  // End stays exclusive, exactly as stored: the last closed night is the eve of DTEND.
  assert.equal(valueOf(closure, 'DTEND'), compact(end));
  assert.equal(valueOf(closure, 'TRANSP'), 'OPAQUE');
});

test('rule 1 — a global closure (propertyId IS NULL) appears in every property feed', () => {
  const { db, model } = freshModel();
  const id = addClosure(db, { propertyId: null, startDate: day(30), endDate: day(60) });

  for (const propertyId of [GRANJA, ESTIVA]) {
    const found = closureEvents(model.exportProperty(propertyId));
    assert.equal(found.length, 1, `property ${propertyId} must carry the global closure`);
    assert.equal(valueOf(found[0], 'UID'), `closure-${id}@guestflow.local`);
  }
});

test("rule 1 — another property's closure never leaks into this feed", () => {
  const { db, model } = freshModel();
  addClosure(db, { propertyId: ESTIVA, label: 'Travaux Estiva', startDate: day(10), endDate: day(15) });

  assert.deepEqual(closureEvents(model.exportProperty(GRANJA)), []);
  assert.equal(closureEvents(model.exportProperty(ESTIVA)).length, 1);
});

test('rule 2 — a closure that is over is filtered out, one still running is not', () => {
  const { db, model } = freshModel();
  addClosure(db, { propertyId: GRANJA, label: 'Travaux de printemps', startDate: day(-30), endDate: day(-10) });
  const running = addClosure(db, { propertyId: GRANJA, label: 'Panne de chaudière', startDate: day(-1), endDate: day(6) });

  const found = closureEvents(model.exportProperty(GRANJA));

  assert.equal(found.length, 1, 'only the closure that is not over yet');
  assert.equal(valueOf(found[0], 'UID'), `closure-${running}@guestflow.local`);
  // An ongoing closure keeps its real start date — clipping it to today would move DTSTART on every
  // fetch and make the platforms churn the block.
  assert.equal(valueOf(found[0], 'DTSTART'), compact(day(-1)));
});

test('rule 3 — SUMMARY prefixes the label, and collapses when the label is the default or blank', () => {
  const cases = [
    ['Fermeture hivernale', 'Fermeture — Fermeture hivernale'],
    ['Fermeture établissement', 'Fermeture'],
    ['   ', 'Fermeture'],
    ['', 'Fermeture'],
  ];

  for (const [label, expected] of cases) {
    const { db, model } = freshModel();
    addClosure(db, { propertyId: GRANJA, label, startDate: day(5), endDate: day(9) });
    const [closure] = closureEvents(model.exportProperty(GRANJA));
    assert.equal(valueOf(closure, 'SUMMARY'), expected, `label ${JSON.stringify(label)}`);
  }
});

test('rule 3 — a label carrying a comma or a semicolon is escaped', () => {
  const { db, model } = freshModel();
  addClosure(db, { propertyId: GRANJA, label: 'Travaux, phase 2; aile nord', startDate: day(5), endDate: day(9) });

  const [closure] = closureEvents(model.exportProperty(GRANJA));

  assert.equal(valueOf(closure, 'SUMMARY'), 'Fermeture — Travaux\\, phase 2\\; aile nord');
});

test('rule 6 — a closure event carries no guest data and no ATTENDEE', () => {
  const { db, model } = freshModel();
  addClosure(db, { propertyId: GRANJA, startDate: day(5), endDate: day(9) });

  const [closure] = closureEvents(model.exportProperty(GRANJA));

  assert.equal(valueOf(closure, 'ATTENDEE'), null);
  assert.equal(valueOf(closure, 'DESCRIPTION'), 'Période de fermeture — aucune réservation possible.');
});

test('rule 5 — closure UIDs live in their own namespace, next to the reservations', () => {
  const { db, model } = freshModel();
  addClosure(db, { propertyId: GRANJA, startDate: day(5), endDate: day(9) });

  const uids = events(model.exportProperty(GRANJA)).map((lines) => valueOf(lines, 'UID'));

  assert.equal(uids.length, 2);
  assert.equal(new Set(uids).size, 2, 'no collision between a reservation and a closure');
  assert.ok(uids.some((u) => u.startsWith('reservation-')));
  assert.ok(uids.some((u) => u.startsWith('closure-')));
});

test('with no applicable closure the feed is byte-for-byte what it was', () => {
  const { db, model } = freshModel();
  const before = model.exportProperty(GRANJA);

  addClosure(db, { propertyId: ESTIVA, startDate: day(5), endDate: day(9) });
  addClosure(db, { propertyId: GRANJA, startDate: day(-30), endDate: day(-10) });

  assert.equal(model.exportProperty(GRANJA), before);
});

test('a devis is still never exported, closures or not', () => {
  const { db, model } = freshModel();
  db.prepare(`
    INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, adults, children)
    VALUES ('devis', ?, 1, ?, ?, 'direct', 2, 0)
  `).run(GRANJA, day(50), day(55));
  addClosure(db, { propertyId: GRANJA, startDate: day(5), endDate: day(9) });

  const uids = events(model.exportProperty(GRANJA)).map((lines) => valueOf(lines, 'UID'));

  assert.equal(uids.length, 2, 'one reservation + one closure, never the devis');
});

test('rule 8 — closures come after the reservations, ordered by startDate', () => {
  const { db, model } = freshModel();
  const late = addClosure(db, { propertyId: GRANJA, label: 'Fermeture hivernale', startDate: day(60), endDate: day(90) });
  const early = addClosure(db, { propertyId: null, label: 'Ravalement', startDate: day(5), endDate: day(9) });

  const uids = events(model.exportProperty(GRANJA)).map((lines) => valueOf(lines, 'UID'));

  assert.deepEqual(uids, [
    'reservation-1@guestflow.local',
    `closure-${early}@guestflow.local`,
    `closure-${late}@guestflow.local`,
  ]);
});

test('rule 9 — a deleted closure simply stops being in the feed', () => {
  const { db, model } = freshModel();
  const id = addClosure(db, { propertyId: GRANJA, startDate: day(5), endDate: day(9) });
  assert.equal(closureEvents(model.exportProperty(GRANJA)).length, 1);

  db.prepare('DELETE FROM establishment_closures WHERE id = ?').run(id);

  // The feed is rebuilt on every request, so the platform unblocks the dates on its next fetch with
  // no bookkeeping on our side.
  assert.deepEqual(closureEvents(model.exportProperty(GRANJA)), []);
});

test('rule 10 — an existing reservation event keeps its exact shape once closures are exported', () => {
  const { db, model } = freshModel();
  const reservationBefore = events(model.exportProperty(GRANJA))[0];

  addClosure(db, { propertyId: GRANJA, startDate: day(5), endDate: day(9) });
  addClosure(db, { propertyId: null, startDate: day(60), endDate: day(90) });

  // Additive for every consumer: the feed gains events, it changes none of the ones a platform has
  // already mapped.
  assert.deepEqual(events(model.exportProperty(GRANJA))[0], reservationBefore);
});
