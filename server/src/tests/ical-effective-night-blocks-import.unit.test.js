// specs/ical-import-hardening.md rule 19 (audit R2 H) — the import's overlap check and the drift approval
// judge the nights a GuestFlow stay really takes (late check-out / early check-in), like the export.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');
const icalDateDriftModel = require('../models/icalDateDriftModel');
const { globalFetch } = require('./icalFetchFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  for (const col of ['emptyFeedStreak INTEGER NOT NULL DEFAULT 0', 'lastSyncCounts TEXT']) {
    try { db.exec(`ALTER TABLE ical_sources ADD COLUMN ${col}`); } catch { /* already in the schema */ }
  }
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut) VALUES (1, 'Gite', '15:00', '10:00')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'http://feed.test/a.ics', 'airbnb', 'Airbnb')").run();
  const own = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType, checkInTime, checkOutTime)
    VALUES ('reservation', 1, 1, '${inDays(30)}', '${inDays(32)}', 'Direct', 'manual', '15:00', '18:00')`).run().lastInsertRowid);
  return { db, own };
}

test('rule 19 — an Airbnb stay on the extra night of a late check-out is flagged as a conflict', async () => {
  const { db, own } = seed();
  const body = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:AB1', `DTSTART;VALUE=DATE:${inDays(32).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${inDays(34).replace(/-/g, '')}`, 'SUMMARY:Reserved', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => body });
  try {
    const model = propertyIcalModel.buildModel(db, { fetchImpl: globalFetch });
    const result = await model.syncSource({ id: 1, propertyId: 1, url: 'http://feed.test/a.ics', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' });
    assert.equal(result.createdCount, 1);
    assert.equal(result.conflictReservationIds.length, 1);
    assert.ok(own);
  } finally {
    global.fetch = origFetch;
  }
});

test('rule 19 — a drift approved onto the extra night of a late check-out is flagged', () => {
  const { db } = seed();
  const mine = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType, icalSyncLocked)
    VALUES ('reservation', 1, 1, '${inDays(60)}', '${inDays(62)}', 'Airbnb', 'ical', 1)`).run().lastInsertRowid);
  const model = icalDateDriftModel.buildModel(db);
  const alert = model.recordPending({ reservationId: mine, previousStartDate: inDays(60), previousEndDate: inDays(62), newStartDate: inDays(32), newEndDate: inDays(34) });
  assert.equal(model.approve(alert.id).conflict, true);
});
