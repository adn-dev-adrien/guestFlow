/**
 * The full export of a customer being deprovisioned (rule 20, step 1; GDPR reversibility): a copy
 * of the database, the uploads, and CSV files of the reservations and the clients, in one
 * `.tar.gz` under `<CP_DATA_DIR>/exports`. The instance's database is only read.
 */

const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CSV_TABLES = ['reservations', 'clients'];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = Buffer.isBuffer(v) ? v.toString('base64') : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tableToCsv(db, table) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols.length === 0) return null;
  const lines = [cols.join(',')];
  for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) lines.push(cols.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\n')}\n`;
}

// → { file, bytes } ; throws with a French message the step shows.
function exportInstance({ instances, slug, exportsDir, stamp }) {
  if (!instances.hasDatabase(slug)) throw new Error('Base de l’instance introuvable : rien à exporter.');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `gf-export-${slug}-`));
  try {
    const src = new Database(instances.dbPath(slug), { readonly: true, fileMustExist: true });
    try {
      src.prepare('VACUUM INTO ?').run(path.join(work, 'guestflow.db'));
    } finally {
      src.close();
    }
    const copy = new Database(path.join(work, 'guestflow.db'), { readonly: true });
    try {
      for (const t of CSV_TABLES) {
        const csv = tableToCsv(copy, t);
        if (csv !== null) fs.writeFileSync(path.join(work, `${t}.csv`), csv);
      }
    } finally {
      copy.close();
    }
    const uploads = path.join(instances.dirOf(slug), 'uploads');
    if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(work, 'uploads'), { recursive: true });
    fs.mkdirSync(exportsDir, { recursive: true });
    const file = path.join(exportsDir, `${slug}-${stamp}.tar.gz`);
    execFileSync('tar', ['-czf', file, '-C', work, '.']);
    return { file, bytes: fs.statSync(file).size };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { exportInstance, tableToCsv, CSV_TABLES };
