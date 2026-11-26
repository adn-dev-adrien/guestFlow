// specs/pricing/pricing-components.md rule 74 (the shared « Passage » client), specs/sas/outside-booking-sas.md §5, CLAUDE.md §8 (end review R1-3) — a client a
// sale outside a stay names, and the « Passage » client, are never orphans: the cleanup leaves them and their own delete is refused.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const clients = require('../models/clientsModel');
const sales = require('../models/standaloneSalesModel');

const client = (lastName) => Number(db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Sam', ?)").run(lastName).lastInsertRowid);

test('rule 74 — the cleanup skips the « Passage » client and a client with a sale; their delete is refused; a true orphan still goes', () => {
  const passage = sales.passageClientId();
  const buyer = client('Acheteur');
  const orphan = client('Orphelin');
  sales.insertSale({ soldAt: '2027-03-10T09:00:00.000Z', clientId: passage, status: 'paid', totalCents: 650 }); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  sales.insertSale({ soldAt: '2027-03-10T09:00:00.000Z', clientId: buyer, status: 'paid', totalCents: 1300 }); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  assert.deepEqual(clients.listOrphans().map((row) => row.id), [orphan]);
  assert.match(clients.deletionBlocker(buyer), /ventes hors séjour/);
  assert.match(clients.deletionBlocker(passage), /Passage/);
  assert.deepEqual(clients.removeGuarded(buyer), { blocker: clients.deletionBlocker(buyer) });
  assert.deepEqual(clients.cleanupOrphansByIds([passage, buyer, orphan]), { deletedCount: 1, skippedCount: 2 });
  assert.deepEqual(db.prepare('SELECT id FROM clients WHERE id IN (?, ?, ?) ORDER BY id').all(passage, buyer, orphan).map((row) => row.id), [passage, buyer]);
});
