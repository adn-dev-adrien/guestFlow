/**
 * Payments controller — the payment links of reservations (specs/online-payments-qonto.md §3.4 / §4.1),
 * provider-neutral since specs/plugins-phase-3a-online-payment.md rules 4-5.
 *
 * The core keeps the money path: what to ask for, the link record, the request email, the poll. The
 * link itself comes from the active payment provider (utils/paymentProviders), which a plugin declares
 * — Qonto's settings, OAuth and webhook live in plugins/online-payment. Without an active provider every
 * handler answers 409 NO_PAYMENT_PROVIDER.
 */

const database = require('../database');
const settingsModel = require('../models/settingsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const paymentProviders = require('../utils/paymentProviders');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const { createEmailService } = require('../utils/emailService');
const { formatCurrency } = require('../utils/devisHelpers');

// ----- Payment links on a reservation/devis (specs/online-payments-qonto.md §3.2 / §3.4) -----

const paymentRequestService = require('../utils/paymentRequestService');
const { LINK_TYPES, LINK_TITLES } = paymentRequestService;

// Wire the module-scoped deps into the injectable service (utils/paymentRequestService).
function requestServiceDeps(provider) {
  return {
    database,
    paymentLinksModel,
    resolveAmountCents,
    resolveItems: (id, type) => resolveVatComponents(id, type),
    provider,
    sendTemplate: ({ reservationId, stableKey, paymentLink, amountCents }) => sendReservationTemplateEmail({
      database, templatesModel: emailTemplatesModel, logModel: emailLogModel,
      settingsModel, emailServiceFactory: createEmailService,
      reservationId, stableKey,
      // specs/deposit-blocks-the-dates.md rule 11 — the email announces, to the cent, what the link
      // charges: the amount travels with the link rather than being re-derived from the row.
      extraContext: {
        vars: { paymentLink, paymentAmount: formatCurrency(Number(amountCents || 0) / 100) },
        flags: { hasPaymentLink: true },
      },
    }),
  };
}

// The pricing-engine quote of a persisted devis — the SAME replay the devis screen and the PDF read
// (specs/payment-link-quote-parity.md, amending specs/devis-pdf-total-parity.md §3.1 rule 1).
//
// This used to be a hand-rolled engine input built right here, and it silently dropped everything the
// authoritative replay carries: the `cardOccurrences` of a planning-card option (a breakfast or a meal
// then vanished from the quote entirely — the engine reads no moment as « not taken »), the `sessions`
// of an hourly resource, the `offeredOptionIds`, the per-line Complément routing and the price lock.
// Every one of those makes the Qonto page ask for an amount the devis never showed.
//
// `null` for a reservation (the stored columns stay authoritative there) or on an engine failure.
function runDevisEngineQuote(id, model = devisModel) {
  return model.recomputeQuote(id);
}

// Amount in cents for a link type, taken from the SAME engine the fiche/PDF use so the Qonto page
// matches the acompte/solde/total GuestFlow shows. The stored `depositAmount`/`balanceAmount` columns
// can be stale (pricing-rule change, public-API devis); the engine is the single source of truth.
// Falls back to the stored row for reservations or on failure.
function resolveAmountCents(id, type, row, quoteOf = runDevisEngineQuote) {
  let euros = Number(row[LINK_TYPES[type]] || 0); // fallback = stored column
  const quote = quoteOf(id);
  const field = type === 'deposit' ? 'depositAmount' : type === 'balance' ? 'balanceAmount' : 'finalPrice';
  if (quote && quote[field] != null) euros = Number(quote[field]);
  return Math.round(euros * 100);
}

// VAT basket components per link type (specs/payment-links-vat.md), from the engine quote. The tourist
// tax is VAT-exempt and (for direct stays) rides on the solde, so only `balance` carries a 0 %-VAT tax
// line; deposit (accommodation-only) and admin full (finalPrice, tax-excl) are single taxable lines.
// Returns null for reservations / engine failure → the caller keeps the safe single 0 %-VAT line.
function resolveVatComponents(id, type, quoteOf = runDevisEngineQuote) {
  const quote = quoteOf(id);
  if (!quote) return null;
  const cents = (v) => Math.round(Number(v || 0) * 100);
  const vatRatePercent = quote.vatPercentageAccommodation != null ? Number(quote.vatPercentageAccommodation) : 10;
  const taxCents = Boolean(quote.touristTaxCollectedOnArrival) ? 0 : cents(quote.touristTaxTotal);
  let components = null;
  if (type === 'deposit') {
    components = [{ title: LINK_TITLES.deposit, grossCents: cents(quote.depositAmount), taxable: true }];
  } else if (type === 'full') {
    components = [{ title: LINK_TITLES.full, grossCents: cents(quote.finalPrice), taxable: true }];
  } else if (type === 'balance') {
    const balCents = cents(quote.balanceAmount);
    components = [{ title: LINK_TITLES.balance, grossCents: balCents - taxCents, taxable: true }];
    if (taxCents > 0) components.push({ title: 'Taxe de séjour', grossCents: taxCents, taxable: false });
  } else {
    return null; // complement etc. → single line fallback
  }
  return { components, vatRatePercent };
}

const NO_PROVIDER_RESULT = { httpStatus: 409, body: paymentProviders.NO_PROVIDER };

// Map a thrown error to the HTTP response: a service validation throw carries `httpStatus`; anything
// else is a provider/transport failure, never leaked as is.
function sendError(res, err, provider) {
  if (err && err.httpStatus) return res.status(err.httpStatus).json({ error: err.error, message: err.message });
  if (err && err.code === 'QONTO_NOT_CONNECTED') {
    return res.status(400).json({ error: 'QONTO_NOT_CONNECTED', message: "Connecte d'abord Qonto (OAuth) avant la connexion du provider." });
  }
  const label = provider ? provider.label : 'du prestataire';
  return res.status(502).json({ error: provider ? provider.errorCode : 'PAYMENT_PROVIDER_ERROR', status: (err && err.status) || null, message: `Erreur de l'API ${label} — réessaie ou consulte les logs.` });
}

// Rule 5 — every handler needs a provider; without one it refuses before touching anything.
function withProvider(handler) {
  return (req, res) => {
    const provider = paymentProviders.active();
    if (!provider) return res.status(409).json(paymentProviders.NO_PROVIDER);
    return handler(req, res, provider);
  };
}

// POST /reservations/:id/payment-links — create/reuse a link WITHOUT emailing (used by the site flow,
// use case 2). The host-facing "email the link" action is sendPaymentRequestEmail below.
const createReservationPaymentLink = withProvider(async (req, res, provider) => {
  const id = Number(req.params.id);
  const type = String((req.body && req.body.type) || 'deposit');
  try {
    return res.json(await paymentRequestService.ensurePaymentLink(requestServiceDeps(provider), id, type));
  } catch (err) { return sendError(res, err, provider); }
});

// POST /reservations/:id/payment-emails — host action « Envoyer la demande d'acompte ». Creates/reuses
// the link AND emails the matching `<type>_request` template to the guest with the link injected.
const sendPaymentRequestEmail = withProvider(async (req, res, provider) => {
  const id = Number(req.params.id);
  // specs/deposit-blocks-the-dates.md rule 10 — an omitted type is resolved from the record by the
  // service (acompte when there is one, full payment otherwise); it is no longer assumed to be a deposit.
  const type = req.body && req.body.type ? String(req.body.type) : null;
  try {
    const { httpStatus, body } = await paymentRequestService.sendPaymentRequest(requestServiceDeps(provider), id, type);
    return res.status(httpStatus).json(body);
  } catch (err) { return sendError(res, err, provider); }
});

// Programmatic « send the balance request » (create/reuse the balance Qonto link + email the
// balance_request template) — used by the daily balance cron and reusable by any ops trigger.
// Returns the same { httpStatus, body } shape as sendPaymentRequest.
async function sendBalanceRequestFor(id) {
  const provider = paymentProviders.active();
  if (!provider) return NO_PROVIDER_RESULT;
  return paymentRequestService.sendPaymentRequest(requestServiceDeps(provider), Number(id), 'balance');
}

// Same, for the acompte — fired automatically when a direct reservation is created
// (specs/payment-schedule-and-cancellation.md §3.7 rule 36), and reusable by the dashboard's
// « Relancer » action.
async function sendDepositRequestFor(id) {
  const provider = paymentProviders.active();
  if (!provider) return NO_PROVIDER_RESULT;
  return paymentRequestService.sendPaymentRequest(requestServiceDeps(provider), Number(id), 'deposit');
}

// Every payment link of a reservation/devis (newest first) — the status the UI renders.
const listReservationPaymentLinks = withProvider((req, res) => res.json({
  links: paymentLinksModel.listForReservation(Number(req.params.id)).map((link) => ({
    ...link,
    remoteCancelPending: Boolean(link.remoteCancelPendingAt),
  })),
}));

// Manual "poll now" trigger (specs/online-payments-qonto.md §7 manual test). Runs the same pass the
// cron runs: detect paid links → mark paid → convert devis / flag deposit. Returns a summary.
// A human asked, so the per-link cadence is bypassed (specs/payment-polling-fair-use.md rule 10).
const pollPaymentsNow = withProvider(async (req, res, provider) => {
  try {
    return res.json(await runPaymentPoll({ ...buildPaymentEffectDeps(), provider, force: true }));
  } catch (err) { return sendError(res, err, provider); }
});

module.exports = {
  createReservationPaymentLink, listReservationPaymentLinks, sendPaymentRequestEmail, pollPaymentsNow,
  sendBalanceRequestFor, sendDepositRequestFor,
};

// The two money resolvers, with their quote source injectable (specs/payment-link-quote-parity.md §7):
// a test drives them on an in-memory devis instead of the production database.
module.exports.__test = { runDevisEngineQuote, resolveAmountCents, resolveVatComponents };
