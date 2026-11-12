// specs/resource-booking-client-picker.md rules 1-7, 10 — the client picker of a resource session: three
// groups against the session's day, their order, the line under each name and the text it searches in.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');
const clientsController = require('../controllers/clientsController');
const { normalizeSearchText } = require('../utils/searchText');

// date-literal-ok: the model receives `today` as a parameter; nothing here reads the real clock.
const TODAY = '2026-11-12';
const shift = (days, from = TODAY) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function makeModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lastName TEXT, firstName TEXT, phone TEXT, email TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER,
      propertyId INTEGER, startDate TEXT, endDate TEXT
    );
    INSERT INTO properties (id, name) VALUES (1, 'La Granja'), (2, 'L''Estiva');
  `);
  const addClient = (lastName, firstName = 'X', extra = {}) => db.prepare(
    'INSERT INTO clients (lastName, firstName, email, phone) VALUES (?, ?, ?, ?)',
  ).run(lastName, firstName, extra.email ?? '', extra.phone ?? '').lastInsertRowid;
  const addStay = (clientId, start, end, extra = {}) => db.prepare(
    'INSERT INTO reservations (kind, clientId, propertyId, startDate, endDate) VALUES (?, ?, ?, ?, ?)',
  ).run(extra.kind || 'reservation', clientId, extra.propertyId || 1, shift(start), shift(end)).lastInsertRowid;
  const model = clientsModel.create(db);
  const picker = (params = {}) => model.picker({ today: TODAY, ...params });
  return { addClient, addStay, picker, model };
}

const names = (res) => res.options.map((o) => o.lastName);
const groupOf = (res, lastName) => res.options.find((o) => o.lastName === lastName).group;

test('rule 3 — three groups in order: on site or within 7 days, other upcoming, past then stay-less', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Ancien'), -40, -35);
  addStay(addClient('Loin'), 30, 33);
  addStay(addClient('Sur place'), -2, 2);
  addClient('Personne');
  addStay(addClient('Bientot'), 4, 6);

  const res = picker();
  assert.equal(res.referenceDay, TODAY);
  assert.deepEqual(names(res), ['Sur place', 'Bientot', 'Loin', 'Ancien', 'Personne']);
  assert.deepEqual(res.options.map((o) => o.group), ['soon', 'soon', 'upcoming', 'past', 'past']);
  assert.deepEqual([...new Set(res.options.map((o) => o.groupLabel))], ['En séjour ou bientôt', 'À venir', 'Passés']);
});

test('rule 3 — on site counts the arrival day and the departure day; day + 7 is soon, day + 8 is not', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Arrive'), 0, 3);
  addStay(addClient('Part'), -3, 0);
  addStay(addClient('Sept'), 7, 9);
  addStay(addClient('Huit'), 8, 9);

  const res = picker();
  assert.equal(groupOf(res, 'Arrive'), 'soon');
  assert.equal(groupOf(res, 'Part'), 'soon');
  assert.equal(groupOf(res, 'Sept'), 'soon');
  assert.equal(groupOf(res, 'Huit'), 'upcoming');
  assert.deepEqual(names(res), ['Part', 'Arrive', 'Sept', 'Huit']);
});

test('rule 2 — the session day is the reference: a later guest comes first, an earlier one is past', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Decembre'), 36, 40);
  addStay(addClient('Maintenant'), -1, 2);

  const session = shift(38);
  const res = picker({ date: session });
  assert.equal(res.referenceDay, session);
  assert.equal(groupOf(res, 'Decembre'), 'soon');
  assert.equal(groupOf(res, 'Maintenant'), 'past');
  assert.equal(res.options[0].groupLabel, `En séjour le ${session.slice(8, 10)}/${session.slice(5, 7)} ou bientôt`);
});

test('rule 2 — a missing or malformed date falls back to today', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Ici'), 0, 1);
  for (const date of [undefined, '', 'demain', '2026-02-30']) {
    const res = picker({ date });
    assert.equal(res.referenceDay, TODAY, String(date));
    assert.equal(res.options[0].groupLabel, 'En séjour ou bientôt');
  }
});

test('rule 4 — a devis or a cancelled stay is not a stay: the client ends the past group', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Devis'), 3, 5, { kind: 'devis' });
  addStay(addClient('Annule'), 0, 2, { kind: 'cancelled' });
  addStay(addClient('Parti'), -10, -8);

  const res = picker();
  assert.deepEqual(names(res), ['Parti', 'Annule', 'Devis']);
  assert.ok(res.options.every((o) => o.group === 'past'));
  assert.equal(res.options[1].detail, 'Aucun séjour');
});

test('rule 3 — in-group order: on site by departure then arrivals, upcoming by arrival, past most recent first, names fr', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Longtemps'), -1, 9);
  addStay(addClient('Court'), -1, 1);
  addStay(addClient('Demain'), 1, 3);
  addStay(addClient('Tard B'), 20, 22);
  addStay(addClient('Tard A'), 15, 18);
  addStay(addClient('Vieux'), -300, -290);
  addStay(addClient('Recent'), -5, -2);
  addClient('Émile');
  addClient('Zoe');
  addClient('Eric');

  assert.deepEqual(names(picker()), [
    'Court', 'Longtemps', 'Demain', 'Tard A', 'Tard B', 'Recent', 'Vieux', 'Émile', 'Eric', 'Zoe',
  ]);
});

test('rule 3 — ties break on last name, first name, id', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Martin', 'Zoé'), 2, 4);
  addStay(addClient('Martin', 'Anne'), 2, 4);
  addStay(addClient('Durand', 'Paul'), 2, 4);
  assert.deepEqual(picker().options.map((o) => `${o.lastName} ${o.firstName}`), ['Durand Paul', 'Martin Anne', 'Martin Zoé']);
});

test('rule 5 — the line under the name: the qualifying stay (covering → next → last), else email, phone, nothing', () => {
  const { addClient, addStay, picker } = makeModel();
  const both = addClient('Deux');
  addStay(both, -30, -25, { propertyId: 2 });
  addStay(both, 2, 5);
  addStay(addClient('Passe'), -30, -25, { propertyId: 2 });
  addClient('Mail', 'X', { email: 'mail@exemple.fr', phone: '06 00 00 00 00' });
  addClient('Tel', 'X', { phone: '06 11 22 33 44' });
  addClient('Vide');

  const detail = (lastName) => picker().options.find((o) => o.lastName === lastName).detail;
  assert.equal(detail('Deux'), 'La Granja · 14/11 → 17/11/2026');
  assert.equal(detail('Passe'), "L'Estiva · 13/10 → 18/10/2026");
  assert.equal(detail('Mail'), 'mail@exemple.fr');
  assert.equal(detail('Tel'), '06 11 22 33 44');
  assert.equal(detail('Vide'), 'Aucun séjour');
});

test('rule 7 — searchText folds accents and case, carries the phone digits and the property name', () => {
  const { addClient, addStay, picker } = makeModel();
  addStay(addClient('Lefèvre', 'Élodie', { email: 'E.Lefevre@Exemple.fr', phone: '06 12 34 56 78' }), 1, 3, { propertyId: 2 });
  const { searchText } = picker().options[0];
  assert.equal(searchText, "elodie lefevre e.lefevre@exemple.fr 06 12 34 56 78 0612345678 l'estiva");
});

test('normalizeSearchText — skips empty parts and collapses spaces', () => {
  assert.equal(normalizeSearchText('  Ça ', null, '', undefined, 'VA  bien'), 'ca va bien');
});

test('controller — GET /clients/picker hands the date to the model', () => {
  let received;
  const controller = clientsController.buildController({ picker: (p) => { received = p; return { options: [] }; } });
  // date-literal-ok: an opaque string handed through to a stub model.
  const day = '2026-12-20';
  const body = controller.picker({ query: { date: day } }, { json: (b) => b });
  assert.deepEqual(received, { date: day });
  assert.deepEqual(body, { options: [] });
});

test('specs/resource-booking-client-picker.md rule 10 — GET /api/clients keeps its alphabetical list for the other pickers', () => {
  const { addClient, addStay, model } = makeModel();
  addStay(addClient('Zola'), -1, 2);
  addClient('Abel');
  assert.deepEqual(model.list().map((c) => c.lastName), ['Abel', 'Zola']);
});
