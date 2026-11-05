// specs/reservation-refunds.md rule 49, reading of 2026-11-05 (audit R22-2) — a paid complement never reads as « whatever
// the solde did not hold » while the solde is unpaid: the register offers what each line collected, and giving everything
// back nets every account to 0. Replays of the auditor's p2 / p3 / p5 / item2c probes.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, D, forced, free, fiche, put, pay, cancel, register, offered, keyOf, giveAll, net, rowOf, refund,
} = require('./journalFixture');

const ACCOMMODATION = 'accommodation';
const TAX = 'touristTax';

async function gaveEverythingBack(id) {
  await cancel(id);
  const lines = offered(id);
  giveAll(id);
  assert.deepEqual(net(id), {}, `offered ${JSON.stringify(lines)}`);
  assert.equal(register(id).collectedTtc, 0);
  return lines;
}

test('A — direct, no acompte, tax on the solde, forced 50 €, complement paid: the line, not its tax', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] });
  pay(stay.id, C);
  await cancel(stay.id);
  const key = keyOf(stay.id, 'Forcée');
  assert.deepEqual(offered(stay.id), { [key]: 50 });
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('A2 — a free line never collected offers nothing; the forced one that collected 50 € offers 50 €', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50), free(100)] });
  pay(stay.id, C);
  await cancel(stay.id);
  assert.deepEqual(offered(stay.id), { [keyOf(stay.id, 'Forcée')]: 50 });
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('K1 — acompte paid, forced and free lines, complement paid: the excess never leaves the line paid at arrival', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(50), free(100)] });
  pay(stay.id, D, C);
  const collected = rowOf(stay.id).depositAmount + 50;
  await cancel(stay.id);
  const lines = offered(stay.id);
  assert.equal(lines[keyOf(stay.id, 'Forcée')], 50);
  assert.equal(lines[TAX], undefined, 'the tax rides the unpaid solde');
  assert.equal(Math.round(Object.values(lines).reduce((sum, v) => sum + v, 0) * 100) / 100, collected);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('K2 — acompte paid, tax in the complement, complement paid: the whole tax, the forced line', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { touristTaxInComplement: 1, customOptions: [forced(50), free(100)] });
  pay(stay.id, D, C);
  await cancel(stay.id);
  assert.equal(offered(stay.id)[TAX], 4.8);
  assert.equal(offered(stay.id)[keyOf(stay.id, 'Forcée')], 50);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('C — no acompte, tax in the complement, solde unpaid: 54,80 € on the line and the tax', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, touristTaxInComplement: 1, customOptions: [forced(50)] });
  pay(stay.id, C);
  assert.deepEqual(await gaveEverythingBack(stay.id), { [TAX]: 4.8, 'custom:forcée': 50 });
});

test('D — own channel reversed, added guest, complement 42,40 € alone: supplement and added tax', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600, depositDisabled: 1 });
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).complementAmount, 42.4);
  pay(stay.id, C);
  assert.deepEqual(await gaveEverythingBack(stay.id), { [ACCOMMODATION]: 40, [TAX]: 2.4 });
});

test('K5 — the same with an acompte paid', async () => {
  const stay = fiche(WITH_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const acompte = rowOf(stay.id).depositAmount;
  pay(stay.id, D, C);
  assert.deepEqual(await gaveEverythingBack(stay.id), { [ACCOMMODATION]: Math.round((acompte + 40) * 100) / 100, [TAX]: 2.4 });
});

test('Controls — solde paid: lines as before, nets to 0 on either order, no second reading of the tax', async () => {
  const both = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50), free(100)] });
  pay(both.id, S, C);
  assert.deepEqual(await gaveEverythingBack(both.id), { [ACCOMMODATION]: 600, 'custom:libre': 100, 'custom:forcée': 50, [TAX]: 4.8 });

  const reversed = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600, depositDisabled: 1 });
  await put(reversed, { adults: 3 });
  pay(reversed.id, C, S);
  assert.deepEqual(await gaveEverythingBack(reversed.id), { [ACCOMMODATION]: 635.2, [TAX]: 7.2 });
});

test('Caisse interne — a complement of 50 € paid there: the line in cash, no tax, nothing left after', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] });
  pay(stay.id, { ...C, complementPaidCash: true });
  assert.equal(rowOf(stay.id).complementPaidCash, 1);
  await cancel(stay.id);
  const [line] = register(stay.id).refundableLines;
  assert.equal(line.key, keyOf(stay.id, 'Forcée'));
  assert.equal(line.cashTtc, 50);
  assert.equal(register(stay.id).refundableLines.length, 1);
  assert.equal(refund(stay.id, [{ key: line.key, amountTtc: 50 }], 'internal').statusCode, 201);
  assert.deepEqual(register(stay.id).refundableLines, []);
  assert.deepEqual(net(stay.id), {});
});

test('Rank — with the complement paid, the money comes off the lines that did not collect it first', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(50), free(100)] });
  pay(stay.id, D, C);
  await cancel(stay.id);
  const before = offered(stay.id)[keyOf(stay.id, 'Forcée')];
  assert.equal(before, 50);
});
