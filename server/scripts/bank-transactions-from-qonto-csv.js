#!/usr/bin/env node
/**
 * Recette tool of the bank reconciliation (specs/qonto-bank-reconciliation.md §7): loads a Qonto CSV export
 * into the stored credits of a SHADOW database, so the reconciliation can be tried on the real statement
 * without ever connecting the shadow to the real Qonto account.
 *
 *   node scripts/bank-transactions-from-qonto-csv.js --db <shadow.db> --csv <export.csv> [--start YYYY-MM-DD]
 *
 * Only credits that settled are loaded; the counterparty's IBAN and the account's IBAN are never read.
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const { up } = require('../src/plugins/online-payment/reconciliation/schema');
const { createBankTransactionsModel } = require('../src/plugins/online-payment/reconciliation/bankTransactionsModel');

const ACCOUNT_ID = 'csv-account';

/** `;`-separated, double-quote escaping, quoted fields may hold newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (c === '"') { if (input[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }
  return rows;
}

const parseAmountCents = (v) => Math.round(Number(String(v).replace(/\s/g, '').replace(',', '.')) * 100);
// « 20-10-2026 19:42:28 » (UTC) → ISO instant.
const parseDate = (v) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(String(v || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}.000Z` : null;
};

/** The credits of a Qonto CSV export, in the stored shape. */
function creditsFromCsv(text) {
  const [header, ...rows] = parseCsv(text);
  const at = (name) => header.indexOf(name);
  const col = {
    status: at('Statut'), settled: at('Date de la valeur (UTC)'), emitted: at("Date de l'opération (UTC)"), credit: at('Crédit'),
    currency: at('Devise'), counterparty: at('Nom de la contrepartie'), method: at('Méthode de paiement'),
    id: at('Identifiant de transaction'), reference: at('Référence'), note: at('Note'),
  };
  Object.entries(col).forEach(([k, v]) => { if (v < 0) throw new Error(`Colonne manquante dans l'export : ${k}`); });
  return rows
    .filter((r) => r[col.status] === 'Exécuté' && r[col.credit] !== '')
    .map((r) => ({
      id: `csv:${r[col.id]}`,
      bankAccountId: ACCOUNT_ID,
      amountCents: parseAmountCents(r[col.credit]),
      currency: r[col.currency] || 'EUR',
      settledAt: parseDate(r[col.settled]),
      emittedAt: parseDate(r[col.emitted]),
      updatedAt: parseDate(r[col.settled]),
      operationType: r[col.method] || '',
      label: r[col.counterparty] || '',
      counterpartyName: r[col.counterparty] || '',
      reference: r[col.reference] || '',
      note: r[col.note] || '',
    }));
}

function load({ dbPath, csvPath, startDate }) {
  const db = new Database(dbPath);
  up(db);
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_settings (plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', PRIMARY KEY (plugin_id, key))`);
  const credits = creditsFromCsv(fs.readFileSync(csvPath, 'utf8'));
  createBankTransactionsModel(db).upsertMany(credits, { bankAccountId: ACCOUNT_ID, source: 'csv' });
  const set = db.prepare('INSERT INTO plugin_settings (plugin_id, key, value) VALUES (\'online-payment\', ?, ?) ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value');
  set.run('reconciliationBankAccountId', ACCOUNT_ID);
  set.run('reconciliationLastReadAt', new Date().toISOString());
  if (startDate) set.run('reconciliationStartDate', startDate);
  db.close();
  return credits.length;
}

if (require.main === module) {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
  const dbPath = arg('db');
  const csvPath = arg('csv');
  if (!dbPath || !csvPath) {
    console.error('Usage: node scripts/bank-transactions-from-qonto-csv.js --db <shadow.db> --csv <export.csv> [--start YYYY-MM-DD]');
    process.exit(2);
  }
  console.log(`${load({ dbPath, csvPath, startDate: arg('start') })} credit(s) loaded into ${dbPath}`);
}

module.exports = { parseCsv, creditsFromCsv, load, ACCOUNT_ID };
