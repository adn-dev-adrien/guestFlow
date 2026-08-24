/**
 * specs/adjustable-complement-amounts.md §3.6 — ventilation comptable d'un complément d'arrivée
 * ajusté. Chaque cas vérifie l'invariant qui justifie la brique : Σ postes == le montant annoncé,
 * au centime, sans jamais toucher ni l'hébergement ni la taxe de séjour.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitComplementByPoste, allocateComplementAdjustment, parseComplementAllocation,
} = require('../utils/complementAllocation');

const round2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => round2(a.accommodation + a.options + a.resources + a.tax);

// Le complément réel de la spec : linge 24 € + bain nordique 60 € + taxe 9,60 € = 93,60 €.
const DETAIL = [
  { kind: 'option', label: 'Linge de toilette', amount: 24 },
  { kind: 'resource', label: 'Bain nordique', amount: 60 },
  { kind: 'tax', label: 'Taxe de séjour', amount: 9.6 },
];

test('splitComplementByPoste — chaque ligne tombe sur son poste, Σ = le complément auto', () => {
  const split = splitComplementByPoste(DETAIL, 93.6);
  assert.deepEqual(split, { accommodation: 0, options: 24, resources: 60, tax: 9.6 });
  assert.equal(sum(split), 93.6);
});

test('splitComplementByPoste — ce que les lignes ne couvrent pas est de l\'hébergement (auto-gap)', () => {
  const split = splitComplementByPoste(DETAIL, 120);
  assert.equal(split.accommodation, 26.4);
  assert.equal(sum(split), 120);
});

test('splitComplementByPoste — la ligne « remainder » EST la part hébergement', () => {
  const split = splitComplementByPoste(
    [...DETAIL, { kind: 'remainder', label: "Complément d'arrivée", amount: 26.4 }], 120,
  );
  assert.equal(split.accommodation, 26.4);
  assert.equal(sum(split), 120);
});

test('règle 32 — l\'ajustement se ventile sur les seules prestations, au prorata', () => {
  const out = allocateComplementAdjustment({ target: 85, ...splitComplementByPoste(DETAIL, 93.6) });
  assert.equal(out.tax, 9.6, 'la taxe de séjour ne bouge pas');
  assert.equal(out.accommodation, 0);
  assert.equal(out.options, 21.54);
  assert.equal(out.resources, 53.86);
  assert.equal(sum(out), 85, 'Σ postes == le montant annoncé, au centime');
});

test('règle 32 — les prestations absorbent en premier, l\'hébergement reste intact', () => {
  const base = splitComplementByPoste(DETAIL, 120); // 26,40 € d'auto-gap hébergement
  const out = allocateComplementAdjustment({ target: 100, ...base });
  assert.equal(out.accommodation, 26.4);
  assert.equal(out.tax, 9.6);
  assert.equal(round2(out.options + out.resources), 64);
  assert.equal(sum(out), 100);
});

test('règle 33 — le plancher est la taxe de séjour, et elle seule', () => {
  const out = allocateComplementAdjustment({ target: 5, ...splitComplementByPoste(DETAIL, 93.6) });
  assert.equal(out.floor, 9.6);
  assert.equal(out.floored, true);
  assert.equal(out.total, 9.6);
  assert.equal(out.options, 0);
  assert.equal(out.resources, 0);
  assert.equal(out.accommodation, 0);
  assert.equal(sum(out), 9.6);
});

test('règle 33 — l\'hébergement ne cède qu\'une fois les prestations épuisées', () => {
  const base = splitComplementByPoste(DETAIL, 120); // 26,40 € d'hébergement + 84 € de prestations
  // Tant que les prestations suffisent, l'hébergement ne bouge pas d'un centime.
  const light = allocateComplementAdjustment({ target: 100, ...base });
  assert.equal(light.accommodation, 26.4);
  assert.equal(round2(light.options + light.resources), 64);
  // En dessous, les prestations tombent à 0 et l'hébergement prend le relais.
  const deep = allocateComplementAdjustment({ target: 30, ...base });
  assert.equal(deep.options, 0);
  assert.equal(deep.resources, 0);
  assert.equal(deep.accommodation, 20.4);
  assert.equal(sum(deep), 30);
});

test('règle 34 — complément 100 % hébergement : ajustable jusqu\'à 0, il n\'y a pas de taxe à protéger', () => {
  const base = splitComplementByPoste([], 40);
  assert.deepEqual(base, { accommodation: 40, options: 0, resources: 0, tax: 0 });
  const out = allocateComplementAdjustment({ target: 30, ...base });
  assert.equal(out.floor, 0);
  assert.equal(out.floored, false);
  assert.equal(out.accommodation, 30);
  assert.equal(sum(out), 30);
});

test('règle 35 — à la hausse sans prestation à proratiser, le surplus va aux prestations', () => {
  const base = { accommodation: 0, options: 0, resources: 0, tax: 9.6 };
  const out = allocateComplementAdjustment({ target: 30, ...base });
  assert.equal(out.options, 20.4);
  assert.equal(out.resources, 0);
  assert.equal(sum(out), 30);
});

test('le centime d\'arrondi tombe sur le poste le plus lourd, Σ reste exacte', () => {
  const out = allocateComplementAdjustment({
    target: 10, accommodation: 0, options: 20, resources: 10, tax: 0,
  });
  assert.equal(sum(out), 10);
  assert.equal(out.options + out.resources, 10);
});

test('une prestation offerte (0 €) garde un poids nul dans le prorata', () => {
  const out = allocateComplementAdjustment({
    target: 50, accommodation: 0, options: 0, resources: 60, tax: 0,
  });
  assert.equal(out.options, 0);
  assert.equal(out.resources, 50);
});

test('ajustement à 0 sur un complément sans taxe ni hébergement → tous les postes à 0', () => {
  const out = allocateComplementAdjustment({ target: 0, accommodation: 0, options: 24, resources: 0, tax: 0 });
  assert.equal(sum(out), 0);
  assert.equal(out.floored, false);
});

test('parseComplementAllocation — JSON, objet, ou rien du tout', () => {
  assert.deepEqual(
    parseComplementAllocation('{"accommodation":0,"options":21.54,"resources":53.86,"tax":9.6,"auto":93.6}'),
    { accommodation: 0, options: 21.54, resources: 53.86, tax: 9.6, auto: 93.6 },
  );
  // Une ventilation écrite avant que la taxe et le montant auto y soient stockés reste lisible.
  assert.deepEqual(
    parseComplementAllocation({ accommodation: 1, options: 2, resources: 3 }),
    { accommodation: 1, options: 2, resources: 3, tax: null, auto: null },
  );
  assert.equal(parseComplementAllocation(null), null);
  assert.equal(parseComplementAllocation(''), null);
  assert.equal(parseComplementAllocation('pas du json'), null);
  assert.equal(parseComplementAllocation('[1,2]'), null);
});
