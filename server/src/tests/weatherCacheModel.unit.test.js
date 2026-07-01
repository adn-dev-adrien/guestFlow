const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/weatherCacheModel');

function makeModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE weather_vigilance_cache (
      departmentCode TEXT PRIMARY KEY,
      payload        TEXT NOT NULL,
      fetchedAt      TEXT NOT NULL
    );
  `);
  return buildModel(db);
}

const SAMPLE = [{ phenomenonId: 6, colorLevel: 3, startsAt: '2026-07-02T10:00:00Z', endsAt: '2026-07-04T20:00:00Z' }];

test('read: missing département → null', () => {
  const m = makeModel();
  assert.equal(m.read('83'), null);
});

test('upsert + read: round-trips the parsed payload', () => {
  const m = makeModel();
  const now = Date.parse('2026-07-02T09:00:00Z');
  m.upsert('83', SAMPLE, now);
  const entry = m.read('83');
  assert.deepEqual(entry.payload, SAMPLE);
  assert.equal(entry.fetchedAt, new Date(now).toISOString());
});

test('upsert: same département overwrites (no duplicate rows)', () => {
  const m = makeModel();
  m.upsert('83', SAMPLE, Date.parse('2026-07-02T09:00:00Z'));
  m.upsert('83', [], Date.parse('2026-07-02T10:00:00Z'));
  assert.deepEqual(m.read('83').payload, []);
});

test('readFresh: within TTL returns the entry, beyond TTL returns null', () => {
  const m = makeModel();
  const fetchedMs = Date.parse('2026-07-02T09:00:00Z');
  m.upsert('83', SAMPLE, fetchedMs);

  // 10 min later, TTL 30 → fresh.
  assert.ok(m.readFresh('83', 30, fetchedMs + 10 * 60 * 1000));
  // 40 min later, TTL 30 → stale → null.
  assert.equal(m.readFresh('83', 30, fetchedMs + 40 * 60 * 1000), null);
});

test('department code is normalized to upper-case (Corsica 2a → 2A)', () => {
  const m = makeModel();
  m.upsert('2a', SAMPLE, Date.parse('2026-07-02T09:00:00Z'));
  assert.deepEqual(m.read('2A').payload, SAMPLE);
});
