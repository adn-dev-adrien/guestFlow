const test = require('node:test');
const assert = require('node:assert/strict');

const {
  entryToRows, buildRows, entryToStructured, buildStructuredEntries, CSV_HEADERS,
  __test: { classifyLine, libelleFor, zerofyMoneyColumns },
} = require('../utils/accountingExport');
const {
  buildClientAccount, accountLabel, SALES_JOURNAL_CODE, PASS_THROUGH_ACCOUNTS,
} = require('../constants/accounting');

// Pure engine: encaissement entries → balanced double-entry journal rows.
// Column layout (aligned with the accountant's `Exemple export ventes SOLIO.csv`):
//   [0] Jour [1] Mois  [2] Année [3] Journal [4] Pièce [5] Libellé [6] Compte
//   [7] Débit [8] Crédit [9] Plateforme [10] Prix payé client [11] Commission

const COL = {
  day: 0, month: 1, year: 2, journal: 3, piece: 4,
  libelle: 5, compte: 6, debit: 7, credit: 8,
  platform: 9, gross: 10, commission: 11,
};

function makeEntry(overrides = {}) {
  // Total TTC 200; encaissement 60 (deposit at 30 %); accommodation HT 181.82 + VAT 18.18 (10 %);
  // options HT 8.33 + VAT 1.67 (20 %). Pro-rated 30 % → debit 60 / Σ credits 60.
  return {
    reservationId: 42,
    kind: 'deposit',
    paidDate: '2026-08-15',
    client: { firstName: 'Jean', lastName: 'Dupont' },
    platform: 'direct',
    clientGrossAmount: null,
    finalPrice: 200,
    encaissementTtc: 60,
    taxTtc: 0,
    fraction: 60 / 200,
    buckets: [
      { name: 'accommodation', ht: 181.82, vat: 18.18, ratePercent: 10 },
      { name: 'options',       ht:   8.33, vat:  1.67, ratePercent: 20 },
    ],
    ...overrides,
  };
}

function sumCredits(rows) {
  return rows.reduce((s, r) => s + (typeof r[COL.credit] === 'number' ? r[COL.credit] : 0), 0);
}

function debit(rows) {
  return rows.find((r) => typeof r[COL.debit] === 'number' && r[COL.debit] !== 0)[COL.debit];
}

test('CSV_HEADERS match the accountant\'s example layout (9 cols) + 3 GuestFlow info cols', () => {
  // The header `Mois ` carries a TRAILING SPACE byte-for-byte from the example file.
  assert.deepEqual(CSV_HEADERS, [
    'Jour', 'Mois ', 'Année',
    'Journal', 'Pièce',
    "Libellé de l'écriture",
    'Compte',
    'Débit', 'Crédit',
    'Plateforme', 'Prix payé client', 'Commission',
  ]);
});

test('one entry → 1 debit + N credits; Σ credits == debit (balanced)', () => {
  const rows = entryToRows(makeEntry());
  const totalCredits = Math.round(sumCredits(rows) * 100) / 100;
  assert.equal(totalCredits, debit(rows));
});

test('debit line uses the client auxiliary account C<NAME>; libellé is UPPERCASED', () => {
  const rows = entryToRows(makeEntry());
  const debitRow = rows[0];
  assert.equal(debitRow[COL.compte], buildClientAccount('Dupont'));
  // Accountant's example style: "FIRSTNAME LASTNAME" uppercased.
  assert.equal(debitRow[COL.libelle], 'JEAN DUPONT');
});

test('every row carries journal=VT and an empty Pièce (numbering scheme not yet decided)', () => {
  const rows = entryToRows(makeEntry());
  for (const row of rows) {
    assert.equal(row[COL.journal], SALES_JOURNAL_CODE);
    assert.equal(row[COL.piece], '');
  }
});

test('empty money cells render as literal 0 (the counter-side of every line)', () => {
  const rows = entryToRows(makeEntry());
  // Debit row → credit must be 0, not empty.
  assert.equal(rows[0][COL.credit], 0);
  // Credit rows → debit must be 0, not empty.
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i][COL.debit], 0);
  }
});

test('revenue accounts: accommodation → 70600000; options → 70600010; resources → 70601000', () => {
  const e = makeEntry({
    buckets: [
      { name: 'accommodation', ht: 100, vat: 10, ratePercent: 10 },
      { name: 'options',       ht:  20, vat:  4, ratePercent: 20 },
      { name: 'resources',     ht:  10, vat:  2, ratePercent: 20 },
    ],
    encaissementTtc: 146,
    finalPrice: 146,
    fraction: 1,
  });
  const rows = entryToRows(e);
  const accounts = rows.map((r) => r[COL.compte]);
  assert.ok(accounts.includes('70600000'));
  assert.ok(accounts.includes('70600010'));
  assert.ok(accounts.includes('70601000'));
});

test('VAT account by rate: 10 % → 44571100, 20 % → 44571200', () => {
  const rows = entryToRows(makeEntry());
  const accounts = rows.map((r) => r[COL.compte]);
  assert.ok(accounts.includes('44571100')); // 10 %
  assert.ok(accounts.includes('44571200')); // 20 %
});

test('tourist tax > 0 → an extra credit on 46710000 covers it; debit = revenue + tax', () => {
  // Stay 200 TTC (accommodation only @ 10%) + 20 € tourist tax → encaissement = 220.
  // Buckets sum to 200 TTC so that adding tax 20 makes the debit = 220 align exactly.
  const taxed = makeEntry({
    encaissementTtc: 220,
    taxTtc: 20,
    finalPrice: 200,
    fraction: 1,
    buckets: [
      { name: 'accommodation', ht: 181.82, vat: 18.18, ratePercent: 10 },
    ],
  });
  const rows = entryToRows(taxed);
  const taxRow = rows.find((r) => r[COL.compte] === PASS_THROUGH_ACCOUNTS.TOURIST_TAX);
  assert.ok(taxRow, 'expected a credit line on the tourist-tax pass-through account');
  assert.equal(taxRow[COL.credit], 20);
  // Conservation: Σ credits === debit.
  assert.equal(Math.round(sumCredits(rows) * 100) / 100, debit(rows));
});

test('tourist tax == 0 → no 46710000 line emitted (existing direct-bookings stay unchanged)', () => {
  const rows = entryToRows(makeEntry()); // taxTtc: 0
  const taxRow = rows.find((r) => r[COL.compte] === PASS_THROUGH_ACCOUNTS.TOURIST_TAX);
  assert.equal(taxRow, undefined);
});

test('pro-rata: a 30 % deposit produces lines summing to 30 % of HT + VAT (within rounding)', () => {
  const rows = entryToRows(makeEntry()); // fraction = 0.30, debit = 60
  assert.equal(debit(rows), 60);
  const totalCredits = Math.round(sumCredits(rows) * 100) / 100;
  assert.equal(totalCredits, 60);
});

test('rounding residue: Σ credits is nudged to match debit exactly to the cent', () => {
  const tricky = makeEntry({
    encaissementTtc: 33.33,
    finalPrice: 100,
    fraction: 33.33 / 100,
    buckets: [
      { name: 'accommodation', ht: 90.91, vat: 9.09, ratePercent: 10 },
    ],
  });
  const rows = entryToRows(tricky);
  assert.equal(Math.round(sumCredits(rows) * 100) / 100, debit(rows));
});

test('platform info columns are filled only on the debit row, for non-direct only', () => {
  const platformEntry = makeEntry({
    platform: 'airbnb',
    clientGrossAmount: 240, // commission = 240 - 200 = 40
  });
  const rows = entryToRows(platformEntry);
  assert.equal(rows[0][COL.platform], 'airbnb');
  assert.equal(rows[0][COL.gross], 240);
  assert.equal(rows[0][COL.commission], 40);
  // Credit rows have empty platform info.
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i][COL.platform], '');
    assert.equal(rows[i][COL.gross], '');
    assert.equal(rows[i][COL.commission], '');
  }
});

test('direct booking → platform info columns empty even on the debit row', () => {
  const rows = entryToRows(makeEntry()); // direct
  assert.equal(rows[0][COL.platform], '');
  assert.equal(rows[0][COL.gross], '');
  assert.equal(rows[0][COL.commission], '');
});

test('buildRows concatenates multiple entries in order', () => {
  const a = makeEntry({ paidDate: '2026-08-15' });
  const b = makeEntry({ paidDate: '2026-08-20', reservationId: 99, encaissementTtc: 80, fraction: 0.4 });
  const rows = buildRows([a, b]);
  assert.equal(rows[0][COL.year], 2026);
  assert.equal(rows[0][COL.day], 15);
  assert.ok(rows.some((r) => r[COL.day] === 20));
});

test('paidDate "YYYY-MM-DD" is split into day, month, year integers', () => {
  const rows = entryToRows(makeEntry({ paidDate: '2026-12-03' }));
  assert.equal(rows[0][COL.day], 3);
  assert.equal(rows[0][COL.month], 12);
  assert.equal(rows[0][COL.year], 2026);
});

test('client account formatting: C + up to 6 chars (variable width, matches SOLIO example)', () => {
  // SOLIO example shows variable-width codes: CNOTIN (6 chars), CCAGGUI (7 chars). We follow:
  // 'C' + lastname uppercased, accent-stripped, non-alpha removed, truncated to 6 chars.
  // Empty / unknown names fall back to the literal `CXXXXX` placeholder.
  assert.equal(buildClientAccount('Élise'),     'CELISE');     // accent stripped, 5 letters
  assert.equal(buildClientAccount('Müller'),    'CMULLER');    // 6 letters
  assert.equal(buildClientAccount('Li'),        'CLI');        // short names stay short
  assert.equal(buildClientAccount('Saint-Cyr'), 'CSAINTC');    // hyphen stripped, truncated to 6
  assert.equal(buildClientAccount('Caggui'),    'CCAGGUI');
  assert.equal(buildClientAccount('Notin'),     'CNOTIN');
  assert.equal(buildClientAccount(''),          'CXXXXX');
  assert.equal(buildClientAccount(null),        'CXXXXX');
});

// ---------- Helpers ----------

test('libelleFor: uppercases "Firstname Lastname"; falls back to RÉSERVATION #ID', () => {
  assert.equal(libelleFor({ client: { firstName: 'Claire', lastName: 'Notin' } }), 'CLAIRE NOTIN');
  assert.equal(libelleFor({ client: { firstName: '', lastName: 'Cagi' } }), 'CAGI');
  assert.equal(libelleFor({ client: {}, reservationId: 17 }), 'RÉSERVATION #17');
});

test('zerofyMoneyColumns: empty → 0 on debit + credit columns only', () => {
  const row = [3, 12, 2026, 'VT', '', 'JEAN', 'CDUPON', '', 60, '', '', ''];
  const fixed = zerofyMoneyColumns(row);
  assert.equal(fixed[COL.debit], 0);
  assert.equal(fixed[COL.credit], 60);
  // Other empty cells stay empty (Pièce, platform info).
  assert.equal(fixed[COL.piece], '');
  assert.equal(fixed[COL.platform], '');
});

// ---------- Structured (JSON) preview ----------

test('classifyLine: C* → client, 70* → revenue, 44571* → vat, 46710000 → tax_pass_through', () => {
  assert.equal(classifyLine('CDUPONT'), 'client');
  assert.equal(classifyLine('70600000'), 'revenue');
  assert.equal(classifyLine('70600010'), 'revenue');
  assert.equal(classifyLine('70601000'), 'revenue');
  assert.equal(classifyLine('44571100'), 'vat');
  assert.equal(classifyLine('44571200'), 'vat');
  assert.equal(classifyLine('46710000'), 'tax_pass_through');
  assert.equal(classifyLine('999'),      'other');
});

test('entryToStructured: 1 entry → 1 grouped object with classified lines + balanced flag', () => {
  const out = entryToStructured(makeEntry());
  assert.equal(out.reservationId, 42);
  assert.equal(out.kind, 'deposit');
  assert.equal(out.day, 15);
  assert.equal(out.month, 8);
  assert.equal(out.year, 2026);
  assert.equal(out.clientAccount, 'CDUPONT'); // 'DUPONT' = exactly 6 chars → no truncation
  // Libellé is now uppercased.
  assert.equal(out.libelle, 'JEAN DUPONT');
  assert.equal(out.balanced, true);
  // The first line is the client debit; the rest are classified credits.
  assert.equal(out.lines[0].type, 'client');
  assert.equal(out.lines[0].debit, 60);
  assert.equal(out.lines[0].credit, null);
  for (let i = 1; i < out.lines.length; i++) {
    assert.equal(out.lines[i].debit, null);
    assert.equal(typeof out.lines[i].credit, 'number');
    assert.ok(out.lines[i].type === 'revenue' || out.lines[i].type === 'vat' || out.lines[i].type === 'tax_pass_through');
  }
});

test('entryToStructured: tax > 0 surfaces a tax_pass_through line', () => {
  const out = entryToStructured(makeEntry({
    encaissementTtc: 220, taxTtc: 20, finalPrice: 200, fraction: 1,
    buckets: [{ name: 'accommodation', ht: 181.82, vat: 18.18, ratePercent: 10 }],
  }));
  const taxLine = out.lines.find((l) => l.type === 'tax_pass_through');
  assert.ok(taxLine);
  assert.equal(taxLine.compte, '46710000');
  assert.equal(taxLine.credit, 20);
});

test('entryToStructured: direct booking → platform is null/empty', () => {
  const out = entryToStructured(makeEntry()); // direct
  assert.equal(out.platform.platform, null);
  assert.equal(out.platform.gross, null);
  assert.equal(out.platform.commission, null);
});

test('entryToStructured: platform booking → platform name + gross + commission exposed', () => {
  const out = entryToStructured(makeEntry({ platform: 'airbnb', clientGrossAmount: 240 }));
  assert.equal(out.platform.platform, 'airbnb');
  assert.equal(out.platform.gross, 240);
  assert.equal(out.platform.commission, 40);
});

test('buildStructuredEntries: mirrors buildRows entry-for-entry', () => {
  const a = makeEntry();
  const b = makeEntry({ paidDate: '2026-08-20', reservationId: 99, encaissementTtc: 80, fraction: 0.4 });
  const structured = buildStructuredEntries([a, b]);
  const csvRows = buildRows([a, b]);
  const totalLines = structured.reduce((s, e) => s + e.lines.length, 0);
  assert.equal(totalLines, csvRows.length);
  assert.equal(structured.length, 2);
  assert.equal(structured[0].reservationId, 42);
  assert.equal(structured[1].reservationId, 99);
});

test('accountLabel: maps each account number to its human label (incl. tax pass-through)', () => {
  assert.equal(accountLabel('70600000'), 'Location gîte');
  assert.equal(accountLabel('70600010'), 'Prestation complémentaire');
  assert.equal(accountLabel('70601000'), 'Activité diverse');
  assert.equal(accountLabel('44571100'), 'TVA 10 %');
  assert.equal(accountLabel('44571200'), 'TVA 20 %');
  assert.equal(accountLabel('46710000'), 'Taxe de séjour');
  assert.equal(accountLabel('CDUPONT'), 'Compte client');
  assert.equal(accountLabel('CXXXXXX'), 'Compte client');
  assert.equal(accountLabel('99'), '');
  assert.equal(accountLabel(''), '');
  assert.equal(accountLabel(null), '');
});

test('entryToStructured: each line carries accountLabel alongside the account number', () => {
  const out = entryToStructured(makeEntry());
  for (const line of out.lines) {
    assert.equal(typeof line.accountLabel, 'string');
  }
  assert.equal(out.lines[0].accountLabel, 'Compte client');
  const labelsByAccount = Object.fromEntries(out.lines.map((l) => [l.compte, l.accountLabel]));
  assert.equal(labelsByAccount['70600000'], 'Location gîte');
  assert.equal(labelsByAccount['44571100'], 'TVA 10 %');
});
