/**
 * Issuing a voucher: one transaction that draws the code, writes the voucher and its `issue` movement and closes the
 * order (specs/gift-vouchers.md rules 17, 24, 30-32, 43). What the order fixed is frozen on the voucher with its expiry (specs/gift-voucher-campaigns.md rule 11): the
 * campaign, the contents and the VAT lines — a lodging voucher takes the campaign's VAT rate in force when it is issued, a composed one the lines the order was priced with.
 * The code is shown by the caller once; only its hash and its encrypted copy are stored.
 */

const code = require('./code');
const rules = require('./voucherRules');

const OFFERED_NOTE = 'Offert par l’établissement';

function createIssuance({
  db, vouchers, orders, movements, campaigns, visuals = null, pepper, encrypt, now = () => new Date(), randomBytes,
}) {
  /** The VAT rate a voucher is stored with: a composed one carries lines of its own (the highest names it), a lodging one the campaign's rate. */
  function vatRateOf(order, campaign, contents) {
    if (contents.kind === 'resource') {
      const lines = rules.parseJson(order.vatLines, []);
      return lines.length ? Math.max(...lines.map((line) => Number(line.ratePercent))) : 0;
    }
    return campaign && campaign.vatRatePercent !== null ? campaign.vatRatePercent : rules.DEFAULT_VAT_PERCENT;
  }

  /** Rule 48 — the version of the voucher front the campaign shows now, kept on the voucher: a visual replaced or deleted later never changes it. */
  function visualVersionsOf(campaign) {
    const visual = campaign && campaign.voucherVisualId && visuals ? visuals.find(campaign.voucherVisualId) : null;
    return visual && visual.current ? { voucher: visual.current.id } : null;
  }

  /**
   * The order is already created; `idempotencyKey` makes a replay (a link paid twice, a replayed webhook) issue nothing
   * more. `issueDate` is the day of a voucher sold by hand (rule 24); its expiry runs from it. → `{ voucherId, code,
   * replayed }`, `code` being the normalised 16 characters, null on a replay.
   */
  const issue = db.transaction(({
    orderId, actor, issueDate = null, idempotencyKey = `issue:${orderId}`, note = null,
  }) => {
    const order = orders.find(orderId);
    if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND' });
    const existing = movements.byKey(idempotencyKey);
    if (existing) return { voucherId: existing.voucherId, code: null, replayed: true };
    const campaign = order.campaignId ? campaigns.find(order.campaignId) : null;
    const contents = rules.contentsOf(order);
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
      expiresOn: rules.expiryFor(today, campaign ? campaign.validityMonths : rules.DEFAULT_VALIDITY_MONTHS),
      vatRatePercent: vatRateOf(order, campaign, contents),
      campaignId: order.campaignId,
      contents,
      vatLines: rules.parseJson(order.vatLines, null),
      visualVersions: visualVersionsOf(campaign),
    });
    movements.append({
      voucherId, kind: 'issue', amountCents: order.amountCents, actor, idempotencyKey, note,
    });
    orders.markIssued(orderId);
    return { voucherId, code: normalised, replayed: false };
  });

  return { issue };
}

module.exports = { createIssuance, OFFERED_NOTE };
