// specs/accounting-synthesis.md §3 rules 3, 5 and 6 — one source: the synthesis reads the very rows the CSV export
// writes, and the export, refactored to carry each row's role beside it, writes the same bytes as before. The
// expected file below was produced by the export as it stood before the refactor (inte/plugins 5437951d), on these
// entries, with the default plan and with a renamed one. The clock is pinned: the dates are inputs of pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 11, 20, 12) });

process.env.DB_PATH = ':memory:';
const sdk = require('../../sdk');
const { buildRows, CSV_HEADERS, entryVentilation } = require('../accountingExport');
const { toLatin1Text } = require('../latin1');
const { ventilate, vatReturn, balanceCheck } = require('../synthesis');

const { serializeCsv } = sdk.coreModule('csv');

const ENTRIES = [
  { reservationId: 11, kind: 'balance', paidDate: '2026-12-03', client: { firstName: 'Anna', lastName: 'Lima' }, platform: 'CanalRev', clientGrossAmount: 640,
    finalPrice: 600, encaissementTtc: 640, encaissementNetTtc: 550, taxTtc: 40, fraction: 1,
    commission: { account: '62260300', hasVat: true, ttc: 90, ht: 75, vat: 15, vatAccount: '44566000', vatRate: 20 },
    buckets: [{ name: 'accommodation', ht: 500, vat: 50, ratePercent: 10 }, { name: 'options', ht: 45.45, vat: 4.55, ratePercent: 10 }] },
  { reservationId: 12, kind: 'deposit', paidDate: '2026-12-04', client: { firstName: 'Zoé', lastName: 'Œuvre' }, platform: 'direct', clientGrossAmount: null,
    finalPrice: 150.07, encaissementTtc: 129, taxTtc: 0, fraction: 0.859599, buckets: [{ name: 'accommodation', ht: 136.43, vat: 13.64, ratePercent: 10 }] },
  { reservationId: 12, kind: 'deposit', paidDate: '2026-10-04', client: { firstName: 'Zoé', lastName: 'Œuvre' }, platform: 'direct', clientGrossAmount: null,
    finalPrice: 150.07, encaissementTtc: 129, taxTtc: 0, fraction: 0.859599, buckets: [{ name: 'accommodation', ht: 136.43, vat: 13.64, ratePercent: 10 }] },
  { reservationId: 13, kind: 'refund', direction: 'refund', refundId: 4, paidDate: '2026-12-05', client: { firstName: 'Paul', lastName: 'Retour' }, platform: 'direct',
    finalPrice: 300, encaissementTtc: 115, taxTtc: 5, buckets: [{ name: 'accommodation', ht: 90.91, vat: 9.09, ratePercent: 10 }],
    indemnity: { account: '75880000', ht: 8.33, vat: 1.67, ratePercent: 20 } },
  { kind: 'compensation', direction: 'compensation', compensationId: 7, reservationId: null, paidDate: '2026-12-06', client: { firstName: '', lastName: '' }, platform: 'CanalPlat',
    encaissementTtc: 120, compensation: { account: '75880000', ht: 100, vat: 20, ratePercent: 20, startDate: '2027-01-02', endDate: '2027-01-05' } },
  { reservationId: 14, kind: 'discount', direction: 'discount', paidDate: '2026-12-07', client: { firstName: 'Léa', lastName: 'Porte' }, platform: 'direct', finalPrice: 400, taxTtc: 0, buckets: [], fraction: 1,
    encaissementTtc: 22, encaissementNetTtc: 22, discount: { account: '70900000', ttc: 22, ht: 20, vat: 2, ratePercent: 10 } },
  { reservationId: 14, kind: 'tip', direction: 'tip', paidDate: '2026-12-07', client: { firstName: 'Léa', lastName: 'Porte' }, platform: 'direct', finalPrice: 400, taxTtc: 0, buckets: [], fraction: 1,
    encaissementTtc: 10, encaissementNetTtc: 10, tipAccount: '75880000', accountLabels: { 75880000: 'Pourboire' } },
  { reservationId: 11, kind: 'penalty', direction: 'penalty', paidDate: '2026-12-08', client: { firstName: 'Anna', lastName: 'Lima' }, platform: 'CanalRev', finalPrice: 600,
    encaissementTtc: 12.5, encaissementNetTtc: 12.5, penaltyAccount: '658000' },
  { reservationId: 15, kind: 'endOfStayComplement', paidDate: '2026-12-09', client: { firstName: 'Ana', lastName: 'Fin' }, platform: 'direct', finalPrice: 200, clientGrossAmount: null,
    encaissementTtc: 66, encaissementNetTtc: 66, taxTtc: 0, fraction: 1,
    buckets: [{ name: 'options', ht: 45.45, vat: 4.55, ratePercent: 10 }, { name: 'resources', ht: 13.33, vat: 2.67, ratePercent: 20 }] },
];

const RENAMED_PLAN = { accommodationAccount: '706100', vat10Account: '445711', journalCode: 'VE', ttcSplitFrom: '2026-11-01' };

/** The CSV the controller sends: latin1, no BOM. */
function csvBytes(entries, plan) {
  const rows = buildRows(entries, plan).map((row) => row.map((cell) => (typeof cell === 'string' ? toLatin1Text(cell) : cell)));
  return Buffer.from(serializeCsv(CSV_HEADERS, rows, { bom: false }), 'latin1');
}
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const GOLDEN_DEFAULT = [
  "Jour;Mois ;Année;Journal;Pièce;Libellé de l'écriture;Compte;Débit;Crédit;Plateforme;Prix payé client;Commission",
  '3;12;2026;VT;;ANNA LIMA;CLIMA;550;0;CanalRev;640;90',
  '3;12;2026;VT;;ANNA LIMA;62260300;75;0;;;',
  '3;12;2026;VT;;ANNA LIMA;44566000;15;0;;;',
  '3;12;2026;VT;;ANNA LIMA;70600000;0;500;;;',
  '3;12;2026;VT;;ANNA LIMA;70600010;0;45,45;;;',
  '3;12;2026;VT;;ANNA LIMA;44571100;0;54,55;;;',
  '3;12;2026;VT;;ANNA LIMA;46710000;0;40;;;',
  '4;12;2026;VT;;ZOÉ OEUVRE;CUVRE;129;0;;;',
  '4;12;2026;VT;;ZOÉ OEUVRE;70600000;0;117,27;;;',
  '4;12;2026;VT;;ZOÉ OEUVRE;44571100;0;11,73;;;',
  '4;10;2026;VT;;ZOÉ OEUVRE;CUVRE;129;0;;;',
  '4;10;2026;VT;;ZOÉ OEUVRE;70600000;0;117,28;;;',
  '4;10;2026;VT;;ZOÉ OEUVRE;44571100;0;11,72;;;',
  '5;12;2026;VT;;PAUL RETOUR;CRETOUR;0;115;;;',
  '5;12;2026;VT;;PAUL RETOUR;70600000;90,91;0;;;',
  '5;12;2026;VT;;PAUL RETOUR;75880000;8,33;0;;;',
  '5;12;2026;VT;;PAUL RETOUR;44571100;9,09;0;;;',
  '5;12;2026;VT;;PAUL RETOUR;44571200;1,67;0;;;',
  '5;12;2026;VT;;PAUL RETOUR;46710000;5;0;;;',
  '6;12;2026;VT;;INDEMNITÉ ANNULATION #7;CXXXXX;120;0;CanalPlat;;',
  '6;12;2026;VT;;INDEMNITÉ ANNULATION #7;75880000;0;100;;;',
  '6;12;2026;VT;;INDEMNITÉ ANNULATION #7;44571200;0;20;;;',
  '7;12;2026;VT;;LÉA PORTE;70900000;20;0;;;',
  '7;12;2026;VT;;LÉA PORTE;44571100;2;0;;;',
  '7;12;2026;VT;;LÉA PORTE;CPORTE;0;22;;;',
  '7;12;2026;VT;;LÉA PORTE;CPORTE;10;0;;;',
  '7;12;2026;VT;;LÉA PORTE;75880000;0;10;;;',
  '8;12;2026;VT;;ANNA LIMA;658000;12,50;0;;;',
  '8;12;2026;VT;;ANNA LIMA;CLIMA;0;12,50;;;',
  '9;12;2026;VT;;ANA FIN;CFIN;66;0;;;',
  '9;12;2026;VT;;ANA FIN;70600010;0;45,45;;;',
  '9;12;2026;VT;;ANA FIN;70601000;0;13,33;;;',
  '9;12;2026;VT;;ANA FIN;44571100;0;4,55;;;',
  '9;12;2026;VT;;ANA FIN;44571200;0;2,67;;;',
  '',
].join('\r\n');

test('rule 3 — the CSV is byte-identical to the export before the refactor, default plan and renamed plan', () => {
  const bytes = csvBytes(ENTRIES);
  assert.equal(bytes.toString('latin1'), GOLDEN_DEFAULT);
  assert.equal(sha(bytes), 'd359bec6001cacfb46f814301a8b988de963f57ef2fe732f85dd59feb5944258');
  assert.equal(sha(csvBytes(ENTRIES, RENAMED_PLAN)), '8c3089656823caccedc9d00d0d23ba34cfbe333f728c7d55621b1ba2b5edd3f5');
});

test('rule 3 — the role of a row rides beside it, never in it: the cells are the twelve columns', () => {
  for (const row of buildRows(ENTRIES, RENAMED_PLAN)) {
    assert.equal(row.length, CSV_HEADERS.length);
    assert.deepEqual(Object.keys(row), Object.keys([...row]));
    assert.equal(JSON.stringify(row), JSON.stringify([...row]));
  }
});

test('rule 3 — every CSV row is one ventilation line: same account, same debit, same credit', () => {
  for (const plan of [undefined, RENAMED_PLAN]) {
    const rows = buildRows(ENTRIES, plan);
    const lines = ENTRIES.flatMap((entry) => entryVentilation(entry, plan));
    assert.equal(lines.length, rows.length);
    rows.forEach((row, i) => {
      assert.deepEqual([lines[i].account, lines[i].debit, lines[i].credit], [String(row[6]), Number(row[7]), Number(row[8])]);
    });
    assert.deepEqual([...new Set(lines.map((l) => l.role))].sort(),
      ['client', 'commission', 'commissionVat', 'penalty', 'revenue', 'touristTax', 'vat']);
  }
});

test('rules 5 and 6 — the VAT to declare equals the VAT accounts of the CSV, account by account', () => {
  for (const [plan, vat10, vat20] of [[undefined, '44571100', '44571200'], [RENAMED_PLAN, '445711', '44571200']]) {
    const text = csvBytes(ENTRIES, plan).toString('latin1');
    const byAccount = {};
    text.split('\r\n').slice(1).filter(Boolean).forEach((line) => {
      const cells = line.split(';');
      const amount = (v) => Math.round(Number(v.replace(',', '.')) * 100);
      byAccount[cells[6]] = (byAccount[cells[6]] || 0) + amount(cells[8]) - amount(cells[7]);
    });
    const vat = vatReturn(ventilate(ENTRIES, plan), plan);
    const at = (rate) => Math.round((vat.byRate.find((r) => r.ratePercent === rate) || { vat: 0 }).vat * 100);
    assert.equal(at(10), byAccount[vat10], 'VAT at 10 %');
    assert.equal(at(20), byAccount[vat20], 'VAT at 20 %');
    assert.equal(Math.round(vat.totals.vat * 100), byAccount[vat10] + byAccount[vat20]);
    assert.equal(Math.round(vat.deductibleOnCommissions * 100), -byAccount['44566000']);
    assert.deepEqual(balanceCheck(ventilate(ENTRIES, plan)).status, 'ok');
  }
});
