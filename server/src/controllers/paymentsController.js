/**
 * Payments controller — Qonto OAuth connect flow (specs/online-payments-qonto.md §3.1 / §4.1).
 *
 * Thin: the OAuth token logic lives in `utils/qontoClient` + `utils/qontoAuth`, the token storage in
 * `settingsModel`. These handlers only orchestrate the browser redirect dance:
 *   GET /api/payments/qonto/authorize → 302 to Qonto consent (state stored in the session)
 *   GET /api/payments/qonto/callback  → exchange the code, store tokens, 302 back to /settings
 *   GET /api/payments/qonto/status    → { connected, connectionStatus, configured, sandbox }
 *
 * The callback is reachable with the admin's session because the cookie is `sameSite=lax` (a
 * top-level GET navigation from Qonto carries it), so the standard /api auth guard applies.
 */

const crypto = require('crypto');
const database = require('../database');
const settingsModel = require('../models/settingsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { buildQontoClient } = require('../utils/qontoClient');
const { getValidQontoAccessToken } = require('../utils/qontoAuth');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const { createEmailService } = require('../utils/emailService');
const { calculateReservationQuote } = require('../utils/pricing');
const { validatePaymentTimings, OFFSET_FIELDS } = require('../utils/paymentTimingsValidation');
const { validateProviderConnection } = require('../utils/paymentProviderValidation');

const CALLBACK_PATH = '/api/payments/qonto/callback';

// The OAuth redirect_uri MUST byte-match the one registered in the Qonto app. Prefer an explicit
// env override; otherwise derive it from the configured public URL.
function resolveRedirectUri() {
  if (process.env.QONTO_REDIRECT_URI) return process.env.QONTO_REDIRECT_URI.trim();
  const base = settingsModel.publicUrl();
  return base ? `${base.replace(/\/+$/, '')}${CALLBACK_PATH}` : '';
}

function qontoAuthorize(req, res) {
  const client = buildQontoClient();
  if (!client.isConfigured()) {
    return res.status(400).json({ error: 'QONTO_NOT_CONFIGURED', message: 'Identifiants Qonto (client id/secret) manquants dans .env.local.' });
  }
  const redirectUri = resolveRedirectUri();
  if (!redirectUri) {
    return res.status(400).json({ error: 'PUBLIC_URL_MISSING', message: "L'URL publique de GuestFlow n'est pas configurée (Paramètres) et QONTO_REDIRECT_URI est absent." });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.qontoOAuthState = state;
  return res.redirect(client.getAuthorizeUrl({ redirectUri, state }));
}

async function qontoCallback(req, res) {
  const { code, state, error } = req.query;
  // Land back on the dedicated Paiements page (it reads ?qonto=… to show a success/error alert).
  const back = (status) => res.redirect(`/parametres/paiements?qonto=${status}`);

  if (error) return back('error');
  const expected = req.session.qontoOAuthState;
  delete req.session.qontoOAuthState;
  if (!code || !state || !expected || String(state) !== String(expected)) {
    return back('invalid_state');
  }
  try {
    const client = buildQontoClient();
    const tokens = await client.exchangeCode({ code: String(code), redirectUri: resolveRedirectUri() });
    if (!tokens.refreshToken) return back('error');
    const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null;
    settingsModel.storeQontoTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt });
    return back('connected');
  } catch {
    // The exact error is logged by the HTTP layer in qontoClient; never leak it to the URL.
    return back('error');
  }
}

function qontoStatus(req, res) {
  const client = buildQontoClient();
  return res.json({
    ...settingsModel.qontoConnectionInfo(),
    configured: client.isConfigured(),
    sandbox: client.sandbox,
  });
}

// ----- Paiements settings page (specs/online-payments-qonto.md §3.1) -----

// `payment` + Capitalize(key): depositReminderOffsets → paymentDepositReminderOffsets, etc.
function timingColumn(key) {
  return `payment${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

// Everything the Paiements page renders: the parsed timings + the Qonto connection state.
function getSettings(req, res) {
  const client = buildQontoClient();
  return res.json({
    timings: settingsModel.paymentTimings(),
    qonto: {
      ...settingsModel.qontoConnectionInfo(),
      configured: client.isConfigured(),
      sandbox: client.sandbox,
    },
  });
}

// Update the (partial) timings: validate, then persist offset arrays as JSON + the rest as columns.
function updateSettings(req, res) {
  const { ok, errors, value } = validatePaymentTimings(req.body || {});
  if (!ok) return res.status(400).json({ error: 'VALIDATION_FAILED', messages: errors });
  const payload = {};
  for (const [key, val] of Object.entries(value)) {
    payload[timingColumn(key)] = OFFSET_FIELDS.includes(key) ? JSON.stringify(val) : val;
  }
  settingsModel.upsert(payload);
  return res.json({ timings: settingsModel.paymentTimings() });
}

// ----- Qonto payment-links provider connection (specs/online-payments-qonto.md §3.2) -----

// Map an internal error to a clean HTTP response (never leak the Qonto body to the client).
function qontoError(res, err) {
  if (err && err.code === 'QONTO_NOT_CONNECTED') {
    return res.status(400).json({ error: 'QONTO_NOT_CONNECTED', message: "Connecte d'abord Qonto (OAuth) avant la connexion du provider." });
  }
  return res.status(502).json({ error: 'QONTO_API_ERROR', status: (err && err.status) || null, message: "Erreur de l'API Qonto — réessaie ou consulte les logs." });
}

// Resolve a valid access token (refreshing if needed) then run `fn(client, accessToken)`.
async function withAccessToken(fn) {
  const accessToken = await getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient });
  return fn(buildQontoClient(), accessToken);
}

// Where Qonto redirects the user after the provider onboarding/KYC — back on the Paiements page,
// which re-checks the status on `?provider=callback`.
function providerCallbackUrl() {
  const base = settingsModel.publicUrl();
  return base ? `${base.replace(/\/+$/, '')}/parametres/paiements?provider=callback` : '';
}

// List the org's bank accounts for the connection form's picker.
async function qontoBankAccounts(req, res) {
  try {
    const bankAccounts = await withAccessToken((client, at) => client.listBankAccounts({ accessToken: at }));
    return res.json({ bankAccounts });
  } catch (err) { return qontoError(res, err); }
}

// Establish the provider connection. Persists the returned status; returns `connectionLocation`
// (the onboarding URL) when the connection is still `pending`.
async function qontoConnectProvider(req, res) {
  const { ok, errors, value } = validateProviderConnection(req.body || {});
  const callback = providerCallbackUrl();
  if (!callback) errors.push("URL publique de GuestFlow non configurée (Paramètres).");
  if (!ok || errors.length) return res.status(400).json({ error: 'VALIDATION_FAILED', messages: errors });
  try {
    const result = await withAccessToken((client, at) => client.connectProvider({
      accessToken: at,
      partnerCallbackUrl: callback,
      userBankAccountId: value.bankAccountId,
      userPhoneNumber: value.phone,
      userWebsiteUrl: value.websiteUrl,
      businessDescription: value.businessDescription,
    }));
    settingsModel.storeQontoConnection({ connectionId: result.bankAccountId || value.bankAccountId, status: result.status });
    return res.json({ connectionStatus: result.status, connectionLocation: result.connectionLocation });
  } catch (err) { return qontoError(res, err); }
}

// Re-check the provider status (after the user returns from onboarding) and persist it.
async function qontoRefreshConnection(req, res) {
  try {
    const conn = await withAccessToken((client, at) => client.getConnection({ accessToken: at }));
    settingsModel.storeQontoConnection({ status: conn.status, connectionId: conn.bankAccountId });
    return res.json({ connectionStatus: conn.status });
  } catch (err) { return qontoError(res, err); }
}

// ----- Payment links on a reservation/devis (specs/online-payments-qonto.md §3.2 / §3.4) -----

const paymentRequestService = require('../utils/paymentRequestService');
const { LINK_TYPES, LINK_TITLES } = paymentRequestService;

// Wire the module-scoped deps into the injectable service (utils/paymentRequestService).
function requestServiceDeps() {
  return {
    database,
    paymentLinksModel,
    resolveAmountCents,
    resolveItems: (id, type) => resolveVatComponents(id, type),
    createLink: ({ title, amountCents, items, expectedTotalCents }) =>
      withAccessToken((client, at) => client.createPaymentLink({ accessToken: at, title, amountCents, items, expectedTotalCents })),
    sendTemplate: ({ reservationId, stableKey, paymentLink }) => sendReservationTemplateEmail({
      database, templatesModel: emailTemplatesModel, logModel: emailLogModel,
      settingsModel, emailServiceFactory: createEmailService,
      reservationId, stableKey,
      extraContext: { vars: { paymentLink }, flags: { hasPaymentLink: true } },
    }),
  };
}

// Re-run the pricing engine against a persisted devis (the SAME source the fiche/PDF use). Returns the
// quote or null (a reservation row / engine failure). Shared by the amount + VAT-components resolvers.
function runDevisEngineQuote(id) {
  try {
    const full = devisModel.findById(id); // devis only (kind='devis'); reservations keep stored columns
    if (!full) return null;
    return calculateReservationQuote({
      db: database,
      propertyId: Number(full.propertyId),
      startDate: full.startDate, endDate: full.endDate,
      checkInTime: full.checkInTime, checkOutTime: full.checkOutTime,
      adults: Number(full.adults || 0), children: Number(full.children || 0),
      teens: Number(full.teens || 0), babies: Number(full.babies || 0),
      discountPercent: Number(full.discountPercent || 0),
      customPrice: full.customPrice != null ? Number(full.customPrice) : undefined,
      selectedOptions: (full.options || []).filter((o) => !o.isCustom).map((o) => ({
        optionId: Number(o.optionId), quantity: Number(o.quantity || 1),
        unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
      })),
      customOptions: (full.options || []).filter((o) => o.isCustom).map((o) => ({
        customKey: String(o.customOptionId || o.title || ''),
        description: o.title || o.description || '',
        amount: Number(o.amount ?? o.originalTotalPrice ?? o.totalPrice ?? 0),
        offered: Boolean(o.offered),
      })),
      selectedResources: (full.resources || []).map((r) => ({
        resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
        unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined, offered: Boolean(r.offered),
      })),
      platform: full.platform,
    });
  } catch { return null; }
}

// Amount in cents for a link type, taken from the SAME engine the fiche/PDF use so the Qonto page
// matches the acompte/solde/total GuestFlow shows. The stored `depositAmount`/`balanceAmount` columns
// can be stale (pricing-rule change, public-API devis); the engine is the single source of truth.
// Falls back to the stored row for reservations or on failure.
function resolveAmountCents(id, type, row) {
  let euros = Number(row[LINK_TYPES[type]] || 0); // fallback = stored column
  const quote = runDevisEngineQuote(id);
  const field = type === 'deposit' ? 'depositAmount' : type === 'balance' ? 'balanceAmount' : 'finalPrice';
  if (quote && quote[field] != null) euros = Number(quote[field]);
  return Math.round(euros * 100);
}

// VAT basket components per link type (specs/payment-links-vat.md), from the engine quote. The tourist
// tax is VAT-exempt and (for direct stays) rides on the solde, so only `balance` carries a 0 %-VAT tax
// line; deposit (accommodation-only) and admin full (finalPrice, tax-excl) are single taxable lines.
// Returns null for reservations / engine failure → the caller keeps the safe single 0 %-VAT line.
function resolveVatComponents(id, type) {
  const quote = runDevisEngineQuote(id);
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

// Map a thrown error to the HTTP response: a service validation throw carries `httpStatus`; anything
// else is a Qonto/transport failure → qontoError.
function sendError(res, err) {
  if (err && err.httpStatus) return res.status(err.httpStatus).json({ error: err.error, message: err.message });
  return qontoError(res, err);
}

// POST /reservations/:id/payment-links — create/reuse a link WITHOUT emailing (used by the site flow,
// use case 2). The host-facing "email the link" action is sendPaymentRequestEmail below.
async function createReservationPaymentLink(req, res) {
  const id = Number(req.params.id);
  const type = String((req.body && req.body.type) || 'deposit');
  try {
    return res.json(await paymentRequestService.ensurePaymentLink(requestServiceDeps(), id, type));
  } catch (err) { return sendError(res, err); }
}

// POST /reservations/:id/payment-emails — host action « Envoyer la demande d'acompte ». Creates/reuses
// the link AND emails the matching `<type>_request` template to the guest with the link injected.
async function sendPaymentRequestEmail(req, res) {
  const id = Number(req.params.id);
  const type = String((req.body && req.body.type) || 'deposit');
  try {
    const { httpStatus, body } = await paymentRequestService.sendPaymentRequest(requestServiceDeps(), id, type);
    return res.status(httpStatus).json(body);
  } catch (err) { return sendError(res, err); }
}

// Every payment link of a reservation/devis (newest first) — the status the UI renders.
function listReservationPaymentLinks(req, res) {
  return res.json({ links: paymentLinksModel.listForReservation(Number(req.params.id)) });
}

// Register (or report) the Qonto payment-link webhook subscription (specs/public-online-payment.md
// §3bis). Builds the callback from the configured public URL + uses QONTO_WEBHOOK_SECRET so deliveries
// are signed with the secret our endpoint verifies. One-shot admin action from the Paiements page.
async function registerQontoWebhook(req, res) {
  const secret = String(process.env.QONTO_WEBHOOK_SECRET || '').trim();
  if (!secret) return res.status(400).json({ error: 'WEBHOOK_SECRET_MISSING', message: 'Définis QONTO_WEBHOOK_SECRET dans server/.env.local avant d’enregistrer le webhook.' });
  const base = settingsModel.publicUrl();
  if (!base) return res.status(400).json({ error: 'PUBLIC_URL_MISSING', message: "L'URL publique de GuestFlow n'est pas configurée (Paramètres)." });
  const callbackUrl = `${base.replace(/\/+$/, '')}/api/payments/qonto/webhook`;
  try {
    const sub = await withAccessToken((client, at) => client.createWebhookSubscription({
      accessToken: at, callbackUrl, types: ['v1/payment-links'], secret, description: 'GuestFlow payment links',
    }));
    return res.json({ ok: true, id: sub.id, callbackUrl });
  } catch (err) { return sendError(res, err); }
}

// Manual "poll now" trigger (specs/online-payments-qonto.md §7 manual test). Runs the same pass the
// cron runs: detect paid links → mark paid → convert devis / flag deposit. Returns a summary.
async function pollPaymentsNow(req, res) {
  try {
    const summary = await runPaymentPoll({
      ...buildPaymentEffectDeps(),
      qontoClient: buildQontoClient(),
      getAccessToken: () => getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient }),
    });
    return res.json(summary);
  } catch (err) { return qontoError(res, err); }
}

module.exports = {
  qontoAuthorize, qontoCallback, qontoStatus, getSettings, updateSettings,
  qontoBankAccounts, qontoConnectProvider, qontoRefreshConnection, resolveRedirectUri,
  createReservationPaymentLink, listReservationPaymentLinks, sendPaymentRequestEmail, pollPaymentsNow,
  registerQontoWebhook,
};
