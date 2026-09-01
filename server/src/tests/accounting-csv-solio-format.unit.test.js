const test = require('node:test');
const assert = require('node:assert/strict');

const { CSV_HEADERS, buildRows } = require('../utils/accountingExport');
const { serializeCsv } = require('../utils/csv');

// Pinned-format tests for the accountant CSV (Adrien's `Exemple export ventes SOLIO.csv`).
//
// The export must serialise byte-identically to the example on every dimension the
// accountant's software cares about:
//   - Semicolon separator, CRLF terminators, comma decimals.
//   - 9-column structural header (`Mois ` with trailing space, `Libellé de l'écriture`).
//   - Constant `VT` in the Journal column, empty Pièce (TODO once Adrien settles numbering).
//   - Uppercased libellé, debit/credit cells use literal `0` for the counter-side.
//   - ISO-8859-1 round-trip works (no character outside latin1 in standard French names).

function makeEntry(overrides = {}) {
  return {
    reservationId: 11,
    kind: 'balance',
    paidDate: '2025-10-17',
    client: { firstName: 'Claire', lastName: 'Notin' },
    platform: 'direct',
    clientGrossAmount: null,
    finalPrice: 623,
    encaissementTtc: 623,
    taxTtc: 0,
    fraction: 1,
    buckets: [
      // SOLIO F-2025-011 layout: 70600000 519,17 HT + 44571200 103,83 VAT 20%.
      { name: 'accommodation', ht: 519.17, vat: 103.83, ratePercent: 20 },
    ],
    ...overrides,
  };
}

// specs/accounting-platform-commission-and-no-deposit.md rule 14
test('header line matches the SOLIO example byte-for-byte (incl. trailing space on `Mois `)', () => {
  const csv = serializeCsv(CSV_HEADERS, [], { bom: false });
  const headerLine = csv.split('\r\n')[0];
  // First 9 columns must equal the SOLIO example header exactly.
  const expectedFirst9 = "Jour;Mois ;Année;Journal;Pièce;Libellé de l'écriture;Compte;Débit;Crédit";
  assert.ok(headerLine.startsWith(expectedFirst9), `header should start with the SOLIO 9 columns, got: ${headerLine}`);
  // Then the 3 GuestFlow info columns.
  assert.ok(headerLine.endsWith(';Plateforme;Prix payé client;Commission'), `header should end with the platform info columns, got: ${headerLine}`);
});

// specs/accountant-accounting-export.md rule 18
test('a single entry serialises to the SOLIO row shape: debit + revenue + VAT', () => {
  const rows = buildRows([makeEntry()]);
  const csv = serializeCsv(CSV_HEADERS, rows, { bom: false });
  const lines = csv.split('\r\n').filter(Boolean);
  // 1 header + 3 data rows (1 debit + 1 revenue + 1 VAT).
  assert.equal(lines.length, 4);

  // The 3 data lines all carry day=17, month=10, year=2025, Journal=VT, libellé=CLAIRE NOTIN.
  for (const line of lines.slice(1)) {
    const cols = line.split(';');
    assert.equal(cols[0], '17');
    assert.equal(cols[1], '10');
    assert.equal(cols[2], '2025');
    assert.equal(cols[3], 'VT');
    assert.equal(cols[4], '');                // empty Pièce
    assert.equal(cols[5], 'CLAIRE NOTIN');
  }

  // Debit row: client account CNOTIN, debit 623, credit 0 (integer → bare).
  const debitCols = lines[1].split(';');
  assert.equal(debitCols[6], 'CNOTIN');
  assert.equal(debitCols[7], '623');
  assert.equal(debitCols[8], '0');

  // Revenue row: account 70600000, debit 0, credit 519,17.
  const revenueCols = lines[2].split(';');
  assert.equal(revenueCols[6], '70600000');
  assert.equal(revenueCols[7], '0');
  assert.equal(revenueCols[8], '519,17');

  // VAT row: account 44571200, debit 0, credit 103,83.
  const vatCols = lines[3].split(';');
  assert.equal(vatCols[6], '44571200');
  assert.equal(vatCols[7], '0');
  assert.equal(vatCols[8], '103,83');
});

// specs/accountant-accounting-export.md rule 16
test('entry with tourist tax → an extra 46710000 row matching the SOLIO F-2025-020 shape', () => {
  // SOLIO F-2025-020: 775 = 690 (70600000 @ 10%) + 69 (44571100 @ 10%) + 16 (46710000).
  // Buckets sum to 759 TTC (HT 690 + VAT 69); + tax 16 = 775 debit.
  const rows = buildRows([makeEntry({
    reservationId: 20,
    paidDate: '2025-10-28',
    client: { firstName: 'Teddy', lastName: 'Caggui' },
    encaissementTtc: 775,
    taxTtc: 16,
    finalPrice: 759,
    buckets: [{ name: 'accommodation', ht: 690, vat: 69, ratePercent: 10 }],
  })]);
  const csv = serializeCsv(CSV_HEADERS, rows, { bom: false });
  const lines = csv.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 5); // header + 4 data rows (debit + 70600000 + 44571100 + 46710000)
  const taxLine = lines.find((l) => l.includes(';46710000;'));
  assert.ok(taxLine, 'expected a 46710000 credit row');
  const taxCols = taxLine.split(';');
  assert.equal(taxCols[5], 'TEDDY CAGGUI');
  assert.equal(taxCols[7], '0');           // debit zerofied
  assert.equal(taxCols[8], '16');          // tax credit — integer 16 renders bare per SOLIO style

  // Sanity: the debit row carries the full 775.
  const debitCols = lines[1].split(';');
  assert.equal(debitCols[6], 'CCAGGUI');
  assert.equal(debitCols[7], '775');
});

// specs/accountant-accounting-export.md rule 19
test('CRLF line terminator + comma decimal + no BOM (latin1-friendly serialisation)', () => {
  const csv = serializeCsv(CSV_HEADERS, buildRows([makeEntry()]), { bom: false });
  assert.ok(csv.includes('\r\n'), 'lines must be CRLF-terminated');
  assert.ok(!csv.startsWith('﻿'), 'no UTF-8 BOM (caller encodes to latin1)');
  assert.ok(csv.includes('519,17'), 'numbers must use comma decimal');
  assert.ok(!csv.includes('519.17'), 'no period decimals');
});

test('every printable byte of a typical French libellé survives the latin1 round-trip', () => {
  const csv = serializeCsv(CSV_HEADERS, buildRows([makeEntry({
    client: { firstName: 'Hélène', lastName: 'François-Côté' },
  })]), { bom: false });
  const latin1Bytes = Buffer.from(csv, 'latin1');
  const roundTrip = latin1Bytes.toString('latin1');
  assert.ok(roundTrip.includes('HÉLÈNE FRANÇOIS-CÔTÉ'), 'French accents survive ISO-8859-1 round-trip');
});

// specs/accountant-accounting-export.md rule 20
test('uppercased libellé regardless of input casing — matches the accountant\'s example style', () => {
  const rows = buildRows([makeEntry({
    client: { firstName: 'claire', lastName: 'notin' }, // lowercase input
  })]);
  const csv = serializeCsv(CSV_HEADERS, rows, { bom: false });
  assert.ok(csv.includes('CLAIRE NOTIN'));
  assert.ok(!csv.includes('claire notin'));
});

test('platform info columns appear on the debit row only — accountant ignores them, Adrien sees them', () => {
  const rows = buildRows([makeEntry({
    platform: 'airbnb',
    clientGrossAmount: 720, // commission = 720 - 623 = 97 (both integers → bare)
  })]);
  const csv = serializeCsv(CSV_HEADERS, rows, { bom: false });
  const lines = csv.split('\r\n').filter(Boolean);
  // Debit row carries platform info — integers render bare (`720`, `97`) per SOLIO style.
  const debitCols = lines[1].split(';');
  assert.equal(debitCols[9], 'airbnb');
  assert.equal(debitCols[10], '720');
  assert.equal(debitCols[11], '97');
  // Credit rows have empty platform info.
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(';');
    assert.equal(cols[9], '');
    assert.equal(cols[10], '');
    assert.equal(cols[11], '');
  }
});
