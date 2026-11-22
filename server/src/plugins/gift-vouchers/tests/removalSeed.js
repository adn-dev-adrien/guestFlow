// specs/plugin-removal-resilience.md rule 11 — a cancelled voucher with its order and its ledger, so a purge has rows to drop and
// holds no balance to refuse it.
module.exports = {
  seed(db) {
    const order = db.prepare(`INSERT INTO gift_voucher_orders (amountCents, source, paymentMethod, state, createdAt, createdBy)
      VALUES (5000, 'manual', 'cash', 'issued', datetime('now'), 'removal-seed')`).run().lastInsertRowid;
    const voucher = db.prepare(`INSERT INTO gift_vouchers (orderId, number, codeHash, codeEncrypted, amountCents, issuedAt, expiresOn, cancelledAt)
      VALUES (?, 'BC-2026-0001', 'removal-seed-hash', 'removal-seed-blob', 5000, datetime('now'), '2099-01-01', datetime('now'))`).run(order).lastInsertRowid;
    db.prepare(`INSERT INTO gift_voucher_movements (voucherId, kind, amountCents, actor, idempotencyKey, createdAt)
      VALUES (?, 'issue', 5000, 'system', 'removal-seed-issue', datetime('now')), (?, 'cancel', -5000, 'system', 'removal-seed-cancel', datetime('now'))`).run(voucher, voucher);
  },
};
