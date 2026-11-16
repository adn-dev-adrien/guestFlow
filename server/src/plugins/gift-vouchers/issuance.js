/**
 * Issuing a voucher: one transaction that draws the code, writes the voucher and its `issue` movement and closes the
 * order (specs/gift-vouchers.md rules 17, 24, 30-32, 43). The VAT rate in force is frozen on the voucher with its expiry. The code is shown by the caller once; only its hash and its
 * encrypted copy are stored.
 */

const code = require('./code');
const rules = require('./voucherRules');

function createIssuance({
  db, vouchers, orders, movements, pepper, encrypt, now = () => new Date(), randomBytes, vatRatePercent = () => rules.DEFAULT_VAT_PERCENT,
}) {
  /**
   * The order is already created; `idempotencyKey` makes a replay (a link paid twice, a replayed webhook) issue nothing
   * more. `issueDate` is the day of a voucher sold by hand (rule 24); its expiry runs from it. → `{ voucherId, code,
   * replayed }`, `code` being the normalised 16 characters, null on a replay.
   */
  const issue = db.transaction(({
    orderId, actor, validityMonths = rules.DEFAULT_VALIDITY_MONTHS, issueDate = null, idempotencyKey = `issue:${orderId}`,
  }) => {
    const order = orders.find(orderId);
    if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });
    const existing = movements.byKey(idempotencyKey);
    if (existing) return { voucherId: existing.voucherId, code: null, replayed: true };
    const today = issueDate || rules.parisDate(now());
    const issuedAt = issueDate && issueDate !== rules.parisDate(now()) ? new Date(`${issueDate}T12:00:00Z`) : now();
    let normalised = code.generate(randomBytes);
    while (vouchers.findByCodeHash(code.hashCode(pepper(), normalised))) normalised = code.generate(randomBytes);
    const voucherId = vouchers.insert({
      orderId,
      number: vouchers.nextNumber(today.slice(0, 4)),
      codeHash: code.hashCode(pepper(), normalised),
      codeEncrypted: encrypt(normalised),
      amountCents: order.amountCents,
      issuedAt: issuedAt.toISOString(),
      expiresOn: rules.expiryFor(today, validityMonths),
      vatRatePercent: vatRatePercent(),
    });
    movements.append({
      voucherId, kind: 'issue', amountCents: order.amountCents, actor, idempotencyKey,
    });
    orders.markIssued(orderId);
    return { voucherId, code: normalised, replayed: false };
  });

  return { issue };
}

module.exports = { createIssuance };
