/**
 * What a Qonto failure means, and what repairs it — specs/qonto-settings-in-app.md §3 rules 10, 14.
 *
 * On 2026-09-06 the payment tunnel had been dead for eighteen days behind a single line the operator
 * never sees: `token refresh HTTP 401 invalid_client`. Telling that apart from `invalid_grant` is the
 * whole diagnosis — the first means the application's secret is wrong (recopy it), the second means
 * the authorisation lapsed (click Reconnecter). One is a form to fill, the other is a button to press,
 * and nothing in the interface distinguished them.
 *
 * Pure functions: no I/O, no settings, no clock. The French sentences live here because they ARE the
 * repair procedure — the server owns the diagnosis, the page only renders it (CLAUDE.md §6.0).
 */

/** Ordered by how early the operator meets them; each carries the one action that fixes it. */
const STATES = {
  ok: {
    ok: true,
    title: 'Connexion opérationnelle',
    explanation: 'GuestFlow parle à Qonto et peut créer des liens de paiement.',
    action: '',
  },
  not_configured: {
    ok: false,
    title: 'Identifiants manquants',
    explanation: "GuestFlow n'a pas le Client ID et le Client secret de ton application Qonto.",
    action: 'Renseigne-les ci-dessus, depuis developers.qonto.com → Business API access, puis enregistre.',
  },
  credentials_rejected: {
    ok: false,
    title: 'Identifiants refusés par Qonto',
    explanation:
      "Qonto ne reconnaît pas le couple Client ID / Client secret. C'est ce qui arrive quand Qonto régénère le secret de l'application.",
    action:
      'Recopie le Client ID et le Client secret depuis developers.qonto.com → Business API access, enregistre, puis relance le test.',
  },
  reauth_required: {
    ok: false,
    title: 'Autorisation à renouveler',
    explanation:
      "Les identifiants sont bons, mais l'autorisation donnée à GuestFlow n'est plus valable (expirée, révoquée, ou jamais accordée).",
    action: 'Clique « Reconnecter Qonto » et accepte l\'accès dans la fenêtre Qonto.',
  },
  provider_not_connected: {
    ok: false,
    title: 'Provider de liens non activé',
    explanation:
      "La connexion bancaire fonctionne, mais le compte n'est pas encore relié au provider qui encaisse les paiements par carte.",
    action: 'Renseigne le formulaire « Connexion du provider de liens » plus bas.',
  },
  unreachable: {
    ok: false,
    title: 'Qonto injoignable',
    explanation: "Le serveur n'a pas réussi à joindre Qonto (réseau, DNS ou certificat).",
    action: 'Vérifie la connexion réseau du serveur, puis relance le test.',
  },
  api_error: {
    ok: false,
    title: 'Qonto a renvoyé une erreur',
    explanation: 'Qonto a répondu, mais en erreur. Le détail est repris ci-dessous.',
    action: 'Relance le test dans quelques minutes ; si ça persiste, contacte le support Qonto avec ce détail.',
  },
  unverified: {
    ok: false,
    title: 'À vérifier',
    explanation: "Les identifiants sont là et une autorisation est enregistrée, mais aucun appel réel n'a encore confirmé que ça marche.",
    action: 'Clique « Tester la connexion ».',
  },
};

/** Qonto answers `{"error":"invalid_client"}`; a plain HTTP failure gets `HTTP 500`. */
function errorCodeOf(err) {
  if (!err) return '';
  const body = err.body && typeof err.body === 'object' ? err.body : null;
  const fromBody = body ? String(body.error || body.code || '').trim() : '';
  if (fromBody) return fromBody;
  // The Business API answers `{"errors":[{"code","detail"}], "trace_id"}` — a different envelope
  // from the OAuth one, and the shape every payment-link failure arrives in.
  const first = firstApiError(body);
  if (first && first.code) return String(first.code);
  if (err.code) return String(err.code);
  if (err.status) return `HTTP ${err.status}`;
  return 'error';
}

/** The first entry of the Business API's `errors` array, or null. */
function firstApiError(body) {
  const list = body && Array.isArray(body.errors) ? body.errors : null;
  const first = list && list.length ? list[0] : null;
  return first && typeof first === 'object' ? first : null;
}

/**
 * The sentence Qonto itself gave, kept as-is: it is the only thing the operator can act on.
 *
 * On 2026-09-07 a production run showed « Qonto a renvoyé une erreur — HTTP 400 » while the body
 * held « connection with the provider does not exist ». The diagnosis existed; it just never
 * reached the page, and the operator was sent to the logs — the exact trip this spec removes.
 */
function errorMessageOf(err) {
  if (!err) return '';
  const body = err.body && typeof err.body === 'object' ? err.body : null;
  const detail = body ? String(body.error_description || body.detail || body.message || '').trim() : '';
  if (detail) return detail;
  const first = firstApiError(body);
  const apiDetail = first ? String(first.detail || first.message || '').trim() : '';
  return apiDetail || String(err.message || '').trim();
}

/** A failure that never reached Qonto: DNS, TLS, refused connection, timeout. */
function isNetworkFailure(err) {
  if (!err || err.status) return false;
  const code = String(err.code || err.cause?.code || '');
  if (/^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|CERT_|DEPTH_ZERO|UNABLE_TO_VERIFY)/.test(code)) return true;
  return /fetch failed|network|socket hang up|timeout/i.test(String(err.message || ''));
}

/**
 * Classify one Qonto outcome (rule 10).
 *
 * @param {Error|null} err the failure, or null/undefined for a success
 * @param {{configured?: boolean, providerEnabled?: boolean}} context
 * @returns {{state: string, ok: boolean, title: string, explanation: string, action: string,
 *   code: string, detail: string}}
 */
function classifyQontoOutcome(err, context = {}) {
  const { configured = true, providerEnabled = true } = context;
  const decorate = (state) => ({
    state,
    ...STATES[state],
    code: errorCodeOf(err),
    detail: errorMessageOf(err),
  });

  if (!configured) return decorate('not_configured');

  if (!err) return providerEnabled ? decorate('ok') : decorate('provider_not_connected');

  const code = errorCodeOf(err).toLowerCase();

  if (code === 'qonto_not_configured') return decorate('not_configured');
  // No refresh token stored, or Qonto rejected the one we hold: both need a new authorisation.
  if (code === 'qonto_not_connected' || code === 'invalid_grant') return decorate('reauth_required');
  // The application itself is refused — the secret, not the authorisation.
  if (code === 'invalid_client' || code === 'unauthorized_client') return decorate('credentials_rejected');
  if (isNetworkFailure(err)) return decorate('unreachable');
  if (err.status === 401 || err.status === 403) return decorate('reauth_required');
  // Creating a payment link without the link provider fails with a plain 400; only the sentence in
  // the body says so, and « contacte le support Qonto » would be the wrong advice for a form the
  // operator can fill right there.
  if (/connection with the provider does not exist/i.test(errorMessageOf(err))) return decorate('provider_not_connected');
  return decorate('api_error');
}

/**
 * The state the settings page shows, from what is stored — rule 11.
 *
 * The point of this function is what it REFUSES to say: holding a refresh token is not a working
 * connection. Until a real call has succeeded, and while a failure stands unanswered, the badge tells
 * the operator to look, instead of reassuring them.
 *
 * @param {{configured: boolean, hasToken: boolean, providerEnabled: boolean,
 *   health: {lastSuccessAt: string|null, lastError: object|null}}} snapshot
 */
function qontoConnectionState({ configured, hasToken, providerEnabled, health } = {}) {
  const lastError = health?.lastError || null;
  const decorate = (state) => ({
    state,
    ...STATES[state],
    code: lastError ? String(lastError.code || '') : '',
    detail: lastError ? String(lastError.message || '') : '',
  });

  if (!configured) return decorate('not_configured');
  // A standing failure is classified from the code Qonto gave, so the badge names the actual repair.
  if (lastError) {
    const asError = { code: lastError.code, body: { error: lastError.code }, message: lastError.message };
    return { ...classifyQontoOutcome(asError, { configured: true }), code: String(lastError.code || ''), detail: String(lastError.message || '') };
  }
  if (!hasToken) return decorate('reauth_required');
  if (!health?.lastSuccessAt) return decorate('unverified');
  return decorate(providerEnabled ? 'ok' : 'provider_not_connected');
}

module.exports = { classifyQontoOutcome, qontoConnectionState, errorCodeOf, errorMessageOf, STATES };
