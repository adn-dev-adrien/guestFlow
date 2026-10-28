// specs/clients-upcoming-past-directory.md rules 11-21 (amendment of 2026-10-28) — the three views of the
// Clients page, their groups, the stay and label of each row, the search across views, the sort.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');
const clientsController = require('../controllers/clientsController');

const TODAY = '2026-10-28';
const shift = (days) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function makeModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lastName TEXT, firstName TEXT, streetNumber TEXT, street TEXT,
      postalCode TEXT, city TEXT, address TEXT, phone TEXT, email TEXT, notes TEXT,
      createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', platform TEXT,
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, finalPrice REAL DEFAULT 0,
      adults INTEGER DEFAULT 0, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      devisNumber TEXT, devisStatus TEXT
    );
    INSERT INTO properties (id, name) VALUES (1, 'La Granja'), (2, 'L''Estiva');
  `);
  let created = 0;
  const addClient = (lastName, firstName = 'X', extra = {}) => db.prepare(
    'INSERT INTO clients (lastName, firstName, email, phone, city, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(lastName, firstName, extra.email || '', extra.phone || '', extra.city || '',
    extra.createdAt || `2026-09-${String(10 + (created += 1)).padStart(2, '0')} 09:00:00`).lastInsertRowid;
  const addStay = (clientId, start, end, extra = {}) => db.prepare(
    'INSERT INTO reservations (kind, clientId, propertyId, platform, startDate, endDate, devisNumber, devisStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(extra.kind || 'reservation', clientId, extra.propertyId || 1, extra.platform || 'Booking',
    shift(start), shift(end), extra.devisNumber || null, extra.devisStatus || null).lastInsertRowid;
  const directory = (params = {}) => model.directory({ today: TODAY, ...params });
  const model = clientsModel.create(db);
  return { model, db, addClient, addStay, directory };
}

const names = (items) => items.map((c) => c.lastName);
const find = (res, lastName) => res.items.find((c) => c.lastName === lastName);

test('rule 11 — a stay-less client is « none », not « upcoming »; a devis-only client too', () => {
  const { addClient, addStay, directory } = makeModel();
  addClient('Rien');
  const quote = addClient('Devisseul');
  addStay(quote, 20, 22, { kind: 'devis', devisNumber: 'D-1', devisStatus: 'sent' });
  const real = addClient('Venant');
  addStay(real, 5, 7);

  assert.deepEqual(directory().counts, { upcoming: 1, past: 0, none: 2 });
  assert.deepEqual(names(directory({ view: 'none' }).items).sort(), ['Devisseul', 'Rien']);
  assert.equal(find(directory({ view: 'none' }), 'Rien').stay, null);
});

test('rule 11 — a cancelled stay is not a stay: no view, no stayCount', () => {
  const { addClient, addStay, directory } = makeModel();
  const id = addClient('Annule');
  addStay(id, 5, 7, { kind: 'cancelled' });
  addStay(id, -40, -38);
  const res = directory({ view: 'past' });
  assert.equal(find(res, 'Annule').stayCount, 1);
  assert.equal(find(res, 'Annule').stay.startDate, shift(-40));
  assert.equal(directory().counts.upcoming, 0);
});

test('rule 12 — an unknown view falls back to upcoming; the legacy `bucket` alias still answers', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('Futur'), 5, 7);
  addStay(addClient('Ancien'), -30, -28);
  assert.equal(directory({ view: 'bogus' }).view, 'upcoming');
  assert.equal(directory({}).view, 'upcoming');
  assert.deepEqual(names(directory({ bucket: 'past' }).items), ['Ancien']);
  assert.equal(directory({ bucket: 'past' }).view, 'past');
});

test('rule 13 — upcoming groups at the thresholds, empty groups omitted, in order', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('Encours'), -2, 2);
  addStay(addClient('Aujourdhui'), 0, 3);
  addStay(addClient('J7'), 7, 9);
  addStay(addClient('J8'), 8, 10);
  addStay(addClient('J30'), 30, 32);
  addStay(addClient('J31'), 31, 33);
  const { groups } = directory();
  assert.deepEqual(groups.map((g) => [g.key, g.label, g.count]), [
    ['inStay', 'En séjour', 2],
    ['next7', '7 prochains jours', 1],
    ['next30', '30 prochains jours', 2],
    ['later', 'Plus tard', 1],
  ]);
  assert.deepEqual(names(groups[0].items), ['Encours', 'Aujourdhui']);
  assert.deepEqual(names(groups[2].items), ['J8', 'J30']);

  const only = makeModel();
  only.addStay(only.addClient('Seul'), 40, 42);
  assert.deepEqual(only.directory().groups.map((g) => g.key), ['later']);
});

test('rule 13 — past groups by year of the last stay, newest first; none groups devis before nothing', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('A2026'), -10, -8);
  addStay(addClient('B2025'), -400, -398);
  addStay(addClient('C2026'), -30, -28);
  const past = directory({ view: 'past' }).groups;
  assert.deepEqual(past.map((g) => g.label), ['2026', '2025']);
  assert.deepEqual(names(past[0].items), ['A2026', 'C2026']);

  addClient('Vide');
  addStay(addClient('Avecdevis'), 3, 4, { kind: 'devis', devisNumber: 'D-2', devisStatus: 'draft' });
  const none = directory({ view: 'none' }).groups;
  assert.deepEqual(none.map((g) => [g.key, g.label]), [['devis', 'Devis en cours'], ['nothing', 'Aucune réservation']]);
});

test('rule 13 — the name sort is one unlabelled group, and groups flattened equal `items`', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('Zed'), 3, 4);
  addStay(addClient('Alard'), 40, 41);
  const res = directory({ sort: 'name' });
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].label, '');
  assert.deepEqual(names(res.groups[0].items), ['Alard', 'Zed']);
  const grouped = directory();
  assert.deepEqual(grouped.items, grouped.groups.flatMap((g) => g.items));
});

test('rule 14 — `stay` is the next stay when both exist, the last one otherwise, null when none', () => {
  const { addClient, addStay, directory } = makeModel();
  const both = addClient('Fidele');
  addStay(both, -400, -397, { propertyId: 2, platform: 'direct' });
  const nextId = addStay(both, 12, 15, { propertyId: 1, platform: 'Booking' });
  addStay(addClient('Ancien'), -50, -47);
  addClient('Rien');

  const row = find(directory(), 'Fidele');
  assert.deepEqual(row.stay, {
    reservationId: nextId, propertyName: 'La Granja', startDate: shift(12), endDate: shift(15), nights: 3, platform: 'Booking',
  });
  assert.equal(row.stayDate, shift(12));
  assert.equal(row.whenLabel, 'Arrive dans 12 j');
  assert.equal(find(directory({ view: 'past' }), 'Ancien').stay.startDate, shift(-50));
  assert.equal(find(directory({ view: 'past' }), 'Ancien').whenLabel, 'Parti il y a 6 sem.');
  assert.equal(find(directory({ view: 'none' }), 'Rien').stay, null);
});

test('rule 14 — the stay of a client in the house is the current one; yesterday’s departure is « past »', () => {
  const { addClient, addStay, directory } = makeModel();
  const inHouse = addClient('Chezlui');
  const current = addStay(inHouse, -2, 11);
  addStay(inHouse, 40, 42);
  addStay(addClient('Hier'), -4, -1);
  const res = directory();
  assert.equal(find(res, 'Chezlui').stay.reservationId, current);
  assert.equal(find(res, 'Chezlui').whenLabel, 'En séjour · départ le 08/11');
  assert.equal(res.groups[0].key, 'inStay');
  assert.equal(find(directory({ view: 'past' }), 'Hier').whenLabel, 'Parti le 27/10');
});

test('rule 15 — stayCount counts past and future real stays', () => {
  const { addClient, addStay, directory } = makeModel();
  const id = addClient('Habitue');
  addStay(id, -300, -298);
  addStay(id, -100, -98);
  addStay(id, 20, 22);
  addStay(id, 25, 26, { kind: 'devis' });
  assert.equal(find(directory(), 'Habitue').stayCount, 3);
});

test('rule 16 — the search spans the three views; `elsewhere` names the view with most matches, null otherwise', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('Futur', 'A', { city: 'Lyon' }), 5, 7);
  addStay(addClient('Ancien1', 'B', { city: 'Paris' }), -30, -28);
  addStay(addClient('Ancien2', 'C', { city: 'Paris' }), -60, -58);
  addClient('Orphelin', 'D', { city: 'Paris' });

  const paris = directory({ q: 'Paris' });
  assert.deepEqual(paris.counts, { upcoming: 0, past: 2, none: 1 });
  assert.deepEqual(paris.elsewhere, { view: 'past', count: 2 });
  assert.equal(paris.items.length, 0);

  const lyon = directory({ q: 'Lyon' });
  assert.equal(lyon.elsewhere, null);
  assert.equal(directory({ q: 'introuvable' }).elsewhere, null);
  assert.deepEqual(directory({ q: 'introuvable' }).counts, { upcoming: 0, past: 0, none: 0 });
});

test('rule 17 — name sort is French-locale, `none` sorts by creation date, legacy lastName maps to name', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('Bernard'), 3, 4);
  addStay(addClient('Élodie'), 5, 6);
  addStay(addClient('Alard'), 7, 8);
  assert.deepEqual(names(directory({ sort: 'name' }).items), ['Alard', 'Bernard', 'Élodie']);
  assert.deepEqual(names(directory({ sort: 'lastName' }).items), ['Alard', 'Bernard', 'Élodie']);
  assert.equal(directory({ sort: 'lastName' }).sort, 'name');

  const older = addClient('Ancien', 'X', { createdAt: '2026-01-01 08:00:00' });
  const newer = addClient('Recent', 'X', { createdAt: '2026-10-20 08:00:00' });
  assert.ok(older && newer);
  assert.deepEqual(names(directory({ view: 'none' }).items), ['Recent', 'Ancien']);
});

test('rule 6 — the default direction is per view and `dir` flips groups and rows', () => {
  const { addClient, addStay, directory } = makeModel();
  addStay(addClient('Proche'), 3, 4);
  addStay(addClient('Lointain'), 40, 42);
  addStay(addClient('Recent'), -10, -8);
  addStay(addClient('Vieux'), -300, -298);
  assert.deepEqual(names(directory().items), ['Proche', 'Lointain']);
  assert.deepEqual(names(directory({ view: 'past' }).items), ['Recent', 'Vieux']);
  assert.deepEqual(names(directory({ dir: 'desc' }).items), ['Lointain', 'Proche']);
  assert.deepEqual(directory({ dir: 'desc' }).groups.map((g) => g.key), ['later', 'next7']);
  assert.deepEqual(names(directory({ view: 'past', dir: 'asc' }).items), ['Vieux', 'Recent']);
});

test('rule 19 — orphanCount equals the cleanup dialog’s set (no reservation and no devis)', () => {
  const { model, addClient, addStay, directory } = makeModel();
  addClient('Rien1');
  addClient('Rien2');
  addStay(addClient('Devisseul'), 5, 6, { kind: 'devis' });
  addStay(addClient('Venant'), 5, 6);
  assert.equal(directory().orphanCount, model.listOrphans().length);
  assert.equal(directory().orphanCount, 2);
  assert.equal(directory({ q: 'Venant' }).orphanCount, 2, 'the count describes the cleanup, not the search');
});

test('rule 21 — the plain client list used by the pickers is unchanged: a bare array of clients', () => {
  const { model, addClient, addStay } = makeModel();
  addStay(addClient('Venant'), 5, 6);
  const list = model.list();
  assert.ok(Array.isArray(list));
  assert.deepEqual(Object.keys(list[0]).sort(), ['address', 'city', 'createdAt', 'email', 'firstName', 'id',
    'lastName', 'notes', 'phone', 'postalCode', 'street', 'streetNumber', 'updatedAt']);
});

test('rule 12 — the controller forwards view, sort and dir and lets the model fall back', () => {
  let received;
  const controller = clientsController.buildController
    ? clientsController.buildController({ directory: (p) => { received = p; return { ok: true }; } })
    : null;
  const res = { json: (body) => body };
  const body = controller.directory({ query: { q: 'x', view: 'past', sort: 'name', dir: 'asc' } }, res);
  assert.deepEqual(body, { ok: true });
  assert.deepEqual(received, { q: 'x', view: 'past', bucket: undefined, sort: 'name', dir: 'asc' });
});
