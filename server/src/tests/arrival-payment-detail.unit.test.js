// specs/arrival-payment-detail-and-adjustment.md §3.1 — what the single arrival payment actually paid
// for. Pure: no DB. The invariant every test here defends is « les lignes somment aux seaux » — a
// detail that does not add up to the amount printed above it is worse than no detail at all, because
// the operator would trust it.
const test = require('node:test');
const assert = require('node:assert');

const { buildArrivalPaymentDetail } = require('../utils/arrivalPaymentDetail');

const round2 = (n) => Math.round(n * 100) / 100;
const sum = (lines) => round2(lines.reduce((s, l) => s + l.amount, 0));
const find = (lines, label) => lines.find((l) => l.label === label);

// Un séjour de 3 nuits réglé à la porte : solde 452,82 € (hébergement 420 + linge 24 + taxe 8,82)
// et complément d'arrivée 132 € (repas 50 + ménage 82).
function reservation(overrides = {}) {
  return {
    id: 1,
    startDate: '2026-08-19',
    endDate: '2026-08-22',
    depositAmount: 0,
    balanceAmount: 452.82,
    complementAmount: 132,
    endOfStayComplementAmount: 0,
    endOfStayComplementDetail: null,
    accommodationSoldeContribTtc: 420,
    touristTaxSoldeContribTtc: 8.82,
    options: [
      {
        optionId: 4, title: 'Linge de lit', quantity: 2, billedUnits: 2, unitPrice: 12,
        totalPrice: 24, originalTotalPrice: 24, offered: 0, inComplement: 0,
        acompteContribTtc: null, soldeContribTtc: 24,
      },
    ],
    resources: [],
    ...overrides,
  };
}

const COMPLEMENT_DETAIL = {
  detail: [
    { kind: 'option', label: 'Repas des trappeurs', qty: 2, unitPrice: 25, amount: 50 },
    { kind: 'option', label: 'Ménage', qty: 1, unitPrice: 82, amount: 82 },
  ],
};

test('the lines name the prestations, in the spec order, and sum to the buckets', () => {
  const { lines, bucketsTotal, accommodation } = buildArrivalPaymentDetail(reservation(), {
    buckets: ['balance', 'complement'],
    complementDetail: COMPLEMENT_DETAIL,
  });
  assert.deepEqual(lines.map((l) => l.label), [
    'Hébergement — 3 nuits', 'Linge de lit', 'Repas des trappeurs', 'Ménage', 'Taxe de séjour',
  ]);
  assert.equal(bucketsTotal, 584.82);
  assert.equal(sum(lines), 584.82);
  assert.equal(accommodation, 420);
});

test('the accommodation is the RESIDUAL of its bucket, so nothing can drift', () => {
  // L'instantané d'hébergement ment de 3 € (arrondi, capture partielle) : c'est le seau qui fait foi,
  // et l'écart revient sur l'hébergement plutôt que de casser le total.
  const { lines } = buildArrivalPaymentDetail(
    reservation({ accommodationSoldeContribTtc: 417 }),
    { buckets: ['balance', 'complement'], complementDetail: COMPLEMENT_DETAIL },
  );
  assert.equal(find(lines, 'Hébergement — 3 nuits').amount, 420);
  assert.equal(sum(lines), 584.82);
});

test('the taxe de séjour is ONE line, wherever it was collected', () => {
  const { lines } = buildArrivalPaymentDetail(reservation(), {
    buckets: ['balance', 'complement'],
    complementDetail: {
      detail: [
        ...COMPLEMENT_DETAIL.detail,
        { kind: 'tax', label: 'Taxe de séjour', qty: 1, unitPrice: 9.6, amount: 9.6 },
      ],
    },
  });
  const taxes = lines.filter((l) => l.kind === 'tax');
  assert.equal(taxes.length, 1);
  assert.equal(taxes[0].amount, 18.42);
  assert.equal(lines[lines.length - 1].kind, 'tax', 'la taxe ferme la liste');
});

test('an option split between the acompte and the solde is ONE prestation, not two', () => {
  const r = reservation({
    depositAmount: 200,
    balanceAmount: 252.82,
    accommodationAcompteContribTtc: 188,
    accommodationSoldeContribTtc: 232,
    touristTaxAcompteContribTtc: 0,
    touristTaxSoldeContribTtc: 8.82,
    options: [{
      optionId: 4, title: 'Linge de lit', quantity: 2, billedUnits: 2, unitPrice: 12,
      totalPrice: 24, originalTotalPrice: 24, offered: 0, inComplement: 0,
      acompteContribTtc: 12, soldeContribTtc: 12,
    }],
  });
  const { lines } = buildArrivalPaymentDetail(r, { buckets: ['deposit', 'balance'] });
  const linen = lines.filter((l) => l.label === 'Linge de lit');
  assert.equal(linen.length, 1);
  assert.equal(linen[0].amount, 24);
  assert.equal(sum(lines), 452.82);
});

test('an offered line stays visible at 0 € with its original amount', () => {
  // Un geste commercial fait partie de ce que le client a reçu : le cacher ferait mentir le détail
  // par omission.
  const r = reservation({
    options: [
      ...reservation().options,
      {
        optionId: 9, title: 'Petit-déjeuner', quantity: 2, billedUnits: 2, unitPrice: 9,
        totalPrice: 0, originalTotalPrice: 18, offered: 1, inComplement: 0,
        acompteContribTtc: null, soldeContribTtc: 0,
      },
    ],
  });
  const { lines } = buildArrivalPaymentDetail(r, { buckets: ['balance', 'complement'], complementDetail: COMPLEMENT_DETAIL });
  const breakfast = find(lines, 'Petit-déjeuner');
  assert.equal(breakfast.amount, 0);
  assert.equal(breakfast.offered, 1);
  assert.equal(breakfast.originalAmount, 18);
  assert.equal(sum(lines), 584.82, 'une ligne offerte ne change pas le total');
});

test('a bucket with no contribution snapshot degrades to ONE line named after it', () => {
  // Réservation plateforme dont la capture a légitimement échoué : on ne fabrique pas une répartition
  // qui n'a jamais été mesurée.
  const r = reservation({
    accommodationSoldeContribTtc: null,
    touristTaxSoldeContribTtc: null,
    options: [{ ...reservation().options[0], soldeContribTtc: null }],
  });
  const { lines, accommodation } = buildArrivalPaymentDetail(r, {
    buckets: ['balance', 'complement'], complementDetail: COMPLEMENT_DETAIL,
  });
  assert.deepEqual(lines.map((l) => l.label), ['Solde', 'Repas des trappeurs', 'Ménage']);
  assert.equal(find(lines, 'Solde').amount, 452.82);
  assert.equal(accommodation, 0, 'sans instantané, aucune réduction possible sur ce seau');
  assert.equal(sum(lines), 584.82);
});

test('the end-of-stay complement brings its own lines when the group covers it', () => {
  const r = reservation({
    endOfStayComplementAmount: 50,
    endOfStayComplementDetail: JSON.stringify([
      { label: 'Bain nordique', qty: 1, unitPrice: 30, amount: 30, source: 'midStayExtra' },
    ]),
  });
  const { lines, bucketsTotal } = buildArrivalPaymentDetail(r, {
    buckets: ['balance', 'endOfStayComplement'],
  });
  assert.ok(find(lines, 'Bain nordique'));
  // Le reste non itemisé est nommé plutôt que perdu, pour que les lignes somment au seau.
  assert.equal(find(lines, 'Complément de fin de séjour').amount, 20);
  assert.equal(bucketsTotal, 502.82);
  assert.equal(sum(lines), 502.82);
});

test('a bucket the group does not name contributes nothing', () => {
  const { lines, bucketsTotal } = buildArrivalPaymentDetail(reservation(), { buckets: ['balance'] });
  assert.equal(bucketsTotal, 452.82);
  assert.equal(sum(lines), 452.82);
  assert.equal(find(lines, 'Repas des trappeurs'), undefined);
});

test('the nights are counted from the stay, and the label agrees for one night', () => {
  const { lines } = buildArrivalPaymentDetail(
    reservation({ startDate: '2026-08-19', endDate: '2026-08-20' }),
    { buckets: ['balance'] },
  );
  assert.equal(lines[0].label, 'Hébergement — 1 nuit');
});
