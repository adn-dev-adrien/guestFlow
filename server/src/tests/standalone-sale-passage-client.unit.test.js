// specs/pricing-components.md §3 rule 74 and specs/outside-booking-sas.md rule 8a — who a standalone sale belongs to: the shared « Passage » client (seeded once),
// an exact e-mail match (case-insensitive, trimmed) and nothing fuzzy, « Enregistrer comme client » needing a name, a quote creating nothing.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const sales = require('../models/standaloneSalesModel');

const beer = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Bière', 6.5, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);
const lines = [{ articleRef: `option:${beer}`, quantity: 1 }];
const clients = () => db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
const clientOf = (result) => db.prepare('SELECT * FROM clients WHERE id = ?').get(result.document.document.client.id);
const known = Number(db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Alice', 'Martin', 'Alice.Martin@exemple.fr')").run().lastInsertRowid);

test('rule 74 — an anonymous sale goes to the one « Passage » client, seeded once and reused', () => {
  const before = clients();
  const first = standaloneSale.sell({ lines });
  const second = standaloneSale.sell({ lines });
  assert.equal(clients(), before + 1, 'one client row for any number of anonymous sales');
  assert.equal(first.document.document.client.id, second.document.document.client.id);
  assert.deepEqual([first.document.document.client.label, first.document.document.client.kind], ['Passage', 'passage']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients WHERE isPassage = 1').get().n, 1);
  assert.equal(sales.passageClientId(), first.document.document.client.id, 'seeding twice changes nothing');
});

test('rule 8a — a typed name alone attaches to nothing: the sale stays on « Passage » and keeps the name for the receipt', () => {
  const before = clients();
  const result = standaloneSale.sell({ lines, customer: { name: 'Alice Martin' } });
  assert.equal(result.document.document.client.kind, 'passage');
  assert.equal(result.document.document.customerName, 'Alice Martin');
  assert.equal(clients(), before);
});

test('rule 8a — an e-mail that exactly matches one client (case-insensitive, trimmed) attaches the sale to that client', () => {
  const result = standaloneSale.sell({ lines, customer: { email: '  alice.martin@EXEMPLE.fr ' } });
  assert.equal(result.document.document.client.id, known);
  assert.equal(result.document.document.client.kind, 'registered');
  assert.equal(standaloneSale.quote({ lines, customer: { email: 'alice.martin@exemple.fr' } }).customer.kind, 'match');
});

test('rule 8a — no fuzzy match: a near e-mail, or an e-mail two clients share, stays on « Passage »', () => {
  assert.equal(standaloneSale.sell({ lines, customer: { email: 'alice.martin@exemple.com' } }).document.document.client.kind, 'passage');
  db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Autre', 'Martin', 'alice.martin@exemple.fr')").run();
  assert.equal(standaloneSale.sell({ lines, customer: { email: 'alice.martin@exemple.fr' } }).document.document.client.kind, 'passage');
});

test('rule 8a — « Enregistrer comme client » creates the record, and needs a name; unticked, nothing is created', () => {
  const before = clients();
  const refused = standaloneSale.sell({ lines, customer: { email: 'nouveau@exemple.fr', registerAsClient: true } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'Un nom pour enregistrer le client.');
  const registered = standaloneSale.sell({ lines, customer: { name: 'Jean Dupont', email: 'nouveau@exemple.fr', registerAsClient: true } });
  assert.equal(clients(), before + 1);
  assert.deepEqual([clientOf(registered).firstName, clientOf(registered).lastName, clientOf(registered).email], ['Jean', 'Dupont', 'nouveau@exemple.fr']);
  assert.equal(standaloneSale.sell({ lines, customer: { email: 'nouveau@exemple.fr' } }).document.document.client.kind, 'registered', 'and the next sale matches it by e-mail');
});

test('rule 8a — a quote creates no client, not even the one it would register', () => {
  const before = clients();
  const quote = standaloneSale.quote({ lines, customer: { name: 'Marie Curie', registerAsClient: true } });
  assert.equal(quote.customer.kind, 'new');
  assert.equal(clients(), before);
});

test('rule 8a — an invalid e-mail is refused, never stored', () => {
  assert.equal(standaloneSale.sell({ lines, customer: { email: 'pas-un-mail' } }).body.code, 'EMAIL_INVALID');
});
