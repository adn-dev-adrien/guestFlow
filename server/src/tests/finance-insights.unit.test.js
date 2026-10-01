const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 11 — the three « faits marquants », written server-side.
const { buildInsights } = require('../utils/financeInsights');

const norm = (s) => s.replace(/\s/g, ' ');

test('rule 11 — best month, commissions avoided by direct, late payments', () => {
  const out = buildInsights({
    bestMonth: { month: '2026-07', revenue: 11938, previous: 12257 },
    direct: { revenue: 24789, averagePlatformRate: 0.15 },
    late: { count: 2, amount: 817 },
  });
  assert.deepEqual(out.map((i) => i.key), ['bestMonth', 'directSavings', 'late']);
  assert.equal(norm(out[0].title), "Juillet, meilleur mois de l'exercice");
  assert.equal(norm(out[0].text), "11 938 €, contre 12 257 € l'an dernier.");
  assert.equal(norm(out[1].title), 'Le direct vous a évité 3 718 € de commissions');
  assert.equal(norm(out[1].text), '24 789 € réservés en direct, au taux moyen de vos plateformes (15 %).');
  assert.equal(out[2].tone, 'error');
  assert.equal(norm(out[2].title), '2 séjours en retard de paiement');
});

test('rule 11 — no known commission, no savings line; nothing late says so', () => {
  const out = buildInsights({ bestMonth: { month: '2026-08', revenue: 500, previous: null }, direct: { revenue: 1000, averagePlatformRate: null }, late: { count: 0, amount: 0 } });
  assert.deepEqual(out.map((i) => i.key), ['bestMonth', 'late']);
  assert.equal(norm(out[0].text), '500 €.');
  assert.equal(out[1].title, 'Aucun paiement en retard');
});

test('rule 11 — an empty exercise has no best month', () => {
  const out = buildInsights({ bestMonth: { month: '2026-01', revenue: 0, previous: null }, direct: { revenue: 0, averagePlatformRate: 0.1 }, late: { count: 0, amount: 0 } });
  assert.deepEqual(out.map((i) => i.key), ['late']);
});
