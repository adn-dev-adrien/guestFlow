# Configure and repair Qonto from the interface

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/qonto-settings-in-app` |
| **Created** | 2026-09-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On 2026-09-06 the public booking tunnel was exercised end to end on production. The booking request
was created correctly, then « Payer en ligne » failed with `QONTO_API_ERROR`. The visitor saw a
generic error; the operator saw nothing at all. The real cause was only in the PM2 log:

```
[qonto] token refresh HTTP 401: {"error":"invalid_client","error_description":"Client authentication failed…"}
```

Qonto had regenerated the OAuth application secret when its developer portal was reworked. The
repair took an hour and needed, in order: an SSH session on the production VM, a `grep` in
`data/.env.local`, a hand-written `curl` against the OAuth endpoint to tell `invalid_client` from
`invalid_grant`, an `md5sum` comparison because the secret cannot be read from the interface, a
manual edit of `.env.local`, and a `pm2 restart`. None of it was possible from GuestFlow.

Three separate defects made that necessary:

- **The credentials live only in `server/.env.local`** (`qontoClient.js` reads `process.env`), so
  rotating a secret is a file edit plus a restart — `specs/online-payments-qonto.md` §4.1 always
  assumed the operator has a shell.
- **The interface lied.** Réglages → Paiements showed « Connecté ✓ » and « Identifiants : Configurés »
  while every single call to Qonto had been failing for weeks. `qontoStatus` reports whether a
  refresh token *exists*, never whether it *works*.
- **Nothing surfaced the failure.** The error was swallowed into a generic message for the visitor
  and a line in a log file nobody reads. Between the last working payment link (2026-08-19) and the
  test (2026-09-06) the payment tunnel was dead and silent.

## 2. Goal

An operator can set up, diagnose and repair the Qonto connection using only two interfaces — GuestFlow
and Qonto — and GuestFlow tells the truth about the state of that connection, including how to fix it
when it is broken.

## 3. Functional rules

**Configuration**

1. The Qonto application settings — environment, client id, client secret, sandbox staging token,
   webhook secret — are entered in Réglages → Paiements and stored in `app_settings`. A saved value
   takes effect on the next call to Qonto, with no file to edit and no restart.
2. A value stored in the database wins over the environment variable of the same role. When the
   stored value is empty the environment variable is still used, so an installation configured
   through `.env.local` keeps working untouched.
3. A secret never leaves the server in clear. The settings payload exposes, per secret, whether it is
   configured — never its value — and a secret is only ever written, never read back.
4. The client id is not a secret and is returned in clear, so the operator can compare it with the one
   the Qonto portal displays. Telling « same application » from « another application » is the first
   step of every diagnosis.
5. The environment (sandbox or production) is chosen in the interface. The OAuth and API hosts derive
   from it and are displayed read-only, so what GuestFlow will call is never a guess.
6. The redirect URI to declare in the Qonto portal is displayed, ready to copy.
7. The public site origin — the address the payer returns to after paying — is entered in the same
   place, because a payment tunnel whose return URL is missing is as broken as one whose secret is.
8. Every value is trimmed before being stored: a secret copied from a web page carries trailing
   whitespace, and a credential that differs by one invisible character fails exactly like a wrong one.

**Diagnosis**

9. « Tester la connexion » performs a real authenticated call to Qonto and reports its outcome in the
   interface, in French.
10. The outcome is classified, and each class carries the explanation and the one action that repairs
    it: not configured, credentials rejected, authorisation to renew, provider not connected,
    Qonto unreachable, Qonto in error, never verified, everything working. Telling a rejected secret
    (`invalid_client`) from a lapsed authorisation (`invalid_grant`) is the whole diagnosis: both
    arrive as an HTTP 401, one is a form to fill and the other a button to press.
11. The connection badge shows the last *verified* outcome. It says « Connecté » only when a real call
    to Qonto has succeeded — never merely because a token is stored.
12. Every failed Qonto call records its code, its message and its date, wherever it was made from —
    public payment link, scheduled poll, or a link created by hand. The record is shown in
    Réglages → Paiements.
13. A successful call clears the recorded failure, so what the page shows is the current state and not
    an old scar.
14. The visitor on the public site never sees the detail of a Qonto failure: the tunnel keeps
    answering its generic message, and the detail goes to the operator's interface.
17. A failure from the Qonto Business API carries its own `errors[].code` and `errors[].detail` to
    the operator, not just its HTTP status — the two envelopes Qonto uses (`{error, error_description}`
    for OAuth, `{errors: [{code, detail}]}` for the Business API) are both read. In particular, a
    payment link refused because the link provider is not connected is named as such and points at
    the form that fixes it, instead of sending the operator to the support desk for something they
    can repair themselves in a minute.

**Safety**

15. Saving a client id, a client secret or an environment that differs from the current one clears the
    stored OAuth tokens: they were issued by another application, or for another environment, and
    keeping them would show a connection that cannot work. The interface then asks for a new
    authorisation.
16. Reading and writing these settings requires an authenticated operator, like every other
    `/api/payments/**` route.

**Edge cases:**

- Secret pasted with a trailing newline → trimmed, stored, works (rule 8).
- Switching sandbox → production while connected → tokens cleared, badge drops to « autorisation à
  renouveler » (rule 15).
- Test run with no credentials at all → « non configuré », pointing at the fields to fill, not an
  opaque failure (rule 10).
- Qonto unreachable (DNS, TLS, timeout) → distinguished from a credential rejection, because the
  repair is not the same (rule 10).
- A stored failure older than the last success → not shown (rule 13).

---

## 4. Architecture

> **Fat backend, thin frontend.** The classification of a Qonto failure, the precedence between
> database and environment, and the decision to clear the OAuth tokens are all server-side. The page
> renders a ready-made status object and posts a form.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `payments.js` | T | Adds `GET/PUT /qonto/credentials` and `POST /qonto/test` |
| `controllers/` | `paymentsController.js` | T | Serves the credential payload, saves it, runs the connection test, builds the status from the verified state |
| `models/` | `settingsModel.js` | T | New columns: credentials (secrets encrypted), environment, public site origin, and the verified-health record |
| `utils/` | `qontoConfig.js` | C | Single source of the effective Qonto configuration: database over environment, derived hosts, redirect URI |
| `utils/` | `qontoHealth.js` | C | Pure classification of a Qonto outcome into a state + French explanation + repair action |
| `utils/` | `qontoService.js` | C | Builds the client from `qontoConfig` and records every outcome through `settingsModel` (the choke point for rules 12-13) |
| `utils/` | `qontoAuth.js` | T | Takes its configuration from `qontoConfig` instead of `process.env` |
| `utils/` | `paymentRequestService.js` | T | Builds its client through `qontoService` so its failures are recorded |
| `utils/` | `paymentPollRunner.js` | T | Same, for the scheduled poll |
| `controllers/public/` | `publicPaymentController.js` | T | Keeps its generic visitor message while the failure is recorded (rule 14) |
| `database.js` | `database.js` | T | Idempotent migration adding the new `app_settings` columns |

`qontoClient.js` is **not** touched: it already accepts a full config object, which is exactly the
seam `qontoConfig` plugs into. That is why the change stays small.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PaymentsSettingsPage.jsx` | T | Hosts the new card, renders the honest badge and the last-failure alert, wires save/test |
| `components/` | `QontoApplicationCard.jsx` | C | The credentials form, the derived hosts, the redirect URI, and the diagnosis the server computed |
| `api.js` | `api.js` | T | `getQontoCredentials`, `updateQontoCredentials`, `testQontoConnection` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusCard`, `SummaryItem`, `MaskedTextField`, `HelpedTextField`, `ErrorAlert`, `PageActionBar` | All pre-existing. `MaskedTextField` is exactly the write-only secret field rule 3 needs. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `QontoApplicationCard` | Every field it holds names a Qonto concept (staging token, redirect URI, OAuth hosts); there is no second page that could consume it. It is a composition of the generics above, extracted only to keep the page readable. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/payments/qonto/credentials` | — | `{ environment, clientId, oauthBase, apiBase, redirectUri, publicSiteOrigin, secrets: { clientSecret: { configured, source }, stagingToken: {…}, webhookSecret: {…} } }` | Secrets masked to booleans (rule 3); `source` ∈ `db` \| `env` \| `none` (rule 2) |
| PUT | `/api/payments/qonto/credentials` | `{ environment?, clientId?, clientSecret?, stagingToken?, webhookSecret?, publicSiteOrigin? }` | same shape as GET, plus `{ tokensCleared: boolean }` | An omitted or empty secret leaves the stored one untouched; `null` erases it |
| POST | `/api/payments/qonto/test` | — | `{ state, ok, title, explanation, action, checkedAt, detail? }` | Runs a real call (rule 9) |
| GET | `/api/payments/qonto/status` | — | existing shape + `{ verified, lastCheckAt, lastSuccessAt, lastError: { code, message, at, origin } \| null }` | `connected` now means verified (rule 11) |

All four require the session guard already applied to `/api/payments/**` (rule 16).

---

## 5. Data model

New `app_settings` columns, added by an idempotent block in `server/src/database.js`:

| Column | Type | Default | Encrypted | Role |
|---|---|---|---|---|
| `qontoEnvironment` | TEXT | `''` | no | `sandbox` \| `production`; empty falls back to the environment variable |
| `qontoClientId` | TEXT | `''` | no | Public OAuth identifier, displayed (rule 4) |
| `qontoClientSecretEncrypted` | TEXT | `''` | **yes** | OAuth application secret |
| `qontoStagingTokenEncrypted` | TEXT | `''` | **yes** | `X-Qonto-Staging-Token` for the sandbox |
| `qontoWebhookSecretEncrypted` | TEXT | `''` | **yes** | HMAC secret of the webhook |
| `publicSiteOrigin` | TEXT | `''` | no | Origin the payer returns to (rule 7) |
| `qontoLastCheckAt` | TEXT | `''` | no | Date of the last verification, successful or not |
| `qontoLastSuccessAt` | TEXT | `''` | no | Date of the last successful call (rule 11) |
| `qontoLastErrorAt` | TEXT | `''` | no | Date of the recorded failure (rule 12) |
| `qontoLastErrorCode` | TEXT | `''` | no | `invalid_client`, `HTTP 500`, `network`… |
| `qontoLastErrorMessage` | TEXT | `''` | no | Message returned by Qonto, kept as-is for the operator |
| `qontoLastErrorOrigin` | TEXT | `''` | no | Where the call came from: `test`, `public-payment`, `poll`, `manual-link` |

The three encrypted columns join `ENCRYPTED_COLUMNS` in `settingsModel.js`, which masks them to
booleans in every payload (CLAUDE.md §8).

**Data impact:** additive only. Existing rows get empty strings, which by rule 2 means « keep reading
the environment » — an installation that never opens the new form behaves exactly as before.

## 6. UI / UX

**Réglages → Paiements**, above the existing « Connexion bancaire (Qonto) » card:

- **Card « Application Qonto »** — `StatusCard` with a badge reading the verified state:
  - `Environnement` — select: « Bac à sable (test) » / « Production ».
  - `Client ID` — plain `HelpedTextField`, helper: « Visible dans developers.qonto.com → Business API
    access. Doit être identique à celui du portail. »
  - `Client secret` — `MaskedTextField`, helper: « Recopie-le depuis le portail Qonto. Qonto le
    régénère quand l'application change : c'est la panne la plus fréquente. »
  - `Jeton bac à sable` — `MaskedTextField`, shown only when the environment is sandbox.
  - `Secret du webhook` — `MaskedTextField`.
  - `Origine publique du site` — `HelpedTextField`, helper: « L'adresse à laquelle le client revient
    après avoir payé, ex. https://www.domainesolio.com ».
  - `URL de redirection à déclarer chez Qonto` — read-only `SummaryItem` + « Copier ».
  - Hosts derived from the environment, read-only.
  - Actions: « Enregistrer » and « Tester la connexion ».
- **Test result** — an alert under the card: green with « Connexion Qonto opérationnelle », or orange
  with the title, the explanation and the repair action from rule 10. Example for a rejected secret:
  « Le secret de l'application est refusé par Qonto (invalid_client). Recopie le Client secret depuis
  developers.qonto.com → Business API access, enregistre, puis relance le test. »
- **Last failure** — `ErrorAlert` above the cards when a failure is recorded and no success came
  after it: « Dernier échec le 6 septembre à 11:42 — invalid_client (paiement public) ».
- **Connexion bancaire card** — the badge now reads « Connecté » / « À reconnecter » / « Non
  configuré » from the verified state, no longer from the mere presence of a token.

**Copy for the states (rule 10):**

| State | Title | Repair action |
|---|---|---|
| `not_configured` | Identifiants manquants | Renseigne le Client ID et le Client secret de ton application Qonto. |
| `credentials_rejected` | Identifiants refusés par Qonto | Recopie le Client secret depuis le portail Qonto, puis relance le test. |
| `reauth_required` | Autorisation à renouveler | Clique « Reconnecter Qonto » et accepte l'accès. |
| `provider_not_connected` | Provider de liens non activé | Renseigne le formulaire « Connexion du provider de liens » ci-dessous. |
| `unreachable` | Qonto injoignable | Vérifie la connexion réseau du serveur, puis relance le test. |
| `api_error` | Qonto a renvoyé une erreur | Relance le test dans quelques minutes ; si ça persiste, contacte le support Qonto avec ce détail. |
| `unverified` | À vérifier | Clique « Tester la connexion ». |
| `ok` | Connexion opérationnelle | — |

**Responsive:** the card is a single column on `xs` (fields full width, actions stacked with
`flexDirection: { xs: 'column', sm: 'row' }`), two columns from `md`. The page keeps its existing
`PageActionBar title="Paiements" backTo="/settings"` with Save; the two new actions live inside the
card, next to the fields they act on.

## 7. Test plan

### Server unit tests

- [ ] `tests/qonto-config.unit.test.js` — rules 2, 4, 5, 8
- [ ] `tests/qonto-health.unit.test.js` — rules 10, 14
- [ ] `tests/qonto-credentials-endpoint.unit.test.js` — rules 1, 3, 6, 7, 16
- [ ] `tests/qonto-connection-test.unit.test.js` — rules 9, 11
- [ ] `tests/qonto-failure-record.unit.test.js` — rules 12, 13
- [ ] `tests/qonto-credentials-clear-tokens.unit.test.js` — rule 15

### Client unit tests

- [x] `components/__tests__/QontoApplicationCard.test.jsx` — the client id is readable, the secrets
      are not, the diagnosis and its repair action are rendered, and a save sends only edited fields.

### Manual UI verification

- [ ] Happy path: fill the credentials, save, test → « Connexion opérationnelle ».
- [ ] Edge case: wrong secret → « Identifiants refusés », with the repair action.
- [ ] Edge case: change the client id → tokens cleared, badge asks for a new authorisation.
- [ ] Regression: the provider-connection form and « Enregistrer le webhook » still work.

> All six server suites are green (4029 server tests, 1236 client tests, 16/16 rules covered by
> `scripts/check-spec-coverage.mjs`). The manual pass runs on production right after the release,
> as the first half of the E2E booking test this spec interrupted.

## 8. Out of scope

- Proactively notifying the operator (push/email) when the payment tunnel breaks. This spec makes the
  failure *visible in the interface*; pushing it to the operator is a follow-up.
- Configuring Qonto from the public WordPress side.
- The `PUBLIC_API_KEY`, SMTP and Google credentials, which have the same env-only shape and deserve
  the same treatment later.
- Automatic retry of a payment link that failed while the credentials were broken.

## 9. Open questions

- Q: should the client secret be readable back by the operator, to compare it with the portal?
  - A (2026-09-07): no. Rule 3 keeps it write-only; rule 4 makes the **client id** readable instead,
    which is enough to tell one application from another. A readable secret in a payload is a secret
    in a log, a screenshot and a browser cache.
- Q: what does « Connecté » mean when no call has been made yet?
  - A (2026-09-07): « À vérifier » — the badge only claims success after a real call (rule 11), and
    the page invites the operator to run the test.

**Corrected 2026-09-07 (first production run):** the release was exercised against production the
hour it shipped. Recording worked — the public tunnel's failure reached Réglages → Paiements with
its origin and its timestamp, which it never had before. But the page read « Qonto a renvoyé une
erreur — HTTP 400 » while the body held `{"errors":[{"code":"invalid","detail":"connection with the
provider does not exist"}]}`. Two envelopes, one reader: `errorMessageOf` only knew the OAuth shape.
Rule 17 makes it read both, and names that particular refusal after the form that repairs it. The
first version of this spec sent the operator back to the logs for a failure it had already caught —
half a fix is its own kind of bug.
