// specs/public-api.md rule 15 (2026-10-27 audit) — the availability re-check of /quote,
// /booking-requests and /pay reads a window exactly as wide as the stay; a neighbour whose late
// check-out or early check-in blocks a night INSIDE that window must still be seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-blocked-edges-')), 'g.db');
const db = require('../database');
const { computeBlockedDates, rangeHasBlockedNight } = require('../utils/blockedDates');

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
const cid = db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Z', 'Z')").run().lastInsertRowid;
const insert = db.prepare(`INSERT INTO reservations (clientId, kind, propertyId, startDate, endDate, checkInTime, checkOutTime, platform)
  VALUES (?, 'reservation', ?, ?, ?, ?, ?, 'direct')`);
insert.run(cid, pid, '2027-07-10', '2027-07-17', '16:00', '18:00'); // late check-out: night of 07-17
insert.run(cid, pid, '2027-07-24', '2027-07-31', '09:00', '10:00'); // early check-in: night of 07-23

test('a stay starting on a late check-out day sees the night it blocks', () => {
  const blocked = computeBlockedDates(pid, '2027-07-17', '2027-07-19');
  assert.deepEqual(blocked, ['2027-07-17']);
  assert.equal(rangeHasBlockedNight('2027-07-17', '2027-07-19', blocked), true);
});

test('a stay ending on an early check-in day sees the night before it', () => {
  const blocked = computeBlockedDates(pid, '2027-07-20', '2027-07-24');
  assert.deepEqual(blocked, ['2027-07-23']);
  assert.equal(rangeHasBlockedNight('2027-07-20', '2027-07-24', blocked), true);
});

test('only nights of the asked window come back; a free gap stays free', () => {
  assert.deepEqual(computeBlockedDates(pid, '2027-07-18', '2027-07-23'), []);
  const wide = computeBlockedDates(pid, '2027-07-15', '2027-07-25');
  assert.deepEqual(wide, ['2027-07-15', '2027-07-16', '2027-07-17', '2027-07-23', '2027-07-24']);
});
