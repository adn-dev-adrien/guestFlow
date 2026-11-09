/**
 * The card payment of a plugin's basket — a guest order (specs/guest-app.md rules 33, 35, 36) — on the core's money
 * path: the link is minted, polled, withdrawn and booked like every other payment link; only its paid effect is the
 * owning plugin's (`ctx.paymentBasket`, settled by `paymentPollRunner.applyPaidEffect`).
 *
 *   basketLink(reservationId, basket, { redirectUrl }) → { linkId, url, amountCents, expiresAt }   throws { httpStatus, error, message }
 *   refreshBasketLink(linkId)  → the link's status after an on-demand read of the provider (`open`, `paid`, …), or null
 *   withdrawBasketLink(linkId) → the link's status once withdrawn (`cancelled`), `paid` when the guest paid meanwhile
 */

const paymentsController = () => require('../controllers/paymentsController');
const paymentLinksModel = () => require('../models/paymentLinksModel');
const paymentProviders = () => require('./paymentProviders');

async function basketLink(reservationId, basket, { redirectUrl = null } = {}) {
  const link = await paymentsController().ensureBasketLinkFor(Number(reservationId), basket, { redirectUrl });
  return { linkId: link.id, url: link.url, amountCents: link.amountCents, expiresAt: link.expiresAt };
}

const deps = () => ({ ...require('./paymentEffectDeps').buildPaymentEffectDeps() });

// Like the booking's status page (public-online-payment.md §3bis): the guest waits on the order page, so its open
// link is read now rather than at the next poll. Exempt from the cadence, counted towards it.
async function refreshBasketLink(linkId) {
  const links = paymentLinksModel();
  const link = links.findById(Number(linkId));
  if (!link) return null;
  const provider = paymentProviders().declared();
  if (link.status === 'open' && link.providerLinkId && provider && link.provider === provider.id) {
    try {
      links.touchPolled(link.id);
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'basket' });
      if (pay && pay.paid) {
        const { processPaidLink } = require('./paymentPollRunner');
        await processPaidLink({ ...deps(), paymentLinksModel: links, link, paidPayment: pay });
      }
    } catch { /* best effort: the poll reads it later */ }
  }
  const now = links.findById(Number(linkId));
  return now ? now.status : null;
}

// Rule 35 — an order abandoned in the app: its link is withdrawn like the operator's « Retirer le lien », so it can
// no longer be paid; a payment that landed meanwhile is booked on the poll's path, the order's paid effect included.
async function withdrawBasketLink(linkId) {
  const links = paymentLinksModel();
  const { withdrawPaymentLink } = require('./paymentLinkWithdrawal');
  try {
    await withdrawPaymentLink(Number(linkId), {
      database: require('../database'),
      paymentLinksModel: links,
      provider: paymentProviders().declared(),
      bookPaid: (link, payment) => require('./paymentPollRunner').processPaidLink({
        ...deps(), paymentLinksModel: links, link, paidPayment: payment,
      }),
    });
  } catch (err) {
    if (!(err && err.error === 'LINK_ALREADY_PAID')) throw err;
  }
  const now = links.findById(Number(linkId));
  return now ? now.status : null;
}

module.exports = { basketLink, refreshBasketLink, withdrawBasketLink };
