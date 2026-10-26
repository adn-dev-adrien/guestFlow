// A fiche with a custom line saves without inventing an options change
// (specs/reservation-history-granular-diff.md rule 12).
//
// The stored snapshot keyed custom lines `1_000_000 + rank among custom lines`, the payload snapshot
// `2_000_000 + rank among ALL option lines`. The two never matched, so every save of a fiche carrying
// a custom line logged a phantom « Options » change — and on a past stay, where options are locked,
// the save was refused outright. Found on réservation 202609003 on 2026-10-23.

const test = require('node:test');
const assert = require('node:assert/strict');

const { CUSTOM_OPTION_SIGNATURE_BASE, buildAuditSnapshotFromPayload, getOptionsSignature, computeAuditChanges } = require('../utils/reservationAudit');

const storedSignature = (catalogue, custom) => getOptionsSignature([
  ...catalogue,
  ...custom.map((line, idx) => ({
    optionId: CUSTOM_OPTION_SIGNATURE_BASE + idx,
    quantity: 1,
    totalPrice: line.offered ? 0 : line.amount,
    inComplement: line.inComplement,
  })),
]);

const quoteWith = (optionLines) => ({ optionLines, resourceLines: [] });

test('catalogue lines before a custom line do not shift its key', () => {
  const quote = quoteWith([
    { optionId: 7, quantity: 1, totalPrice: 80, inComplement: 0 },
    { optionId: 8, quantity: 1, totalPrice: 0, inComplement: 0 },
    { isCustom: true, quantity: 1, totalPrice: 45, inComplement: 1 },
  ]);
  const after = buildAuditSnapshotFromPayload({ propertyId: 1 }, quote).optionsSignature;
  const before = storedSignature(
    [{ optionId: 7, quantity: 1, totalPrice: 80, inComplement: 0 }, { optionId: 8, quantity: 1, totalPrice: 0, inComplement: 0 }],
    [{ amount: 45, inComplement: 1 }],
  );
  assert.equal(after, before);
  assert.deepEqual(computeAuditChanges({ optionsSignature: before }, { optionsSignature: after }), []);
});

test('several custom lines keep their rank among custom lines only', () => {
  const quote = quoteWith([
    { isCustom: true, quantity: 1, totalPrice: 20, inComplement: 0 },
    { optionId: 3, quantity: 2, totalPrice: 16, inComplement: 0 },
    { isCustom: true, quantity: 1, totalPrice: 0, inComplement: 0 },
  ]);
  const after = buildAuditSnapshotFromPayload({ propertyId: 1 }, quote).optionsSignature;
  const before = storedSignature(
    [{ optionId: 3, quantity: 2, totalPrice: 16, inComplement: 0 }],
    [{ amount: 20, inComplement: 0 }, { amount: 30, offered: true, inComplement: 0 }],
  );
  assert.equal(after, before);
});

test('a real change on a custom line is still reported', () => {
  const quote = quoteWith([{ isCustom: true, quantity: 1, totalPrice: 60, inComplement: 1 }]);
  const after = buildAuditSnapshotFromPayload({ propertyId: 1 }, quote).optionsSignature;
  const before = storedSignature([], [{ amount: 45, inComplement: 1 }]);
  const changes = computeAuditChanges({ optionsSignature: before }, { optionsSignature: after });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, 'optionsSignature');
});
