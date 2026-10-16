/**
 * The guest email texts as one spreadsheet file (specs/guest-email-texts-made-simple.md rules 16–18).
 *
 * Pure: rows in, CSV out; CSV in, rows out; rows against the current texts, a plan out. The parser
 * and its forgiving shape rules (BOM, CRLF, `;` or `,`, quoted newlines) are the translation
 * catalogue's (utils/translationCsv.js), so both files behave the same in Excel and LibreOffice.
 *
 * In a cell: empty means « keep the current text », a lone `-` means « empty it ».
 */

const { cell, splitRows, detectSeparator, CsvError } = require('./translationCsv');
const { SECTIONS } = require('./templateTokens');

const COLUMNS = Object.freeze({
  email: 'email', key: 'clé', description: 'description', fr: 'français', en: 'english', defaultFr: 'texte par défaut (fr)',
});
const HEADER = ['email', 'clé', 'description', 'français', 'english', 'texte par défaut (FR)'];
const EMPTY_MARK = '-';

const titleOf = (section) => (SECTIONS.find((s) => s.id === section) || {}).title || section || '';

/** Rule 16 — one row per text, `;`, UTF-8 with a BOM so Excel reads the accents. */
function serialise(items) {
  const sep = ';';
  const lines = [HEADER.map((h) => cell(h, sep)).join(sep)];
  for (const item of items) {
    lines.push([titleOf(item.section), item.key, item.description, item.fr, item.en, item.defaultFr]
      .map((c) => cell(c, sep)).join(sep));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * The rows of an uploaded file: `[{ line, key, fr, en }]`, `undefined` for a language to keep; `line`
 * is the spreadsheet row (the header is row 1).
 * @throws {CsvError} on a shape it cannot read — a missing column, an unclosed quote.
 */
function parse(text) {
  const raw = String(text == null ? '' : text).replace(/^﻿/, '');
  if (!raw.trim()) throw new CsvError('Le fichier est vide.', 1);
  const rows = splitRows(raw, detectSeparator(raw));
  const header = rows[0].cells.map((h) => String(h).trim().toLowerCase());
  const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, header.indexOf(name)]));
  for (const required of ['key', 'fr', 'en']) {
    if (idx[required] === -1) throw new CsvError(`La colonne « ${COLUMNS[required]} » est absente.`, rows[0].line);
  }
  const read = (cells, i) => {
    const v = String(cells[i] == null ? '' : cells[i]).replace(/\r\n/g, '\n');
    if (v.trim() === '') return undefined;
    return v.trim() === EMPTY_MARK ? '' : v;
  };
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const { cells } = rows[r];
    if (!cells.length || cells.every((c) => String(c).trim() === '')) continue;
    // The spreadsheet's row number, what the owner sees in Excel — not the text line, which a
    // multi-line cell would shift.
    out.push({ line: r + 1, key: String(cells[idx.key] == null ? '' : cells[idx.key]).trim(), fr: read(cells, idx.fr), en: read(cells, idx.en) });
  }
  return out;
}

/**
 * Rule 17 — what the file would change, before anything is saved. A row whose key is unknown, or
 * whose text the validator refuses, is refused with its line number; a row identical to the current
 * text is counted as unchanged.
 *
 * @param rows   parse() output
 * @param model  { find(key), validate(item, { fr, en }) } — models/emailTextsModel.js
 * @returns {{ changed: [{ line, key, description, fr, en }], refused: [{ line, key, message }], unchanged: number }}
 */
function plan(rows, model) {
  const changed = [];
  const refused = [];
  let unchanged = 0;
  const seen = new Set();
  for (const row of rows) {
    const item = row.key ? model.find(row.key) : null;
    if (!item) { refused.push({ line: row.line, key: row.key, message: `Clé inconnue : ${row.key || '(vide)'}` }); continue; }
    if (seen.has(row.key)) { refused.push({ line: row.line, key: row.key, message: 'Clé en double' }); continue; }
    seen.add(row.key);
    const fr = row.fr !== undefined && row.fr !== item.fr ? row.fr : undefined;
    const en = row.en !== undefined && row.en !== item.en ? row.en : undefined;
    if (fr === undefined && en === undefined) { unchanged += 1; continue; }
    const error = model.validate(item, { fr, en });
    if (error) { refused.push({ line: row.line, key: row.key, message: error.message }); continue; }
    changed.push({ line: row.line, key: row.key, description: item.description, fr, en });
  }
  return { changed, refused, unchanged };
}

module.exports = { serialise, parse, plan, HEADER, EMPTY_MARK };
