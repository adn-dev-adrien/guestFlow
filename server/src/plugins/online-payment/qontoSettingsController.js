/**
 * The Qonto settings handlers — specs/online-payments-qonto.md §3.1-3.2, specs/qonto-settings-in-app.md
 * §3, specs/settings-one-save-and-automatic-webhook.md rules 11-14.
 *
 * A factory over a settings store rather than handlers bound to GuestFlow's `settingsModel`, because
 * the control plane runs the very same Qonto module, settings page included, over its own database
 * (specs/control-plane-plans-and-access.md rule 32). Nothing here may require an instance database:
 * the caller hands the settings in.
 *
 *   GET  /qonto/authorize          → 302 to Qonto consent (state stored in the session)
 *   GET  /qonto/callback           → exchange the code, store tokens, verify, 302 back to the page
 *   GET  /qonto/status             → the verified connection state
 *   GET|PUT /qonto/credentials     → the application credentials, secrets masked
 *   POST /qonto/test               → a real call, classified
 *   GET  /qonto/bank-accounts, POST /qonto/connect-provider, GET /qonto/refresh-connection
 *   GET  /settings                 → everything the Paiements page renders
 *
 * The callback is reachable with the operator's session because the cookie survives a top-level GET
 * navigation from Qonto, so the caller's auth guard applies.
 */

const crypto = require('crypto');
const { DEFAULT_SCOPES } = require('./qonto/qontoClient');
const {
  buildConfiguredQontoClient, withQonto, runQontoConnectionTest,
  qontoCredentialsPayload, qontoStatusPayload, applyQontoCredentials,
} = require('./qonto/qontoService');
const { resolveQontoConfig } = require('./qonto/qontoConfig');
const { ensureWebhookSubscription } = require('./qonto/qontoWebhookRegistrar');
const { validateProviderConnection } = require('./qonto/paymentProviderValidation');

const SETTINGS_PAGE_PATH = '/parametres/paiements';

/**
 * @param {object} deps
 * @param {object} deps.settings   the settings store (GuestFlow's `settingsModel` shape)
 * @param {object} [deps.env]      environment the configuration falls back on
 * @param {string[]} [deps.scopes] OAuth scopes asked from Qonto
 * @param {() => number} [deps.now]
 */
function createQontoSettingsController({ settings, env = process.env, scopes = DEFAULT_SCOPES, now = Date.now } = {}) {
  // The effective configuration: what the operator saved in the interface, over what the files hold
  // (specs/qonto-settings-in-app.md §3 rule 2).
  const qontoConfig = () => resolveQontoConfig({ settings, env });

  // The OAuth redirect_uri MUST byte-match the one registered in the Qonto app.
  const resolveRedirectUri = () => qontoConfig().redirectUri;

  function qontoAuthorize(req, res) {
    const config = qontoConfig();
    if (!config.configured) {
      return res.status(400).json({ error: 'QONTO_NOT_CONFIGURED', message: 'Identifiants Qonto (client id/secret) manquants — renseigne-les dans Réglages → Paiements.' });
    }
    const client = buildConfiguredQontoClient({ settings, env, config });
    const redirectUri = config.redirectUri;
    if (!redirectUri) {
      return res.status(400).json({ error: 'PUBLIC_URL_MISSING', message: "L'URL publique de GuestFlow n'est pas configurée (Paramètres) et QONTO_REDIRECT_URI est absent." });
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.qontoOAuthState = state;
    return res.redirect(client.getAuthorizeUrl({ redirectUri, state, scopes }));
  }

  /**
   * What happens the moment an authorisation succeeds
   * (specs/settings-one-save-and-automatic-webhook.md rules 11, 14).
   *
   * Storing a token proves nothing about the connection. The operator who had just repaired their
   * credentials on 2026-09-15 landed on the failure that *preceded* the repair — the state was stale,
   * not wrong, and « Tester la connexion » turned it green without changing a single setting. So we
   * make that call ourselves, and the page opens on what is true now.
   *
   * Neither step can undo the authorisation: a failing test still leaves the tokens in place and shows
   * its diagnosis, and `ensureWebhookSubscription` never throws.
   */
  async function completeQontoAuthorization({ settings: store = settings, env: vars = env } = {}) {
    const verified = await runQontoConnectionTest({ settings: store, env: vars }).catch(() => null);
    const webhook = await ensureWebhookSubscription({ settings: store, env: vars });
    return { verified, webhook };
  }

  async function qontoCallback(req, res) {
    const { code, state, error } = req.query;
    // Land back on the dedicated Paiements page (it reads ?qonto=… to show a success/error alert).
    const back = (status) => res.redirect(`${SETTINGS_PAGE_PATH}?qonto=${status}`);

    if (error) return back('error');
    const expected = req.session.qontoOAuthState;
    delete req.session.qontoOAuthState;
    if (!code || !state || !expected || String(state) !== String(expected)) {
      return back('invalid_state');
    }
    try {
      const client = buildConfiguredQontoClient({ settings, env });
      const tokens = await client.exchangeCode({ code: String(code), redirectUri: resolveRedirectUri() });
      if (!tokens.refreshToken) return back('error');
      const expiresAt = tokens.expiresIn ? new Date(now() + tokens.expiresIn * 1000).toISOString() : null;
      settings.storeQontoTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt });

      await completeQontoAuthorization();
      return back('connected');
    } catch {
      // The exact error is logged by the HTTP layer in qontoClient; never leak it to the URL.
      return back('error');
    }
  }

  // ----- Qonto state, credentials and connection test (specs/qonto-settings-in-app.md §3) -----
  //
  // Thin on purpose: the payload shapes, the precedence and the token-clearing decision live in
  // `utils/qontoService`, which is where they can be unit-tested without an HTTP layer.

  const statusPayload = () => qontoStatusPayload({ settings, env });

  function qontoStatus(req, res) {
    return res.json(statusPayload());
  }

  function getQontoCredentials(req, res) {
    return res.json(qontoCredentialsPayload({ settings, env }));
  }

  function updateQontoCredentials(req, res) {
    return res.json(applyQontoCredentials({ settings, env, body: req.body || {} }));
  }

  /** Run a real call against Qonto and report what it means (rules 9-10). */
  async function testQontoConnection(req, res) {
    const result = await runQontoConnectionTest({ settings, env });
    return res.json({ ...result, status: statusPayload() });
  }

  // Everything the Paiements page renders: the Qonto connection state. The « Délais & relances »
  // timings are gone — nothing read them (specs/settings-rationalization.md rule 9).
  function getSettings(req, res) {
    return res.json({
      qonto: statusPayload(),
      credentials: qontoCredentialsPayload({ settings, env }),
      // The website the provider form starts from: this space's own public site, never a fixed one.
      providerDefaults: { websiteUrl: (settings.qontoCredentials().publicSiteOrigin || '') },
    });
  }

  // ----- Qonto payment-links provider connection (specs/online-payments-qonto.md §3.2) -----

  // Map an internal error to a clean HTTP response (never leak the Qonto body to the client).
  function qontoError(res, err) {
    if (err && err.code === 'QONTO_NOT_CONNECTED') {
      return res.status(400).json({ error: 'QONTO_NOT_CONNECTED', message: "Connecte d'abord Qonto (OAuth) avant la connexion du provider." });
    }
    return res.status(502).json({ error: 'QONTO_API_ERROR', status: (err && err.status) || null, message: "Erreur de l'API Qonto — réessaie ou consulte les logs." });
  }

  // Resolve a valid access token (refreshing if needed) then run `fn(client, accessToken)`. Goes
  // through `withQonto` so the outcome is recorded like every other Qonto call (rules 12-13).
  async function withAccessToken(fn, origin = 'admin') {
    return withQonto({ settings, env, origin }, (client, accessToken) => fn(client, accessToken));
  }

  // Where Qonto redirects the user after the provider onboarding/KYC — back on the Paiements page,
  // which re-checks the status on `?provider=callback`.
  function providerCallbackUrl() {
    const base = settings.publicUrl();
    return base ? `${base.replace(/\/+$/, '')}${SETTINGS_PAGE_PATH}?provider=callback` : '';
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
      settings.storeQontoConnection({ connectionId: result.bankAccountId || value.bankAccountId, status: result.status });
      return res.json({ connectionStatus: result.status, connectionLocation: result.connectionLocation });
    } catch (err) { return qontoError(res, err); }
  }

  // Re-check the provider status (after the user returns from onboarding) and persist it.
  async function qontoRefreshConnection(req, res) {
    try {
      const conn = await withAccessToken((client, at) => client.getConnection({ accessToken: at }));
      settings.storeQontoConnection({ status: conn.status, connectionId: conn.bankAccountId });
      return res.json({ connectionStatus: conn.status });
    } catch (err) { return qontoError(res, err); }
  }

  return {
    qontoAuthorize, qontoCallback, qontoStatus, getSettings,
    getQontoCredentials, updateQontoCredentials, testQontoConnection,
    qontoBankAccounts, qontoConnectProvider, qontoRefreshConnection,
    resolveRedirectUri, completeQontoAuthorization, withAccessToken, qontoError,
  };
}

/** Mounts the settings handlers on a router, at the paths GuestFlow's Paiements page calls. */
function mountQontoSettingsRoutes(router, ctrl) {
  router.get('/qonto/authorize', ctrl.qontoAuthorize);
  router.get('/qonto/callback', ctrl.qontoCallback);
  router.get('/qonto/status', ctrl.qontoStatus);
  router.get('/qonto/credentials', ctrl.getQontoCredentials);
  router.put('/qonto/credentials', ctrl.updateQontoCredentials);
  router.post('/qonto/test', ctrl.testQontoConnection);
  router.get('/qonto/bank-accounts', ctrl.qontoBankAccounts);
  router.post('/qonto/connect-provider', ctrl.qontoConnectProvider);
  router.get('/qonto/refresh-connection', ctrl.qontoRefreshConnection);
  router.get('/settings', ctrl.getSettings);
  return router;
}

module.exports = { createQontoSettingsController, mountQontoSettingsRoutes, SETTINGS_PAGE_PATH };
