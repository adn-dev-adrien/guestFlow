/**
 * What the emails controller knows of installments (specs/direct-installments.md rules 19-21): which
 * installment an `installment_request` entry stands for, the variables of its email, its link.
 *
 * Kept apart so the controller stays a pipeline (render, send, log): every question about the plan is
 * answered here, every dependency injectable.
 */

const { requestContext } = require('./installmentPlan');

const KEY = /^installment:(\d+)$/;

function createInstallmentRequests({
  installmentsModel = require('../models/installmentsModel'),
  paymentLinksModel = require('../models/paymentLinksModel'),
  paymentProviders = require('./paymentProviders'),
  ensureLink = (reservationId, installmentId) => require('../controllers/paymentsController').ensureInstallmentLinkFor(reservationId, installmentId),
  now = () => new Date().toISOString(),
} = {}) {
  return {
    // Requests need a payment provider to mint their link (rule 18: gated by the online-payment plugin).
    available: () => Boolean(paymentProviders.active()),

    // The installment an entry names — `installment:<id>` — or, without a key (the template queued by
    // hand), the first one still to pay. Null when it does not belong to the reservation or is paid.
    resolve(reservationId, occurrenceKey) {
      const rows = installmentsModel.listFor(reservationId);
      const wanted = KEY.exec(String(occurrenceKey || ''));
      const row = wanted
        ? rows.find((r) => r.id === Number(wanted[1]))
        : rows.find((r) => Number(r.paid) === 0);
      if (!row || Number(row.paid) === 1) return null;
      const open = paymentLinksModel.findOpenForInstallment(row.id);
      return {
        id: row.id,
        occurrenceKey: `installment:${row.id}`,
        context: requestContext(row, rows),
        openLinkUrl: open && open.url ? open.url : '',
      };
    },

    ensureLink,

    markRequested: (installmentId) => installmentsModel.markRequested(installmentId, now()),
  };
}

module.exports = { createInstallmentRequests };
