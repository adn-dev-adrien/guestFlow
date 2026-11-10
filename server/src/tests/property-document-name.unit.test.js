// specs/settings-input-guards.md rule 63 (verification R42 L1-L3, 2026-11-10) — the stored name of a document: the one
// sent, trimmed; empty or blank, the file's own name shortened to 200 characters (extension kept); and an INSERT that
// throws removes the upload already on disk.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const f = require('./reservationSaveFixture');
const propertiesModel = require('../models/propertiesModel');
const { documentDisplayName } = require('../utils/propertyValidation');

test.before(() => f.seed());

test('rule 63: a sent name is trimmed; a blank one falls back to the file\'s own name', () => {
  assert.equal(documentDisplayName('  Contrat  ', 'scan.pdf'), 'Contrat');
  assert.equal(documentDisplayName('   ', 'scan.pdf'), 'scan.pdf');
  assert.equal(documentDisplayName(undefined, 'scan.pdf'), 'scan.pdf');
});

test('rule 63: the file\'s own name is shortened to 200 characters, its extension kept', () => {
  const long = `${'a'.repeat(10000)}.pdf`;
  const name = documentDisplayName('', long);
  assert.equal(name.length, 200);
  assert.ok(name.endsWith('.pdf'));
  assert.equal(documentDisplayName('', 'b'.repeat(300)).length, 200);
});

test('rule 63: an INSERT that throws removes the upload already on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-doc-throw-'));
  const filePath = path.join(dir, 'probe.pdf');
  fs.writeFileSync(filePath, 'x');
  f.db.exec("CREATE TRIGGER documents_refuse BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'refused'); END");
  try {
    assert.throws(() => propertiesModel.addDocument(1, { path: filePath, filename: 'probe.pdf', originalname: 'probe.pdf' }, {}), /refused/);
    assert.equal(fs.existsSync(filePath), false, 'no orphan private file');
  } finally {
    f.db.exec('DROP TRIGGER documents_refuse');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
