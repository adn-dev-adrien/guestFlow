/**
 * The translation catalogue's exchange format (specs/translation-catalogue.md §3.2).
 *
 * Pure: no database, no filesystem. It turns catalogue rows into the CSV the operator downloads, and
 * turns the file they send back into a list of changes — nothing else decides anything here.
 *
 * This is the module that meets a hostile file, so it is deliberately forgiving about *shape* and
 * deliberately strict about *meaning*:
 *   - a BOM, CRLF line endings and `;` separators are accepted, because they are what Excel writes
 *     on a French machine and this file exists to be opened in Excel;
 *   - a missing or renamed required column is refused outright, naming the line, because guessing
 *     which column held the English is how a catalogue gets silently emptied.
 */

const COL_KEY = 'clé';
const COL_WHERE = 'où';
const COL_SOURCE = 'français';
const COL_REVIEW = 'à revérifier';

/** Column header per language code. An unlisted language keeps its code — honest, if unlovely. */
const LANG_HEADERS = Object.freeze({ en: 'english', de: 'deutsch', es: 'español', it: 'italiano', nl: 'nederlands' });

/** The `où` column: what the operator reads to know what they are translating. */
const KIND_LABELS = Object.freeze({
  category: 'Catégorie',
  'option.title': 'Option · titre',
  'option.description': 'Option · description',
  'resource.name': 'Ressource · nom',
});

/** Rule 8 — a stable order, so two downloads of the same catalogue are the same file. */
const KIND_ORDER = Object.freeze(['category', 'option.title', 'option.description', 'resource.name']);

function headerFor(lang) {
  return LANG_HEADERS[lang] || lang;
}

function langOfHeader(header) {
  const h = String(header || '').trim().toLowerCase();
  const found = Object.keys(LANG_HEADERS).find((code) => LANG_HEADERS[code] === h);
  return found || h;
}

/** RFC 4180 with the separator we are writing: quote only when we must, double the inner quotes. */
function cell(value, sep) {
  const s = value == null ? '' : String(value);
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

function compareRows(a, b) {
  const ka = KIND_ORDER.indexOf(a.kind);
  const kb = KIND_ORDER.indexOf(b.kind);
  if (ka !== kb) return (ka === -1 ? KIND_ORDER.length : ka) - (kb === -1 ? KIND_ORDER.length : kb);
  const bySource = String(a.sourceText || '').localeCompare(String(b.sourceText || ''), 'fr', { sensitivity: 'base' });
  return bySource !== 0 ? bySource : String(a.entryKey).localeCompare(String(b.entryKey));
}

/**
 * Serialise the whole catalogue (rule 10 — always everything, translated or not).
 *
 * @param {Array<{entryKey,kind,sourceText,values:Object<string,{text,sourceAtTime}>}>} entries
 * @param {string[]} languages  e.g. ['en','de'] — the order of the language columns
 * @returns {string} CSV text, `,`-separated, with a BOM so Excel opens it as UTF-8
 */
function serialise(entries, languages) {
  const sep = ',';
  const langs = (languages || []).filter((l) => l && l !== 'fr');
  const header = [COL_KEY, COL_WHERE, COL_SOURCE, ...langs.map(headerFor), COL_REVIEW];
  const lines = [header.map((h) => cell(h, sep)).join(sep)];

  for (const entry of [...(entries || [])].sort(compareRows)) {
    const values = entry.values || {};
    // Rule 5 — « à revérifier » is computed, never stored: the French moved since a translation was
    // written. Recomputing it here is what keeps the file and the database from ever disagreeing.
    const needsReview = langs.some((l) => values[l] && values[l].text && values[l].sourceAtTime !== entry.sourceText);
    const row = [
      entry.entryKey,
      KIND_LABELS[entry.kind] || entry.kind,
      entry.sourceText,
      ...langs.map((l) => (values[l] ? values[l].text : '')),
      needsReview ? 'oui' : '',
    ];
    lines.push(row.map((c) => cell(c, sep)).join(sep));
  }
  // The BOM is for Excel, which otherwise reads « Séjour » as « SÃ©jour ». Every parser below eats it.
  return `﻿${lines.join('\r\n')}\r\n`;
}

class CsvError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'CsvError';
    this.code = 'MALFORMED_CSV';
    this.line = line;
  }
}

/** Split one CSV document into rows of cells. Handles quotes, doubled quotes, CRLF and embedded newlines. */
function splitRows(text, sep) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let startedLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        if (c === '\n') line += 1;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') { quoted = true; continue; }
    if (c === sep) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      rows.push({ cells: row, line: startedLine });
      row = []; field = '';
      line += 1; startedLine = line;
      continue;
    }
    field += c;
  }
  if (quoted) throw new CsvError('Un guillemet ouvert n’est jamais refermé.', startedLine);
  if (field !== '' || row.length) { row.push(field); rows.push({ cells: row, line: startedLine }); }
  return rows;
}

/**
 * Parse an uploaded file into the changes it asks for.
 *
 * Returns `{ languages, rows: [{ entryKey, values: { en: '…' }, reviewAcknowledged, line }] }`.
 * It decides nothing about what exists: matching keys against the catalogue is the model's job
 * (rule 13 — an unknown key is ignored there, never created).
 *
 * @throws {CsvError} on a shape it cannot read. Nothing is half-parsed: the caller gets all or nothing.
 */
function parse(text) {
  const raw = String(text == null ? '' : text).replace(/^﻿/, '');
  if (!raw.trim()) throw new CsvError('Le fichier est vide.', 1);

  // Separator: whichever of `,` and `;` appears first on the header line. Excel on a French locale
  // writes `;`, Numbers writes `,`, and both are this file's natural home.
  const firstLine = raw.split(/\r?\n/, 1)[0];
  const comma = firstLine.indexOf(',');
  const semi = firstLine.indexOf(';');
  const sep = semi !== -1 && (comma === -1 || semi < comma) ? ';' : ',';

  const rows = splitRows(raw, sep);
  if (!rows.length) throw new CsvError('Le fichier est vide.', 1);

  const header = rows[0].cells.map((h) => String(h).trim().toLowerCase());
  const idxKey = header.indexOf(COL_KEY);
  const idxWhere = header.indexOf(COL_WHERE);
  const idxSource = header.indexOf(COL_SOURCE);
  const idxReview = header.indexOf(COL_REVIEW);
  if (idxKey === -1) throw new CsvError(`La colonne « ${COL_KEY} » est absente.`, rows[0].line);
  if (idxSource === -1) throw new CsvError(`La colonne « ${COL_SOURCE} » est absente.`, rows[0].line);

  // Everything between « français » and « à revérifier » is a language column.
  const end = idxReview === -1 ? header.length : idxReview;
  const langCols = [];
  for (let i = idxSource + 1; i < end; i += 1) {
    if (i === idxKey || i === idxWhere) continue;
    const code = langOfHeader(header[i]);
    if (code && code !== 'fr') langCols.push({ index: i, lang: code });
  }
  if (!langCols.length) throw new CsvError('Aucune colonne de langue : rien à importer.', rows[0].line);

  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const { cells, line } = rows[r];
    if (!cells.length || cells.every((c) => String(c).trim() === '')) continue;
    const entryKey = String(cells[idxKey] == null ? '' : cells[idxKey]).trim();
    if (!entryKey) throw new CsvError(`La colonne « ${COL_KEY} » est vide sur cette ligne.`, line);
    const values = {};
    for (const { index, lang } of langCols) values[lang] = String(cells[index] == null ? '' : cells[index]).trim();
    // An emptied « à revérifier » cell is how the operator says « I have looked at it » (rule 5).
    const reviewCell = idxReview === -1 ? '' : String(cells[idxReview] == null ? '' : cells[idxReview]).trim();
    out.push({ entryKey, values, reviewAcknowledged: reviewCell === '', line });
  }
  return { languages: langCols.map((c) => c.lang), rows: out };
}

module.exports = {
  serialise,
  parse,
  CsvError,
  headerFor,
  KIND_LABELS,
  KIND_ORDER,
  COLUMNS: { COL_KEY, COL_WHERE, COL_SOURCE, COL_REVIEW },
};
