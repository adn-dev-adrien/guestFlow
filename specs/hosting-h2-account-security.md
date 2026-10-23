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
   - Added 2026-10-17 (review): an address is counted only for a caller still under the IP limit,
     so a flood from one IP does not use up the hourly quota of the addresses it names. The counters
     stay bounded in memory: expired entries are swept on a timer and past 10 000 keys the one hit
     least recently gives way.
4. The link opens « Nouveau mot de passe », which applies the existing password rules. Saving it ends
   every session of that user and logs the user in.
5. The email uses the instance's mail transport. This is the platform sender on a managed instance
   (H1 rule 18). Without any transport, the link is not shown on the login page.
   - Added 2026-10-08 at implementation: the link points to the application's public address
     (Réglages › Système, else `GUESTFLOW_PUBLIC_URL` set by the hosting), never to the request's
     `Host` header, which a caller chooses. Without that address the link is not offered either.
   - The answer leaves before the email, so a known and an unknown address cost the same time.
     Since 2026-10-17 (review) it leaves before the address is even looked up: the counters, the
     lookup, the token and the email all run after the response.
   - `GUESTFLOW_MAIL_OUTBOX=<dir>` writes the account emails as files instead of sending them: the dev
     mail catcher of the E2E suite. It is refused when `NODE_ENV=production`.

### 3.B Two-step login

6. In « Mon compte », any user can turn on a second step:
   - **an authenticator app (TOTP)**, enrolled by scanning a QR code and confirmed by a first code;
   - **or a code sent by email.**

   Turning it on shows 10 single-use backup codes once, with « Télécharger » and « Copier ».
   Since 2026-10-17 (review) that dialog closes on « Terminé » only, never on a click outside or
   Escape: the codes are not shown again.
   - Details (2026-10-08, at implementation): turning it on, turning it off and renewing the backup
     codes ask for the password again; 5 wrong codes while enrolling cancel the enrolment; a TOTP code
     is accepted once (its time step is remembered), as on the console.
   - 2026-10-23 (inte/plugins review): the « Mon compte » second-step routes
     (`/api/auth/2fa/status|start|confirm|disable|backup-codes|snooze`) apply the same gate as every
     business route — a deleted or deactivated account is refused (401, its session ended), one
     still on its default password gets 403 `PASSWORD_CHANGE_REQUIRED`; the user is re-read from the
     database, never taken from the session copy.
7. **Once it is on, the login asks for the code after the password.**
   - « Faire confiance à cet appareil 30 jours » skips the step on that browser.
   - The trust is stored in a signed cookie and revoked when the user changes their password or turns
     the second step off.
   - How (2026-10-08): the cookie's HMAC also covers a fingerprint of the password hash and the date
     the second step was turned on, so a new password or a step turned off revokes every trust given
     before, with no table to purge. One cookie per account (`guestflow.trust.<id>`, `HttpOnly`,
     path `/api/auth`).
   - The code screen (2026-10-17, review): « Utiliser un code de secours » switches the field to the
     letter keyboard; « Utiliser le code de l'application » (or « Utiliser le code reçu par email »)
     switches back to the numeric keypad. A backup code pasted in the numeric field is still taken.
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
    - Clarified 2026-10-17 (review): what the support session may not do (its own access, the account
      it borrows, rule 18) is judged on the path Express actually routes — any letter case, a trailing
      slash, doubled slashes — and refused again by the access controller itself, whatever the path.
      A refused request is logged too. The reads are logged by the server as well (rule 19).
16. **The support session shows a red bar « Session support — <expiry> »** so screenshots are never
    mistaken for the customer's own.
    - 2026-10-17 (review): on a phone the bar keeps clear of the home indicator
      (`env(safe-area-inset-bottom)`).
17. **An instance without licence key cannot be opened.** On an instance that is not managed (no
    `GUESTFLOW_LICENCE_PUBLIC_KEY`), support access is not offered at all and its page is hidden.
18. **A support session changes no account and no credential** (added 2026-10-17, review). Whatever
    the administrator rights it borrows, it answers 403 « Identifiants et accès réservés au client. »
    on:
    - any write under `/api/users` (creating an account, changing an email or roles, resetting a
      password, turning off someone's second step) — reading stays possible;
    - the settings that hold a credential or where the account emails point: the SMTP connection
      (the `smtp` group), a plugin setting declared
      `secret`, the Google connection (`/api/google-calendar/oauth/*`, the calendar), the Qonto
      credentials and provider connection, the Neat credentials and environment.

    Nothing the support does can therefore outlive the access.
    - Widened 2026-10-17 (second review): also refused, for any method, the Qonto OAuth connection
      (`/api/payments/qonto/authorize`, `/callback`, `/refresh-connection`) and
      `GET /api/settings/gate-connector/secrets`, the only endpoint that returns secrets in clear;
      uninstalling or turning off a plugin (`DELETE /api/plugins/:id`, `POST …/deactivate`), which
      erases or strands its credentials — installing, activating and updating stay allowed; and the
      whole SMTP group, the sender name and address included.
    - Widened 2026-10-23 (inte/plugins review): the sender name written by the start assistant
      (`senderName` on `PUT /api/onboarding/emails`), and a property's access code and Wi-Fi
      password, whether the start assistant (a non-empty `accessCode` / `wifiPassword` in
      `properties[]`) or the property page (`accessCode` / `wifiPassword` present on
      `PUT /api/properties/:id/arrival-facts`, clearing included) writes them. The other fields of
      those two forms stay open.
19. **The server logs what the support reads too** (added 2026-10-17, review). Every `GET` of a
    support session is written to `support_access_log`, once per path and per minute, besides the
    pages the client reports (rule 15). What the application polls by itself (`/api/auth/*`,
    `/api/support-access/*`, `/api/version`) is not.
20. **The customer reads the log in plain French** (added 2026-10-17, review). The server words each
    entry — « Réservation 12 modifiée », « Consultation : Réservations », « Page ouverte : Planning »,
    « Connexion du support » — with its outcome « Effectué » or « Refusé ». No method, raw path or
    HTTP code is shown; the table keeps them.
21. **The support account is told by a flag, never by its email** (added 2026-10-17, review).
    - `users.isSupportAccount` marks it; an existing database marks the account it already has.
    - A support session is recognised by the marker its sign-in link leaves in the session, so a
      changed account could not escape the guard either.
    - No write of the users model touches it: identity, email, roles, password, active flag
      (`SUPPORT_ACCOUNT_LOCKED`, 403 on « Mon compte »). Only the access lifecycle opens a session
      with it.
    - The admin recovery (`reset-admin.js`) never picks it: on an instance whose bootstrap admin was
      removed by `create-first-admin.js`, it restores the customer's oldest administrator.
22. **A managed instance accepts support only for its own slug** (added 2026-10-17, review). With
    `GUESTFLOW_LICENCE_PUBLIC_KEY` set, the request file and the sign-in link must name the instance's
    slug: `GUESTFLOW_SLUG` when the hosting sets it, else the slug of the verified licence (the
    console's provisioning does not set `GUESTFLOW_SLUG`). An instance that can tell neither accepts
    nothing.
23. **A route that hands out, creates or rotates a secret is refused to a support session** (added
    2026-10-18, code review M2). A plugin declares such routes with `ctx.secretRoutes([{ method, re }])`
    (method `'*'` for any; `re` on the lower-case path below `/api`, like `ctx.roleAccess`), and the
    guard refuses them with rule 18's « Identifiants et accès réservés au client. », whatever the case
    or a trailing slash. Declared today: the Booking userscript and its secret
    (`GET /api/booking-intake/userscript.user.js`, `POST /api/booking-intake/secret`,
    `POST …/secret/regenerate`, `specs/booking-extranet-intake.md` rule 26) and the gate connector's
    keys (`GET /api/settings/gate-connector/secrets`). The core also refuses rotating a property's iCal
    export token (`POST /api/ical/regenerate-token/:id`), which breaks the feed every platform imports.
    Audit of the other plugins on that date: the Météo-France key is a setting declared `secret`
    (rule 18), the Google, Qonto and Neat credentials are already refused, the website's
    `PUBLIC_API_KEY` is never returned by any route.
24. **Reading a property's iCal export token is refused to a support session too** (added 2026-10-18,
    second review of the code review). `GET /api/ical/token/:id` returns the feed's address in clear and
    creates the token on its first read, so it falls under rule 23: refused with « Identifiants et
    accès réservés au client. », whatever the case or a trailing slash. The public feed
    (`GET /api/ical/export/:token`) is unchanged. The property's iCal card shows that refusal instead
    of an empty address field.
25. **The journal folds the reads** (added 2026-10-18, console review m8). In Paramètres › Accès du
    support, the successful reads of one minute in a row — the pages opened and the API calls behind
    them — make one line « Consultation : Planning, Linge », each name once, in the order they were
    opened. A read that names nothing joins the line silently (alone, the line reads « Consultation »).
    Writes, refused requests and « Connexion du support » keep their own line. The table keeps every
    raw row (rule 19); only the wording folds.
26. **A request just sent reads « En attente »** (added 2026-10-18, console review m3). The console
    reads the request it wrote (verified with its key, never through a link the instance planted) and,
    while the instance has not imported it yet, shows it pending with its reason — the form is no
    longer offered right after « Demande envoyée ». Once the instance imported it, its own row
    decides again.

**Implementation choices (2026-10-08, the recommended options, see the summary page):**
- **The channel.** The console signs the request with the licence key and writes it to
  `<dataDir>/support-request.jws`, next to the licence; the instance verifies it with
  `GUESTFLOW_LICENCE_PUBLIC_KEY` and its slug (rule 22) when an administrator loads a page.
  The console reads the access state in the instance's database, read-only, like the directory. No
  port and no endpoint are added on the instance; `GET /api/support-access/state` was not needed.
- **The support account** (`support@guestflow.invalid`, « Support GuestFlow », admin role) stays
  inactive in the database with a password nobody holds: the open access, not the account, lets a
  signed link open its session. It is therefore never counted in the plan's quota, never listed in
  the console's directory nor in Paramètres › Utilisateurs, and cannot be edited (404).
- **What the support session cannot do:** decide or revoke its own access, change the password,
  touch the second step or the profile of the account it borrows (403), nor any account or
  credential (rule 18).
- **The trace:** every write is logged with its HTTP status, every read once a minute (rule 19), and
  every page opened is reported by the client (`POST /api/support-access/page`); the customer reads
  them worded (rule 20). The red bar sits at the bottom of the screen, clear
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

**Review of 2026-10-18**

27. **The first login is the company email.** At step 1 of the start assistant, when the administrator
    still logs in with the bootstrap `admin@guestflow.local`, the company email typed becomes the login
    (unless another account holds it), and the assistant says so once: « Connexion désormais avec … ».
    « Mot de passe oublié » then reaches a real mailbox. A login the owner chose is never changed.
28. **The enrolment code is spent.** The authenticator code that confirms the enrolment records its
    step, like a login code (rule 6): the same code cannot open a session in the same 30 s, even from
    another browser.
29. **The method picker fits a phone.** « Appli d'authentification » / « Code par email » stack in one
    full-width column below 600 px and sit on one row above, in sentence case.
30. **One « Mot de passe actuel » per page.** « Mon compte » shows it on the password card; the
    « Second code » card asks for the same password as « Mot de passe (confirmation) », so the two
    fields are never read as two different passwords.
31. **A plugin's secret route is declared once, by the plugin** (added 2026-10-18, final code review,
    low 2). The website connection (`GET /api/settings/website-connection`,
    `POST …/regenerate`, which hand out and rotate the WordPress site's `PUBLIC_API_KEY`) and the gate
    connector's keys (`GET /api/settings/gate-connector/secrets`) are refused to a support session
    only through the `ctx.secretRoutes` their plugins declare (rule 23); `supportSessionPolicy` keeps
    no hard-coded copy of them. A plugin that is not installed serves neither route. Rule 23's « the
    website's `PUBLIC_API_KEY` is never returned by any route » no longer holds since the website
    connection card (plugins-phase-2-hosts rules 30-31): that route is refused here.

**UI/UX review of 2026-10-18 (proposal 23, decided 2026-10-19)**

32. **The second code is one field that looks like six cells, sent at the 6th digit.** The code screen
    has ONE native input (`autocomplete="one-time-code"`, `inputmode="numeric"`), transparent, laid
    over six drawn cells that mirror its value: iOS/Android autofill and paste fill it as any field,
    which six separate inputs would break. The code is sent as soon as it has 6 digits, or as soon as
    a whole backup code (`xxxxx-xxxxx`) is typed; there is no « Valider » button (Enter still sends a
    complete code). A code being checked shows « Vérification… » under the cells, and a second
    complete code is not sent before the answer. The backup code switch of rule 7 stays: the field
    then draws one wide cell (placeholder `xxxxx-xxxxx`) and opens the letter keyboard. The title of
    the screen is « Vérification »; the trust box of rule 7 reads « Se souvenir de cet appareil
    (30 jours) » and sits **above** the cells, since an autofilled code is sent at once (the review's
    mock had it below; above is the only place it can still be ticked in time).
33. **A refused code is said where it was typed.** The server's refusal (« Code incorrect. », the lock
    of rule 8) is written under the cells (`role="alert"`, tied to the input by `aria-describedby`),
    the cells turn red and shake once (no movement under `prefers-reduced-motion`: the colour only), and
    the digits stay, selected, so the next keystroke replaces them. Typing again clears the message.
    Before, the field emptied, « Valider » greyed out and the error sat at the top of the card.
34. **The console's operator login uses the same field** (`@gf/components/OneTimeCodeField`), with the
    same sending at the 6th digit and refusal under the cells: it no longer accepts and sends a 5-digit
    code. « Renvoyer le code » (email method) and « Changer d'email » stay. The enrolment of
    « Mon compte » (rule 6) draws the same cells but keeps its « Confirmer » button; its wrong code is
    said under the cells like at login (rule 33), not in an alert at the top of the card (review of
    PR #720).
35. **No input leaves the user stuck** (added 2026-10-19, review of PR #720). Since there is no
    « Valider », whatever is typed or pasted must either send or say why:
    - the field takes the code out of what arrives: « Votre code : 123 456 » or « 123-456 » is the
      6-digit code (six cells, sent); a backup code typed or pasted without its dash, or with a space,
      gets its dash back (`xxxxx-xxxxx`, sent); digits beyond the 6th are dropped. The input has no
      length cap, so a pasted sentence is never cut before the code is found;
    - Enter on an incomplete value says why under the cells: « Code incomplet : 6 chiffres. » or
      « Code de secours incomplet : 10 caractères (xxxxx-xxxxx). »; nothing is sent;
    - the server reads the code the same way (`totp.normalizeCode`, shared with the console): spaces,
      dots and dashes out of a 6-digit code, the dash back into a 10-character backup code;
    - the input is transparent ink over the cells, never `opacity: 0`, which password managers take
      for a hidden field (selection and autofill colours transparent too).
36. **A managed instance refuses the E2E suite's key** (added 2026-10-23, security review of
    `inte/plugins`). The E2E suite signs its support links with a TEST-ONLY Ed25519 pair whose private
    half is committed (`e2e/fixtures/accountSecurity.js`): anyone can sign a licence, a registry index
    or a support link for its public half. With `GUESTFLOW_MANAGED=1`, an instance whose
    `GUESTFLOW_LICENCE_PUBLIC_KEY` or `GUESTFLOW_REGISTRY_PUBLIC_KEY` is that key refuses to start
    (`server/src/utils/testOnlyKeys.js`, checked first thing in `index.js`). Unmanaged installs, the
    E2E server included, are unaffected.

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
| `middleware/` | `supportAudit.js` | C | Rules 15, 18, 19: the support session's guard (by its session marker) and trace |
| `utils/` | `supportSessionPolicy.js` | C | Rules 15, 18: what a support session may not do, on the normalised path |
| `utils/` | `supportLogLabels.js` | C | Rule 20: the log entries worded for the customer |
| `utils/` | `rateLimiter.js` | C | Rule 3: an in-memory sliding window, swept and capped (express-rate-limit answers 429; the forgotten password must answer the same). Rule 8 is counted in `user_two_factor` |
| shared | `server/src/utils/totp.js` | T (moved) | Rule 11: TOTP + backup codes, moved from `control-plane/server/src/utils/totp.js`; the console requires it through `utils/gf.js`, its existing shared location |
| shared | `utils/supportAccess.js` | C | Rules 12, 14: the signed request and sign-in link, signed by the console and verified by the instance (same JWS as the licence) |
| `utils/` | `accountMailer.js`, `deviceTrust.js`, `httpError.js`, `accountSecurityServices.js`, `accountSecuritySchema.js` | C | The mail transport + dev outbox (rule 5), the trusted-device cookie (rule 7), controller errors, the wiring, the tables (§5) |
| `routes/` | `supportAccess.js`, `users.js` | C/T | Paramètres › Accès du support (`buildRouter` for tests; a support session is flagged by its marker); `DELETE /api/users/:id/two-factor` (rule 9) |
| `middleware/` | `enforceSubscription.js` | T | Support decisions and the admin's « turn off » stay allowed when read-only |
| `scripts/` | `reset-admin.js` | T | `--disable-2fa`; never restores the support account (rule 21, through `usersModel.resetAdminToDefault`) |
| `models/` | `usersModel.js` | T | Rule 21: `isSupport` from `isSupportAccount`, `findSupportAccount()`, every write refuses the support row |
| `utils/` | `licence.js` | T | Rule 22: `slug()`, the instance's slug as the verified licence names it |

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
  - `OneTimeCodeField` (generic, used by the console too; « Utiliser un code de secours »
    switch, rule 7; one input drawn as six cells, `onComplete` at the 6th digit, the refusal under the
    cells, rules 32–34);
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
| GET | `/api/support-access`, `/banner`, `/:id/log` | admin | 12, 15, 20 — log entries `{ at, atLabel, label, outcomeLabel }` |
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
- Added 2026-10-17 (review): `users.isSupportAccount INTEGER NOT NULL DEFAULT 0` — the support
  account's flag (rule 21), set on the existing support row by its creation address.

## 6. UI / UX

See the summary page. Mobile:
- the code field is numeric (`inputmode="numeric"`, `autocomplete="one-time-code"`);
- the backup codes dialog is full screen.

*2026-10-19 (rules 32–34):* the code screen is « Vérification »: the server's message, « Se souvenir de
cet appareil (30 jours) », six cells (one wide cell for a backup code), the message line under them
(« Vérification… », « Nouveau code envoyé… » or the refusal), « Utiliser un code de secours », then
« Retour » / « Renvoyer le code ». Same layout on a phone and on a desktop (the card is 400 px at
most); at 390 px each cell is about 45 px wide. Interactive mock:
[`docs/specs/2026-10-19-otp-field-and-guest-email-html.html`](../docs/specs/2026-10-19-otp-field-and-guest-email-html.html).

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
- expiry ends the session;
- 2026-10-17 (review): the guard through a real Express router with odd casing and trailing slashes,
  the controller refusing the support on its own, rule 18's refusals, the reads logged once a
  minute, the worded log, the support account's flag and locks, `reset-admin.js` after
  `create-first-admin.js`, the slug from the licence, the forgotten password answering before any
  lookup, the bounded counters.
- 2026-10-18 (code review): `ctx.secretRoutes` and the iCal token rotation refused to a support
  session (rule 23) — `hosting-h2-support-secret-routes.unit.test.js`, and booking-intake's
  `secret-lifecycle.unit.test.js`.
- 2026-10-18 (final code review): rule 31 — with an empty plugin registry the two routes are not
  refused, once the real `gate-access` / `website-booking` `register(ctx)` ran they are, any case and
  trailing slash (`hosting-h2-support-secret-routes.unit.test.js`, `hosting-h2-support-guard.unit.test.js`,
  website-booking's `site-connection.unit.test.js`).
- 2026-10-23 (security review): rule 36 — a managed install with the test-only key as either
  variable refuses to start, an unmanaged one or a managed one with another key starts
  (`hosting-h2-test-only-key.unit.test.js`, 3).

**Client unit tests:** the second-step screen, the banner states and the support bar; the backup-code
switch of the code field and the backup codes dialog closing on « Terminé » only (2026-10-17).
Review of PR #720 (rules 34–35): `OneTimeCodeField.extract` (6: backup code without its dash, pasted
« 123-456 », a 7th digit, « Votre code : 123 456 », no length cap and no `opacity: 0`, the incomplete
messages), `SecondFactorForm.second-step` (+1: Enter on an incomplete code), console
`LoginPage.second-factor` (+1), `TwoFactorSection.enrol-error` (1); server
`hosting-h2-code-normalize` (3), console `operator-code-normalize` (1).
2026-10-19 (rules 32–34): `OneTimeCodeField.autosubmit` (4: one input mirrored by six cells, sent once
at the 6th digit, paste and backup code, the refusal under the cells with the digits selected),
`SecondFactorForm.second-step` (6, rewritten: no « Valider », trust box sent, no second send while
busy, refusal under the field), console `LoginPage.second-factor` (5: sent at the 6th digit, never at
the 5th, refusal under the cells).

**E2E:**
- forgot password through the dev mail catcher;
- enable TOTP and log in with a computed code (2026-10-19: a wrong code first, said under the cells,
  then the right one sent at its 6th digit with no « Valider »);
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

- **Server:** 5 suites, one per subject — `hosting-h2-password-reset` (17 tests), `hosting-h2-two-factor`
  (17), `hosting-h2-support-access` (13), and since the 2026-10-17 review `hosting-h2-support-guard`
  (7, rules 15, 18-20) and `hosting-h2-support-account` (7, rules 21-22) — over the shared fixture
  `accountSecurityFixture.js`.
  `control-plane-first-admin` now ignores the support account.
- **Console:** `support-access.unit.test.js` (5); the operator 2FA suite (`operator-auth`) runs on the
  moved TOTP module unchanged.
- **Client:** `SecondFactorForm.second-step` (5), `OneTimeCodeField.backup-code` (3),
  `BackupCodesDialog.closing` (1), `SupportAccessBanner.states` (4),
  `SupportSessionBar.support-bar` (2), `roles.support-access` (2); the role suites give their admin
  `supportAccessEnabled`. Console client: `SupportAccessSection.support-access` (3).
- **E2E:** `e2e/specs/account-security/hosting-h2.spec.js` (3), through the dev outbox and a TEST-ONLY
  key pair (`e2e/fixtures/accountSecurity.js`).
- **Browser check** on a copy of the dev database at 1280 px and 390 px: forgotten password through
  the outbox, refusal of a short password, TOTP enrolment (wrong code refused), backup codes, login
  with a computed code, trusted device, backup code at login, lock after 5 codes, banner, support
  session with its red bar, reuse of a link refused, journal, revocation ending the support session,
  plain login of an account without a second step unchanged. No console error.

**UI/UX review, 2026-10-19 (`feature/ui-otp-html-emails`, target `inte/plugins`):** rules 32–34 —
`OneTimeCodeField` rewritten as one input drawn as six cells with `onComplete`; `SecondFactorForm`
without « Valider », trust box above the cells; `LoginPage` / `ResetPasswordPage` titled
« Vérification »; the console's `LoginPage` on the shared field. Checked in a browser at 390, 900 and
1280 px.

**Review fixes (2026-10-17, `fix/h2-review-findings`, target `inte/plugins`):** the guard judged on the
routed path and doubled in the access controller (rule 15); the support account told by a flag and
locked in the model, never picked by the admin recovery (rule 21); no account or credential write by
a support session (rule 18); the reads logged server-side (rule 19) and the log worded for the
customer (rule 20); the slug required, taken from the licence when the hosting does not set it
(rule 22); the forgotten password answering before any lookup, bounded counters (rules 3, 5); the
backup-code switch (rule 7), the backup codes dialog closed by « Terminé » only (rule 6), the red bar
clear of the home indicator (rule 16).
