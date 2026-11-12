// specs/pricing-components.md §3 rules 85 and 86, §5 and rule 36; specs/self-update-and-releases.md rule 57 — the PR C schema: the
// outside-sale tables, the nullable targets of payment_links and email_log, the line tables without their article key (rows copied in
// rowid order), the schema floor; additions and rebuilds with the same rows, a second run changes nothing, no amount rewritten.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPricingSalesMigration, backfillOrderRefsOnce } = require('../utils/pricingSalesMigration');
const { readSchemaFloor } = require('../utils/schemaFloor');
const { oldDatabase, seed, rowsInOrder, schemaHash } = require('./pricingSalesFixtures');

const AMOUNTS = (db) => JSON.stringify({
  options: db.prepare('SELECT reservationId, optionId, quantity, unitPrice, totalPrice, offered, inComplement FROM reservation_options ORDER BY rowid').all(),
  resources: db.prepare('SELECT reservationId, resourceId, quantity, unitPrice, totalPrice, offered, inComplement FROM reservation_resources ORDER BY rowid').all(),
  links: db.prepare('SELECT id, reservationId, amountCents, status FROM payment_links ORDER BY id').all(),
});

test('rule 85: the line tables lose their article key, every row and its physical order are copied as stored', () => {
  const db = oldDatabase();
  seed(db);
  const before = { options: rowsInOrder(db, 'reservation_options'), resources: rowsInOrder(db, 'reservation_resources'), amounts: AMOUNTS(db) };
  const byStay = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = 10').all();
  const changes = runPricingSalesMigration(db);
  assert.equal(changes.trueLines, 2);
  assert.deepEqual(rowsInOrder(db, 'reservation_options'), before.options, 'same rows, same rowids, same order');
  assert.deepEqual(rowsInOrder(db, 'reservation_resources'), before.resources);
  assert.deepEqual(db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = 10').all(), byStay, 'a keyed read answers in the same order');
  assert.equal(AMOUNTS(db), before.amounts);
  for (const table of ['reservation_options', 'reservation_resources']) {
    assert.deepEqual(db.prepare(`PRAGMA table_info(${table})`).all().filter((c) => c.pk > 0), [], `${table} has no primary key`);
    assert.ok(db.prepare(`SELECT 1 FROM pragma_index_list('${table}') WHERE name = 'idx_${table}_line_id' AND "unique" = 1`).get(), 'lineId stays unique');
    assert.ok(db.prepare(`SELECT 1 FROM pragma_index_list('${table}') WHERE name = 'idx_${table}_article' AND "unique" = 0`).get(), 'the article index is not unique');
    assert.equal(db.prepare('PRAGMA foreign_key_list(' + table + ')').all().length, 2, 'both foreign keys survive');
  }
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys are back on');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('rule 85: a second sale of the same article is a second line, numbered by the sequence', () => {
  const db = oldDatabase();
  seed(db);
  runPricingSalesMigration(db);
  const top = db.prepare('SELECT MAX(lineId) AS n FROM reservation_options').get().n;
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (10, 2, 2, 7, 2, 'per_stay', 14)").run();
  const lines = db.prepare('SELECT lineId, quantity FROM reservation_options WHERE reservationId = 10 AND optionId = 2 ORDER BY lineId').all();
  assert.equal(lines.length, 2);
  assert.ok(lines[1].lineId > top, 'the new line gets a number above every existing one');
  assert.throws(() => db.prepare("INSERT INTO reservation_options (reservationId, optionId, lineId) VALUES (10, 3, ?)").run(top + 1), /UNIQUE/, 'two rows never share a lineId');
});

test('rule 86: payment_links and email_log keep their rows and ids and accept a sale target', () => {
  const db = oldDatabase();
  seed(db);
  db.prepare('DELETE FROM payment_links WHERE id = 2').run();
  const links = db.prepare('SELECT * FROM payment_links ORDER BY id').all();
  const mails = db.prepare('SELECT * FROM email_log ORDER BY id').all();
  const changes = runPricingSalesMigration(db);
  assert.equal(changes.rebuilt, 2);
  assert.deepEqual(db.prepare('SELECT id, reservationId, type, amountCents, status, paidAt, createdAt, cancelReason, basketJson FROM payment_links ORDER BY id').all(), links.map(({ id, reservationId, type, amountCents, status, paidAt, createdAt, cancelReason, basketJson }) => ({ id, reservationId, type, amountCents, status, paidAt, createdAt, cancelReason, basketJson })));
  assert.deepEqual(db.prepare('SELECT * FROM email_log ORDER BY id').all().map(({ saleRef, ...row }) => { assert.equal(saleRef, null); return row; }), mails);
  db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents) VALUES (NULL, 'standalone:7', 'complement', 900)").run();
  db.prepare("INSERT INTO email_log (templateId, reservationId, saleRef, status, renderedSubject, renderedBody) VALUES (2, NULL, 'standalone:7', 'sent', 's', 'b')").run();
  assert.throws(() => db.prepare("INSERT INTO payment_links (reservationId, type, amountCents) VALUES (NULL, 'bogus', 1)").run(), /CHECK/, 'the type CHECK is kept');
  assert.throws(() => db.prepare("INSERT INTO email_log (templateId, reservationId, status, renderedSubject, renderedBody) VALUES (1, 10, 'bogus', 's', 'b')").run(), /CHECK/, 'the status CHECK is kept');
});

test('rule 86: the AUTOINCREMENT counter of a rebuilt table is kept, an id is never reused', () => {
  const db = oldDatabase();
  seed(db);
  db.prepare('DELETE FROM payment_links WHERE id = 2').run();
  runPricingSalesMigration(db);
  const next = db.prepare("INSERT INTO payment_links (reservationId, type) VALUES (10, 'full')").run().lastInsertRowid;
  assert.equal(Number(next), 3);
});

test('the outside-sale tables, the suggestions and the sellable flags exist, empty', () => {
  const db = oldDatabase();
  seed(db);
  runPricingSalesMigration(db);
  for (const table of ['standalone_sales', 'standalone_sale_lines', 'standalone_sale_payments', 'suggested_articles']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(\'options\') WHERE name = \'sellableExternally\'').get().n, 1);
  assert.equal(db.prepare('SELECT sellableExternally FROM resources WHERE id = 5').get().sellableExternally, 0, 'default: not sellable');
});

test('rule 36 and rule 57: a second run changes nothing, and the floor is stored once', () => {
  const db = oldDatabase();
  seed(db);
  runPricingSalesMigration(db);
  const schema = schemaHash(db);
  const data = JSON.stringify(['reservation_options', 'reservation_resources', 'payment_links', 'email_log', 'migrations'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => (t === 'migrations' ? r.name : r))));
  const second = runPricingSalesMigration(db);
  assert.deepEqual(second, { tables: 0, columns: 0, rebuilt: 0, trueLines: 0 });
  assert.equal(schemaHash(db), schema);
  assert.equal(JSON.stringify(['reservation_options', 'reservation_resources', 'payment_links', 'email_log', 'migrations'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => (t === 'migrations' ? r.name : r)))), data);
  assert.equal(readSchemaFloor(db), '4.1.0');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM migrations WHERE name LIKE 'schema_floor:%'").get().n, 1);
});

test('rule 36: orderRef is written only where a line names exactly one order, and only once', () => {
  const db = oldDatabase();
  seed(db);
  runPricingSalesMigration(db);
  db.prepare("INSERT INTO guest_orders (id, reservationId, status, linesJson) VALUES (5, 10, 'paid', ?), (6, 11, 'paid', ?), (7, 11, 'paid', ?)")
    .run(JSON.stringify([{ kind: 'option', id: 1, quantity: 2 }, { kind: 'breakfast', id: 9 }]), JSON.stringify([{ kind: 'option', id: 2, quantity: 1 }]), JSON.stringify([{ kind: 'option', id: 2, quantity: 1 }]));
  assert.equal(backfillOrderRefsOnce(db), 1);
  assert.equal(db.prepare('SELECT orderRef FROM reservation_options WHERE reservationId = 10 AND optionId = 1').get().orderRef, 'order:5:0');
  assert.equal(db.prepare('SELECT orderRef FROM reservation_options WHERE reservationId = 11 AND optionId = 2').get().orderRef, null, 'two orders name the line: ambiguous, left NULL');
  assert.equal(db.prepare('SELECT orderRef FROM reservation_options WHERE reservationId = 10 AND optionId = 3').get().orderRef, null);
  assert.equal(backfillOrderRefsOnce(db), 0, 'marked done');
});
