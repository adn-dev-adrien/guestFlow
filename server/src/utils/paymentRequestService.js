/**
 * Payment-request orchestration (specs/online-payments-qonto.md §3.2 / §3.4) — the testable core
 * behind the thin `paymentsController` HTTP handlers. Every dependency is injected so the branching
 * (type validation, link reuse, amount guard, error→HTTP mapping) is unit-testable without the prod
 * DB or the Qonto network.
 *
 * Conventions:
 *   - `ensurePaymentLink` throws `{ httpStatus, error, message }` on a validation problem; a Qonto /
 *     transport error from `createLink` bubbles up unchanged (the controller maps it via qontoError).
 *   - `sendPaymentRequest` returns `{ httpStatus, body }` for the controller to relay verbatim.
 */

const LINK_TYPES   = { deposit: 'depositAmount', balance: 'balanceAmount', full: 'finalPrice' };
const LINK_TITLES  = { deposit: 'Acompte séjour', balance: 'Solde séjour', full: 'Paiement séjour' };
// Template per request type. Only the deposit request ships now (balance/full requests to come).
const REQUEST_TEMPLATES = { deposit: 'deposit_request' };

// Resolve a usable payment link for (reservation, type): reuse the current open one or create it.
//   deps: { database, paymentLinksModel, resolveAmountCents, createLink({ title, amountCents }) }
async function ensurePaymentLink(deps, id, type) {
  const { database, paymentLinksModel, resolveAmountCents, createLink } = deps;
  if (!LINK_TYPES[type]) throw { httpStatus: 400, error: 'INVALID_TYPE', message: 'Type de lien invalide (deposit/balance/full).' };

  // touristTaxTotal is carried so the full-payment amount resolver has the tax even on the fallback row
  // (specs/public-online-payment.md — avoids a silent tax-free undercharge if the devis lookup misses).
  const r = database.prepare('SELECT id, kind, depositAmount, balanceAmount, finalPrice, touristTaxTotal FROM reservations WHERE id = ?').get(id);
  if (!r) throw { httpStatus: 404, error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' };
  const amountCents = resolveAmountCents(id, type, r);
  if (amountCents <= 0) throw { httpStatus: 400, error: 'ZERO_AMOUNT', message: 'Montant nul pour ce type — vérifie le devis/réservation.' };

  // Reuse the current open link of that type if there is one (avoid duplicates on a double-click) — but
  // ONLY if it still bills the current amount. If the devis was edited between two `pay` calls the stored
  // amount drifts; reusing the stale link would charge the old total yet book the stay as fully paid at
  // the new total. Retire the stale link and mint a fresh one at the correct amount.
  const existing = paymentLinksModel.findOpenForReservation(id, type);
  if (existing && existing.url) {
    if (Number(existing.amountCents) === Number(amountCents)) {
      return { id: existing.id, type, amountCents: existing.amountCents, url: existing.url, status: existing.status, qontoPaymentLinkId: existing.qontoPaymentLinkId, reused: true };
    }
    paymentLinksModel.updateStatus(existing.id, 'cancelled');
  }

  const link = await createLink({ title: LINK_TITLES[type], amountCents });
  const row = paymentLinksModel.create({
    reservationId: id, type, amountCents,
    qontoPaymentLinkId: link.id, url: link.url, status: link.mappedStatus, expiresAt: link.expirationDate || null,
  });
  return { id: row.id, type, amountCents, url: link.url, status: link.mappedStatus, qontoPaymentLinkId: link.id, reused: false };
}

// Create/reuse the link AND email the matching `<type>_request` template to the guest.
//   deps: ensurePaymentLink deps + { sendTemplate({ reservationId, stableKey, paymentLink }) → senderResult }
async function sendPaymentRequest(deps, id, type) {
  const stableKey = REQUEST_TEMPLATES[type];
  if (!stableKey) return { httpStatus: 400, body: { error: 'INVALID_TYPE', message: 'Type de demande invalide (deposit).' } };

  const link = await ensurePaymentLink(deps, id, type); // {httpStatus} throw bubbles to the controller
  const result = await deps.sendTemplate({ reservationId: id, stableKey, paymentLink: link.url });

  if (!result.sent) {
    const map = {
      'no-email':       { s: 400, m: "Le client n'a pas d'adresse email." },
      'no-reservation': { s: 404, m: 'Réservation introuvable.' },
      'no-template':    { s: 500, m: 'Template « deposit_request » manquant.' },
    };
    const e = map[result.reason] || { s: 502, m: `Envoi du mail impossible : ${result.reason}` };
    return { httpStatus: e.s, body: { error: 'EMAIL_NOT_SENT', reason: result.reason, message: e.m, url: link.url, amountCents: link.amountCents } };
  }
  return { httpStatus: 200, body: { sent: true, url: link.url, amountCents: link.amountCents, emailLogId: result.emailLogId, recipientEmail: result.recipientEmail } };
}

module.exports = { ensurePaymentLink, sendPaymentRequest, LINK_TYPES, LINK_TITLES, REQUEST_TEMPLATES };
