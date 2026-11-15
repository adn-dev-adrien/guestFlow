// specs/gift-vouchers.md rules 5-11, 25, 28, 31 — the pure rules: amount bounds, expiry frozen at issue, derived states, the
// balance as a sum, what a movement may do, the settings that feed them.
const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../voucherRules');
const settings = require('../settings');
const fx = require('./giftVoucherFixtures');

const BOUNDS = { minAmountCents: 2000, maxAmountCents: 200000 };

test('rule 6: the amount is whole cents between the bounds — 19,99 € and 2 000,01 € are refused, 20 € and 2 000 € pass', () => {
  assert.deepEqual(rules.checkAmountCents(1999, BOUNDS), { ok: false, code: 'VOUCHER_AMOUNT_OUT_OF_BOUNDS' });
  assert.deepEqual(rules.checkAmountCents(200001, BOUNDS), { ok: false, code: 'VOUCHER_AMOUNT_OUT_OF_BOUNDS' });
  assert.deepEqual(rules.checkAmountCents(2000, BOUNDS), { ok: true, cents: 2000 });
  assert.deepEqual(rules.checkAmountCents(200000, BOUNDS), { ok: true, cents: 200000 });
});

test('rule 6: a fraction of a cent, a string, NaN, Infinity, nothing — all refused as invalid, never rounded', () => {
  [12345.5, '2000', NaN, Infinity, undefined, null, {}, [], true].forEach((value) => {
    assert.deepEqual(rules.checkAmountCents(value, BOUNDS), { ok: false, code: 'AMOUNT_INVALID' }, String(value));
  });
});

test('rule 6: defaults are 20 € and 2 000 €, and the bounds come from the settings', () => {
  assert.deepEqual([rules.DEFAULT_MIN_CENTS, rules.DEFAULT_MAX_CENTS], [2000, 200000]);
  assert.equal(rules.checkAmountCents(1000).ok, false);
  assert.equal(rules.checkAmountCents(1000, { minAmountCents: 500, maxAmountCents: 5000 }).ok, true);
  const get = (values) => (key) => values[key] ?? null;
  assert.deepEqual(settings.limitsOf(get({})), { validityMonths: 18, ...BOUNDS });
  assert.deepEqual(settings.limitsOf(get({ minAmountCents: '5000', maxAmountCents: '10000', validityMonths: '12' })), { validityMonths: 12, minAmountCents: 5000, maxAmountCents: 10000 });
  assert.deepEqual(settings.limitsOf(get({ minAmountCents: '9000', maxAmountCents: '1000' })), { validityMonths: 18, ...BOUNDS }, 'a min above the max falls back');
});

test('rule 7: the expiry is the issue date plus the validity — 18 months by default, a 31st landing on the last day of a short month', () => {
  assert.equal(rules.DEFAULT_VALIDITY_MONTHS, 18);
  assert.equal(rules.expiryFor('2026-11-15'), '2028-05-15');
  assert.equal(rules.expiryFor('2026-08-31'), '2028-02-29');
  assert.equal(rules.expiryFor('2027-08-31', 6), '2028-02-29');
  assert.equal(rules.expiryFor('2026-01-31', 1), '2026-02-28');
  assert.equal(rules.expiryFor('2026-11-15', 12), '2027-11-15');
});

test('rule 7: the expiry is stored at issue — changing the validity setting never moves an issued voucher', async () => {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    const first = await fx.issueManual(server);
    assert.equal(first.expiresOn, '2028-05-15');
    fixture.settingsStore.set('validityMonths', '6');
    const second = await fx.issueManual(server);
    assert.equal(second.expiresOn, '2027-05-15');
    assert.equal((await server.call('GET', `/api/gift-vouchers/${first.id}`)).body.expiresOn, '2028-05-15');
  } finally {
    await server.close();
  }
});

test('rule 7: the validity setting accepts 1 to 120 whole months and nothing else', () => {
  const validate = settings.DECLARED.find((d) => d.key === 'validityMonths').validate;
  ['1', '18', 120, '120'].forEach((v) => assert.equal(validate(v), null, String(v)));
  ['0', '121', '-1', '1.5', 'abc', '', [], {}].forEach((v) => assert.notEqual(validate(v), null, JSON.stringify(v)));
});

test('rule 10: pending without a voucher; cancelled from its date; exhausted from its balance; expired the day after its expiry; else started (balance below the issued amount) or active', () => {
  const v = { cancelledAt: null, expiresOn: '2027-01-31', amountCents: 1000 };
  const state = (voucher, balanceCents, today) => rules.stateOf({ voucher, balanceCents, today });
  assert.equal(state(null, 0, '2026-11-15'), 'pending');
  assert.equal(state(v, 1000, '2026-11-15'), 'active');
  assert.equal(state(v, 1000, '2027-01-31'), 'active', 'valid through its expiry day');
  assert.equal(state(v, 400, '2026-11-15'), 'started');
  assert.equal(state(v, 400, '2027-02-01'), 'expired', 'a started voucher still expires');
  assert.equal(state(v, 0, '2026-11-15'), 'exhausted');
  assert.equal(state(v, 1000, '2027-02-01'), 'expired');
  assert.equal(state(v, 0, '2026-11-15'), 'exhausted');
  assert.equal(state(v, 0, '2027-02-01'), 'exhausted', 'a used-up voucher is never reported expired');
  assert.equal(state({ ...v, cancelledAt: '2026-11-16T10:00:00Z' }, 500, '2026-11-17'), 'cancelled');
  assert.deepEqual(rules.STATES, ['pending', 'active', 'started', 'exhausted', 'expired', 'cancelled']);
});

test('rule 8: only an active or started voucher can pay', () => {
  assert.deepEqual(rules.STATES.filter(rules.isUsable), ['active', 'started']);
});

test('rule 11: the balance is the sum of the money movements — extend, reveal and mail carry none', () => {
  const rows = [
    { kind: 'issue', amountCents: 10000 }, { kind: 'redeem', amountCents: -2500 }, { kind: 'adjust', amountCents: 300 },
    { kind: 'reveal', amountCents: 0 }, { kind: 'mail', amountCents: 0 }, { kind: 'extend', amountCents: 0 },
  ];
  assert.equal(rules.balanceOf(rows), 7800);
  assert.equal(rules.balanceOf([]), 0);
});

test('rule 31: each kind moves the balance one way — issue, release, refund up; hold, redeem, cancel down; adjust either', () => {
  const refusal = (kind, amountCents, balanceCents = 5000, issuedCents = 10000) => rules.movementRefusal({
    kind, amountCents, balanceCents, issuedCents,
  });
  assert.equal(refusal('redeem', -1000), null);
  assert.equal(refusal('redeem', 1000), 'MOVEMENT_AMOUNT_INVALID');
  assert.equal(refusal('refund', 1000), null);
  assert.equal(refusal('refund', -1000), 'MOVEMENT_AMOUNT_INVALID');
  assert.equal(refusal('adjust', 1000), null);
  assert.equal(refusal('adjust', -1000), null);
  assert.equal(refusal('adjust', 0), 'MOVEMENT_AMOUNT_INVALID');
  assert.equal(refusal('cancel', 0), null, 'cancelling an empty voucher moves nothing');
  assert.equal(refusal('reveal', 0), null);
  assert.equal(refusal('reveal', 100), 'MOVEMENT_AMOUNT_INVALID');
  assert.equal(refusal('teleport', 0), 'MOVEMENT_KIND_INVALID');
});

test('rule 28: a movement never takes the balance below 0 or above the issued amount', () => {
  const refusal = (kind, amountCents, balanceCents) => rules.movementRefusal({
    kind, amountCents, balanceCents, issuedCents: 10000,
  });
  assert.equal(refusal('adjust', -5000, 5000), null);
  assert.equal(refusal('adjust', -5001, 5000), 'BALANCE_BELOW_ZERO');
  assert.equal(refusal('adjust', 5000, 5000), null);
  assert.equal(refusal('adjust', 5001, 5000), 'BALANCE_ABOVE_ISSUED');
});

test('rule 25: a new expiry is a real date in the future', () => {
  const refusal = (expiresOn) => rules.extensionRefusal({ expiresOn, today: '2026-11-15' });
  assert.equal(refusal('2026-11-16'), null);
  assert.equal(refusal('2026-11-15'), 'DATE_NOT_IN_FUTURE');
  assert.equal(refusal('2026-11-14'), 'DATE_NOT_IN_FUTURE');
  ['2026-02-30', '15/11/2027', '', null, undefined, 20271115, {}].forEach((v) => assert.equal(refusal(v), 'DATE_INVALID', String(v)));
});

test('rule 5: numbers read BC-<year>-<4 digits>, a sequence per year', async () => {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    const a = await fx.issueManual(server);
    const b = await fx.issueManual(server);
    const old = await fx.issueManual(server, { date: '2025-12-30' });
    const c = await fx.issueManual(server);
    assert.deepEqual([a.number, b.number, old.number, c.number], ['BC-2026-0001', 'BC-2026-0002', 'BC-2025-0001', 'BC-2026-0003']);
  } finally {
    await server.close();
  }
});

test('rule 5: the Paris calendar day is the shop’s day, whatever the server zone', () => {
  assert.equal(rules.parisDate(new Date('2026-11-15T23:30:00Z')), '2026-11-16');
  assert.equal(rules.parisDate(new Date('2026-07-15T21:59:00Z')), '2026-07-15');
  assert.equal(rules.parisDate(new Date('2026-07-15T22:00:00Z')), '2026-07-16');
});

test('formatEuros: plain spaces, two decimals, a comma', () => {
  assert.equal(rules.formatEuros(15000), '150,00 €');
  assert.equal(rules.formatEuros(123456), '1 234,56 €');
  assert.equal(rules.formatEuros(5), '0,05 €');
  assert.equal(rules.formatFrDate('2028-05-15'), '15/05/2028');
});
