/**
 * What a paid link does to an order (specs/gift-vouchers.md rule 17): the plugin's side of `ctx.paymentBasket`, called by the
 * core when the bank — never the visitor's browser — says the link is paid. It issues the voucher in one transaction and
 * starts the receipt; it is idempotent on the link, and money it cannot honour is flagged « à rembourser » rather than lost.
 */

const SOURCE = 'giftVoucher';

/** Money the plugin keeps nothing for: the core flags it « à rembourser » on the link (`ctx.paymentBasket`). */
function unhonoured(reason) {
  const outcome = { reason };
  outcome.refundOwed = true;
  return outcome;
}

function createOrderPaid({
  orders, movements, issuance, limits, receipt,
}) {
  /** `{ ref, linkId, amountCents }` → `{ effect }`, or `{ refundOwed, reason }`. */
  return function paid({ ref, linkId, amountCents }) {
    const order = orders.find(ref);
    if (!order) return unhonoured('commande de bon cadeau introuvable');
    const idempotencyKey = `issue:link:${linkId}`;
    if (movements.byKey(idempotencyKey)) return { effect: 'voucher-already-issued' };
    if (order.state === 'issued') return unhonoured('bon cadeau déjà émis par un autre paiement');
    if (Number(amountCents) !== order.amountCents) return unhonoured('montant payé différent de celui du bon cadeau');
    const issued = issuance.issue({
      orderId: order.id, actor: 'public', validityMonths: limits().validityMonths, idempotencyKey,
    });
    receipt.deliverReceipt(issued.voucherId).catch(() => {});
    return { effect: 'voucher-issued' };
  };
}

module.exports = { createOrderPaid, SOURCE };
