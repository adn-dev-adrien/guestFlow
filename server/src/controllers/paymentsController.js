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

const LINK_TYPES = { deposit: 'depositAmount', balance: 'balanceAmount', full: 'finalPrice' };
const LINK_TITLES = { deposit: 'Acompte séjour', balance: 'Solde séjour', full: 'Paiement séjour' };

// Create a Qonto payment link for a reservation/devis (deposit by default). The amount comes from the
// engine-computed reservation fields (depositAmount / balanceAmount / finalPrice), never the client.
async function createReservationPaymentLink(req, res) {
  const id = Number(req.params.id);
  const type = String((req.body && req.body.type) || 'deposit');
  if (!LINK_TYPES[type]) return res.status(400).json({ error: 'INVALID_TYPE', message: 'Type de lien invalide (deposit/balance/full).' });

  const r = database.prepare('SELECT id, kind, depositAmount, balanceAmount, finalPrice FROM reservations WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
  const amountCents = Math.round(Number(r[LINK_TYPES[type]] || 0) * 100);
  if (amountCents <= 0) return res.status(400).json({ error: 'ZERO_AMOUNT', message: 'Montant nul pour ce type — vérifie le devis/réservation.' });

  // Reuse the current open link of that type if there is one (avoid duplicates on a double-click).
  const existing = paymentLinksModel.findOpenForReservation(id, type);
  if (existing && existing.url) {
    return res.json({ id: existing.id, type, amountCents: existing.amountCents, url: existing.url, status: existing.status, qontoPaymentLinkId: existing.qontoPaymentLinkId, reused: true });
  }

  try {
    const link = await withAccessToken((client, at) => client.createPaymentLink({ accessToken: at, title: LINK_TITLES[type], amountCents }));
    const row = paymentLinksModel.create({
      reservationId: id, type, amountCents,
      qontoPaymentLinkId: link.id, url: link.url, status: link.mappedStatus, expiresAt: link.expirationDate || null,
    });
    return res.json({ id: row.id, type, amountCents, url: link.url, status: link.mappedStatus, qontoPaymentLinkId: link.id });
  } catch (err) { return qontoError(res, err); }
}

// Every payment link of a reservation/devis (newest first) — the status the UI renders.
function listReservationPaymentLinks(req, res) {
  return res.json({ links: paymentLinksModel.listForReservation(Number(req.params.id)) });
}

// Manual "poll now" trigger (specs/online-payments-qonto.md §7 manual test). Runs the same pass the
// cron runs: detect paid links → mark paid → convert devis / flag deposit. Returns a summary.
async function pollPaymentsNow(req, res) {
  try {
    const summary = await runPaymentPoll({
      database,
      paymentLinksModel,
      devisModel,
      qontoClient: buildQontoClient(),
      getAccessToken: () => getValidQontoAccessToken({ settings: settingsModel, clientFactory: buildQontoClient }),
    });
    return res.json(summary);
  } catch (err) { return qontoError(res, err); }
}

module.exports = {
  qontoAuthorize, qontoCallback, qontoStatus, getSettings, updateSettings,
  qontoBankAccounts, qontoConnectProvider, qontoRefreshConnection, resolveRedirectUri,
  createReservationPaymentLink, listReservationPaymentLinks, pollPaymentsNow,
};
