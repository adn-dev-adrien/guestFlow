/**
 * Public online full-payment controller (specs/public-online-payment.md §3). Two server-to-server
 * routes (the WordPress proxy calls them with the public API key):
 *   - `pay`    : create/reuse the FULL (or deposit) link for a public devis (availability re-checked,
 *                engine amount, return URL allowlisted) → { paymentUrl, amountCents }.
 *   - `status` : on-demand poll of the devis's link → pending | paid | confirmed | conflict | cancelled |
 *                expired (+ recap).
 *
 * Confirmation itself (convert devis → block dates → confirmation email) is the shared `processPaidLink`
 * effect, driven primarily by the provider's webhook and reconciled here on demand. The link comes from
 * the active payment provider (specs/plugins-phase-3a-online-payment.md rule 4); the answers are the
 * WordPress contract and do not change — `QONTO_API_ERROR` included, through `provider.errorCode`.
 */

const db = require('../../database');
const devisModel = require('../../models/devisModel');
const paymentLinksModel = require('../../models/paymentLinksModel');
const paymentProviders = require('../../utils/paymentProviders');
const { retireOpenLink } = require('../../utils/paymentLinkDeactivation');
const { ensurePaymentLink } = require('../../utils/paymentRequestService');
const { processPaidLink, retryPendingCancellations } = require('../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../utils/paymentEffectDeps');
const { fullPaymentCents, fullPaymentComponents } = require('../../utils/devisQuote');
const { resolvePublicPaymentMode, depositPaymentCents, depositPaymentComponents } = require('../../utils/publicPaymentMode');
const { tokensMatch } = require('../../utils/publicDevisToken');
const { calculateReservationQuote, calculateBaseStayPrice } = require('../../utils/pricing');
const { checkChangeover } = require('../../utils/changeover');
const settingsModel = require('../../models/settingsModel');
const { computeBlockedDates, rangeHasBlockedNight } = require('../../utils/blockedDates');
const { ok, fail, failT } = require('./publicHttp');

// Build the site success URL from the configured site origin + a caller-supplied path. Allowlisted to
// the origin to prevent open redirects; returns '' (no redirect) when unset/invalid.
function buildReturnUrl(returnPath) {
  const origin = settingsModel.publicSiteOrigin();
  if (!origin) return '';
  const path = String(returnPath || '/').trim();
  // Only a same-origin path: must start with a single '/'. Reject protocol-relative ('//host') and full
  // URLs ('https://…') — both are open-redirect vectors.
  if (!path.startsWith('/') || path.startsWith('//')) return '';
  return `${origin}${path}`;
}

// Load a devis eligible for the public payment flow, gated on the per-devis capability token, or an
// error tag. A bad id or a wrong/missing token is indistinguishable from "not found" so the sequential
// row id can't be enumerated (specs/public-online-payment.md §7).
function loadPublicDevis(id, token) {
  if (!Number.isInteger(id) || id <= 0) return { error: 'not_found' };
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!row || row.kind !== 'devis' || row.requestOrigin !== 'public') return { error: 'not_found' };
  if (!tokensMatch(row.publicToken, token)) return { error: 'not_found' };
  if (row.convertedReservationId) return { error: 'already_converted', row };
  return { row };
}

/**
 * The stay rule the saved devis breaks today, as `[code, messageKey, ...args]` for `failT`, or null.
 * Same order and wording as the booking request (website-booking publicProjections.stayRuleBreach):
 * the rules may have changed since the request, and nothing is paid yet (fixed at the 2026-10-27
 * audit). An exception the operator grants is sent as a payment link from the fiche, never through
 * this route.
 */
function stayRuleRefusal(row) {
  const rules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(row.propertyId);
  const base = calculateBaseStayPrice(rules, row.startDate, row.endDate);
  if (base.minNightsBreached) return ['MIN_NIGHTS', 'minNights', Number(base.requiredMinNights || 0)];
  if (base.maxNightsBreached) return ['MAX_NIGHTS', 'maxNights', Number(base.requiredMaxNights || 0)];
  const changeover = checkChangeover(rules, row.startDate, row.endDate);
  if (changeover.breached) {
    return ['CHANGEOVER', 'changeover',
      changeover.arrivalBreached ? changeover.requiredArrivalWeekday : null,
      changeover.departureBreached ? changeover.requiredDepartureWeekday : null];
  }
  return null;
}

// Without a provider plugin the routes answer the envelope they answered while online payment was off
// (rule 5). A provider that is live but not connected still answers, and fails like it always did.
function requireProvider(req, res, next) {
  const provider = paymentProviders.declared();
  if (provider) return next();
  return res.status(404).json({ error: 'PLUGIN_INACTIVE', plugin: 'online-payment' });
}

async function pay(req, res) {
  const id = Number(req.params.id);
  const provider = paymentProviders.declared();
  const token = req.body && req.body.token;
  const { row, error } = loadPublicDevis(id, token);
  if (error === 'not_found') return failT(res, req, 404, 'DEVIS_NOT_FOUND', 'devisNotFound');
  if (error === 'already_converted') return failT(res, req, 409, 'ALREADY_CONFIRMED', 'alreadyConfirmed');

  // Re-check availability — nothing is paid yet, so we can still refuse cleanly.
  const blocked = computeBlockedDates(row.propertyId, row.startDate, row.endDate);
  if (rangeHasBlockedNight(row.startDate, row.endDate, blocked)) {
    return failT(res, req, 409, 'DATES_UNAVAILABLE', 'datesUnavailable');
  }
  const ruleRefusal = stayRuleRefusal(row);
  if (ruleRefusal) {
    const [code, key, ...args] = ruleRefusal;
    return failT(res, req, 409, code, key, undefined, ...args);
  }

  // Server-decided mode (specs/public-online-deposit.md): 'deposit' charges the stored acompte now (solde
  // by a later emailed link); 'full' charges the whole stay. The client never chooses.
  const mode = resolvePublicPaymentMode(db, row.propertyId, depositPaymentCents(db, id, row));
  const linkType = mode === 'deposit' ? 'deposit' : 'full';

  // If the property's mode flipped between the quote and this pay, retire an open link of the OTHER
  // public type so the guest can't pay the stale one and we don't leave a dangling open link.
  const stale = paymentLinksModel.findOpenForReservation(id, linkType === 'deposit' ? 'full' : 'deposit');
  if (stale && stale.url) {
    try {
      await retireOpenLink(stale, { paymentLinksModel, provider });
    } catch (refusal) {
      return res.status(refusal.httpStatus || 409).json({ error: refusal.error, message: refusal.message });
    }
  }

  const redirectUrl = buildReturnUrl(req.body && req.body.returnPath);
  try {
    const link = await ensurePaymentLink({
      database: db,
      paymentLinksModel,
      // Amount re-derived from the SAVED devis (never the client). Deposit = stored acompte column;
      // full = tax-inclusive stay total (unless the tax is collected on arrival).
      resolveAmountCents: (_id, _type, r) => (mode === 'deposit'
        ? depositPaymentCents(db, id, r)
        : fullPaymentCents({ database: db, devisModel, calc: calculateReservationQuote }, id, r)),
      // VAT basket so the Qonto/Mollie page shows the real TVA while charging exactly the resolved total
      // (specs/payment-links-vat.md). Deposit is accommodation-only (single taxable line).
      resolveItems: (_id, _type, r) => (mode === 'deposit'
        ? depositPaymentComponents(db, id, r)
        : fullPaymentComponents({ database: db, devisModel, calc: calculateReservationQuote }, id, r)),
      provider,
      redirectUrl: redirectUrl || undefined,
      origin: 'public-payment',
    }, id, linkType);
    return ok(res, { paymentUrl: link.url, amountCents: link.amountCents, currency: 'EUR', status: link.status, paymentMode: mode });
  } catch (err) {
    // The provider's own wording is passed through untranslated — it is a diagnostic string, not a
    // sentence we wrote. Only OUR fallback follows the visitor's language.
    if (err && err.httpStatus) {
      return err.message
        ? fail(res, err.httpStatus, err.error || 'PAYMENT_LINK_FAILED', err.message)
        : failT(res, req, err.httpStatus, err.error || 'PAYMENT_LINK_FAILED', 'paymentProviderError');
    }
    return failT(res, req, 502, provider.errorCode, 'paymentProviderError');
  }
}

// Minimal, non-PII recap of a confirmed booking. When only the acompte was collected online (deposit
// mode: balancePaid=0 with a positive balance), a `payment` block surfaces the balance still due so the
// success page can show « Acompte payé — solde à régler avant le … ».
function recap(reservationRow) {
  const propertyName = (db.prepare('SELECT name FROM properties WHERE id = ?').get(reservationRow.propertyId) || {}).name || '';
  const finalPrice = Number(reservationRow.finalPrice || 0);
  const out = {
    reservationId: reservationRow.id,
    propertyName,
    startDate: reservationRow.startDate,
    endDate: reservationRow.endDate,
    finalPrice,
    // Tax-inclusive stay total — matches what the guest was charged online (the site displays this).
    totalStayPrice: Number((finalPrice + Number(reservationRow.touristTaxTotal || 0)).toFixed(2)),
  };
  const balanceAmount = Number(reservationRow.balanceAmount || 0);
  if (Number(reservationRow.balancePaid || 0) !== 1 && balanceAmount > 0) {
    out.payment = {
      mode: 'deposit',
      depositAmount: Number(reservationRow.depositAmount || 0),
      balanceAmount,
      balanceDueDate: reservationRow.balanceDueDate || null,
    };
  }
  return out;
}

// A link retired by the stay's own payment may have been paid anyway (the guest still holds its URL):
// settle it now, so the double payment is flagged while the guest is on the page. The page polls every few
// seconds, so a link is asked about at most once per OWED_RETRY_MINUTES (the webhook covers the rest), and a
// rate limit stops the loop (specs/payment-polling-fair-use.md).
const OWED_RETRY_MINUTES = 5;
async function settleOwedRetiredLinks(devisId) {
  const provider = paymentProviders.declared();
  if (!provider) return;
  try {
    const now = Date.now();
    const owed = paymentLinksModel.listForReservation(devisId)
      .filter((l) => l.status === 'cancelled' && l.remoteCancelPendingAt && l.providerLinkId && l.provider === provider.id)
      .filter((l) => !(Date.parse(l.lastPolledAt) > now - OWED_RETRY_MINUTES * 60 * 1000));
    for (const l of owed) {
      paymentLinksModel.touchPolled(l.id);
      const { stoppedBy } = await retryPendingCancellations({ ...buildPaymentEffectDeps(), provider, only: l.id });
      if (stoppedBy) break;
    }
  } catch (e) { /* best-effort — the poll retries */ }
}

// specs/payment-link-lifecycle.md rule 30 — a lapsed link may still have been paid (a payment in flight at
// its deadline): while its last look is pending, or for 24 h after it lapsed, the page reads it once per
// OWED_RETRY_MINUTES. No lapse timestamp is stored: a lapse writes its moment into `expiresAt` (rule 8);
// a stay-started lapse without one counts from 00:00 Paris on the arrival day (rule 9).
const LAPSED_READ_HOURS = 24;
function lapsedAtMs(link, devisRow) {
  const end = paymentLinksModel.knownExpiryMs(link.expiresAt);
  if (end != null) return end;
  if (link.cancelReason === 'stay-started' && devisRow.startDate) return new Date(`${String(devisRow.startDate).slice(0, 10)}T00:00:00`).getTime();
  return null;
}

function lapsedReadDue(link, devisRow, nowMs) {
  if (Date.parse(link.lastPolledAt) > nowMs - OWED_RETRY_MINUTES * 60 * 1000) return false;
  const { lastLookAt } = db.prepare('SELECT lastLookAt FROM payment_links WHERE id = ?').get(link.id) || {};
  if (lastLookAt) return true;
  const lapsedMs = lapsedAtMs(link, devisRow);
  return lapsedMs != null && nowMs - lapsedMs < LAPSED_READ_HOURS * 60 * 60 * 1000;
}

function lookOwed(link) {
  const row = db.prepare('SELECT lastLookAt, remoteCancelPendingAt FROM payment_links WHERE id = ?').get(link.id) || {};
  return Boolean(row.lastLookAt || row.remoteCancelPendingAt);
}

// The devis's latest link, when it lapsed: booked here if the provider says it was paid.
async function readLapsedLink(devisRow) {
  const latest = paymentLinksModel.listForReservation(devisRow.id)[0];
  if (!latest || latest.status !== 'expired') return null;
  const provider = paymentProviders.declared();
  if (!provider || !latest.providerLinkId || latest.provider !== provider.id || !lapsedReadDue(latest, devisRow, Date.now())) return latest;
  try {
    paymentLinksModel.touchPolled(latest.id);
    const pay = await provider.getPayment(latest.providerLinkId, { origin: 'public-payment' });
    if (pay.paid) await processPaidLink({ ...buildPaymentEffectDeps(), link: latest, paidPayment: pay });
  } catch (e) { /* best-effort — the lifecycle pass reads it too */ }
  return paymentLinksModel.findById(latest.id);
}

async function status(req, res) {
  const id = Number(req.params.id);
  const token = req.query && req.query.token;
  const { row, error } = loadPublicDevis(id, token);
  if (error === 'not_found') return failT(res, req, 404, 'DEVIS_NOT_FOUND', 'devisNotFound');

  const asConfirmed = (rid) => {
    const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
    // The stay the devis became was cancelled: the page must not claim a confirmed booking.
    if (r && r.kind === 'cancelled') return ok(res, { status: 'cancelled' });
    return ok(res, { status: r && r.bookingConflictAt ? 'conflict' : 'confirmed', ...recap(r) });
  };
  // Already confirmed (by the webhook / a prior poll)? loadPublicDevis tags it `already_converted`.
  if (error === 'already_converted') {
    await settleOwedRetiredLinks(id);
    return asConfirmed(row.convertedReservationId);
  }

  // On-demand reconciliation: if the devis's open link (deposit OR full, per the property's mode) is paid
  // at Qonto but not yet processed, process it now (best-effort) so the success page sees `confirmed`
  // without waiting for the cron.
  const mode = resolvePublicPaymentMode(db, row.propertyId, depositPaymentCents(db, id, row));
  const link = paymentLinksModel.findOpenForReservation(id, mode)
    || paymentLinksModel.findOpenForReservation(id, mode === 'deposit' ? 'full' : 'deposit');
  const provider = paymentProviders.declared();
  if (link && link.providerLinkId && provider && link.provider === provider.id) {
    try {
      // Exempt from the poll cadence (the guest is waiting on this page), but the call still counts
      // towards it (specs/payment-polling-fair-use.md rules 4 and 10). The provider records a failure
      // where the operator reads it (specs/qonto-settings-in-app.md §3 rule 14).
      paymentLinksModel.touchPolled(link.id);
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'public-payment' });
      if (pay.paid) {
        await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: pay });
        const reloaded = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(id);
        if (reloaded && reloaded.convertedReservationId) return asConfirmed(reloaded.convertedReservationId);
        return ok(res, { status: 'paid' });
      }
    } catch (e) { /* best-effort — fall through to pending */ }
  }
  const lapsed = link ? null : await readLapsedLink(row);
  await settleOwedRetiredLinks(id);
  const converted = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(id);
  if (converted && converted.convertedReservationId) return asConfirmed(converted.convertedReservationId);
  // Rule 30 — nothing open and the latest link lapsed unpaid: the page stops waiting (additive value). Unpaid
  // is established only once no look is owed: while the deactivation or the last look is pending, a payment
  // in flight at the deadline may still land, so the page keeps waiting (review of #897).
  if (lapsed && lapsed.status === 'expired') return ok(res, { status: lookOwed(lapsed) ? 'pending' : 'expired' });
  if (lapsed && lapsed.status === 'paid') return ok(res, { status: 'paid' });
  return ok(res, { status: 'pending' });
}

module.exports = { pay, status, requireProvider, __test: { buildReturnUrl } };
