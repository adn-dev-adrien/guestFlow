// specs/vat-optional-mode.md rules 39 and 40 — the four levels, their words, and a card with no threshold.

const test = require('node:test');
const assert = require('node:assert/strict');

const { franchiseDb, insert, TODAY } = require('./vatFranchiseFixture');
const { levelOf, wordsOf, attentionSummary } = require('../utils/vatFranchise');

test('rule 39: four levels from the collected figure, the projection and the threshold', () => {
  assert.equal(levelOf({ collected: 5000, projected: 7000, threshold: 10000 }), 'ok');
  assert.equal(levelOf({ collected: 5000, projected: 10000.01, threshold: 10000 }), 'projected_over');
  assert.equal(levelOf({ collected: 8000, projected: 9000, threshold: 10000 }), 'near');
  assert.equal(levelOf({ collected: 10000.01, projected: 10000.01, threshold: 10000 }), 'over');
});

test('rule 39: « near » starts at 80 %, and the threshold itself is near, never over', () => {
  assert.equal(levelOf({ collected: 7999.99, projected: 7999.99, threshold: 10000 }), 'ok');
  assert.equal(levelOf({ collected: 8000, projected: 8000, threshold: 10000 }), 'near');
  assert.equal(levelOf({ collected: 10000, projected: 12000, threshold: 10000 }), 'near');
});

test('rule 39: comparisons are made in cents, not in floating point', () => {
  assert.equal(levelOf({ collected: 0.1 + 0.2, projected: 0.3, threshold: 0.3 }), 'near');
  assert.equal(levelOf({ collected: 33333.33 + 0.01, projected: 0, threshold: 33333.34 }), 'near');
});

test('rule 39: each level has its tone, title and text; only « over » carries the action', () => {
  const words = (level, collected, projected) => wordsOf({ level, collected, projected, threshold: 10000, settingsPath: '/settings/tva-exercice' });
  assert.deepEqual(words('ok', 5000, 6000), { tone: 'neutral', title: 'Sous le seuil', text: 'Reste 5 000 € avant le seuil.', action: null });
  assert.deepEqual(words('near', 8400, 9000), { tone: 'warning', title: 'Seuil proche', text: 'Reste 1 600 € avant le seuil.', action: null });
  assert.deepEqual(words('projected_over', 5000, 10800), {
    tone: 'warning', title: 'Projection au-delà du seuil', text: '5 800 € attendus d’ici le 31/12 avec les réservations en cours.', action: null,
  });
  assert.deepEqual(words('over', 11240, 12000), {
    tone: 'error',
    title: 'Seuil dépassé',
    text: '1 240 € au-delà du seuil. Retour à la TVA à prévoir.',
    action: { label: 'Passer à la TVA…', path: '/settings/tva-exercice' },
  });
});

test('rule 39: an overrun under one euro shows its cents instead of « 0 € »', () => {
  const { text } = wordsOf({ level: 'over', collected: 10000.5, projected: 10000.5, threshold: 10000, settingsPath: '/x' });
  assert.match(text, /^0,50 € au-delà/);
});

test('rule 39: the model answers the level of the typed threshold, with the ratios', () => {
  const { db, model } = franchiseDb({ threshold: 10000 });
  insert(db, { startDate: '2026-03-01', endDate: '2026-03-04', finalPrice: 8400, balanceAmount: 8400, balancePaid: 1, balancePaidDate: '2026-03-04' });
  const f = model.getFollowUp({ today: TODAY });
  assert.equal(f.level, 'near');
  assert.equal(f.tone, 'warning');
  assert.equal(f.ratio, 0.84);
  assert.equal(f.projectedRatio, 0.84);
  assert.equal(f.threshold, 10000);
  assert.equal(f.thresholdSetAt, '2026-03-12');
  assert.equal(f.year, 2026);
  assert.equal(f.asOf, TODAY);
});

test('rule 40: with no threshold there is no level, no words, no ratio — only the figure of the year', () => {
  const { db, model } = franchiseDb();
  insert(db, { startDate: '2026-03-01', endDate: '2026-03-04', finalPrice: 1200, balanceAmount: 1200, balancePaid: 1, balancePaidDate: '2026-03-04' });
  const f = model.getFollowUp({ today: TODAY });
  assert.equal(f.applies, true);
  assert.equal(f.collected, 1200);
  assert.deepEqual([f.threshold, f.level, f.title, f.text, f.action, f.ratio, f.projectedRatio], [null, null, null, null, null, null, null]);
  assert.equal(f.settingsPath, '/settings/tva-exercice');
  assert.equal(attentionSummary(f), null);
});

test('rule 35: outside the franchise the follow-up does not exist', () => {
  assert.deepEqual(franchiseDb({ regime: 'subject' }).model.getFollowUp({ today: TODAY }), { applies: false });
  assert.deepEqual(franchiseDb({ mention: 'art_261_d_4', threshold: 10000 }).model.getFollowUp({ today: TODAY }), { applies: false });
});
