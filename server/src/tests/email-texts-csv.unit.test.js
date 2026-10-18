// specs/guest-email-texts-made-simple.md §3.E rules 16–18 — the whole wording as one CSV: exported
// with a BOM and `;`, read back in any column order and with either separator, shown before anything
// is saved, refused row by row with its line number, an empty cell keeping the text and `-` emptying it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { buildController } = require('../controllers/emailTextsController');
const emailTextsCsv = require('../utils/emailTextsCsv');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');
const translationCsv = require('../utils/translationCsv');

const translator = { isAvailable: () => false };

async function exported(db) {
  const res = await call(buildController({ database: db, translator }).exportCsv);
  return res.body;
}

function rewrite(csv, key, column, value) {
  const sep = ';';
  const rows = translationCsv.splitRows(csv.replace(/^﻿/, ''), sep).map((r) => r.cells);
  const col = rows[0].indexOf(column);
  const row = rows.find((r) => r[1] === key);
  row[col] = value;
  return `﻿${rows.map((r) => r.map((c) => translationCsv.cell(c, sep)).join(sep)).join('\r\n')}\r\n`;
}

test('rules 16 + 31: one row per text, BOM, `;`, the six columns, no secret, no « Accès »', async () => {
  const { db } = setup();
  arrivalFactsModel.buildModel(db).save(1, { accessFr: 'Porte bleue.', accessCode: '4521', wifiPassword: 'pres2026' });
  const csv = await exported(db);
  assert.ok(csv.startsWith('﻿email;clé;description;français;english;texte par défaut (FR)\r\n'));
  // Rule 31 — « Accès » may hold a code typed by hand: it never leaves in the file.
  assert.doesNotMatch(csv, /access:1|Porte bleue/);
  assert.match(csv, /\r\nJ-7;text:beds\.made;Lits préparés;/);
  assert.match(csv, /\r\nJ-7;hook:1;/);
  assert.match(csv, /\r\nConfirmation;subject:reservation_confirmation;Objet — /);
  assert.doesNotMatch(csv, /4521|pres2026/);
});

test('rule 17: export then import changes nothing', async () => {
  const { db } = setup();
  const controller = buildController({ database: db, translator });
  const csv = await exported(db);
  const res = await call(controller.importCsv, { body: csv, query: { confirm: 'true' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changed, []);
  assert.deepEqual(res.body.refused, []);
  assert.ok(res.body.unchanged > 40);
  assert.equal(await exported(db), csv);
});

test('rule 17: the summary comes first, the confirmation writes; refused rows carry their line', async () => {
  const { db } = setup();
  const controller = buildController({ database: db, translator });
  let csv = await exported(db);
  csv = rewrite(csv, 'text:house', 'français', 'Café et thé vous attendent.');
  csv = rewrite(csv, 'text:beds.made', 'français', 'Bonjour {{prenon}}');
  csv = `${csv}J-2;text:inconnue;;Texte;;\r\n`;
  // Spreadsheet rows, as Excel numbers them (a multi-line cell is one row).
  const records = translationCsv.splitRows(csv.replace(/^\uFEFF/, ''), ';').map((r) => r.cells);
  const badLine = records.findIndex((r) => r[1] === 'text:beds.made') + 1;

  const summary = await call(controller.importCsv, { body: csv, query: {} });
  assert.equal(summary.body.applied, false);
  assert.deepEqual(summary.body.changed.map((c) => c.key), ['text:house']);
  assert.deepEqual([summary.body.changed[0].frShown, summary.body.changed[0].enShown], ['Café et thé vous attendent.', '']);
  assert.deepEqual(summary.body.refused, [
    { line: badLine, key: 'text:beds.made', message: 'Variable inconnue : {{prenon}}' },
    { line: records.length, key: 'text:inconnue', message: 'Clé inconnue : text:inconnue' },
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stay_texts WHERE key = 'house'").get().n, 0, 'nothing saved before confirming');

  const applied = await call(controller.importCsv, { body: csv, query: { confirm: 'true' } });
  assert.equal(applied.body.applied, true);
  assert.equal(db.prepare("SELECT fr FROM stay_texts WHERE key = 'house'").get().fr, 'Café et thé vous attendent.');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stay_texts WHERE key = 'beds.made'").get().n, 0);
});

test('rule 17: an empty cell keeps the text, `-` empties it', () => {
  const rows = emailTextsCsv.parse('clé;français;english\ntext:house;;-\ntext:noWifi;Pas de wifi.;\n');
  assert.deepEqual(rows, [
    { line: 2, key: 'text:house', fr: undefined, en: '' },
    { line: 3, key: 'text:noWifi', fr: 'Pas de wifi.', en: undefined },
  ]);
});

test('rule 18: the translation catalogue\'s parser — any column order, `,` from Excel, quoted newlines', () => {
  const rows = emailTextsCsv.parse('﻿english,clé,français\r\n"Line one\r\nline two",text:house,"Ligne, un"\r\n');
  assert.deepEqual(rows, [{ line: 2, key: 'text:house', fr: 'Ligne, un', en: 'Line one\nline two' }]);
  assert.throws(() => emailTextsCsv.parse('clé;français\nx;y\n'), /colonne « english »/);
});

test('rule 22: a text starting with - = + @ is exported as text and read back unchanged', async () => {
  const { db } = setup();
  db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('parkingLine', 0, '- Garez-vous au parking.', '=Park here')").run();
  const csv = await exported(db);
  assert.match(csv, /\r\nJ-2;text:parkingLine;[^;]*;'- Garez-vous au parking\.;'=Park here;'- Garez-vous/);
  const res = await call(buildController({ database: db, translator }).importCsv, { body: csv, query: {} });
  assert.deepEqual(res.body.changed, []);
  assert.deepEqual(emailTextsCsv.parse("clé;français;english\ntext:house;'-x;'@y\n")[0], { line: 2, key: 'text:house', fr: '-x', en: '@y' });
});

test('rule 22: a cell Excel turned into an error value is refused with its line, in both files', () => {
  const rows = emailTextsCsv.parse('clé;français;english\ntext:house;#NOM?;\ntext:noWifi;Pas de wifi.;#NAME?\n');
  const plan = emailTextsCsv.plan(rows, { find: () => ({ fr: '', en: '', description: 'x' }), validate: () => null });
  assert.deepEqual(plan.refused.map((r) => r.message), [
    'Excel a transformé ce texte en formule — ligne 2. Remettre le texte avec une apostrophe devant, puis réimporter le fichier.',
    'Excel a transformé ce texte en formule — ligne 3. Remettre le texte avec une apostrophe devant, puis réimporter le fichier.',
  ]);
  assert.throws(() => translationCsv.parse('clé,français,english\noption.title:1,Pain,#VALUE!\n'),
    /Excel a transformé ce texte en formule\. Remettre le texte avec une apostrophe devant, puis réimporter le fichier\./);
});

test('rule 23: a file that was not UTF-8 is refused before anything is read', async () => {
  const { db } = setup();
  const res = await call(buildController({ database: db, translator }).importCsv, { body: 'clé;français;english\ntext:house;Caf�;\n', query: { confirm: 'true' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, 'Fichier mal encodé : l’enregistrer en « CSV UTF-8 ».');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n, 0);
});
