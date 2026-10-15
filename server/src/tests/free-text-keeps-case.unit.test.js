// specs/free-text-keeps-case.md — free text (notes, descriptions) is stored as typed; only its first
// letter is raised. Labels and names keep `sentenceCase`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { capitalizeFirst, sentenceCase } = require('../utils/textFormatters');
const reservationsModel = require('../models/reservationsModel');
const clientsModel = require('../models/clientsModel');
const calendarNotesModel = require('../models/calendarNotesModel');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const TYPED = "Arrivée annoncée entre 20:00 et 21:00 (acceptée sur Booking).\nDemande 2 lits d'appoint — voir le SAS.";

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
  db.prepare("INSERT INTO clients (id, lastName, firstName) VALUES (1, 'Garnier', 'Camille')").run();
  return db;
}

test('capitalizeFirst: blank and null → empty string', () => {
  assert.equal(capitalizeFirst(null), '');
  assert.equal(capitalizeFirst(undefined), '');
  assert.equal(capitalizeFirst('   '), '');
});

test('capitalizeFirst: raises only the first letter, keeps every other character', () => {
  assert.equal(capitalizeFirst('été : clé chez M. Dupont'), 'Été : clé chez M. Dupont');
  assert.equal(capitalizeFirst(TYPED), TYPED);
  assert.equal(capitalizeFirst('  voir la TVA  '), 'Voir la TVA');
  assert.equal(capitalizeFirst('2 lits pour Booking'), '2 Lits pour Booking');
  assert.equal(capitalizeFirst('→ 42'), '→ 42');
});

test('labels still go through sentenceCase', () => {
  assert.equal(sentenceCase('FERMETURE HIVER'), 'Fermeture hiver');
});

test('reservation notes keep their capitals on create and update', () => {
  const db = freshDb();
  const model = reservationsModel.create(db);
  const quote = { totalPrice: 0, finalPrice: 0 };
  const nightBlocks = { blocksPreviousNight: 0, blocksNextNight: 0 };
  const base = { propertyId: 1, clientId: 1, startDate: '2026-11-06', endDate: '2026-11-08', adults: 2, platform: 'Booking' };
  const id = model.insertReservation({ ...base, notes: 'première ligne\nSeconde ligne avec Booking' }, quote, nightBlocks);
  assert.equal(db.prepare('SELECT notes FROM reservations WHERE id = ?').get(id).notes,
    'Première ligne\nSeconde ligne avec Booking');

  model.updateReservation(id, { ...base, notes: TYPED }, quote, nightBlocks, 0);
  assert.equal(db.prepare('SELECT notes FROM reservations WHERE id = ?').get(id).notes, TYPED);
});

test('client notes keep their capitals; names keep sentenceCase', () => {
  const db = freshDb();
  const model = clientsModel.create(db);
  const client = model.insert({ lastName: 'GARNIER', firstName: 'camille', notes: 'Client fidèle, réserve via Booking' });
  assert.equal(client.notes, 'Client fidèle, réserve via Booking');
  assert.equal(client.lastName, 'Garnier');
  assert.equal(client.firstName, 'Camille');
});

test('calendar notes keep their capitals', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE calendar_notes (propertyId INTEGER, date TEXT, note TEXT, PRIMARY KEY (propertyId, date));');
  const model = calendarNotesModel.buildModel(db);
  assert.equal(model.upsert(1, '2026-11-06', 'arrivée Booking tardive').note, 'Arrivée Booking tardive');
});

test('audit: re-saving an unchanged note records no change', () => {
  const before = buildAuditSnapshotFromPayload({ notes: TYPED }, {});
  const after = buildAuditSnapshotFromPayload({ notes: TYPED }, {});
  assert.equal(after.notes, TYPED);
  assert.equal(computeAuditChanges(before, after).filter((c) => c.field === 'notes').length, 0);
});
