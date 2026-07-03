/**
 * Public online full-payment controller (specs/public-online-payment.md §3). Two server-to-server
 * routes (the WordPress proxy calls them with the public API key):
 *   - `pay`    : create/reuse the Qonto FULL link for a public devis (availability re-checked, engine
 *                amount, return URL allowlisted) → { paymentUrl, amountCents }.
 *   - `status` : on-demand poll of the devis's link → pending | paid | confirmed | conflict (+ recap).
 *
 * Confirmation itself (convert devis → block dates → confirmation email) is the shared `processPaidLink`
 * effect, driven primarily by the Qonto webhook and reconciled here on demand.
 */

const db = require('../../database');
const devisModel = require('../../models/devisModel');
const paymentLinksModel = require('../../models/paymentLinksModel');
const { buildQontoClient } = require('../../utils/qontoClient');
const { getValidQontoAccessToken } = require('../../utils/qontoAuth');
const { ensurePaymentLink } = require('../../utils/paymentRequestService');
const { processPaidLink } = require('../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../utils/paymentEffectDeps');
const { fullPaymentCents, fullPaymentComponents } = require('../../utils/devisQuote');
const { resolvePublicPaymentMode, depositPaymentCents, depositPaymentComponents } = require('../../utils/publicPaymentMode');
const { tokensMatch } = require('../../utils/publicDevisToken');
const { calculateReservationQuote } = require('../../utils/pricing');
const settingsModel = require('../../models/settingsModel');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { ok, fail } = require('./publicHttp');

// Build the site success URL from the configured site origin + a caller-supplied path. Allowlisted to
// the origin to prevent open redirects; returns '' (no redirect) when unset/invalid.
function buildReturnUrl(returnPath) {
  const origin = String(process.env.PUBLIC_SITE_ORIGIN || '').trim().replace(/\/+$/, '');
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

async function pay(req, res) {
  const id = Number(req.params.id);
  const token = req.body && req.body.token;
  const { row, error } = loadPublicDevis(id, token);
  if (error === 'not_found') return fail(res, 404, 'DEVIS_NOT_FOUND', 'Devis introuvable.');
  if (error === 'already_converted') return fail(res, 409, 'ALREADY_CONFIRMED', 'Cette réservation est déjà confirmée.');

  // Re-check availability — nothing is paid yet, so we can still refuse cleanly.
  const blocked = computeBlockedDates(row.propertyId, row.startDate, row.endDate);
  if (rangeHasBlockedNight(row.startDate, row.endDate, blocked)) {
    return fail(res, 409, 'DATES_UNAVAILABLE', 'Ces dates ne sont plus disponibles.');
  }

  // Server-decided mode (specs/public-online-deposit.md): 'deposit' charges the stored acompte now (solde
  // by a later emailed link); 'full' charges the whole stay. The client never chooses.
  const mode = resolvePublicPaymentMode(db, row.propertyId, depositPaymentCents(db, id, row));
  const linkType = mode === 'deposit' ? 'deposit' : 'full';

  // If the property's mode flipped between the quote and this pay, retire an open link of the OTHER
  // public type so the guest can't pay the stale one and we don't leave a dangling open link.
  const stale = paymentLinksModel.findOpenForReservation(id, linkType === 'deposit' ? 'full' : 'deposit');
  if (stale && stale.url) paymentLinksModel.updateStatus(stale.id, 'cancelled');

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
      createLink: ({ title, amountCents, items, expectedTotalCents }) => withAccessToken((client, at) =>
        client.createPaymentLink({ accessToken: at, title, amountCents, items, expectedTotalCents, redirectUrl: redirectUrl || undefined })),
    }, id, linkType);
    return ok(res, { paymentUrl: link.url, amountCents: link.amountCents, currency: 'EUR', status: link.status, paymentMode: mode });
  } catch (err) {
    if (err && err.httpStatus) return fail(res, err.httpStatus, err.error || 'PAYMENT_LINK_FAILED', err.message || 'Lien de paiement impossible.');
    return fail(res, 502, 'QONTO_API_ERROR', 'Erreur du fournisseur de paiement.');
  }
}

async function withAccessToken(fn) {
  const accessToken = await getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient });
  return fn(buildQontoClient(), accessToken);
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

async function status(req, res) {
  const id = Number(req.params.id);
  const token = req.query && req.query.token;
  const { row, error } = loadPublicDevis(id, token);
  if (error === 'not_found') return fail(res, 404, 'DEVIS_NOT_FOUND', 'Devis introuvable.');

  const asConfirmed = (rid) => {
    const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
    return ok(res, { status: r && r.bookingConflictAt ? 'conflict' : 'confirmed', ...recap(r) });
  };
  // Already confirmed (by the webhook / a prior poll)? loadPublicDevis tags it `already_converted`.
  if (error === 'already_converted') return asConfirmed(row.convertedReservationId);

  // On-demand reconciliation: if the devis's open link (deposit OR full, per the property's mode) is paid
  // at Qonto but not yet processed, process it now (best-effort) so the success page sees `confirmed`
  // without waiting for the cron.
  const mode = resolvePublicPaymentMode(db, row.propertyId, depositPaymentCents(db, id, row));
  const link = paymentLinksModel.findOpenForReservation(id, mode)
    || paymentLinksModel.findOpenForReservation(id, mode === 'deposit' ? 'full' : 'deposit');
  if (link && link.qontoPaymentLinkId) {
    try {
      const accessToken = await getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient });
      const pay = await buildQontoClient().getPaymentLinkPayments({ accessToken, id: link.qontoPaymentLinkId });
      if (pay.paid) {
        await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: pay.paidPayment });
        const reloaded = db.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(id);
        if (reloaded && reloaded.convertedReservationId) return asConfirmed(reloaded.convertedReservationId);
        return ok(res, { status: 'paid' });
      }
    } catch (e) { /* best-effort — fall through to pending */ }
  }
  return ok(res, { status: 'pending' });
}

module.exports = { pay, status, __test: { buildReturnUrl } };
