// specs/guest-email-texts-made-simple.md rule 32 — « Accès » may hold a door code typed by hand: it
// never leaves in the file, and a row naming it is refused on import. A text emptied by `-` reads
// « (vidé) » in the summary, not as an empty cell.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { buildController } = require('../controllers/emailTextsController');
const emailTextsCsv = require('../utils/emailTextsCsv');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');

const translator = { isAvailable: () => false };
const HEADER = '﻿email;clé;description;français;english;texte par défaut (FR)\r\n';

test('rule 32: the export holds no « Accès » row, and its code never', async () => {
  const { db } = setup();
  arrivalFactsModel.buildModel(db).save(1, { accessFr: 'Boîte à clés, code 4821.' });
  const res = await call(buildController({ database: db, translator }).exportCsv);
  assert.doesNotMatch(res.body, /access:|4821/);
});

test('rule 32: an imported « Accès » row is refused with its line; nothing is written', async () => {
  const { db } = setup();
  arrivalFactsModel.buildModel(db).save(1, { accessFr: 'Porte bleue.' });
  const csv = `${HEADER}J-2;access:1;Accès;Code 9999;;\r\n`;
  const res = await call(buildController({ database: db, translator }).importCsv, { body: csv, query: { confirm: 'true' } });
  assert.deepEqual(res.body.refused, [{ line: 2, key: 'access:1', message: emailTextsCsv.ACCESS_REFUSED }]);
  assert.equal(arrivalFactsModel.buildModel(db).forEmail(1).accessFr, 'Porte bleue.');
});

test('rule 32: a text emptied with « - » reads « (vidé) » in the summary', async () => {
  const { db } = setup();
  const csv = `${HEADER}J-7;text:beds.made;Lits préparés;;-;\r\n`;
  const res = await call(buildController({ database: db, translator }).importCsv, { body: csv, query: {} });
  assert.equal(res.body.changed.length, 1);
  assert.equal(res.body.changed[0].enShown, emailTextsCsv.CLEARED);
  assert.equal(emailTextsCsv.CLEARED, '(vidé)');
});
