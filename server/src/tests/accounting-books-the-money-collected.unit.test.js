const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry, buildEndOfStayEntry, splitByDestination } } = require('../models/accountingModel');
const { entryToRows } = require('../utils/accountingExport');

// specs/accounting-books-the-money-collected.md — the five reservations of the 2026-08-24 coherence
// audit, as regressions. Each one broke a different way before this spec; together they pin the two
// rules: the stored échéances ARE the money (rule 1), and each encaissement credits only the postes it
// actually covers (rules 5-8).

const COMMISSION_CONTEXT = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  vatRate: 10,
  platformByName: new Map([
    ['abracadaroom', { commissionAccountNumber: '', hasVatOnCommission: 0 }],
    ['lodgify',      { commissionAccountNumber: '', hasVatOnCommission: 0 }],
    ['gitesdefrance', { commissionAccountNumber: '', hasVatOnCommission: 0 }],
  ]),
};

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function rowsByAccount(entry) {
  return new Map(entryToRows(entry).map((r) => [r[6], { debit: r[7] || 0, credit: r[8] || 0 }]));
}
function baseRow(over) {
  return {
    id: 1, firstName: 'Test', lastName: 'Client', propertyName: 'Gîte',
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 0, balancePaid: 0, balancePaidDate: null,
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    endOfStayComplementAmount: 0,
    touristTaxTotal: 0, touristTaxInComplement: 0, clientGrossAmount: null,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
    ...over,
  };
}
function perLine({ options = 0, resources = 0, destinations }) {
  return { hasContribs: false, optionsTtc: options, resourcesTtc: resources, destinations };
}

// ── Carpier #22275 — a bain nordique sold DURING the stay ───────────────────────────────────────────
// Abracadaroom bills 720,82 and wires 573,77 (147,05 of commission). The stay also collects a 132 €
// arrival complement and a 30 € checkout complement. The 30 € used to be missing from the gross-up
// denominator, inflating every entry by 3,5 %: the solde debited the client 599,24 € against a 573,77 €
// transfer, and credited 113,63 € HT of extras it had not collected.
const CARPIER = baseRow({
  id: 22275, lastName: 'Carpier', platform: 'Abracadaroom',
  finalPrice: 865.82, totalPrice: 865.82, touristTaxTotal: 13.05,
  balanceAmount: 720.82, balancePaid: 1, balancePaidDate: '2026-08-10',
  complementAmount: 132, complementPaid: 1, complementPaidDate: '2026-08-19',
  complementAllocation: '{"accommodation":0,"options":118.95,"resources":0,"tax":13.05,"auto":128.05}',
  endOfStayComplementAmount: 30,
  platformCommissionAmount: 147.05,
});
const CARPIER_LINES = perLine({
  options: 115, resources: 30,
  destinations: { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 115, complementResources: 0 },
});

test('Carpier: the solde debits the client the exact transfer and credits accommodation only', () => {
  const entry = buildEntry(CARPIER, 'balance', CARPIER_LINES, COMMISSION_CONTEXT, { collectedOnArrival: true });
  assert.equal(round2(entry.encaissementTtc), 720.82, 'no gross-up: the stored solde IS the money');
  assert.equal(round2(entry.encaissementNetTtc), 573.77, 'the Abracadaroom transfer, to the cent');

  const rows = rowsByAccount(entry);
  assert.equal(round2(rows.get('CCARPIE').debit), 573.77);
  assert.equal(round2(rows.get('622600').debit), 147.05);
  assert.equal(round2(rows.get('70600000').credit), 655.29, 'accommodation HT');
  assert.equal(round2(rows.get('44571100').credit), 65.53);
  assert.ok(!rows.has('70600010'), 'the arrival extras are NOT credited here');
  assert.ok(!rows.has('70601000'), 'the checkout extras are NOT credited here');
});

test('Carpier: the arrival complement keeps the ventilation the fiche stored', () => {
  const entry = buildEntry(CARPIER, 'complement', CARPIER_LINES, COMMISSION_CONTEXT, { collectedOnArrival: true });
  const rows = rowsByAccount(entry);
  assert.equal(round2(rows.get('CCARPIE').debit), 132, 'the amount announced to the guest');
  assert.equal(round2(rows.get('70600010').credit), 108.14);
  assert.equal(round2(rows.get('46710000').credit), 13.05, 'tourist tax on the pass-through');
  assert.ok(!rows.has('70600000'), 'a complement never credits accommodation');
});

test('Carpier: the bain nordique sold mid-stay is booked as a resource, not a prestation', () => {
  const entry = buildEndOfStayEntry({
    ...CARPIER,
    endOfStayComplementPaidDate: '2026-08-22',
    endOfStayComplementDetail: '[{"label":"Bain nordique","amount":30,"source":"midStayExtra","key":"res:2"}]',
  }, 10);
  const rows = rowsByAccount(entry);
  assert.equal(round2(rows.get('70601000').credit), 27.27, 'activités diverses');
  assert.equal(round2(rows.get('44571100').credit), 2.73);
  assert.ok(!rows.has('70600010'));
});

test('an end-of-stay complement without mid-stay lines stays on the prestations account', () => {
  // The departure SAS's own lines (ménage, linge manquant) are services, not resources.
  const entry = buildEndOfStayEntry({
    ...CARPIER,
    endOfStayComplementAmount: 45,
    endOfStayComplementDetail: '[{"label":"Ménage","amount":45}]',
  }, 10);
  const rows = rowsByAccount(entry);
  assert.equal(round2(rows.get('70600010').credit), 40.91);
  assert.ok(!rows.has('70601000'));
});

// ── Foulon #22269 — a checkout complement settled in caisse interne ─────────────────────────────────
test('Foulon: a caisse-interne complement never leaks back into the solde', () => {
  const row = baseRow({
    id: 22269, lastName: 'Foulon', platform: 'Lodgify',
    finalPrice: 462.23, totalPrice: 462.23, touristTaxTotal: 21,
    balanceAmount: 452.73, balancePaid: 1, balancePaidDate: '2026-08-05',
    complementAmount: 24, complementPaid: 1, complementPaidDate: '2026-08-05',
    endOfStayComplementAmount: 6.5, // paid in caisse interne → never exported
    platformCommissionAmount: 11.57,
  });
  const lines = perLine({
    options: 30.5, resources: 0,
    destinations: { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 24, complementResources: 0 },
  });
  const entry = buildEntry(row, 'balance', lines, COMMISSION_CONTEXT, { collectedOnArrival: false });
  // Before: 452,73 × (483,23 / 476,73) = 458,90 — the 6,50 € of cash re-entered the books here.
  assert.equal(round2(entry.encaissementTtc), 452.73);
  assert.equal(round2(entry.encaissementNetTtc), 441.16, 'the Lodgify payout');
  assert.equal(round2(entry.taxTtc), 21, 'the reversed tax rides the solde');
});

// ── Nicolet #22226 — a schedule that drifted above the stay total ───────────────────────────────────
test('Nicolet: a drifted schedule books the money banked, never an invented total', () => {
  const row = baseRow({
    id: 22226, lastName: 'Nicolet', platform: 'Lodgify',
    finalPrice: 281.82, totalPrice: 281.82, touristTaxTotal: 2.94,
    depositAmount: 126.38, depositPaid: 1, depositPaidDate: '2026-06-22',
    balanceAmount: 126.38, balancePaid: 1, balancePaidDate: '2026-07-13',
    complementAmount: 60, endOfStayComplementAmount: 30, // both caisse interne
    platformCommissionAmount: 3.41, acompteCommissionAmount: 3.41,
  });
  const lines = perLine({
    options: 90, resources: 0,
    destinations: { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 90, complementResources: 0 },
  });
  const entry = buildEntry(row, 'deposit', lines, COMMISSION_CONTEXT, { collectedOnArrival: false });
  // Before: 126,38 × (284,76 / 312,76) = 115,07, i.e. a client debit of 111,66 € against a 126,38 €
  // movement. The schedule/total inconsistency is a fiche problem; the books follow the bank.
  assert.equal(round2(entry.encaissementTtc), 126.38);
  assert.equal(round2(entry.encaissementNetTtc), 122.97);
});

// ── Parreton #7 — the legacy « solde = net » shape the gross-up exists for ──────────────────────────
test('Parreton: the legacy net schedule still grosses up to the total the guest paid', () => {
  const row = baseRow({
    id: 7, lastName: 'Parreton', platform: 'GitesDeFrance',
    finalPrice: 994, totalPrice: 994, touristTaxTotal: 0,
    balanceAmount: 903, balancePaid: 1, balancePaidDate: '2026-05-13',
    platformCommissionAmount: 91,
  });
  const lines = perLine({ options: 0, resources: 0, destinations: { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 0, complementResources: 0 } });
  const entry = buildEntry(row, 'balance', lines, COMMISSION_CONTEXT, { collectedOnArrival: false });
  assert.equal(round2(entry.encaissementTtc), 994, 'CA recognised on what the guest paid');
  assert.equal(round2(entry.encaissementNetTtc), 903, 'client debit = the transfer received');
});

// ── Control: a plain stay with pre-arrival extras is unchanged ──────────────────────────────────────
test('control: a direct stay with pre-arrival extras pro-rates acompte and solde as before', () => {
  const row = baseRow({
    id: 100, lastName: 'Direct', platform: 'direct',
    finalPrice: 500, totalPrice: 500, touristTaxTotal: 0,
    depositAmount: 150, depositPaid: 1, depositPaidDate: '2026-03-01',
    balanceAmount: 350, balancePaid: 1, balancePaidDate: '2026-04-01',
  });
  const lines = perLine({
    options: 100, resources: 0,
    destinations: { preArrivalOptions: 100, preArrivalResources: 0, complementOptions: 0, complementResources: 0 },
  });
  const deposit = buildEntry(row, 'deposit', lines, COMMISSION_CONTEXT, { collectedOnArrival: false });
  const rows = rowsByAccount(deposit);
  // 30 % of the stay: 30 % of the 400 € accommodation and 30 % of the 100 € of options.
  assert.equal(round2(deposit.encaissementTtc), 150);
  assert.equal(round2(rows.get('70600000').credit), 109.09); // 120 TTC
  assert.equal(round2(rows.get('70600010').credit), 27.27);  //  30 TTC
  assert.equal(round2(rows.get('44571100').credit), 13.64);
});

test('splitByDestination: offered lines are ignored and a mid-stay share leaves the complement', () => {
  const split = splitByDestination({
    optionLines: [
      { optionId: 6, totalPrice: 40, offered: 0, inComplement: 1 },
      { optionId: 7, totalPrice: 0, offered: 1, inComplement: 0 },  // offered → nowhere
      { optionId: 8, totalPrice: 25, offered: 0, inComplement: 0 }, // pre-arrival
    ],
    customOptionLines: [],
    resourceLines: [{ resourceId: 2, totalPrice: 30, offered: 0, inComplement: 1 }],
  }, { 'res:2': 30 }); // the bain nordique was sold during the stay
  assert.deepEqual(split, {
    preArrivalOptions: 25, preArrivalResources: 0,
    complementOptions: 40, complementResources: 0, // the resource left for the checkout entry
  });
});
