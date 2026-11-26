// specs/gift-vouchers/gift-vouchers.md rules 11, 31 — the ledger: append-only, one writer, idempotent, never below 0, never above the issued amount.
const test = require('node:test');
const assert = require('node:assert/strict');

const fx = require('./giftVoucherFixtures');

async function withVoucher(fn, amountCents = 10000) {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    const { id } = await fx.issueManual(server, { amountCents });
    await fn({ ...fixture, server, id, movements: fixture.api.movements });
  } finally {
    await server.close();
  }
}

test('rule 31: an issue writes its movement, and the balance is the sum of the ledger', () => withVoucher(({ movements, id }) => {
  assert.deepEqual(movements.list(id).map((m) => [m.kind, m.amountCents, m.actor]), [['issue', 10000, 'user:7']]);
  assert.equal(movements.balanceOf(id), 10000);
}));

test('rule 31: no column stores a balance — the voucher row has none and the figure follows the ledger', () => withVoucher(({ db, movements, id, api }) => {
  assert.equal('balanceCents' in db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id), false);
  movements.append({
    voucherId: id, kind: 'redeem', amountCents: -2500, actor: 'system', idempotencyKey: 'r1',
  });
  assert.equal(api.vouchers.find(id).balanceCents, 7500);
}));

test('rule 31: rows are never updated or deleted', () => withVoucher(({ db, id }) => {
  assert.throws(() => db.prepare('UPDATE gift_voucher_movements SET amountCents = 1 WHERE voucherId = ?').run(id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM gift_voucher_movements WHERE voucherId = ?').run(id), /append-only/);
}));

test('rule 31: the idempotency key is unique — a replay returns the first row and writes nothing', () => withVoucher(({ movements, id }) => {
  const args = {
    voucherId: id, kind: 'redeem', amountCents: -1000, actor: 'system', idempotencyKey: 'same',
  };
  const first = movements.append(args);
  const again = movements.append(args);
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(again.movement.id, first.movement.id);
  assert.equal(movements.balanceOf(id), 9000);
}));

test('rule 31: a movement needs an author and a key', () => withVoucher(({ movements, id }) => {
  assert.throws(() => movements.append({ voucherId: id, kind: 'reveal', idempotencyKey: 'k' }), { code: 'MOVEMENT_INCOMPLETE' });
  assert.throws(() => movements.append({ voucherId: id, kind: 'reveal', actor: 'system' }), { code: 'MOVEMENT_INCOMPLETE' });
}));

test('rule 28: the balance never goes below 0 or above the issued amount — two redeems racing for the last cents, one wins', () => withVoucher(({ movements, id }) => {
  movements.append({
    voucherId: id, kind: 'redeem', amountCents: -6000, actor: 'system', idempotencyKey: 'a',
  });
  assert.throws(() => movements.append({
    voucherId: id, kind: 'redeem', amountCents: -6000, actor: 'system', idempotencyKey: 'b',
  }), { code: 'BALANCE_BELOW_ZERO' });
  assert.throws(() => movements.append({
    voucherId: id, kind: 'refund', amountCents: 6001, actor: 'system', idempotencyKey: 'c',
  }), { code: 'BALANCE_ABOVE_ISSUED' });
  assert.equal(movements.balanceOf(id), 4000);
}));

test('rule 31: an unknown voucher is refused', () => withVoucher(({ movements }) => {
  assert.throws(() => movements.append({
    voucherId: 999, kind: 'reveal', actor: 'system', idempotencyKey: 'x',
  }), { code: 'VOUCHER_NOT_FOUND' });
}));

test('rule 31: the table allows only the ten kinds', () => withVoucher(({ db, id }) => {
  assert.throws(() => db.prepare("INSERT INTO gift_voucher_movements (voucherId, kind, actor, idempotencyKey, createdAt) VALUES (?, 'steal', 'x', 'k', 'now')").run(id), /CHECK/);
}));

test('rule 17: issuing again with the same key issues nothing more (a link paid twice, a replayed webhook)', () => withVoucher(({ db, api }) => {
  const order = api.orders.create({ amountCents: 5000, source: 'site', email: 'a@b.test' });
  const first = api.issuance.issue({ orderId: order.id, actor: 'system' });
  const replay = api.issuance.issue({ orderId: order.id, actor: 'system' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.voucherId, first.voucherId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE orderId = ?').get(order.id).n, 1);
}));

test('rule 18: an order never paid is deleted after 7 days, never an issued one', () => withVoucher(({
  db, api, clock, id,
}) => {
  const stale = api.orders.create({ amountCents: 5000, source: 'site' });
  clock.at = new Date('2026-11-21T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(api.orders.purgeStalePending(), 0);
  clock.at = new Date('2026-11-23T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(api.orders.purgeStalePending(), 1);
  assert.equal(api.orders.find(stale.id), null);
  assert.ok(db.prepare('SELECT 1 FROM gift_vouchers WHERE id = ?').get(id), 'the issued voucher’s order stays');
}));
