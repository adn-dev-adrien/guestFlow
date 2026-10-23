// specs/qonto-bank-reconciliation.md §7 — the recette tool: a Qonto CSV export becomes stored credits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { parseCsv, creditsFromCsv, load } = require('../../../../scripts/bank-transactions-from-qonto-csv');

const HEADER = "Statut;Date de la valeur (UTC);Date de l'opération (UTC);Crédit;Devise;Nom de la contrepartie;IBAN de la contrepartie;Méthode de paiement;Identifiant de transaction;Référence;Note";
const CSV = [
  HEADER,
  'Exécuté;12-10-2026 05:00:00;12-10-2026 04:00:00;704,22;EUR;AIRBNB PAYMENTS LUXEMBOURG S.A.;FR7600000000000000000000000;Transférer;tx-1;Airbnb;',
  'Exécuté;13-10-2026 05:00:00;13-10-2026 04:00:00;;EUR;ALDI;;Carte;tx-2;"";',
  'En cours;14-10-2026 05:00:00;14-10-2026 04:00:00;50,00;EUR;PENDING;;Transférer;tx-3;;',
  'Exécuté;15-10-2026 05:00:00;15-10-2026 04:00:00;1 234,50;EUR;"M. OU ""MME"" DUPONT";;Transférer;tx-4;"Acompte; séjour";"note',
  'sur deux lignes"',
].join('\n');

test('parseCsv — semicolons, quotes, doubled quotes and newlines inside a field', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 5);
  assert.equal(rows[4][5], 'M. OU "MME" DUPONT');
  assert.equal(rows[4][9], 'Acompte; séjour');
  assert.equal(rows[4][10], 'note\nsur deux lignes');
});

test('creditsFromCsv — only settled credits, in cents and ISO dates, no IBAN kept', () => {
  const credits = creditsFromCsv(CSV);
  assert.deepEqual(credits.map((c) => [c.id, c.amountCents, c.settledAt]), [
    ['csv:tx-1', 70422, '2026-10-12T05:00:00.000Z'],
    ['csv:tx-4', 123450, '2026-10-15T05:00:00.000Z'],
  ]);
  assert.equal(JSON.stringify(credits).includes('FR76'), false);
});

test('creditsFromCsv — a file that is not a Qonto export is refused', () => {
  assert.throws(() => creditsFromCsv('a;b\n1;2'), /Colonne manquante/);
});

test('load — fills the stored credits and the settings of a shadow database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-csv-'));
  const dbPath = path.join(dir, 'shadow.db');
  const csvPath = path.join(dir, 'export.csv');
  fs.writeFileSync(csvPath, CSV);
  assert.equal(load({ dbPath, csvPath, startDate: '2026-10-01' }), 2);
  assert.equal(load({ dbPath, csvPath, startDate: '2026-10-01' }), 2, 'idempotent');
  const db = new Database(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n, 2);
  assert.equal(db.prepare("SELECT value FROM plugin_settings WHERE key = 'reconciliationStartDate'").get().value, '2026-10-01');
  assert.equal(db.prepare('SELECT DISTINCT source FROM bank_transactions').get().source, 'csv');
  db.close();
});
