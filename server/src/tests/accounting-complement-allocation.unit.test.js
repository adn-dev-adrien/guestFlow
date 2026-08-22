/**
 * specs/adjustable-complement-amounts.md §3.6 — la comptabilité ne recalcule pas un montant ajusté.
 *
 * Le cas de référence est celui de la spec : complément d'arrivée de 93,60 € (linge 24 € + bain
 * nordique 60 € + taxe de séjour 9,60 €) annoncé 85 € au client. Sans ventilation stockée, l'écart
 * de 8,60 € tombait sur le DERNIER crédit de l'écriture — qui se trouve être la ligne 46710000 de la
 * taxe de séjour : écriture équilibrée, taxe fausse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');
const { entryToRows } = require('../utils/accountingExport');

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Linge 24 € (option) + bain nordique 60 € (ressource), tous deux forcés au complément, + 9,60 € de
// taxe de séjour routée au complément.
const PER_LINE = {
  optionLines: [{ optionId: 9, totalPrice: 24, offered: 0, inComplement: 1, acompteContribTtc: null, soldeContribTtc: null }],
  customOptionLines: [],
  resourceLines: [{ resourceId: 3, totalPrice: 60, offered: 0, inComplement: 1, acompteContribTtc: null, soldeContribTtc: null }],
  hasContribs: true,
  accommodationTtcCurrent: 200,
  midStayByKey: {},
};

function rowOf(overrides = {}) {
  return {
    id: 1, firstName: 'Jean', lastName: 'Dupont', platform: 'direct',
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-07-01',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-07-05',
    complementAmount: 93.6, complementPaid: 1, complementPaidDate: '2026-07-10',
    finalPrice: 284, totalPrice: 284, touristTaxTotal: 9.6,
    touristTaxInComplement: 1,
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
    touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0,
    clientGrossAmount: null, complementAllocation: null,
    ...overrides,
  };
}

// Une ligne d'export est un tuple aligné sur CSV_HEADERS : [6] = compte, [7] = débit, [8] = crédit.
const ACCOUNT = 6; const DEBIT = 7; const CREDIT = 8;
const num = (v) => round2(Number(v) || 0);
const creditsOf = (entry) => entryToRows(entry)
  .filter((r) => num(r[CREDIT]) > 0)
  .map((r) => ({ account: String(r[ACCOUNT]), amount: num(r[CREDIT]) }));
const debitOf = (entry) => round2(entryToRows(entry).reduce((s, r) => s + num(r[DEBIT]), 0));

test('sans ajustement : rien ne change (non-régression)', () => {
  const entry = buildEntry(rowOf(), 'complement', PER_LINE);
  assert.equal(entry.encaissementTtc, 93.6);
  const credits = creditsOf(entry);
  assert.equal(round2(credits.reduce((s, c) => s + c.amount, 0)), 93.6);
  const tax = credits.find((c) => c.account === '46710000');
  assert.equal(tax.amount, 9.6, 'la taxe de séjour est intacte');
});

test('le bug que la ventilation corrige : sans elle, l\'écart tombe sur la ligne taxe de séjour', () => {
  // Montant ajusté à 85 € mais AUCUNE ventilation stockée → l'export rattrape sur le dernier crédit.
  const entry = buildEntry(rowOf({ complementAmount: 85 }), 'complement', PER_LINE);
  const tax = creditsOf(entry).find((c) => c.account === '46710000');
  assert.equal(tax.amount, 1, 'témoin du comportement à ne plus jamais produire');
});

test('règle 36 — avec la ventilation stockée, l\'export la reprend poste par poste', () => {
  const entry = buildEntry(
    rowOf({ complementAmount: 85, complementAllocation: '{"accommodation":0,"options":21.54,"resources":53.86,"tax":9.6,"auto":93.6}' }),
    'complement', PER_LINE,
  );
  assert.equal(entry.fraction, 1);
  const credits = creditsOf(entry);
  const by = (account) => credits.filter((c) => c.account === account).reduce((s, c) => s + c.amount, 0);
  assert.equal(round2(by('70600010')), 19.58, 'prestations HT (21,54 / 1,10)');
  assert.equal(round2(by('70601000')), 48.96, 'activités HT (53,86 / 1,10)');
  assert.equal(round2(by('46710000')), 9.6, 'règle 32 — la taxe de séjour n\'est jamais touchée');
});

test('règle 37 — Σ crédits == débit, sans passer par la ligne de résidu', () => {
  const entry = buildEntry(
    rowOf({ complementAmount: 85, complementAllocation: '{"accommodation":0,"options":21.54,"resources":53.86,"tax":9.6,"auto":93.6}' }),
    'complement', PER_LINE,
  );
  const credits = creditsOf(entry);
  assert.equal(round2(credits.reduce((s, c) => s + c.amount, 0)), 85);
  assert.equal(debitOf(entry), 85);
});

test('la ventilation ne s\'applique qu\'au complément : acompte et solde l\'ignorent', () => {
  const row = rowOf({ complementAllocation: '{"accommodation":0,"options":21.54,"resources":53.86,"tax":9.6,"auto":93.6}' });
  assert.equal(buildEntry(row, 'deposit', PER_LINE).encaissementTtc, 60);
  assert.equal(buildEntry(row, 'balance', PER_LINE).encaissementTtc, 140);
});

test('règle 37 — le gross-up ne réagit pas à l\'ajustement (ni sur le complément, ni sur les autres)', () => {
  // Réservation « legacy » dont l'échéancier ne somme pas à finalPrice + taxe : le ratio vaut 0,995.
  const legacy = {
    depositAmount: 30, balanceAmount: 100, finalPrice: 269.15, touristTaxTotal: 14.85,
    acompteCommissionAmount: 5, platformCommissionAmount: 10, platform: 'airbnb',
  };
  const withoutAdjustment = buildEntry(rowOf({ ...legacy }), 'complement', PER_LINE);
  const depositBefore = buildEntry(rowOf({ ...legacy }), 'deposit', PER_LINE);

  const adjusted = rowOf({
    ...legacy,
    complementAmount: 140,
    complementAllocation: '{"accommodation":3.96,"options":122.99,"resources":0,"tax":13.05,"auto":93.6}',
  });
  const entry = buildEntry(adjusted, 'complement', PER_LINE);
  assert.equal(entry.encaissementTtc, 140, 'le montant annoncé est booké tel quel, jamais mis à l\'échelle');
  assert.equal(round2(creditsOf(entry).reduce((s, c) => s + c.amount, 0)), 140);
  assert.equal(creditsOf(entry).find((c) => c.account === '46710000').amount, 13.05);

  // Et les autres échéances de la même réservation ne bougent pas d'un centime.
  assert.equal(buildEntry(adjusted, 'deposit', PER_LINE).encaissementTtc, depositBefore.encaissementTtc);
  assert.ok(withoutAdjustment.encaissementTtc !== 140, 'le témoin legacy est bien mis à l\'échelle sans ajustement');
});

test('une ventilation illisible retombe sur la dérivation d\'origine', () => {
  const entry = buildEntry(rowOf({ complementAllocation: 'pas du json' }), 'complement', PER_LINE);
  assert.equal(round2(creditsOf(entry).reduce((s, c) => s + c.amount, 0)), 93.6);
});
