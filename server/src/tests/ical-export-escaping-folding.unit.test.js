// specs/ical-export-closures.md rule 13 — TEXT values are escaped per RFC 5545 §3.3.11 (backslash first,
// then CR/LF, comma, semicolon) and content lines are folded at 75 octets (§3.1) without cutting a
// multi-byte character (audit 2026-10-28). The feed still reads back to the same label.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalModel = require('../models/icalModel');
const { parseIcsEvents } = require('../utils/icalParser');

const { escapeIcalText, foldLine } = icalModel.__test;

test('backslash is escaped before the other characters', () => {
  assert.equal(escapeIcalText('a\\b'), 'a\\\\b');
  assert.equal(escapeIcalText('a\\,b'), 'a\\\\\\,b');
});

test('CR, LF and CRLF all become the escaped newline, never a raw control character', () => {
  assert.equal(escapeIcalText('a\r\nb\rc\nd'), 'a\\nb\\nc\\nd');
  assert.doesNotMatch(escapeIcalText('x\ry'), /[\r\n]/);
});

test('comma and semicolon are escaped', () => {
  assert.equal(escapeIcalText('Fermeture, hiver; 2027'), 'Fermeture\\, hiver\\; 2027');
});

test('a short line is left alone', () => {
  assert.equal(foldLine('SUMMARY:Réservé'), 'SUMMARY:Réservé');
});

test('a long line is folded at 75 octets, continuation lines start with one space', () => {
  const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
  const lines = folded.split('\r\n');
  assert.ok(lines.length > 1);
  lines.forEach((l, i) => {
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `line ${i} is ${Buffer.byteLength(l, 'utf8')} octets`);
    if (i > 0) assert.equal(l[0], ' ');
  });
  assert.equal(lines.map((l, i) => (i ? l.slice(1) : l)).join(''), `SUMMARY:${'x'.repeat(200)}`);
});

test('folding never cuts a multi-byte character', () => {
  const folded = foldLine(`SUMMARY:${'é€'.repeat(60)}`);
  const unfolded = folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('');
  assert.equal(unfolded, `SUMMARY:${'é€'.repeat(60)}`);
  folded.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l, 'utf8') <= 75));
});

test('the exported feed of a closure with a hostile label is well formed and reads back', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT 'reservation', propertyId INTEGER, startDate TEXT, endDate TEXT);
    CREATE TABLE ical_tokens (propertyId INTEGER, token TEXT);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT, startDate TEXT, endDate TEXT, createdAt TEXT, updatedAt TEXT);
    INSERT INTO properties (id, name) VALUES (1, 'La Granja; Gîte, "n°1"\\ test');
  `);
  const label = `Travaux\r\nBEGIN:VEVENT, \\ ; ${'très long '.repeat(20)}`;
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, ?, '2099-11-01', '2099-11-08')").run(label);
  const ics = icalModel.buildModel(db).exportProperty(1);
  ics.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l, 'utf8') <= 75, l));
  assert.equal(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length, 1, 'a CR/LF in a label cannot open another event');
  const [event] = parseIcsEvents(ics);
  assert.ok(event.startDate === '2099-11-01' && event.endDate === '2099-11-08');
});
