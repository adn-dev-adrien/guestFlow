// Remboursements — pure layer (specs/reservation-refunds.md §3.2, rules 7–14).
// Refundable-line derivation, per-key + global caps, HT/VAT split. No DB, no clock.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRefundableLines,
  validateRefundPayload,
  refundedByKey,
  refundsTotal,
  splitHtVat,
} = require('../utils/refunds');

// A stay at 480 € = 380 € accommodation + 72 € breakfasts (6 × 12) + 28 € vélos, plus 13,20 € of tax.
const STAY = {
  finalPrice: 480,
  touristTaxTotal: 13.2,
  vatRate: 10,
  options: [
    { optionId: 7, title: 'Petit-déjeuner', totalPrice: 72, billedUnits: 6, offered: 0 },
    { customOptionId: 3, title: 'Panier gourmand', totalPrice: 0, offered: 1, isCustom: true },
  ],
  resources: [
    { resourceId: 2, name: 'Vélos', totalPrice: 28, billedUnits: 2, offered: 0 },
  ],
};

const lineFor = (lines, key) => lines.find((l) => l.key === key);

test('refundable lines: accommodation derived from finalPrice minus the extras, offered lines absent', () => {
  const lines = buildRefundableLines({ ...STAY, refunds: [] });

  assert.deepEqual(lines.map((l) => l.key), ['accommodation', 'opt:7', 'res:2', 'touristTax']);
  assert.equal(lineFor(lines, 'accommodation').billedTtc, 380);
  assert.equal(lineFor(lines, 'accommodation').bucket, 'accommodation');
  assert.equal(lineFor(lines, 'opt:7').billedTtc, 72);
  assert.equal(lineFor(lines, 'opt:7').unitPrice, 12);
  assert.equal(lineFor(lines, 'opt:7').bucket, 'options');
  assert.equal(lineFor(lines, 'res:2').bucket, 'resources');
  // The offered custom option is stored at 0 € — nothing to give back, so it never shows up.
  assert.equal(lines.some((l) => l.label === 'Panier gourmand'), false);
});

test('a pass-through line (taxe de séjour) carries no VAT, revenue lines carry the app rate', () => {
  const lines = buildRefundableLines({ ...STAY, refunds: [] });
  assert.equal(lineFor(lines, 'touristTax').vatRate, 0);
  assert.equal(lineFor(lines, 'touristTax').bucket, 'touristTax');
  assert.equal(lineFor(lines, 'opt:7').vatRate, 10);
});

test('already-refunded amounts shrink the refundable part, and a fully-refunded line disappears', () => {
  const refunds = [{
    method: 'transfer',
    totalTtc: 24,
    lines: [{ lineKey: 'opt:7', amountTtc: 24 }],
  }];
  const partly = buildRefundableLines({ ...STAY, refunds });
  assert.equal(lineFor(partly, 'opt:7').refundedTtc, 24);
  assert.equal(lineFor(partly, 'opt:7').refundableTtc, 48);

  const whole = buildRefundableLines({
    ...STAY,
    refunds: [{ method: 'transfer', totalTtc: 72, lines: [{ lineKey: 'opt:7', amountTtc: 72 }] }],
  });
  assert.equal(lineFor(whole, 'opt:7'), undefined);
});

test('a line shrunk below what was already refunded clamps to 0 instead of going negative', () => {
  // 24 € of breakfasts refunded, then the fiche drops the option to a single unit (12 €).
  const lines = buildRefundableLines({
    ...STAY,
    options: [{ optionId: 7, title: 'Petit-déjeuner', totalPrice: 12, billedUnits: 1, offered: 0 }],
    refunds: [{ method: 'transfer', totalTtc: 24, lines: [{ lineKey: 'opt:7', amountTtc: 24 }] }],
  });
  assert.equal(lineFor(lines, 'opt:7'), undefined);
});

test('refundedByKey aggregates every means, refundsTotal separates book money from caisse interne', () => {
  const refunds = [
    { method: 'transfer', totalTtc: 24, lines: [{ lineKey: 'opt:7', amountTtc: 24 }] },
    { method: 'internal', totalTtc: 10, lines: [{ lineKey: 'opt:7', amountTtc: 10 }] },
    { method: 'cash', totalTtc: 5, lines: [{ lineKey: null, amountTtc: 5 }] },
  ];
  assert.deepEqual(refundedByKey(refunds), { 'opt:7': 34 });
  assert.equal(refundsTotal(refunds), 29);                    // virement + espèces
  assert.equal(refundsTotal(refunds, { withCash: true }), 39); // + caisse interne
});

test('splitHtVat extracts the VAT from a TTC amount; a 0-rate line stays entirely HT', () => {
  assert.deepEqual(splitHtVat(24, 10), { ht: 21.82, vat: 2.18 });
  assert.deepEqual(splitHtVat(13.2, 0), { ht: 13.2, vat: 0 });
  assert.deepEqual(splitHtVat(0, 10), { ht: 0, vat: 0 });
});

// ── validateRefundPayload ────────────────────────────────────────────────────

const CONTEXT = {
  refundableLines: buildRefundableLines({ ...STAY, refunds: [] }),
  finalPrice: 480,
  touristTaxTotal: 13.2,
  alreadyRefundedTotal: 0,
  vatRate: 10,
  today: '2026-08-20',
};

test('the trigger case: 2 breakfasts refunded by transfer are normalized with a frozen VAT rate', () => {
  const result = validateRefundPayload({
    refundDate: '2026-08-14',
    method: 'transfer',
    reason: 'Départ anticipé — petits-déjeuners non pris',
    lines: [{ key: 'opt:7', quantity: 2, amountTtc: 24 }],
  }, CONTEXT);

  assert.equal(result.error, undefined);
  assert.equal(result.refund.totalTtc, 24);
  assert.deepEqual(result.refund.lines, [{
    lineKey: 'opt:7',
    label: 'Petit-déjeuner',
    bucket: 'options',
    quantity: 2,
    unitPrice: 12,
    amountTtc: 24,
    vatRate: 10,
  }]);
});

test('a free line takes its operator-chosen bucket and the app VAT rate', () => {
  const result = validateRefundPayload({
    refundDate: '2026-08-14',
    lines: [{ label: 'Geste commercial', bucket: 'options', amountTtc: 15 }],
  }, CONTEXT);
  assert.equal(result.refund.method, 'transfer'); // default means
  assert.deepEqual(result.refund.lines[0], {
    lineKey: null, label: 'Geste commercial', bucket: 'options',
    quantity: null, unitPrice: null, amountTtc: 15, vatRate: 10,
  });
});

test('rule 10 — per-key cap: refunding more than the line billed is a 409', () => {
  const result = validateRefundPayload({
    refundDate: '2026-08-14',
    lines: [{ key: 'opt:7', amountTtc: 90 }],
  }, CONTEXT);
  assert.equal(result.code, 'REFUND_EXCEEDS_LINE');
  assert.equal(result.status, 409);
});

test('rule 10 — two lines on the same key are capped on their SUM, not one by one', () => {
  const result = validateRefundPayload({
    refundDate: '2026-08-14',
    lines: [{ key: 'opt:7', amountTtc: 40 }, { key: 'opt:7', amountTtc: 40 }],
  }, CONTEXT);
  assert.equal(result.code, 'REFUND_EXCEEDS_LINE');
});

test('rule 11 — global cap counts what was already refunded, every means included', () => {
  const result = validateRefundPayload({
    refundDate: '2026-08-14',
    lines: [{ label: 'Geste', bucket: 'options', amountTtc: 100 }],
  }, { ...CONTEXT, alreadyRefundedTotal: 400 });
  assert.equal(result.code, 'REFUND_EXCEEDS_STAY');
  assert.equal(result.status, 409);

  const ok = validateRefundPayload({
    refundDate: '2026-08-14',
    lines: [{ label: 'Geste', bucket: 'options', amountTtc: 90 }],
  }, { ...CONTEXT, alreadyRefundedTotal: 400 });
  assert.equal(ok.error, undefined);
});

test('rules 12–13 — amounts must be positive, dates valid and never in the future', () => {
  const zero = validateRefundPayload({ refundDate: '2026-08-14', lines: [{ key: 'opt:7', amountTtc: 0 }] }, CONTEXT);
  assert.equal(zero.code, 'REFUND_INVALID_AMOUNT');

  const negative = validateRefundPayload({ refundDate: '2026-08-14', lines: [{ key: 'opt:7', amountTtc: -5 }] }, CONTEXT);
  assert.equal(negative.code, 'REFUND_INVALID_AMOUNT');

  const empty = validateRefundPayload({ refundDate: '2026-08-14', lines: [] }, CONTEXT);
  assert.equal(empty.code, 'REFUND_INVALID_AMOUNT');

  const malformed = validateRefundPayload({ refundDate: '14/08/2026', lines: [{ key: 'opt:7', amountTtc: 12 }] }, CONTEXT);
  assert.equal(malformed.code, 'REFUND_INVALID_DATE');

  const future = validateRefundPayload({ refundDate: '2026-08-21', lines: [{ key: 'opt:7', amountTtc: 12 }] }, CONTEXT);
  assert.equal(future.code, 'REFUND_INVALID_DATE');
});

// specs/reservation-refunds.md rule 4
test('unknown key, unknown means and unlabelled free line are all refused', () => {
  const unknownKey = validateRefundPayload({ refundDate: '2026-08-14', lines: [{ key: 'opt:999', amountTtc: 5 }] }, CONTEXT);
  assert.equal(unknownKey.code, 'REFUND_UNKNOWN_LINE');

  const badMethod = validateRefundPayload({ refundDate: '2026-08-14', method: 'bitcoin', lines: [{ key: 'opt:7', amountTtc: 5 }] }, CONTEXT);
  assert.equal(badMethod.code, 'REFUND_INVALID_METHOD');

  const noLabel = validateRefundPayload({ refundDate: '2026-08-14', lines: [{ amountTtc: 5 }] }, CONTEXT);
  assert.equal(noLabel.code, 'REFUND_INVALID_LINE');

  const badBucket = validateRefundPayload({ refundDate: '2026-08-14', lines: [{ label: 'X', bucket: 'caution', amountTtc: 5 }] }, CONTEXT);
  assert.equal(badBucket.code, 'REFUND_INVALID_LINE');
});

// specs/reservation-refunds.md rule 5 — `totalTtc` est calculé par le SERVEUR comme la somme des
// lignes ; un total envoyé par le client n'est jamais cru. C'est la même discipline que partout
// ailleurs sur l'argent : le navigateur propose des lignes, le serveur décide du montant.
test('rule 5 — un total envoyé par le client est ignoré au profit de la somme des lignes', () => {
  const result = validateRefundPayload({
    refundDate: '2026-08-14',
    method: 'transfer',
    totalTtc: 999,
    lines: [{ key: 'opt:7', quantity: 2, amountTtc: 24 }, { label: 'Geste', bucket: 'options', amountTtc: 6 }],
  }, CONTEXT);

  assert.equal(result.error, undefined);
  assert.equal(result.refund.totalTtc, 30);
});
