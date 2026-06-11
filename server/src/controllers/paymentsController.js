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
const settingsModel = require('../models/settingsModel');
const { buildQontoClient } = require('../utils/qontoClient');
const { validatePaymentTimings, OFFSET_FIELDS } = require('../utils/paymentTimingsValidation');

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

module.exports = { qontoAuthorize, qontoCallback, qontoStatus, getSettings, updateSettings, resolveRedirectUri };
