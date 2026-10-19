// specs/ui-review-2026-10-19-operations.md rules 5 and 9 — one row of the quotes list, shaped by the
// server: its total, and no « Origine inconnue » badge.
const test = require('node:test');
const assert = require('node:assert/strict');

const { devisListRow } = require('../utils/devisListRow');

test('rule 5 — the row carries totalTtc = stay price + tourist tax, rounded', () => {
  const row = devisListRow({ id: 1, finalPrice: 1099.4, touristTaxTotal: 18.004 });
  assert.equal(row.totalTtc, 1117.4);
  assert.equal(devisListRow({ id: 2, finalPrice: null, touristTaxTotal: null }).totalTtc, 0);
});

test('rule 9 — a website request without attribution has no origin badge in the list', () => {
  const row = devisListRow({ id: 1, requestOrigin: 'public', attributionChannel: null, finalPrice: 0 });
  assert.equal(row.originLabel, null);
  assert.equal(row.originDetail, null);
});

test('rule 9 — a known origin keeps its label; an operator quote has none', () => {
  const social = devisListRow({ id: 1, requestOrigin: 'public', attributionChannel: 'social', attributionLabel: 'Instagram', finalPrice: 0 });
  assert.match(social.originLabel, /Instagram/);
  const internal = devisListRow({ id: 2, requestOrigin: null, attributionChannel: null, finalPrice: 0 });
  assert.equal(internal.originLabel, null);
});
