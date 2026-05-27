const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const schoolHolidaysModel = require('../models/schoolHolidaysModel');
const { runSync, groupRecords, makeExternalRef } = require('../utils/schoolHolidaysSync');

const DDL = `
  CREATE TABLE school_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    zoneA_start TEXT,
    zoneA_end TEXT,
    zoneB_start TEXT,
    zoneB_end TEXT,
    zoneC_start TEXT,
    zoneC_end TEXT,
    externalRef TEXT,
    isLocked INTEGER NOT NULL DEFAULT 0,
    lastSyncedAt TEXT
  );
  CREATE TABLE school_holidays_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    syncIntervalDays INTEGER NOT NULL DEFAULT 60,
    syncHorizonMonths INTEGER NOT NULL DEFAULT 24,
    lastSyncAt TEXT,
    lastSyncStatus TEXT DEFAULT 'never',
    lastSyncMessage TEXT DEFAULT '',
    lastImportedCount INTEGER DEFAULT 0,
    updatedAt TEXT DEFAULT (datetime('now'))
  );
  INSERT OR IGNORE INTO school_holidays_sync_state (id) VALUES (1);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return schoolHolidaysModel.create(db);
}

function mockFetchOk(results) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results, total_count: results.length }),
  });
}

function mockFetchError(msg) {
  return async () => { throw new Error(msg); };
}

const NOW = new Date('2026-05-27T12:00:00Z');

// ---------- helpers ----------

test('groupRecords groups 3 records sharing year + description into 1 group', () => {
  const records = [
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone A', start_date: '2026-10-17', end_date: '2026-11-01' },
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone B', start_date: '2026-10-17', end_date: '2026-11-01' },
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone C', start_date: '2026-10-17', end_date: '2026-11-01' },
  ];
  const groups = groupRecords(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Toussaint');
  assert.equal(groups[0].zoneA_start, '2026-10-17');
  assert.equal(groups[0].zoneB_start, '2026-10-17');
  assert.equal(groups[0].zoneC_start, '2026-10-17');
});

test('groupRecords ignores non-A/B/C zones', () => {
  const records = [
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Corse', start_date: '2026-10-17', end_date: '2026-11-01' },
  ];
  assert.equal(groupRecords(records).length, 0);
});

test('makeExternalRef normalizes diacritics and case', () => {
  assert.equal(makeExternalRef({ annee_scolaire: '2026-2027', description: 'Noël' }),
                makeExternalRef({ annee_scolaire: '2026-2027', description: 'NOEL' }));
});

// ---------- runSync ----------

test('runSync: empty API response → 0 created, status success', async () => {
  const m = freshModel();
  const result = await runSync({ model: m, fetchFn: mockFetchOk([]), horizonMonths: 24, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.createdCount, 0);
  assert.equal(result.updatedCount, 0);
  const state = m.getSyncState();
  assert.equal(state.lastSyncStatus, 'success');
});

test('runSync: one new period across 3 zones → 1 row created', async () => {
  const m = freshModel();
  const records = [
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone A', start_date: '2026-10-17', end_date: '2026-11-01' },
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone B', start_date: '2026-10-17', end_date: '2026-11-01' },
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone C', start_date: '2026-10-17', end_date: '2026-11-01' },
  ];
  const result = await runSync({ model: m, fetchFn: mockFetchOk(records), horizonMonths: 24, now: NOW });
  assert.equal(result.createdCount, 1);
  const rows = m.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].zoneA_start, '2026-10-17');
  assert.equal(rows[0].zoneB_start, '2026-10-17');
  assert.equal(rows[0].zoneC_start, '2026-10-17');
});

test('runSync: period matching an un-locked auto row → 1 update', async () => {
  const m = freshModel();
  // Seed an existing auto row.
  m.upsertByExternalRef({
    externalRef: '2026-2027|toussaint', label: 'Toussaint',
    zoneA_start: '2026-10-15', zoneA_end: '2026-10-30',
  }, '2025-01-01T00:00:00Z');
  const records = [
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone A', start_date: '2026-10-17', end_date: '2026-11-01' },
  ];
  const result = await runSync({ model: m, fetchFn: mockFetchOk(records), horizonMonths: 24, now: NOW });
  assert.equal(result.updatedCount, 1);
  assert.equal(result.createdCount, 0);
  const row = m.list()[0];
  assert.equal(row.zoneA_start, '2026-10-17'); // updated
});

test('runSync: period matching a locked auto row → 1 skip', async () => {
  const m = freshModel();
  const r = m.upsertByExternalRef({
    externalRef: '2026-2027|toussaint', label: 'Toussaint',
    zoneA_start: '2026-10-15', zoneA_end: '2026-10-30',
  }, '2025-01-01T00:00:00Z');
  m.lock(r.id);
  const records = [
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone A', start_date: '2026-10-17', end_date: '2026-11-01' },
  ];
  const result = await runSync({ model: m, fetchFn: mockFetchOk(records), horizonMonths: 24, now: NOW });
  assert.equal(result.skippedLockedCount, 1);
  const row = m.findById(r.id);
  assert.equal(row.zoneA_start, '2026-10-15'); // unchanged
});

test('runSync: past auto row not in API payload → deleted', async () => {
  const m = freshModel();
  m.upsertByExternalRef({
    externalRef: 'old', label: 'Old', zoneA_start: '2025-01-01', zoneA_end: '2025-01-10',
  }, '2025-01-01T00:00:00Z');
  const result = await runSync({ model: m, fetchFn: mockFetchOk([]), horizonMonths: 24, now: NOW });
  assert.equal(result.deletedStaleCount, 1);
  assert.equal(m.list().length, 0);
});

test('runSync: future auto row not in API payload → kept', async () => {
  const m = freshModel();
  m.upsertByExternalRef({
    externalRef: 'future', label: 'Future', zoneA_start: '2026-12-01', zoneA_end: '2026-12-10',
  }, '2026-05-01T00:00:00Z');
  const result = await runSync({ model: m, fetchFn: mockFetchOk([]), horizonMonths: 24, now: NOW });
  assert.equal(result.deletedStaleCount, 0);
  assert.equal(m.list().length, 1);
});

test('runSync: manual row matching incoming label → adopted (not duplicated)', async () => {
  const m = freshModel();
  const { id: manualId } = m.insert({
    label: 'Toussaint', zoneA_start: '2026-10-15', zoneA_end: '2026-10-30',
  });
  const records = [
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone A', start_date: '2026-10-17', end_date: '2026-11-01' },
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone B', start_date: '2026-10-17', end_date: '2026-11-01' },
    { annee_scolaire: '2026-2027', description: 'Toussaint', zones: 'Zone C', start_date: '2026-10-17', end_date: '2026-11-01' },
  ];
  await runSync({ model: m, fetchFn: mockFetchOk(records), horizonMonths: 24, now: NOW });
  const rows = m.list();
  assert.equal(rows.length, 1); // adopted, not duplicated
  assert.equal(rows[0].id, manualId);
  assert.notEqual(rows[0].externalRef, null);
  assert.equal(rows[0].zoneB_start, '2026-10-17'); // payload applied
});

test('runSync: fetch error → status error, no row touched', async () => {
  const m = freshModel();
  m.insert({ label: 'Existing', zoneA_start: '2026-10-15', zoneA_end: '2026-10-30' });
  const result = await runSync({ model: m, fetchFn: mockFetchError('network down'), horizonMonths: 24, now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.error, /network down/);
  const state = m.getSyncState();
  assert.equal(state.lastSyncStatus, 'error');
  assert.match(state.lastSyncMessage, /network down/);
  assert.equal(m.list().length, 1);
});

test('runSync: horizonMonths is propagated to the fetch URL', async () => {
  const m = freshModel();
  let capturedUrl = '';
  const fetchSpy = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  await runSync({ model: m, fetchFn: fetchSpy, horizonMonths: 6, now: NOW });
  // Today + 6 months from 2026-05-27 = 2026-11-27.
  assert.match(capturedUrl, /2026-11-27/);
});
