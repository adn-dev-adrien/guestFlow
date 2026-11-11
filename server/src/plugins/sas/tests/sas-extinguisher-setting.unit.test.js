// specs/plugins-phase-p-productisation.md rule 16 — the extinguisher check belongs to the SAS plugin and
// is off by default: the core inserts no repair row, turning the check on inserts its two rows, and
// with the check off a save of the « Facturables » list never brings them back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sas-ext-')), 'test.db');
const silent = console.log;
console.log = () => {};
const db = require('../../../database');
console.log = silent;

const repairAmounts = require('../../../models/repairAmountsModel');
const settings = require('../settings');

const keys = () => db.prepare('SELECT repairKey FROM repair_amounts WHERE repairKey IS NOT NULL ORDER BY repairKey').all().map((r) => r.repairKey);

function bindWith(value) {
  settings.bind({ settings: { declare() {}, get: () => value } });
}

test('a new database has no extinguisher row, and the check is off', () => {
  assert.deepEqual(keys(), []);
  bindWith('0');
  assert.equal(settings.extinguisherCheckOn(), false);
});

test('turning the check on inserts the two rows, once', () => {
  const [decl] = settings.DECLARED;
  assert.equal(decl.key, 'extinguisherCheck');
  assert.equal(decl.default, '0');
  assert.equal(decl.validate('maybe'), 'Valeur attendue : 0 ou 1.');
  decl.afterSave('1');
  decl.afterSave('true');
  assert.deepEqual(keys(), ['extinguisher_seal', 'extinguisher_use']);
  bindWith('1');
  assert.equal(settings.extinguisherCheckOn(), true);
});

test('off, a save of the list drops them for good; on, they come back', () => {
  repairAmounts.replaceAll([{ label: 'Vitre' }], { keepProtected: false });
  assert.deepEqual(keys(), []);
  repairAmounts.replaceAll([{ label: 'Vitre' }], { keepProtected: true });
  assert.deepEqual(keys(), ['extinguisher_seal', 'extinguisher_use']);
});
