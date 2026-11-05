// specs/reservation-refunds.md rule 49, reading of 2026-11-05 (audit R22-4) — on a cancelled stay a line's ceiling is
// max(billed, collected): money collected on a line lowered after payment can go back on that line, and the stay cap
// leaves a cancelled stay alone (REFUND_EXCEEDS_COLLECTED rules there). Replays of the auditor's item5 and p6 probes.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, NO_ACOMPTE, S, free, fiche, put, pay, cancel, register, offered, keyOf, giveAll, net, refund, csv,
} = require('./journalFixture');

const OPTION = 18;
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (?, 'Bois', 'per_stay', 5)").run(OPTION);
const optionLine = (quantity) => ({ options: [{ optionId: OPTION, quantity }], selectedOptions: [{ optionId: OPTION, quantity }] });

test('a free line lowered 50 → 25 € after the solde: the register offers 50 €, every account nets 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(50)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [free(25)] });
  await cancel(stay.id);
  assert.equal(offered(stay.id)[keyOf(stay.id, 'Libre')], 50);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('a plain quantity lowered 10 → 5: the same', async () => {
  db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)').run(NO_ACOMPTE, OPTION);
  const stay = fiche(NO_ACOMPTE, 'direct', optionLine(10));
  pay(stay.id, S);
  await put(stay, optionLine(5));
  await cancel(stay.id);
  const key = keyOf(stay.id, 'Bois');
  assert.equal(offered(stay.id)[key], 50);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('a line kept at its price: ceiling unchanged, nothing above it', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(50)] });
  pay(stay.id, S);
  await cancel(stay.id);
  const key = keyOf(stay.id, 'Libre');
  assert.equal(refund(stay.id, [{ key, amountTtc: 50.01 }]).body.code, 'REFUND_EXCEEDS_LINE');
});

test('a free line on a cancelled stay is judged by what was collected, never by the stay cap', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [] });
  await cancel(stay.id);
  assert.equal(refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 800 }]).body.code, 'REFUND_EXCEEDS_COLLECTED');
  const given = refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 142 }]);
  assert.equal(given.statusCode, 201, JSON.stringify(given.body));
  const before = csv();
  assert.ok(before.length > 0);
});
