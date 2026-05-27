const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const schoolHolidaysModel = require('../models/schoolHolidaysModel');

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

// ---------- CRUD ----------

test('insert + list returns the row', () => {
  const m = freshModel();
  m.insert({ label: 'Toussaint', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  const rows = m.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Toussaint');
  assert.equal(rows[0].externalRef, null);
  assert.equal(rows[0].isLocked, 0);
});

test('list sorted by earliest configured start date', () => {
  const m = freshModel();
  m.insert({ label: 'Été', zoneB_start: '2027-07-04', zoneB_end: '2027-08-31' });
  m.insert({ label: 'Toussaint', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  m.insert({ label: 'Hiver', zoneC_start: '2027-02-13', zoneC_end: '2027-02-28' });
  const rows = m.list();
  assert.deepEqual(rows.map(r => r.label), ['Toussaint', 'Hiver', 'Été']);
});

test('findById returns row or null', () => {
  const m = freshModel();
  const { id } = m.insert({ label: 'X', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  assert.equal(m.findById(id).label, 'X');
  assert.equal(m.findById(9999), null);
});

test('update returns boolean reflecting change', () => {
  const m = freshModel();
  const { id } = m.insert({ label: 'X', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  assert.equal(m.update(id, { label: 'Y', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' }), true);
  assert.equal(m.update(9999, { label: 'Z' }), false);
  assert.equal(m.findById(id).label, 'Y');
});

test('lock / unlock flip the isLocked flag', () => {
  const m = freshModel();
  const { id } = m.insert({ label: 'X', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  assert.equal(m.findById(id).isLocked, 0);
  assert.equal(m.lock(id), true);
  assert.equal(m.findById(id).isLocked, 1);
  assert.equal(m.unlock(id), true);
  assert.equal(m.findById(id).isLocked, 0);
  assert.equal(m.unlock(9999), false);
});

test('remove returns boolean reflecting deletion', () => {
  const m = freshModel();
  const { id } = m.insert({ label: 'X', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  assert.equal(m.remove(id), true);
  assert.equal(m.remove(id), false);
});

// ---------- upsertByExternalRef ----------

test('upsertByExternalRef inserts when no row matches', () => {
  const m = freshModel();
  const r = m.upsertByExternalRef({
    externalRef: '2026-2027|toussaint',
    label: 'Toussaint',
    zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
  }, '2026-05-27T10:00:00Z');
  assert.equal(r.action, 'created');
  const row = m.findById(r.id);
  assert.equal(row.externalRef, '2026-2027|toussaint');
  assert.equal(row.lastSyncedAt, '2026-05-27T10:00:00Z');
});

test('upsertByExternalRef updates an existing un-locked row', () => {
  const m = freshModel();
  const a = m.upsertByExternalRef({
    externalRef: 'k', label: 'V1', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
  }, '2026-05-27T10:00:00Z');
  const b = m.upsertByExternalRef({
    externalRef: 'k', label: 'V2', zoneA_start: '2026-10-18', zoneA_end: '2026-11-02',
  }, '2026-05-28T10:00:00Z');
  assert.equal(b.action, 'updated');
  assert.equal(b.id, a.id);
  const row = m.findById(a.id);
  assert.equal(row.label, 'V2');
  assert.equal(row.zoneA_start, '2026-10-18');
  assert.equal(row.lastSyncedAt, '2026-05-28T10:00:00Z');
});

test('upsertByExternalRef skips a locked row', () => {
  const m = freshModel();
  const a = m.upsertByExternalRef({
    externalRef: 'k', label: 'V1', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
  }, '2026-05-27T10:00:00Z');
  m.lock(a.id);
  const b = m.upsertByExternalRef({
    externalRef: 'k', label: 'V2', zoneA_start: '2026-10-18', zoneA_end: '2026-11-02',
  }, '2026-05-28T10:00:00Z');
  assert.equal(b.action, 'skippedLocked');
  const row = m.findById(a.id);
  assert.equal(row.label, 'V1'); // unchanged
});

// ---------- adoptManualRow ----------

test('adoptManualRow rewrites a manual row with externalRef + new payload', () => {
  const m = freshModel();
  const { id } = m.insert({ label: 'Toussaint', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  const ok = m.adoptManualRow(id, {
    externalRef: 'k', label: 'Toussaint',
    zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
    zoneB_start: '2026-10-17', zoneB_end: '2026-11-01',
    zoneC_start: '2026-10-17', zoneC_end: '2026-11-01',
  }, '2026-05-27T10:00:00Z');
  assert.equal(ok, true);
  const row = m.findById(id);
  assert.equal(row.externalRef, 'k');
  assert.equal(row.zoneB_start, '2026-10-17');
});

test('adoptManualRow refuses an already-locked row', () => {
  const m = freshModel();
  const { id } = m.insert({ label: 'Toussaint', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  m.lock(id);
  const ok = m.adoptManualRow(id, { externalRef: 'k', label: 'Toussaint' }, '2026-05-27T10:00:00Z');
  assert.equal(ok, false);
});

// ---------- deleteStaleAutoRows ----------

test('deleteStaleAutoRows removes past auto rows not in keep set', () => {
  const m = freshModel();
  const stale = m.upsertByExternalRef({
    externalRef: 'old', label: 'Old', zoneA_start: '2025-01-01', zoneA_end: '2025-01-10',
  }, '2025-01-01T00:00:00Z');
  const fresh = m.upsertByExternalRef({
    externalRef: 'new', label: 'New', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
  }, '2026-05-27T00:00:00Z');
  const future = m.upsertByExternalRef({
    externalRef: 'future', label: 'Future', zoneA_start: '2026-12-01', zoneA_end: '2026-12-10',
  }, '2026-05-27T00:00:00Z');
  const manual = m.insert({ label: 'Manual', zoneA_start: '2025-01-01', zoneA_end: '2025-01-10' });

  const deleted = m.deleteStaleAutoRows(new Set(['new', 'future']), '2026-05-27');
  assert.equal(deleted, 1); // 'old' is past and not in keep set
  assert.equal(m.findById(stale.id), null);
  assert.notEqual(m.findById(fresh.id), null);
  assert.notEqual(m.findById(future.id), null);
  assert.notEqual(m.findById(manual.id), null); // manual rows never deleted
});

test('deleteStaleAutoRows keeps locked rows', () => {
  const m = freshModel();
  const r = m.upsertByExternalRef({
    externalRef: 'old', label: 'Old', zoneA_start: '2025-01-01', zoneA_end: '2025-01-10',
  }, '2025-01-01T00:00:00Z');
  m.lock(r.id);
  const deleted = m.deleteStaleAutoRows(new Set(), '2026-05-27');
  assert.equal(deleted, 0);
  assert.notEqual(m.findById(r.id), null);
});

// ---------- sync state ----------

test('getSyncState returns defaults on a fresh DB', () => {
  const m = freshModel();
  const s = m.getSyncState();
  assert.equal(s.syncIntervalDays, 60);
  assert.equal(s.syncHorizonMonths, 24);
  assert.equal(s.lastSyncStatus, 'never');
  assert.equal(s.lastSyncAt, null);
});

test('updateSyncSettings persists config without touching state', () => {
  const m = freshModel();
  m.setSyncResult({
    lastSyncAt: '2026-05-27T10:00:00Z',
    lastSyncStatus: 'success',
    lastSyncMessage: 'OK',
    lastImportedCount: 8,
  });
  m.updateSyncSettings({ syncIntervalDays: 30, syncHorizonMonths: 12 });
  const s = m.getSyncState();
  assert.equal(s.syncIntervalDays, 30);
  assert.equal(s.syncHorizonMonths, 12);
  assert.equal(s.lastSyncStatus, 'success');
  assert.equal(s.lastSyncAt, '2026-05-27T10:00:00Z');
  assert.equal(s.lastImportedCount, 8);
});
