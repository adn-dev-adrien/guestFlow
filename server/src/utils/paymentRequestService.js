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
const { refusalForKind } = require('./reservationReadOnly');
const { buildStayLineLabel } = require('./paymentLinkLabel');
const { ENGLISH_VERSION_MISSING, ENGLISH_VERSION_MISSING_PAYMENT_ACTION } = require('./emailTemplateLanguage');
const { validityOf, validityEnd, lapsesAtArrival } = require('./paymentLinkLifecycle');
const { LINK_REASONS } = require('../constants/paymentLinks');
const { closedDatesRefusal } = require('./closedStayDates');
const { datesTakenRefusal } = require('./datesTaken');
const { unsettledWithdrawnRefusal } = require('./withdrawnPayments');
const { platformStayRefusal } = require('./platformStayRefusal');

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
  if (asked) return Object.hasOwn(LINK_TYPES, asked) ? asked : null;
  return Number((row && row.depositAmount) || 0) > 0 ? 'deposit' : 'full';
}

const PAID_FLAGS = { deposit: ['depositPaid'], balance: ['balancePaid'], full: ['depositPaid', 'balancePaid'] };
// The paid flags are read from the database, and from the stay a devis became (its own flags stay 0 after
// the conversion). Read again after a provider round trip: the bucket may have been collected meanwhile.
function assertBucketOpen(database, id, type) {
  const own = database.prepare('SELECT depositPaid, balancePaid, convertedReservationId FROM reservations WHERE id = ?').get(id) || {};
  const stay = own.convertedReservationId
    ? database.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(own.convertedReservationId) : null;
  const paid = PAID_FLAGS[type].some((flag) => Number(own[flag] || 0) === 1 || Number(stay && stay[flag] || 0) === 1);
  if (paid) throw { httpStatus: 409, error: 'ALREADY_PAID', message: 'Cette échéance est déjà perçue : aucun lien à créer.' };
}

// Resolve a usable payment link for (reservation, type): reuse the current open one or create it.
//   deps: { database, paymentLinksModel, resolveAmountCents, provider (utils/paymentProviders),
//           resolveItems?(id, type, row) → { components, vatRatePercent } | null, deactivateLinks?(links), now?() → Date,
//           paymentEffect?() → the processPaidLink deps (utils/paymentEffectDeps by default) }
// `provider.createLink` returns { id, url, status, expiresAt }; a stale link is deactivated at the
// provider, not only closed here (specs/plugins-phase-3a-online-payment.md rule 7).
// When resolveItems yields components, the link is created as a VAT basket (specs/payment-links-vat.md):
// Qonto shows the real TVA while the charged total stays exactly amountCents. Absent/mismatched → the
// legacy single 0 %-VAT line (total-only) is used, so the charged amount is never at risk.
// specs/payment-link-lifecycle.md rule 8 (re-review of #897) — one lock per stay, whatever the type: an acompte
// link and a full link settle the same acompte, and each retires the other while waiting on the provider, so
// two of them minted side by side could both stay open. A devis and the reservation it became share the key.
function assertNoUnsettledPayment(database, id) {
  const unsettled = unsettledWithdrawnRefusal(database, id);
  if (unsettled) throw unsettled;
}

function stayLockKey(database, id) {
  let row = null;
  try { row = database.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(Number(id)); } catch { row = null; }
  return `reservation:${Number((row && row.convertedReservationId) || id)}`;
}

function ensurePaymentLink(deps, id, type) {
  return withLinkLock(stayLockKey(deps.database, id), () => mintPaymentLink(deps, id, type));
}

async function mintPaymentLink(deps, id, type) {
  const { database, paymentLinksModel, resolveAmountCents, provider, resolveItems } = deps;
  const deactivateLinks = deps.deactivateLinks
    || ((links) => require('./paymentLinkDeactivation').deactivateAbandonedLinks(links, { paymentLinksModel, providerFor: () => provider }));
  if (!Object.hasOwn(LINK_TYPES, type)) throw { httpStatus: 400, error: 'INVALID_TYPE', message: 'Type de lien invalide (deposit/balance/full).' };

  // touristTaxTotal is carried so the full-payment amount resolver has the tax even on the fallback row
  // (specs/public-online-payment.md — avoids a silent tax-free undercharge if the devis lookup misses).
  const r = database.prepare('SELECT id, kind, depositAmount, balanceAmount, finalPrice, touristTaxTotal, depositPaid, balancePaid FROM reservations WHERE id = ?').get(id);
  if (!r) throw { httpStatus: 404, error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' };
  // Defence in depth behind the route guards (specs/calendar-property-parity.md rule 25): no link, so no
  // provider call, for a cancelled stay or a duplicate set aside — whoever the caller is (a devis is fine).
  const closed = refusalForKind(r.kind);
  if (closed) throw { httpStatus: closed.status, error: closed.body.code, message: closed.body.error };
  // specs/payment-link-lifecycle.md rule 57 — a platform stay is paid by its platform: no link, new or reused.
  const platformOwned = platformStayRefusal(database, id);
  if (platformOwned) throw platformOwned;
  // An échéance already collected is never billed twice (fixed at the 2026-10-27 spec review): the link
  // of a paid acompte or solde — or a full payment once either is in — is refused before any provider call.
  assertBucketOpen(database, id, type);
  // specs/payment-link-lifecycle.md rule 55 — no link, new or reused, on nights the establishment is closed.
  const closedNights = closedDatesRefusal(database, id);
  if (closedNights) throw closedNights;
  // Rule 11 — an unpaid row whose nights a stay holding its dates took gets no link, new or reused.
  const taken = datesTakenRefusal(database, id);
  if (taken) throw taken;
  // Rule 56 — a payment received on a link withdrawn by hand is settled before any new request.
  assertNoUnsettledPayment(database, id);
  const amountCents = resolveAmountCents(id, type, r);
  if (amountCents <= 0) throw { httpStatus: 400, error: 'ZERO_AMOUNT', message: 'Montant nul pour ce type : devis ou réservation à vérifier.' };

  // Reuse the current open link of that type if there is one (avoid duplicates on a double-click) — but
  // ONLY if it still bills the current amount. If the devis was edited between two `pay` calls the stored
  // amount drifts; reusing the stale link would charge the old total yet book the stay as fully paid at
  // the new total. Retire the stale link and mint a fresh one at the correct amount.
  // specs/payment-link-lifecycle.md rule 8 — nor once it has less than 24 hours left: it lapses (reason
  // `validity`) and the guest gets a fresh link with its full 36 hours. Rule 51 — nor when the stay has begun
  // and rule 9 lapses it at the next pass (reason `stay-started`).
  const now = mintClock(deps);
  const existing = paymentLinksModel.findOpenForStay(id, type);
  if (existing && existing.url) {
    const sameAmount = Number(existing.amountCents) === Number(amountCents);
    const validity = validityOf(existing, now);
    const arrived = lapsesAtArrival(database, existing, now);
    if (sameAmount && validity.reusable && !arrived) {
      return { id: existing.id, type, amountCents: existing.amountCents, url: existing.url, status: existing.status, providerLinkId: existing.providerLinkId, expiresAt: validity.expiresAt, reused: true };
    }
    await retireOrBook(deps, existing, { paymentLinksModel, provider, deactivate: deactivateLinks, now, ...lapseReason(sameAmount, arrived) });
    assertBucketOpen(database, id, type);
  } else {
    const owners = require('./deletionGuard').withConvertedDevis(database, [Number(id)]);
    await bookOwedLapsedPayment(deps, `reservationId IN (${owners.map(() => '?').join(', ')}) AND type IN (${SETTLED_BY[type].map(() => '?').join(', ')})`, [...owners, ...SETTLED_BY[type]]);
    // Review of #902 (R2) — the reads above may have waited behind a pass that settled the bucket, and may have
    // found a withdrawn link paid after its withdrawal (rule 56).
    assertBucketOpen(database, id, type);
    assertNoUnsettledPayment(database, id);
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
  // An acompte link and a full link settle the same acompte: only one of them stays payable. The other is
  // retired once the new one exists, so a refused or failed mint never cancels a valid link.
  const otherType = { deposit: 'full', full: 'deposit' }[type];
  const otherOpen = otherType ? paymentLinksModel.findOpenForStay(id, otherType) : null;
  if (otherOpen && otherOpen.url) {
    try {
      await require('./paymentLinkDeactivation').retireOpenLink(otherOpen, { paymentLinksModel, provider, deactivate: deactivateLinks });
      assertBucketOpen(database, id, type);
    } catch (refusal) {
      try { await provider.cancelLink(link.id); } catch { /* nothing references it: at worst a stray link */ }
      throw refusal;
    }
  }
  const row = paymentLinksModel.create({
    reservationId: id, type, amountCents,
    provider: provider.id, providerLinkId: link.id, url: link.url, status: link.status, ...validityStamps(mintClock(deps)),
  });
  return { id: row.id, type, amountCents, url: link.url, status: link.status, providerLinkId: link.id, expiresAt: row.expiresAt, reused: false };
}

// Rule 6 — the 36 hours run from the row's creation, whatever the provider answers about its own expiry.
// `createdAt` is written like SQLite's datetime('now') (UTC, no zone), `expiresAt` as an ISO instant.
function validityStamps(createdAt = new Date()) {
  return { createdAt: createdAt.toISOString().replace('T', ' ').slice(0, 19), expiresAt: validityEnd(createdAt) };
}

// A same-amount link that cannot be reused lapses (rules 8, 51); one whose amount drifted is withdrawn.
function lapseReason(sameAmount, arrived) {
  if (!sameAmount) return {};
  return { reason: arrived ? LINK_REASONS.STAY_STARTED : LINK_REASONS.VALIDITY };
}

const mintClock = (deps) => (typeof deps.now === 'function' ? deps.now() : new Date());

// specs/payment-link-lifecycle.md rule 18 — a lapsed link the provider would not deactivate and reports paid
// is the guest's payment: booked here, on the path the lifecycle pass uses, and the request is refused. The
// fiche then reloads as paid, so a second click cannot mint a request for money already received.
const PAID_BOOKED = { httpStatus: 409, error: 'LINK_ALREADY_PAID', message: 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.' };
// The links whose payment settles the requested bucket (a full link pays the acompte and the solde).
const SETTLED_BY = { deposit: ['deposit', 'full'], balance: ['balance', 'full'], full: ['deposit', 'balance', 'full'] };

async function bookLapsedPayment(deps, link, payment) {
  const { processPaidLink } = require('./paymentPollRunner');
  const effect = typeof deps.paymentEffect === 'function' ? deps.paymentEffect() : require('./paymentEffectDeps').buildPaymentEffectDeps();
  await processPaidLink({ ...effect, database: deps.database, paymentLinksModel: deps.paymentLinksModel, link: deps.paymentLinksModel.findById(link.id) || link, paidPayment: payment });
  throw { ...PAID_BOOKED };
}

async function retireOrBook(deps, link, options) {
  try {
    await require('./paymentLinkDeactivation').retireOpenLink(link, options);
  } catch (err) {
    if (err && err.paidLapsed) await bookLapsedPayment(deps, err.paidLapsed.link, err.paidLapsed.payment);
    throw err;
  }
}

// A re-click before the lifecycle pass: the bucket's newest lapsed link still owed its deactivation is read
// first. Unreadable → refused like any replacement (a new link needs the provider anyway). Rule 58 — so is one
// still owed its last look (rule 19): the guest's payment may have landed after the deactivation read. An
// unpaid read leaves the look to the lifecycle pass.
async function bookOwedLapsedPayment(deps, where, params) {
  const owed = deps.database.prepare(`
    SELECT * FROM payment_links
     WHERE ${where} AND status = 'expired' AND (remoteCancelPendingAt IS NOT NULL OR lastLookAt IS NOT NULL) AND providerLinkId IS NOT NULL
     ORDER BY id DESC LIMIT 1
  `).get(...params);
  if (owed) {
    let pay;
    try {
      pay = await deps.provider.getPayment(owed.providerLinkId, { origin: 'replace-link' });
    } catch {
      throw { httpStatus: 502, error: 'PROVIDER_UNREACHABLE', message: 'Prestataire de paiement injoignable : réessayer.' };
    }
    if (pay && pay.paid) await bookLapsedPayment(deps, owed, pay);
  }
  await settleOwedOperatorLinks(deps, where, params);
}

// specs/payment-link-lifecycle.md rule 42 (re-review of #902, L6) — a link withdrawn by hand while the provider
// could not be read still owes its read: it goes through the poll's retry (booked when paid before its
// withdrawal, the rule-8 alert when paid after, deactivated when unpaid) before a new link of its bucket.
async function settleOwedOperatorLinks(deps, where, params) {
  const owed = deps.database.prepare(`
    SELECT id FROM payment_links
     WHERE ${where} AND status = 'cancelled' AND cancelReason = ? AND remoteCancelPendingAt IS NOT NULL AND providerLinkId IS NOT NULL
     ORDER BY id DESC
  `).all(...params, LINK_REASONS.OPERATOR);
  if (owed.length === 0) return;
  const { retryPendingCancellations } = require('./paymentPollRunner');
  const effect = typeof deps.paymentEffect === 'function' ? deps.paymentEffect() : require('./paymentEffectDeps').buildPaymentEffectDeps();
  for (const { id } of owed) {
    const { results } = await retryPendingCancellations({ ...effect, only: id, database: deps.database, paymentLinksModel: deps.paymentLinksModel, provider: deps.provider });
    const outcome = results.find((r) => Number(r.id) === Number(id));
    // Re-review of #902 (R2) — the row decides: the cron's pass may have booked it while this run waited behind it.
    const now = deps.paymentLinksModel.findById(id);
    if ((outcome && outcome.status === 'paid') || (now && now.status === 'paid')) throw { ...PAID_BOOKED };
    if (outcome && outcome.status === 'deactivation-pending') {
      throw { httpStatus: 502, error: 'PROVIDER_UNREACHABLE', message: 'Prestataire de paiement injoignable : réessayer.' };
    }
  }
}

// specs/direct-installments.md rule 17 — the link of ONE installment, at its exact amount. The open link of
// that installment is reused while it bills the current amount; a stale one is retired and deactivated at
// the provider before the new one is minted, so the old URL can no longer be paid.
//   deps: ensurePaymentLink deps + { installmentsModel }
// Rule 40 — one installment (and, for a reservation or devis, one link of the stay) is asked for at a time: two clicks (or a click and a queue entry) on the same
// installment run one after the other, so the second finds the first's link and mints nothing.
const linkLocks = new Map();
async function withLinkLock(key, work) {
  const previous = linkLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  const tail = run.catch(() => {});
  linkLocks.set(key, tail);
  try { return await run; } finally { if (linkLocks.get(key) === tail) linkLocks.delete(key); }
}

function ensureInstallmentLink(deps, id, installmentId) {
  return withLinkLock(`installment:${Number(installmentId)}`, () => mintInstallmentLink(deps, id, installmentId));
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
  const refusal = platformStayRefusal(database, id) || closedDatesRefusal(database, id) || datesTakenRefusal(database, id);
  if (refusal) throw refusal;
  assertNoUnsettledPayment(database, id);
  const amountCents = Number(installment.amountCents);
  if (amountCents <= 0) throw { httpStatus: 400, error: 'ZERO_AMOUNT', message: 'Montant nul pour cette échéance.' };

  const now = mintClock(deps);
  const existing = paymentLinksModel.findOpenForInstallment(installmentId);
  if (existing && existing.url) {
    const sameAmount = Number(existing.amountCents) === amountCents;
    const validity = validityOf(existing, now);
    const arrived = lapsesAtArrival(database, existing, now);
    if (sameAmount && validity.reusable && !arrived) {
      return { id: existing.id, type: 'installment', amountCents, url: existing.url, status: existing.status, providerLinkId: existing.providerLinkId, expiresAt: validity.expiresAt, reused: true };
    }
    await retireOrBook(deps, existing, { paymentLinksModel, provider, deactivate: deactivateLinks, now, ...lapseReason(sameAmount, arrived) });
  } else {
    await bookOwedLapsedPayment(deps, "type = 'installment' AND installmentId = ?", [Number(installmentId)]);
    const fresh = installmentsModel.findById(installmentId);
    if (fresh && Number(fresh.paid) === 1) throw { httpStatus: 409, error: 'INSTALLMENT_PAID', message: 'Cette échéance est déjà payée.' };
    assertNoUnsettledPayment(database, id);
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
    provider: provider.id, providerLinkId: link.id, url: link.url, status: link.status, ...validityStamps(mintClock(deps)),
  });
  return { id: row.id, type: 'installment', amountCents, url: link.url, status: link.status, providerLinkId: link.id, expiresAt: row.expiresAt, reused: false };
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

// specs/email-language-fr-en.md rule 12 — a mail that cannot leave (no English version for an English
// guest) is refused before any link is minted at the provider. `englishMissing` is optional in deps.
function englishMissingRefusal(deps, id, stableKey) {
  if (!deps.englishMissing || !deps.englishMissing({ reservationId: id, stableKey })) return null;
  return { httpStatus: 422, body: { error: ENGLISH_VERSION_MISSING, reason: ENGLISH_VERSION_MISSING, message: ENGLISH_VERSION_MISSING_PAYMENT_ACTION } };
}

async function doSendInstallmentRequest(deps, id, installmentId) {
  const refused = englishMissingRefusal(deps, id, REQUEST_TEMPLATES.installment);
  if (refused) return refused;
  const link = await ensureInstallmentLink(deps, id, installmentId);
  const installment = deps.installmentsModel.findById(installmentId);
  const result = await deps.sendTemplate({
    reservationId: id,
    stableKey: REQUEST_TEMPLATES.installment,
    paymentLink: link.url,
    amountCents: link.amountCents,
    expiresAt: link.expiresAt,
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
//   deps: ensurePaymentLink deps + { sendTemplate({ reservationId, stableKey, paymentLink, amountCents, expiresAt }) → senderResult }
// `requestedType` may be omitted: the type is then resolved from the record (rule 10). The resolved
// type travels back in the body so the UI can name what it actually sent.
async function sendPaymentRequest(deps, id, requestedType) {
  const row = deps.database.prepare('SELECT id, kind, depositAmount FROM reservations WHERE id = ?').get(id);
  if (!row) return { httpStatus: 404, body: { error: 'RESERVATION_NOT_FOUND', message: 'Réservation introuvable.' } };
  const closed = refusalForKind(row.kind);
  if (closed) return { httpStatus: closed.status, body: { error: closed.body.code, message: closed.body.error } };

  const type = resolveRequestType(row, requestedType);
  const stableKey = Object.hasOwn(REQUEST_TEMPLATES, type) ? REQUEST_TEMPLATES[type] : null;
  if (!stableKey) return { httpStatus: 400, body: { error: 'INVALID_TYPE', message: 'Type de demande invalide (deposit/balance/full).' } };

  const refused = englishMissingRefusal(deps, id, stableKey);
  if (refused) return refused;
  const link = await ensurePaymentLink(deps, id, type); // {httpStatus} throw bubbles to the controller
  const result = await deps.sendTemplate({ reservationId: id, stableKey, paymentLink: link.url, amountCents: link.amountCents, expiresAt: link.expiresAt });

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
