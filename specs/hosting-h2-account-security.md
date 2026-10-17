# Hosting H2 — accounts: forgotten password, two-step login, support access with consent

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hosting-h2-account-security` (from `inte/plugins`) |
| **Created** | 2026-10-08 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) §14 « Security » |
| **Console** | [`specs/control-plane-plans-and-access.md`](control-plane-plans-and-access.md) — rule 25 (a password reset stays on the instance), rule 31 (operator 2FA, reused here) |
| **Summary for review** | [`docs/specs/2026-10-08-hosting-h2-account-security.html`](../docs/specs/2026-10-08-hosting-h2-account-security.html) |

---

## 1. Context

Three gaps block selling GuestFlow to customers we do not sit next to:

- **A forgotten password needs us.** An administrator resets another user's password, or someone runs
  `server/scripts/reset-admin.js` on the host. A sole owner who forgets theirs is locked out until the
  operator steps in.
- **Instance accounts have no second factor.** Instance accounts are protected by a password only.
  The console's operators already have TOTP, an email code and backup codes
  (`control-plane/server/src/utils/totp.js`, C2a rule 31).
- **Support has no sanctioned way into a customer's instance.** It would need the customer's password,
  or a shell on their database. GDPR (§9.5) wants access traced and consented.

## 2. Goal

- **A forgotten password:** an owner resets it alone, by email.
- **Two-step login:** an owner can turn it on in two clicks.
- **Support access:** support enters a customer's space only after the customer accepts. The access
  is limited in time and every action is recorded and visible to the customer.

## 3. Functional rules

### 3.A Forgotten password

1. The login page has a « Mot de passe oublié ? » link. It asks for an email address. The answer is
   always the same, whether the address exists or not: « Si un compte existe, un lien vient d'être
   envoyé. »
2. The link is valid for 1 hour and works once. The server stores only a SHA-256 of its token. When
   a new link is asked for, older links stop working.
3. Asking for links is limited:
   - at most 3 requests per address per hour;
   - at most 20 per IP address per hour.

   A request above the limit gets the same answer as rule 1, and nothing is sent.
4. The link opens « Nouveau mot de passe », which applies the existing password rules. Saving it ends
   every session of that user and logs the user in.
5. The email uses the instance's mail transport. This is the platform sender on a managed instance
   (H1 rule 18). Without any transport, the link is not shown on the login page.
   - Added 2026-10-08 at implementation: the link points to the application's public address
     (Réglages › Système, else `GUESTFLOW_PUBLIC_URL` set by the hosting), never to the request's
     `Host` header, which a caller chooses. Without that address the link is not offered either.
   - The answer leaves before the email, so a known and an unknown address cost the same time.
   - `GUESTFLOW_MAIL_OUTBOX=<dir>` writes the account emails as files instead of sending them: the dev
     mail catcher of the E2E suite. It is refused when `NODE_ENV=production`.

### 3.B Two-step login

6. In « Mon compte », any user can turn on a second step:
   - **an authenticator app (TOTP)**, enrolled by scanning a QR code and confirmed by a first code;
   - **or a code sent by email.**

   Turning it on shows 10 single-use backup codes once, with « Télécharger » and « Copier ».
   - Details (2026-10-08, at implementation): turning it on, turning it off and renewing the backup
     codes ask for the password again; 5 wrong codes while enrolling cancel the enrolment; a TOTP code
     is accepted once (its time step is remembered), as on the console.
7. **Once it is on, the login asks for the code after the password.**
   - « Faire confiance à cet appareil 30 jours » skips the step on that browser.
   - The trust is stored in a signed cookie and revoked when the user changes their password or turns
     the second step off.
   - How (2026-10-08): the cookie's HMAC also covers a fingerprint of the password hash and the date
     the second step was turned on, so a new password or a step turned off revokes every trust given
     before, with no table to purge. One cookie per account (`guestflow.trust.<id>`, `HttpOnly`,
     path `/api/auth`).
8. **Entering codes is limited:** 5 wrong codes lock the step for 15 minutes.
9. **An administrator can turn off another user's second step**, for example after a lost phone. This
   is recorded in the user history. Nobody can read another user's TOTP secret, which is stored
   encrypted (`ENCRYPTED_COLUMNS`).
   - « User history » (2026-10-08): there was none, so each account now has a security journal
     (`user_security_events`), shown in « Mon compte » under the second code: turned on, turned off,
     turned off by an administrator (named), turned off by `reset-admin.js`, new backup codes, password
     reset by link. Paramètres › Utilisateurs shows « Désactiver le second code » on the accounts that
     have one, never on the admin's own.
10. **The second step is optional.** An administrator account without it sees one card on the
    dashboard: « Protéger le compte par un second code », with « Activer » and « Plus tard ». The card
    is hidden for 30 days after « Plus tard ».
11. **The TOTP and backup-code helpers are shared with the console.** They move from
    `control-plane/server/src/utils/totp.js` to a module both import. The code is not duplicated.

### 3.C Support access with consent

12. **The operator requests access** from the customer's page in the console, with a reason. The
    instance shows every administrator a banner: « Le support demande l'accès : <motif> », with
    « Autoriser 24 h » and « Refuser ».
13. **Accepting creates a time-limited access:**
    - it lasts 24 h, or 1 h or 7 days if the administrator picks it;
    - the administrator can revoke it at any time from Paramètres › Accès du support.
14. **While an access is open, the console shows « Ouvrir l'espace ».** It mints a single-use sign-in
    link signed with the console's key, which the instance verifies with
    `GUESTFLOW_LICENCE_PUBLIC_KEY`, valid for 2 minutes. The link opens a session as a dedicated user,
    « Support GuestFlow », with administrator rights. That user cannot be edited or used to log in with
    a password, and it is disabled when no access is open.
15. **The support user's actions are traced.** Every request it makes that changes data, and every
    page it opens, is written to `support_access_log`. Paramètres › Accès du support lists the
    accesses and their logs, read-only.
16. **The support session shows a red bar « Session support — <expiry> »** so screenshots are never
    mistaken for the customer's own.
17. **An instance without licence key cannot be opened.** On an instance that is not managed (no
    `GUESTFLOW_LICENCE_PUBLIC_KEY`), support access is not offered at all and its page is hidden.

**Implementation choices (2026-10-08, the recommended options, see the summary page):**
- **The channel.** The console signs the request with the licence key and writes it to
  `<dataDir>/support-request.jws`, next to the licence; the instance verifies it with
  `GUESTFLOW_LICENCE_PUBLIC_KEY` (and `GUESTFLOW_SLUG` when set) when an administrator loads a page.
  The console reads the access state in the instance's database, read-only, like the directory. No
  port and no endpoint are added on the instance; `GET /api/support-access/state` was not needed.
- **The support account** (`support@guestflow.invalid`, « Support GuestFlow », admin role) stays
  inactive in the database with a password nobody holds: the open access, not the account, lets a
  signed link open its session. It is therefore never counted in the plan's quota, never listed in
  the console's directory nor in Paramètres › Utilisateurs, and cannot be edited (404).
- **What the support session cannot do:** decide or revoke its own access, change the password,
  touch the second step or the profile of the account it borrows (403).
- **The trace:** every write is logged with its HTTP status, and every page opened is reported by
  the client (`POST /api/support-access/page`). The red bar sits at the bottom of the screen, clear
  of the app bar and the sticky action bars, with « Quitter ».
- **Read-only instance:** deciding, revoking and an admin turning off another user's second step
  stay allowed while the subscription is unpaid.

**Edge cases:**
- A reset requested for a user who has a second step → the second step is still asked after the new
  password. A reset does not bypass it.
- The administrator's phone is lost and there is no other administrator → backup codes, or the
  operator runs `reset-admin.js --disable-2fa`. That script is recorded in the history.
- An access expires while the support session is open → the next request answers 401 and the session
  ends.
- Two requests in a row → only one pending request; the new reason replaces the old one.

---

## 4. Architecture

### 4.1 Instance (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `auth.js` | T | `forgot`, `reset`, `2fa/*` endpoints, thin |
| `controllers/` | `passwordResetController.js` | C | Rules 1–5 |
| `controllers/` | `twoFactorController.js` | C | Rules 6–10 |
| `controllers/` | `supportAccessController.js` | C | Rules 12–17 |
| `models/` | `passwordResetModel.js`, `twoFactorModel.js`, `supportAccessModel.js` | C | Tokens, secrets, accesses, log |
| `middleware/` | `supportAudit.js` | C | Rule 15 |
| `utils/` | `rateLimiter.js` | C | Rule 3: an in-memory sliding window (express-rate-limit answers 429; the forgotten password must answer the same). Rule 8 is counted in `user_two_factor` |
| shared | `server/src/utils/totp.js` | T (moved) | Rule 11: TOTP + backup codes, moved from `control-plane/server/src/utils/totp.js`; the console requires it through `utils/gf.js`, its existing shared location |
| shared | `utils/supportAccess.js` | C | Rules 12, 14: the signed request and sign-in link, signed by the console and verified by the instance (same JWS as the licence) |
| `utils/` | `accountMailer.js`, `deviceTrust.js`, `httpError.js`, `accountSecurityServices.js`, `accountSecuritySchema.js` | C | The mail transport + dev outbox (rule 5), the trusted-device cookie (rule 7), controller errors, the wiring, the tables (§5) |
| `routes/` | `supportAccess.js`, `users.js` | C/T | Paramètres › Accès du support; `DELETE /api/users/:id/two-factor` (rule 9) |
| `middleware/` | `enforceSubscription.js` | T | Support decisions and the admin's « turn off » stay allowed when read-only |
| `scripts/` | `reset-admin.js` | T | `--disable-2fa` |

### 4.2 Console (`control-plane/`)

- `supportController.js`: request an access, mint the link.
- The « Accès du support » block of `CustomerPage` (`components/SupportAccessSection.jsx`).
- `utils/instances.js` (`readSupportAccess`), `utils/licenceIssuer.js` (`writeFile`, shared by the
  licence and the request), `routes/console.js` (`GET /customers/:id/support`,
  `POST …/support/request`, `POST …/support/link`), `authController.js` (uses the shared TOTP).
- The console reads the access state from the instance through the existing directory/licence channel.
  If it has none, it uses an authenticated endpoint
  `GET /api/support-access/state` with a console-signed request.

### 4.3 Client (`client/src/`)

- Pages:
  - `ForgotPasswordPage`;
  - `ResetPasswordPage`;
  - `LoginPage` (second-step screen);
  - `AccountPage` (2FA block);
  - `settings/SupportAccessPage`.
- Components:
  - `SupportAccessBanner`;
  - `SupportSessionBar`;
  - `BackupCodesDialog`;
  - `OneTimeCodeField` (generic, also usable by the console);
  - `SecondFactorForm` (the second step, shared by the login and the reset page);
  - `AuthCard` (generic: the centred card of the pre-session screens);
  - `TwoFactorSection` (« Mon compte »), `TwoFactorNudgeCard` (dashboard, rule 10).
- Also touched: `App.jsx` (pre-session routes `/mot-de-passe-oublie`, `/nouveau-mot-de-passe`;
  `/parametres/acces-support`; `/login` with a session goes home), `constants/roles.js`
  (`ROUTE_CONDITIONS`: the support page needs `supportAccessEnabled` from `/auth/me`),
  `constants/settingsMenu.js`, `UserManagementPage` (rule 9), `api.js`, `hooks/useAuth.jsx`.

### 4.4 API

| Method | Path | Auth | Rule |
|---|---|---|---|
| GET | `/api/auth/options` | public | 5 — `{ forgotPassword }` |
| POST | `/api/auth/forgot` | public | 1, 3 — always `{ message }` |
| GET / POST | `/api/auth/reset` | public | 2, 4 — check a token / set the password, then log in (or the second step) |
| POST | `/api/auth/login` | public | 7 — the user, or `{ step: 'second-factor', method, message }` |
| POST | `/api/auth/2fa/verify`, `/2fa/resend` | pending login | 7, 8 — `{ code, trustDevice }` |
| GET | `/api/auth/2fa/status` | session | 6, 9, 10 — `{ enabled, method, backupCodesLeft, emailAvailable, nudge, events }` |
| POST | `/api/auth/2fa/start`, `/confirm`, `/disable`, `/backup-codes`, `/snooze` | session | 6, 10 |
| GET | `/api/auth/support?token=` | public | 14 — redirects to `/`, or to `/login?reason=support-link` |
| DELETE | `/api/users/:id/two-factor` | admin | 9 |
| GET | `/api/support-access`, `/banner`, `/:id/log` | admin | 12, 15 |
| POST | `/api/support-access/:id/decide` `{ decision, hours }`, `/:id/revoke`, `/page` | admin | 13, 15 |

`/api/auth/me` gains `supportAccessEnabled` and `supportSession: { expiresAt } | null`.

## 5. Data model

New tables:
- `password_reset_tokens(id, userId, tokenHash, expiresAt, usedAt, createdAt)`;
- `user_two_factor(userId PK, method, secretEncrypted, enabledAt)`;
- `user_backup_codes(userId, codeHash, usedAt)`;
- `support_access(id, reason, requestedAt, decidedBy, decidedAt, expiresAt, revokedAt)`;
- `support_access_log(id, accessId, at, method, path, summary)`.

Changes to existing tables: `users` gains `twoFactorSnoozedUntil`. The support user is created by a
migration, disabled.

Added at implementation (2026-10-08), all created by `utils/accountSecuritySchema.js` from
`database.js`, additive and idempotent:
- `user_two_factor` also holds the enrolment in progress (`pendingMethod`, `pendingSecretEncrypted`,
  `pendingFailures`), the email code (`emailCodeHash`, `emailCodeExpiresAt`), the lock (`failedCount`,
  `lockedUntil`) and `lastTotpStep`. `secretEncrypted` and `pendingSecretEncrypted` are its
  `ENCRYPTED_COLUMNS`.
- `user_backup_codes` has an `id`.
- `user_security_events(id, userId, at, event, actor)` — the account history of rule 9.
- `support_access` also has `requestId` (unique: a decided request never comes back), `decision`
  (`accepted` / `refused`) and `revokedBy`.
- `support_access_links(jti PK, accessId, usedAt)` — the sign-in links already used (rule 14).

## 6. UI / UX

See the summary page. Mobile:
- the code field is numeric (`inputmode="numeric"`, `autocomplete="one-time-code"`);
- the backup codes dialog is full screen.

## 7. Test plan

**Server unit tests:**
- the same answer whether the address exists or not;
- token single use and expiry;
- older links invalidated;
- rate limits;
- sessions ended on reset;
- TOTP enrolment and verification (drift ±1 step);
- backup codes are single use;
- device trust revoked on a password change;
- the lock after 5 wrong codes;
- an admin turns off another user's second step;
- the support link: signature, 2 minutes, single use, no open access means refused;
- the audit log is written;
- expiry ends the session.

**Client unit tests:** the second-step screen, the banner states and the support bar.

**E2E:**
- forgot password through the dev mail catcher;
- enable TOTP and log in with a computed code;
- the support flow with a locally signed link.

**Mobile check:** the login with a code at 390px.

## 8. Out of scope

- Forcing two-step login on every account.
- WebAuthn and passkeys.
- SSO.
- Support access to a self-hosted instance.

## 9. Open questions

None. The options are the recommended ones, taken under the owner's instruction to run the plan
through.

## 10. Implementation progress

Implemented 2026-10-08 on `feature/hosting-h2-account-security` (target `inte/plugins`).

- **Server:** 3 suites, one per subject — `hosting-h2-password-reset` (13 tests), `hosting-h2-two-factor`
  (17), `hosting-h2-support-access` (13) — over the shared fixture `accountSecurityFixture.js`.
  `control-plane-first-admin` now ignores the support account.
- **Console:** `support-access.unit.test.js` (5); the operator 2FA suite (`operator-auth`) runs on the
  moved TOTP module unchanged.
- **Client:** `SecondFactorForm.second-step` (5), `SupportAccessBanner.states` (4),
  `SupportSessionBar.support-bar` (2), `roles.support-access` (2); the role suites give their admin
  `supportAccessEnabled`. Console client: `SupportAccessSection.support-access` (3).
- **E2E:** `e2e/specs/account-security/hosting-h2.spec.js` (3), through the dev outbox and a TEST-ONLY
  key pair (`e2e/fixtures/accountSecurity.js`).
- **Browser check** on a copy of the dev database at 1280 px and 390 px: forgotten password through
  the outbox, refusal of a short password, TOTP enrolment (wrong code refused), backup codes, login
  with a computed code, trusted device, backup code at login, lock after 5 codes, banner, support
  session with its red bar, reuse of a link refused, journal, revocation ending the support session,
  plain login of an account without a second step unchanged. No console error.
