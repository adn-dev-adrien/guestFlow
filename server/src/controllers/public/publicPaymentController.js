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
const { fullPaymentCents } = require('../../utils/devisQuote');
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

// Load a devis that is eligible for the public payment flow, or an error tag.
function loadPublicDevis(id) {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
  if (!row || row.kind !== 'devis' || row.requestOrigin !== 'public') return { error: 'not_found' };
  if (row.convertedReservationId) return { error: 'already_converted', row };
  return { row };
}

async function pay(req, res) {
  const id = Number(req.params.id);
  const { row, error } = loadPublicDevis(id);
  if (error === 'not_found') return fail(res, 404, 'DEVIS_NOT_FOUND', 'Devis introuvable.');
  if (error === 'already_converted') return fail(res, 409, 'ALREADY_CONFIRMED', 'Cette réservation est déjà confirmée.');

  // Re-check availability — nothing is paid yet, so we can still refuse cleanly.
  const blocked = computeBlockedDates(row.propertyId, row.startDate, row.endDate);
  if (rangeHasBlockedNight(row.startDate, row.endDate, blocked)) {
    return fail(res, 409, 'DATES_UNAVAILABLE', 'Ces dates ne sont plus disponibles.');
  }

  const redirectUrl = buildReturnUrl(req.body && req.body.returnPath);
  try {
    const link = await ensurePaymentLink({
      database: db,
      paymentLinksModel,
      // Full stay total re-computed from the saved devis (never the client): tax-INCLUSIVE
      // (accommodation + options + resources + tourist tax), unless the tax is collected on arrival.
      resolveAmountCents: (_id, _type, r) => fullPaymentCents({ database: db, devisModel, calc: calculateReservationQuote }, id, r),
      createLink: ({ title, amountCents }) => withAccessToken((client, at) =>
        client.createPaymentLink({ accessToken: at, title, amountCents, redirectUrl: redirectUrl || undefined })),
    }, id, 'full');
    return ok(res, { paymentUrl: link.url, amountCents: link.amountCents, currency: 'EUR', status: link.status });
  } catch (err) {
    if (err && err.httpStatus) return fail(res, err.httpStatus, err.error || 'PAYMENT_LINK_FAILED', err.message || 'Lien de paiement impossible.');
    return fail(res, 502, 'QONTO_API_ERROR', 'Erreur du fournisseur de paiement.');
  }
}

async function withAccessToken(fn) {
  const accessToken = await getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient });
  return fn(buildQontoClient(), accessToken);
}

// Minimal, non-PII recap of a confirmed booking.
function recap(reservationRow) {
  const propertyName = (db.prepare('SELECT name FROM properties WHERE id = ?').get(reservationRow.propertyId) || {}).name || '';
  return {
    reservationId: reservationRow.id,
    propertyName,
    startDate: reservationRow.startDate,
    endDate: reservationRow.endDate,
    finalPrice: Number(reservationRow.finalPrice || 0),
  };
}

async function status(req, res) {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!row || row.kind !== 'devis' || row.requestOrigin !== 'public') return fail(res, 404, 'DEVIS_NOT_FOUND', 'Devis introuvable.');

  // Already confirmed (by the webhook / a prior poll)?
  const confirmedId = row.convertedReservationId;
  const asConfirmed = (rid) => {
    const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
    return ok(res, { status: r && r.bookingConflictAt ? 'conflict' : 'confirmed', ...recap(r) });
  };
  if (confirmedId) return asConfirmed(confirmedId);

  // On-demand reconciliation: if the devis's full link is paid at Qonto but not yet processed, process
  // it now (best-effort) so the success page sees `confirmed` without waiting for the cron.
  const link = paymentLinksModel.findOpenForReservation(id, 'full');
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
