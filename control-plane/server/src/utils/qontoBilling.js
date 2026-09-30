/**
 * The renewal in Qonto terms (specs/control-plane-plans-and-access.md rules 17, 32, 34): the client,
 * the invoice, its attached payment link, their payment state, cancel and deactivate.
 *
 * Every call goes through GuestFlow's `withQonto`, over the console's settings, so a failure lands in
 * the same diagnosis the Paiements page shows. The billing controller only sees this facade, which
 * tests replace with a fake.
 */

const { qontoClient, qontoConfig, qontoService } = require('./gf');

// GuestFlow's scopes, plus what invoicing needs (rule 32).
const BILLING_SCOPES = [...qontoClient.DEFAULT_SCOPES, 'client.read', 'client.write', 'client_invoice.read', 'client_invoice.write'];

const FAILED_PAYMENT = new Set(['failed', 'expired', 'canceled', 'cancelled']);

function createQontoBilling({ settings, env = {} }) {
  const call = (fn) => qontoService.withQonto({ settings, env, origin: 'billing' }, fn);

  return {
    /** Configured and authorised: without both, nothing is invoiced (rule 32). */
    ready() {
      return qontoConfig.resolveQontoConfig({ settings, env }).configured && settings.qontoConnected();
    },

    /** The IBAN printed on the invoices: the account chosen in the provider connection. */
    async iban() {
      const accounts = await call((client, accessToken) => client.listBankAccounts({ accessToken }));
      const chosen = settings.qontoConnectionInfo().connectionId;
      const account = accounts.find((a) => a.id === chosen) || accounts.find((a) => a.main) || accounts[0];
      if (!account || !account.iban) {
        const err = new Error('Aucun compte bancaire Qonto : connectez le provider de liens dans Réglages → Paiements.');
        err.code = 'NO_BANK_ACCOUNT';
        throw err;
      }
      return account.iban;
    },

    createClient: (args) => call((client, accessToken) => client.createClient({ accessToken, ...args })),
    createInvoice: (args) => call((client, accessToken) => client.createClientInvoice({ accessToken, ...args })),
    createLink: (args) => call((client, accessToken) => client.createInvoicePaymentLink({ accessToken, ...args })),
    readInvoice: (id) => call((client, accessToken) => client.getClientInvoice({ accessToken, id })),
    cancelInvoice: (id) => call((client, accessToken) => client.cancelClientInvoice({ accessToken, id })),
    deactivateLink: (id) => call((client, accessToken) => client.deactivatePaymentLink({ accessToken, id })),

    /** `{ paid, paidAt, failures: [{ id, status }] }` from the payments made on a link. */
    async linkPayments(id) {
      const { paidPayment, payments } = await call((client, accessToken) => client.getPaymentLinkPayments({ accessToken, id }));
      return {
        paid: Boolean(paidPayment),
        paidAt: paidPayment ? (paidPayment.paid_at || paidPayment.updated_at || null) : null,
        failures: payments
          .filter((p) => FAILED_PAYMENT.has(String(p.status || '').toLowerCase()) && p.id)
          .map((p) => ({ id: String(p.id), status: String(p.status).toLowerCase() })),
      };
    },
  };
}

module.exports = { createQontoBilling, BILLING_SCOPES };
