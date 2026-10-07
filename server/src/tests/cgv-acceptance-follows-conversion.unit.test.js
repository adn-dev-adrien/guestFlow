// specs/terms-acceptance-record.md rule 29 — a website request is a devis, and converting it inserts a
// new reservation row. The acceptance stays on the devis (append-only, rule 19); the stay reads it from
// there: the fiche block, `{{cgvUrl}}`, and the devis cannot be deleted while it carries that proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const termsModel = require('../models/termsModel');
const devisModel = require('../models/devisModel');
const { buildFicheBlock } = require('../controllers/termsController');
const { loadTermsVersion } = require('../utils/reservationEmailGraph');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// Devis 10 (website request, accepted v1) converted into reservation 20; devis 11 (website request,
// accepted v1) not converted; reservation 30 booked by phone.
function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'P')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'C', 'M')").run();
  const ins = db.prepare("INSERT INTO terms_versions (version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt) VALUES (?, '', '', '', '', '{}', 'abcdef0123456789', '2026-09-01')");
  ins.run(1); ins.run(2);
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, requestOrigin, devisStatus, convertedReservationId) VALUES
    (10, 'devis', 1, 1, '2026-10-01', '2026-10-03', 'public', 'converted', 20),
    (11, 'devis', 1, 1, '2026-11-01', '2026-11-03', 'public', 'sent', NULL),
    (20, 'reservation', 1, 1, '2026-10-01', '2026-10-03', 'public', NULL, NULL),
    (30, 'reservation', 1, 1, '2026-12-01', '2026-12-03', NULL, NULL, NULL)`).run();
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt, ip) VALUES (10, 1, '2026-09-02T10:00:00.000Z', '203.0.113.7'), (11, 1, '2026-09-03T10:00:00.000Z', NULL)").run();
  return db;
}

test('rule 29 — the converted stay shows the acceptance its devis recorded', () => {
  const terms = termsModel.create(seed());
  const block = buildFicheBlock({ id: 20, requestOrigin: 'public' }, { termsModel: terms });
  assert.equal(block.termsAcceptanceState, 'recorded');
  assert.equal(block.termsAcceptance.version, 1);
  assert.equal(block.termsAcceptance.ip, '203.0.113.7');
  assert.equal(buildFicheBlock({ id: 10, requestOrigin: 'public' }, { termsModel: terms }).termsAcceptanceState, 'recorded');
});

test('rule 29 — {{cgvUrl}} of the converted stay points at the accepted version, not the current one', () => {
  const db = seed();
  assert.equal(loadTermsVersion(db, 20), 1);
  assert.equal(loadTermsVersion(db, 30), 2, 'a stay booked by phone still gets the current version (rule 26)');
});

test('rule 29 — a converted devis carrying the acceptance cannot be deleted; others can', () => {
  const db = seed();
  const model = devisModel.buildModel(db);
  const refused = model.remove(10);
  assert.equal(refused.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM terms_acceptances WHERE reservationId = 10').get().n, 1);
  assert.ok(model.remove(11).ok, 'an unconverted request goes with its acceptance (rule 19)');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM terms_acceptances WHERE reservationId = 11').get().n, 0);
});
