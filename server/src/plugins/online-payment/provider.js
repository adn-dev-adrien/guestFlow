/**
 * Qonto as the payment provider of the core's money path (specs/plugins-phase-3a-online-payment.md
 * rule 4). A thin adapter: every call goes through `withQonto`, so a failure is recorded where the
 * operator reads it (specs/qonto-settings-in-app.md rules 12-13), and the shapes the core expects are
 * built from what Qonto answers.
 */

const sdk = require('../sdk');

const { withQonto } = sdk.coreModule('qonto').qontoService;

// The payment statuses after which no money can arrive on that payment.
const SETTLED_UNPAID = new Set(['failed', 'canceled', 'cancelled', 'expired', 'declined', 'refused']);

// A payment neither paid nor known to have failed (processing, pending, a status this adapter does not know) may still
// complete (specs/payment-link-lifecycle.md rule 64): fails closed, an unknown status is in flight.
const hasPaymentInFlight = (payments) => (payments || [])
  .some((p) => { const status = String((p && p.status) || '').toLowerCase(); return status !== 'paid' && !SETTLED_UNPAID.has(status); });

/**
 * @param {object} [deps]
 * @param {object} [deps.settings] the settings store (defaults to the instance's, see settingsStore)
 * @param {object} [deps.env]
 */
function createQontoProvider({ settings, env = process.env } = {}) {
  const store = () => settings || require('./settingsStore').current();
  const call = (origin, fn) => withQonto({ settings: store(), env, origin }, fn);

  return {
    id: 'qonto',
    label: 'Qonto',
    // Kept for the WordPress contract: the public pay answers it on a provider failure.
    errorCode: 'QONTO_API_ERROR',

    isReady: () => store().qontoConnected(),

    // The errors Qonto's own wording explains better than « Erreur de l'API » (paymentProviders contract).
    describeError(err) {
      if (err && err.code === 'QONTO_NOT_CONNECTED') {
        return { httpStatus: 400, error: 'QONTO_NOT_CONNECTED', message: "Qonto à connecter d'abord (OAuth), avant le provider." };
      }
      return null;
    },

    async createLink({ title, amountCents, items, expectedTotalCents, redirectUrl }, { origin = 'manual-link' } = {}) {
      const link = await call(origin, (client, accessToken) => client.createPaymentLink({
        accessToken, title, amountCents, items, expectedTotalCents, redirectUrl,
      }));
      return { id: link.id, url: link.url, status: link.mappedStatus, expiresAt: link.expirationDate || null };
    },

    // The authoritative paid signal is the link's payments sub-resource: its top-level status only goes
    // open → processing in sandbox (specs/online-payments-qonto.md §3.3). `pending`: a payment still in flight.
    async getPayment(linkId, { origin = 'poll' } = {}) {
      const pay = await call(origin, (client, accessToken) => client.getPaymentLinkPayments({ accessToken, id: linkId }));
      const paid = pay.paidPayment || {};
      return { paid: Boolean(pay.paid), pending: !pay.paid && hasPaymentInFlight(pay.payments), paymentId: paid.id || null, paidAt: paid.paid_at || null };
    },

    async getLinkStatus(linkId) {
      const link = await call('poll', (client, accessToken) => client.getPaymentLink({ accessToken, id: linkId }));
      return link.mappedStatus;
    },

    async cancelLink(linkId) {
      await call('cancel-link', (client, accessToken) => client.deactivatePaymentLink({ accessToken, id: linkId }));
    },
  };
}

module.exports = { createQontoProvider, hasPaymentInFlight };
