// specs/plugins-phase-4-registry.md rule 60 (audit r5, database N1) — the switched-off notice checks itself: a toggle
// by a core that does not know `off_reason` / `off_at` ends it, and the migration is idempotent.
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./pluginPackagesFixture');
const { buildModel } = require('../models/pluginsModel');
const { ensurePackageColumns } = require('../utils/pluginsSchema');
const { switchedOffNotices } = require('../controllers/pluginsAttentionController');

const row = (id) => ({ id, version: '1.0.0', source: 'bundled', manifest: h.manifest(id, '1.0.0') });

function twoPlugins() {
  const db = h.freshDb();
  const model = buildModel(db);
  model.install('xa', row('xa'));
  model.install('xb', row('xb'));
  model.setEnabled('xa', false);
  model.switchOff('xb', 'xa');
  return { db, model };
}

test('rule 60: a fresh switch-off is announced', () => {
  const { model } = twoPlugins();
  assert.deepEqual(switchedOffNotices(model).map((n) => n.id), ['xb']);
  assert.equal(model.get('xb').offAt, model.get('xb').updatedAt);
});

test('rule 60: a toggle by an older core (no knowledge of the columns) ends the notice', () => {
  const { db, model } = twoPlugins();
  db.prepare("UPDATE plugins SET enabled = 1, updated_at = '2999-01-01 00:00:00' WHERE id = 'xb'").run();
  db.prepare("UPDATE plugins SET enabled = 0, updated_at = '2999-01-01 00:00:01' WHERE id = 'xb'").run();
  assert.equal(model.get('xb').offReason, 'xa');
  assert.deepEqual(switchedOffNotices(model), []);
});

test('rule 60: setEnabled clears the reason and the stamp', () => {
  const { model } = twoPlugins();
  model.setEnabled('xb', true);
  assert.equal(model.get('xb').offReason, null);
  assert.equal(model.get('xb').offAt, null);
});

test('rule 60: the migration is idempotent and backfills a row already switched off', () => {
  const db = h.freshDb();
  db.exec('ALTER TABLE plugins DROP COLUMN off_at');
  db.prepare("INSERT INTO plugins (id, enabled, source, off_reason, updated_at) VALUES ('xb', 0, 'bundled', 'xa', '2026-10-01 10:00:00')").run();
  ensurePackageColumns(db);
  ensurePackageColumns(db);
  const model = buildModel(db);
  assert.equal(model.get('xb').offAt, '2026-10-01 10:00:00');
  assert.deepEqual(switchedOffNotices(model).map((n) => n.id), ['xb']);
});
