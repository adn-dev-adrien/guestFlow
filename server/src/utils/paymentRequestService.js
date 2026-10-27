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

const { buildVatItems } = require('./paymentLinkItems');
const { buildStayLineLabel } = require('./paymentLinkLabel');

// Enrich the stay line's title + description with the booking reference, guest name, property and
// dates so the payment is identifiable in Qonto (specs/qonto-payment-link-reference.md). Text only —
// never touches amounts. Returns silently on any lookup failure (the generic titles stay).
function enrichStayComponent(database, id, type, components) {
  if (!Array.isArray(components) || !components.length) return;
  let info = null;
  try {
    info = database.prepare(`
      SELECT res.*, c.firstName, c.lastName, p.name AS propertyName
      FROM reservations res
      LEFT JOIN clients c ON c.id = res.clientId
      LEFT JOIN properties p ON p.id = res.propertyId
      WHERE res.id = ?`).get(id);
  } catch { info = null; }
  if (!info) return;
  const { title, description } = buildStayLineLabel({
    propertyName: info.propertyName,
    // A reservation without a devis number is named by its reservation number (rule 10).
    reference: String(info.devisNumber || '').trim() || info.reservationNumber || null,
    guest: { firstName: info.firstName, lastName: info.lastName },
    startDate: info.startDate,
    endDate: info.endDate,
    kind: type,
  });
  // The first component is always the taxable stay line; the tax line (if any) keeps its label.
  components[0].title = title;
  if (description) components[0].description = description;
}

// The stored columns a link of each type charges. A full payment is the acompte plus the solde — what
// its payment marks paid (specs/deposit-blocks-the-dates.md rule 18).
const LINK_TYPES   = { deposit: ['depositAmount'], balance: ['balanceAmount'], full: ['depositAmount', 'balanceAmount'] };
const LINK_TITLES  = { deposit: 'Acompte séjour', balance: 'Solde séjour', full: 'Paiement séjour', installment: 'Échéance séjour' };
// Template per request type. Deposit (use case 1), balance (online-deposit solde,
// specs/public-online-deposit.md) and full (a last-minute stay owes one payment,
// specs/deposit-blocks-the-dates.md rule 11).
const REQUEST_TEMPLATES = { deposit: 'deposit_request', balance: 'balance_request', full: 'full_request', installment: 'installment_request' };

// specs/deposit-blocks-the-dates.md rule 10 — the SERVER decides what a payment request asks for: the
// acompte when the record carries one, the whole stay when it does not (a last-minute quote never had
// an acompte, and a 0 € link would only be refused). An explicit caller type always wins.
function resolveRequestType(row, requested = null) {
  const asked = String(requested || '').trim().toLowerCase();
  // An explicit type is honoured — and an explicit UNKNOWN one is refused (null → 400) rather than
  // silently turned into a request for something else.
  if (asked) return LINK_TYPES[asked] ? asked : null;
  return Number((row && row.depositAmount) || 0) > 0 ? 'deposit' : 'full';
}

// Resolve a usable payment link for (reservation, type): reuse the current open one or create it.
//   deps: { database, paymentLinksModel, resolveAmountCents, provider (utils/paymentProviders),
//           resolveItems?(id, type, row) → { components, vatRatePercent } | null, deactivateLinks?(links) }
// `provider.createLink` returns { id, url, status, expiresAt }; a stale link is deactivated at the
// provider, not only closed here (specs/plugins-phase-3a-online-payment.md rule 7).
// When resolveItems yields components, the link is created as a VAT basket (specs/payment-links-vat.md):
// Qonto shows the real TVA while the charged total stays exactly amountCents. Absent/mismatched → the
// legacy single 0 %-VAT line (total-only) is used, so the charged amount is never at risk.
async function ensurePaymentLink(deps, id, type) {
  const { database, paymentLinksModel, resolveAmountCents, provider, resolveItems } = deps;
  const deactivateLinks = deps.deactivateLinks
    || ((links) => require('./paymentLinkDeactivation').deactivateAbandonedLinks(links, { paymentLinksModel, providerFor: () => provider }));
  if (!LINK_TYPES[type]) throw { httpStatus: 400, error: 'INVALID_TYPE', message: 'Type de lien invalide (deposit/balance/full).' };

  // touristTaxTotal is carried so the full-payment amount resolver has the tax even on the fallback row
  // (specs/public-online-payment.md — avoids a silent tax-free undercharge if the devis lookup misses).
  const r = database.prepare('SELECT id, kind, depositAmount, balanceAmount, finalPrice, touristTaxTotal, depositPaid, balancePaid FROM reservations WHERE id = ?').get(id);
  if (!r) throw { httpStatus: 404, error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' };
  // An échéance already collected is never billed twice (fixed at the 2026-10-27 spec review): the link
  // of a paid acompte or solde — or a full payment once either is in — is refused before any provider call.
  const paidBucket = { deposit: ['depositPaid'], balance: ['balancePaid'], full: ['depositPaid', 'balancePaid'] }[type]
    .some((flag) => Number(r[flag] || 0) === 1);
  if (paidBucket) throw { httpStatus: 409, error: 'ALREADY_PAID', message: 'Cette échéance est déjà perçue : aucun lien à créer.' };
  const amountCents = resolveAmountCents(id, type, r);
  if (amountCents <= 0) throw { httpStatus: 400, error: 'ZERO_AMOUNT', message: 'Montant nul pour ce type : devis ou réservation à vérifier.' };

  // Reuse the current open link of that type if there is one (avoid duplicates on a double-click) — but
  // ONLY if it still bills the current amount. If the devis was edited between two `pay` calls the stored
  // amount drifts; reusing the stale link would charge the old total yet book the stay as fully paid at
  // the new total. Retire the stale link and mint a fresh one at the correct amount.
  const existing = paymentLinksModel.findOpenForReservation(id, type);
  if (existing && existing.url) {
    if (Number(existing.amountCents) === Number(amountCents)) {
      return { id: existing.id, type, amountCents: existing.amountCents, url: existing.url, status: existing.status, providerLinkId: existing.providerLinkId, reused: true };
    }
    await require('./paymentLinkDeactivation').assertNotPaid(existing, provider);
    await deactivateLinks([paymentLinksModel.updateStatus(existing.id, 'cancelled')]);
  }

  // Build the VAT basket when the caller can split the amount; only trust it when the components sum to
  // the exact charge (else fall back to the safe single 0 %-VAT line — the total must never drift).
  const linkArgs = { title: LINK_TITLES[type], amountCents };
  if (typeof resolveItems === 'function') {
    let built = null;
    try { built = resolveItems(id, type, r); } catch { built = null; }
    if (built && Array.isArray(built.components)) {
      enrichStayComponent(database, id, type, built.components);
      const { items, expectedTotalCents } = buildVatItems(built);
      if (expectedTotalCents === amountCents && items.length) {
        linkArgs.items = items;
        linkArgs.expectedTotalCents = expectedTotalCents;
      }
    }
  }
  // specs/qonto-payment-link-reference.md rule 10 — the single 0 % line is named like the stay line.
  if (!linkArgs.items) {
    const single = [{ title: LINK_TITLES[type] }];
    enrichStayComponent(database, id, type, single);
    linkArgs.title = single[0].title;
  }
  if (deps.redirectUrl) linkArgs.redirectUrl = deps.redirectUrl;
  const link = await provider.createLink(linkArgs, { origin: deps.origin || 'manual-link' });
  const row = paymentLinksModel.create({
    reservationId: id, type, amountCents,
    provider: provider.id, providerLinkId: link.id, url: link.url, status: link.status, expiresAt: link.expiresAt || null,
  });
  return { id: row.id, type, amountCents, url: link.url, status: link.status, providerLinkId: link.id, reused: false };
}

// specs/direct-installments.md rule 17 — the link of ONE installment, at its exact amount. The open link of
// that installment is reused while it bills the current amount; a stale one is retired and deactivated at
// the provider before the new one is minted, so the old URL can no longer be paid.
//   deps: ensurePaymentLink deps + { installmentsModel }
// Rule 40 — one installment is asked for at a time: two clicks (or a click and a queue entry) on the same
// installment run one after the other, so the second finds the first's link and mints nothing.
const installmentLocks = new Map();
async function withInstallmentLock(installmentId, work) {
  const previous = installmentLocks.get(installmentId) || Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  const tail = run.catch(() => {});
  installmentLocks.set(installmentId, tail);
  try { return await run; } finally { if (installmentLocks.get(installmentId) === tail) installmentLocks.delete(installmentId); }
}

function ensureInstallmentLink(deps, id, installmentId) {
  return withInstallmentLock(Number(installmentId), () => mintInstallmentLink(deps, id, installmentId));
}

async function mintInstallmentLink(deps, id, installmentId) {
  const { database, paymentLinksModel, provider, installmentsModel } = deps;
  const deactivateLinks = deps.deactivateLinks
    || ((links) => require('./paymentLinkDeactivation').deactivateAbandonedLinks(links, { paymentLinksModel, providerFor: () => provider }));

  const installment = installmentsModel.findById(installmentId);
  if (!installment || Number(installment.reservationId) !== Number(id)) {
    throw { httpStatus: 404, error: 'INSTALLMENT_NOT_FOUND', message: 'Échéance introuvable.' };
  }
  if (Number(installment.paid) === 1) throw { httpStatus: 409, error: 'INSTALLMENT_PAID', message: 'Cette échéance est déjà payée.' };
  const reservation = database.prepare('SELECT kind FROM reservations WHERE id = ?').get(Number(id));
  if (!reservation || reservation.kind !== 'reservation') {
    throw { httpStatus: 404, error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' };
  }
  const amountCents = Number(installment.amountCents);
  if (amountCents <= 0) throw { httpStatus: 400, error: 'ZERO_AMOUNT', message: 'Montant nul pour cette échéance.' };

  const existing = paymentLinksModel.findOpenForInstallment(installmentId);
  if (existing && existing.url) {
    if (Number(existing.amountCents) === amountCents) {
      return { id: existing.id, type: 'installment', amountCents, url: existing.url, status: existing.status, providerLinkId: existing.providerLinkId, reused: true };
    }
    await require('./paymentLinkDeactivation').assertNotPaid(existing, provider);
    await deactivateLinks([paymentLinksModel.updateStatus(existing.id, 'cancelled')]);
  }

  const plan = installmentsModel.listFor(id);
  const title = `${LINK_TITLES.installment} ${installment.number}/${plan.length}`;
  const linkArgs = { title, amountCents };
  // Rule 39 — the VAT basket of a share of the stay, the tourist tax exempt; only trusted when it sums to the charge.
  let built = null;
  if (typeof deps.resolveInstallmentItems === 'function') {
    try { built = deps.resolveInstallmentItems(id, installment, plan); } catch { built = null; }
  }
  if (built && Array.isArray(built.components)) {
    enrichStayComponent(database, id, 'installment', built.components);
    const { items, expectedTotalCents } = buildVatItems(built);
    if (expectedTotalCents === amountCents && items.length) {
      linkArgs.items = items;
      linkArgs.expectedTotalCents = expectedTotalCents;
    }
  }
  if (!linkArgs.items) {
    const single = [{ title }];
    enrichStayComponent(database, id, 'installment', single);
    linkArgs.title = single[0].title;
  }
  if (deps.redirectUrl) linkArgs.redirectUrl = deps.redirectUrl;
  const link = await provider.createLink(linkArgs, { origin: deps.origin || 'manual-link' });
  // Rule 35 — the plan was resized or removed while the provider answered: that link bills nothing real.
  const still = installmentsModel.findById(installmentId);
  if (!still || Number(still.paid) === 1 || Number(still.amountCents) !== amountCents) {
    try { await provider.cancelLink(link.id); } catch { /* nothing references it: at worst a stray link */ }
    throw { httpStatus: 409, error: 'INSTALLMENT_CHANGED', message: 'L’échéance a changé pendant la création du lien : réessayer.' };
  }
  const row = paymentLinksModel.create({
    reservationId: id, type: 'installment', installmentId: Number(installmentId), amountCents,
    provider: provider.id, providerLinkId: link.id, url: link.url, status: link.status, expiresAt: link.expiresAt || null,
  });
  return { id: row.id, type: 'installment', amountCents, url: link.url, status: link.status, providerLinkId: link.id, reused: false };
}

// Create/reuse the installment's link AND email the `installment_request` template with it (rule 20: the
// click on the fiche is the validation). `sendTemplate` also receives the installment and its occurrence key.
async function sendInstallmentRequest(deps, id, installmentId) {
  // Rule 40 — a request already leaving for this installment is not sent twice.
  if (sendingNow.has(Number(installmentId))) {
    return { httpStatus: 409, body: { error: 'REQUEST_IN_PROGRESS', message: 'Une demande est déjà en cours pour cette échéance.' } };
  }
  sendingNow.add(Number(installmentId));
  try {
    return await doSendInstallmentRequest(deps, id, installmentId);
  } finally {
    sendingNow.delete(Number(installmentId));
  }
}
const sendingNow = new Set();

async function doSendInstallmentRequest(deps, id, installmentId) {
  const link = await ensureInstallmentLink(deps, id, installmentId);
  const installment = deps.installmentsModel.findById(installmentId);
  const result = await deps.sendTemplate({
    reservationId: id,
    stableKey: REQUEST_TEMPLATES.installment,
    paymentLink: link.url,
    amountCents: link.amountCents,
    installment,
  });
  if (!result.sent) {
    const map = {
      'no-email':       { s: 400, m: "Le client n'a pas d'adresse email." },
      'no-reservation': { s: 404, m: 'Réservation introuvable.' },
      'no-template':    { s: 500, m: `Template « ${REQUEST_TEMPLATES.installment} » manquant.` },
    };
    const e = map[result.reason] || { s: 502, m: `Envoi du mail impossible : ${result.reason}` };
    return { httpStatus: e.s, body: { error: 'EMAIL_NOT_SENT', reason: result.reason, message: e.m, type: 'installment', url: link.url, amountCents: link.amountCents } };
  }
  deps.installmentsModel.markRequested(installmentId, new Date().toISOString());
  return { httpStatus: 200, body: { sent: true, type: 'installment', url: link.url, amountCents: link.amountCents, emailLogId: result.emailLogId, recipientEmail: result.recipientEmail } };
}

// Create/reuse the link AND email the matching `<type>_request` template to the guest.
//   deps: ensurePaymentLink deps + { sendTemplate({ reservationId, stableKey, paymentLink, amountCents }) → senderResult }
// `requestedType` may be omitted: the type is then resolved from the record (rule 10). The resolved
// type travels back in the body so the UI can name what it actually sent.
async function sendPaymentRequest(deps, id, requestedType) {
  const row = deps.database.prepare('SELECT id, depositAmount FROM reservations WHERE id = ?').get(id);
  if (!row) return { httpStatus: 404, body: { error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' } };

  const type = resolveRequestType(row, requestedType);
  const stableKey = REQUEST_TEMPLATES[type];
  if (!stableKey) return { httpStatus: 400, body: { error: 'INVALID_TYPE', message: 'Type de demande invalide (deposit/balance/full).' } };

  const link = await ensurePaymentLink(deps, id, type); // {httpStatus} throw bubbles to the controller
  const result = await deps.sendTemplate({ reservationId: id, stableKey, paymentLink: link.url, amountCents: link.amountCents });

  if (!result.sent) {
    const map = {
      'no-email':       { s: 400, m: "Le client n'a pas d'adresse email." },
      'no-reservation': { s: 404, m: 'Réservation introuvable.' },
      'no-template':    { s: 500, m: `Template « ${stableKey} » manquant.` },
    };
    const e = map[result.reason] || { s: 502, m: `Envoi du mail impossible : ${result.reason}` };
    return { httpStatus: e.s, body: { error: 'EMAIL_NOT_SENT', reason: result.reason, message: e.m, type, url: link.url, amountCents: link.amountCents } };
  }
  return { httpStatus: 200, body: { sent: true, type, url: link.url, amountCents: link.amountCents, emailLogId: result.emailLogId, recipientEmail: result.recipientEmail } };
}

module.exports = {
  ensurePaymentLink, sendPaymentRequest, ensureInstallmentLink, sendInstallmentRequest, resolveRequestType, LINK_TYPES, LINK_TITLES, REQUEST_TEMPLATES,
};
