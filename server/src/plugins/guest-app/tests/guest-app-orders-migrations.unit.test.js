// specs/guest-app.md §5 data model (rules 66, 72, 88 as ported in PR C) and specs/pricing-components.md rule 36 — the two guest_orders migrations:
// `collectAt` (arrival | departure, every earlier order read `departure`) and the `cancelled` status (a rebuild that keeps every row and index).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('../migrations');

const run = (db, names) => MIGRATIONS.filter((m) => names.includes(m.name)).forEach((m) => m.up(db));
const V1 = 'guest_app_tables_v1';
const COLLECT = 'guest_app_orders_collect_at_v2';
const STATUS = 'guest_app_orders_status_v3';

function v1WithOrders() {
  const db = new Database(':memory:');
  run(db, [V1]);
  db.prepare("INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, createdAt, clientKey, sessionId) VALUES (10, 'note', 'confirmed', '[]', 12, '2026-11-01', 'k1', 1), (11, 'card', 'paid', '[]', 30, '2026-11-02', NULL, 2)").run();
  return db;
}

test('collectAt is added with the departure default for every earlier order, and refuses any other word', () => {
  const db = v1WithOrders();
  run(db, [COLLECT]);
  assert.deepEqual(db.prepare('SELECT collectAt FROM guest_orders ORDER BY id').all(), [{ collectAt: 'departure' }, { collectAt: 'departure' }]);
  assert.throws(() => db.prepare("UPDATE guest_orders SET collectAt = 'never' WHERE id = 1").run(), /CHECK/);
  run(db, [COLLECT]);
});

test('the status rebuild keeps every row, its id and its indexes, and accepts cancelled', () => {
  const db = v1WithOrders();
  run(db, [COLLECT]);
  const before = db.prepare('SELECT * FROM guest_orders ORDER BY id').all();
  run(db, [STATUS]);
  assert.deepEqual(db.prepare('SELECT * FROM guest_orders ORDER BY id').all().map(({ cancelledAt, cancelReason, amendmentsJson, ...row }) => row), before);
  db.prepare("UPDATE guest_orders SET status = 'cancelled', cancelledAt = '2026-11-03', cancelReason = 'stay' WHERE id = 1").run();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'guest_orders'").all().map((r) => r.name);
  assert.ok(['idx_guest_orders_reservation', 'idx_guest_orders_client_key', 'idx_guest_orders_held', 'idx_guest_orders_status'].every((n) => names.includes(n)));
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'guest_orders'").get().seq >= 2, true);
});

test('a second run of every migration changes nothing', () => {
  const db = v1WithOrders();
  run(db, [COLLECT, STATUS]);
  const schema = JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all());
  const rows = JSON.stringify(db.prepare('SELECT * FROM guest_orders ORDER BY id').all());
  run(db, [COLLECT, STATUS]);
  assert.equal(JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()), schema);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM guest_orders ORDER BY id').all()), rows);
});

test('rollback (self-update rule 31): the previous plugin\'s readers list a cancelled order without crashing', () => {
  const db = v1WithOrders();
  run(db, [COLLECT, STATUS]);
  db.prepare("UPDATE guest_orders SET status = 'cancelled' WHERE id = 1").run();
  const open = db.prepare("SELECT id FROM guest_orders WHERE reservationId = ? AND status IN ('awaiting_payment', 'confirmed', 'paid')").all(10);
  assert.deepEqual(open, [], 'a cancelled order is simply not open for the previous plugin');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = 10').get().n, 1);
});
