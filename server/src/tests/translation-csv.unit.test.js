/**
 * specs/translation-catalogue.md §3.2 rules 7-13 — the file the operator downloads, fills in and
 * sends back.
 *
 * This is the module that meets a hostile file. The suite is therefore heavier on *shapes* than on
 * behaviour: a comma inside a description, a quote inside a title, the `;` and the BOM Excel writes
 * on a French machine, and the two ways a file can be wrong enough to refuse outright.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { serialise, parse, CsvError } = require('../utils/translationCsv');

const ENTRIES = [
  { entryKey: 'option:21:title', kind: 'option.title', sourceText: 'Jus de pomme 1L', values: { en: { text: 'Apple juice 1L', sourceAtTime: 'Jus de pomme 1L' } } },
  { entryKey: 'category:Boissons', kind: 'category', sourceText: 'Boissons', values: {} },
  { entryKey: 'resource:2:name', kind: 'resource.name', sourceText: 'Bain nordique', values: { en: { text: 'Nordic bath', sourceAtTime: 'Bain nordique' } } },
  { entryKey: 'option:21:description', kind: 'option.description', sourceText: '3 pommes, bouteille 1L', values: {} },
];

const rowsOf = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n');

test('the header names the columns in order, one per language (rule 7)', () => {
  const header = rowsOf(serialise(ENTRIES, ['en', 'de']))[0];
  assert.equal(header, 'clé,où,français,english,deutsch,à revérifier');
});

test('the file is sorted by kind then by the French text, so two downloads can be diffed (rule 8)', () => {
  const kinds = rowsOf(serialise(ENTRIES, ['en'])).slice(1).map((line) => line.split(',')[1].replace(/"/g, ''));
  assert.deepEqual(kinds, ['Catégorie', 'Option · titre', 'Option · description', 'Ressource · nom']);
  // Same input, same bytes — twice.
  assert.equal(serialise(ENTRIES, ['en']), serialise([...ENTRIES].reverse(), ['en']));
});

test('a comma, a quote, a newline and an accent survive the round trip', () => {
  const nasty = [{
    entryKey: 'option:1:description',
    kind: 'option.description',
    sourceText: 'Saucisson 80g, caillette "maison"\net pain',
    values: { en: { text: 'Sausage 80g, "house" pâté\nand bread', sourceAtTime: 'Saucisson 80g, caillette "maison"\net pain' } },
  }];
  const back = parse(serialise(nasty, ['en']));
  assert.equal(back.rows.length, 1);
  assert.equal(back.rows[0].entryKey, 'option:1:description');
  assert.equal(back.rows[0].values.en, 'Sausage 80g, "house" pâté\nand bread');
});

test('a file saved by Excel — « ; » separators and a BOM — is accepted (rule 7)', () => {
  const excel = '﻿clé;où;français;english;à revérifier\r\n'
    + 'option:21:title;Option · titre;Jus de pomme 1L;Apple juice 1L;\r\n';
  const back = parse(excel);
  assert.deepEqual(back.languages, ['en']);
  assert.equal(back.rows[0].values.en, 'Apple juice 1L');
});

test('an emptied « à revérifier » cell is how the operator acknowledges the review (rule 5)', () => {
  const back = parse('clé,où,français,english,à revérifier\nk,Option · titre,Jus,Juice,\nk2,Option · titre,Jus,Juice,oui\n');
  assert.equal(back.rows[0].reviewAcknowledged, true);
  assert.equal(back.rows[1].reviewAcknowledged, false);
});

test('a missing required column is refused outright, naming the line (rule 11)', () => {
  for (const [csv, expected] of [
    ['où,français,english\nOption · titre,Jus,Juice\n', /clé/],
    ['clé,où,english\nk,Option · titre,Juice\n', /français/],
  ]) {
    assert.throws(() => parse(csv), (err) => {
      assert.ok(err instanceof CsvError);
      assert.equal(err.code, 'MALFORMED_CSV');
      assert.equal(err.line, 1);
      assert.match(err.message, expected);
      return true;
    });
  }
});

test('a file with no language column changes nothing, rather than emptying the catalogue (rule 11)', () => {
  assert.throws(() => parse('clé,où,français,à revérifier\nk,Option · titre,Jus,\n'), /Aucune colonne de langue/);
});

test('an unterminated quote is refused rather than half-read', () => {
  assert.throws(() => parse('clé,où,français,english\nk,Option · titre,Jus,"Juice\n'), CsvError);
});

test('a blank line is skipped; a row with no key is refused (rule 13)', () => {
  assert.equal(parse('clé,où,français,english\n\nk,Option · titre,Jus,Juice\n').rows.length, 1);
  assert.throws(() => parse('clé,où,français,english\n,Option · titre,Jus,Juice\n'), /clé/);
});

test('« à revérifier » is computed from the source text, never read from a stored flag (rule 5)', () => {
  const moved = [{
    entryKey: 'option:21:title', kind: 'option.title',
    sourceText: 'Jus de pommes 1L',                                   // corrected since
    values: { en: { text: 'Apple juice 1L', sourceAtTime: 'Jus de pomme 1L' } },
  }];
  assert.match(rowsOf(serialise(moved, ['en']))[1], /,oui$/);
  const aligned = [{ ...moved[0], values: { en: { text: 'Apple juice 1L', sourceAtTime: 'Jus de pommes 1L' } } }];
  assert.match(rowsOf(serialise(aligned, ['en']))[1], /,$/);
  // An untranslated entry is never « à revérifier »: there is nothing to review.
  const untranslated = [{ entryKey: 'k', kind: 'category', sourceText: 'Boissons', values: {} }];
  assert.match(rowsOf(serialise(untranslated, ['en']))[1], /,$/);
});
