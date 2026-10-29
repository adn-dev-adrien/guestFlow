# Hosting H2 — accounts: forgotten password, two-step login, support access with consent

| Field | Value |
|---|---|
| **Status** | Implemented (rules 1–37) · Implemented (rules 38–53, UX review of 2026-10-28, owner decisions of 2026-10-28) · Implemented (rules 59–62, authz audit of 2026-10-28; rule 18 widened) · Implemented (rule 63, authz audit R2 of 2026-10-29) |
| **Branch** | `feature/hosting-h2-account-security` (from `inte/plugins`) |
| **Created** | 2026-10-08 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) §14 « Security » |
| **Console** | [`specs/control-plane-plans-and-access.md`](control-plane-plans-and-access.md) — rule 25 (a password reset stays on the instance), rule 31 (operator 2FA, reused here) |
| **Summary for review** | [`docs/specs/2026-10-08-hosting-h2-account-security.html`](../docs/specs/2026-10-08-hosting-h2-account-security.html) — rules 38–53: [`docs/specs/2026-10-28-account-two-factor-ux.html`](../docs/specs/2026-10-28-account-two-factor-ux.html) |
| **Amendment branch** | `feature/account-two-factor-ux` (from `inte/plugins`, 2026-10-28) |

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
- **(2026-10-28)** Turning the second step on looks and works as on every other site: one dialog, a QR
  code or a tap on a phone, one code, backup codes saved before leaving — with no security property
  weakened and the confirmation password's guessing gap closed.

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
    - Widened 2026-10-28 (audit authz H1, PR #840 review): a plugin setting declared `supportLocked` stays
      readable, and is refused to a support session only when the value sent **differs from the stored one**
      (the card's form sends every key, so an unchanged save passes) — the intake plugins' `imapHost`,
      `imapPort`, `senderAddress`, `senderDomains` and `trustedAuthservId`, which decide where the SMTP password
      is sent and who vouches for a sender (`specs/airbnb-mail-intake.md` rules 22–23). Also refused:
      `POST /api/plugins/:id/rollback` and `POST /api/plugins/:id/update` with a chosen `version`, since a
      support session must not bring back code from before a security fix (the newest-version update stays
      allowed). Test: `mail-intake-credential-destination.unit.test.js`.
    - Widened 2026-10-28 (audit authz M3): a support session also cannot change the property's keypad code
      (`company.portalCode`), the bank details printed on a devis (`company.iban`, `company.bic` — forbidden as
      the safe default, the owner can relax it later), nor where the booking notifications go. The latter is
      judged on the RESOLVED identity (`utils/emailIdentity.js`: recipient ← `notifications.recipientEmail`
      || sender || `company.email`): a write that changes the resolved `recipient` or `fromEmail` is refused,
      whether it comes through `notifications.recipientEmail` or `company.email`, on `PUT /api/settings` and
      `PUT /api/onboarding/company` (on prod the first two are empty, so the company email IS the recipient).
      The settings page sends its whole group on every save: only a value that differs from the stored one is
      refused. The refusal is a logged 403 like the others. Tests: `hosting-h2-support-settings-fields.unit.test.js`.

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

27. **The first login is the company email** *(opt-in since 2026-10-27, rule 37)*. At step 1 of the start assistant, when the administrator
    still logs in with the bootstrap `admin@guestflow.local`, the company email typed becomes the login
    (unless another account holds it), and the assistant says so once: « Connexion désormais avec … ».
    « Mot de passe oublié » then reaches a real mailbox. A login the owner chose is never changed.
28. **The enrolment code is spent.** The authenticator code that confirms the enrolment records its
    step, like a login code (rule 6): the same code cannot open a session in the same 30 s, even from
    another browser.
29. **Withdrawn (2026-10-28, rule 39).** *The method picker fits a phone.* The picker no longer exists:
    the card is a status and one button, the app is the method and the email code a fallback link
    inside the dialog (rule 44), whose full-screen layout is rule 52.
    > **Sans test** — règle retirée : son sujet (le sélecteur de méthode) n'existe plus ; la mise en page du téléphone est couverte par la règle 52.
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
37. **The login e-mail never changes implicitly** (audit 2026-10-27; amends rule 27). Saving the
    « Entreprise » step silently replaced the bootstrap login with the company e-mail, and an operator
    who kept typing `admin@guestflow.local` was locked out. Step 1 now shows « Utiliser aussi cette
    adresse pour se connecter », **unticked by default** and only while the administrator still logs in
    with the bootstrap address (`GET /api/onboarding` → `login.canAdopt`). Only a ticked box
    (`PUT /api/onboarding/company` with `useAsLogin: true`, a literal boolean) replaces the login, with
    the rest of rule 27 unchanged (an address another account holds is kept; « Connexion désormais
    avec … » said once at step 2). Unticked, the login stays as it is.

### 3.D « Validation en deux étapes » — the activation as every site does it (UX review of 2026-10-28)

Owner feedback on the shadow (2026-10-28): « l'activation Second code [doit être] comme tous les autres
sites l'activation de la double authentification […] simplifie cette activation comme c'est
habituellement fait, soigne l'UX. » It IS that feature (rules 6–10: TOTP + email code + 10 backup
codes). What differs from the usual pattern today (`client/src/components/TwoFactorSection.jsx`):

- the card opens on a method picker and a password field before anything is explained
  (`TwoFactorSection.jsx:127-153`); the QR, the key and the code then replace that form inside the card
  (`:156-175`), so the page grows and jumps;
- the key is printed as a caption with no copy button (`:162-164`), and nothing is offered to a phone,
  which is the very device that runs the authenticator: it cannot scan its own screen;
- a wrong code says « Code incorrect. » without how many tries are left; the 5th silently drops the
  form (`:75`);
- the backup codes can be closed with « Terminé » without having been copied or downloaded
  (`BackupCodesDialog.jsx:67`);
- once on, the card reads one line « Appli d’authentification · codes de secours restants : 8 »
  (`:117-119`); there is no way to move to a new phone short of turning the step off (which leaves the
  account unprotected in between);
- the password typed to turn it on, off or renew the codes is checked with no attempt limit
  (`twoFactorController.js:49-53`, only `apiLimiter`'s 3000 / 15 min applies): a stolen session can
  guess the password through these three routes. This is the one security gap the review found;
- the enrolment in progress never expires (`user_two_factor.pendingMethod` stays until replaced).

The rules below change the presentation and close those gaps. **No security property of rules 6–10
and 28 is weakened**: the password is still asked before anything changes, codes are still limited,
every change still writes the journal, the secret still never leaves the server after the enrolment.

38. **The feature is called « Validation en deux étapes »** *(resolved 2026-10-28, §9 Q1)*. Every UI string that says « Second code » / « second code » uses it: the « Mon compte » card,
    the dashboard card (rule 10), the journal labels (rule 9), Paramètres › Utilisateurs (« Désactiver
    la validation en deux étapes », its dialog and success message), the backup codes text. The login's
    code screen keeps its title « Vérification » (rule 32). The settings search keeps « Second code »,
    « 2FA » and « Double authentification » as keywords, so the old name still finds the page. The
    wording lives in `client/src/constants/twoFactor.js` for the client and in `EVENT_LABELS` /
    `dashboardAttention.js` for the server.
39. **Turned off, the card is a status and one button** (amends rules 6, 29, 30). Title, a
    `StatusBadge` « Désactivée », one line « Code de l’appli d’authentification demandé à chaque
    connexion, en plus du mot de passe. », and « Activer ». No method picker and no password field in the
    card any more: they move into the activation dialog (rule 40). The `PasswordField` of rule 30 keeps
    its label « Mot de passe (confirmation) » there.
40. **Activation is a three-step dialog**: « Mot de passe » → « Appli » → « Codes de secours », with
    « Étape n sur 3 » under the title. Full screen on a phone (`fullScreen` below `sm`), 480 px wide
    above.
    - Step 1 asks the password and calls `POST /api/auth/2fa/start` with `method: 'totp'`. A wrong
      password is said under the field (`BAD_PASSWORD`, rule 49's lock included); the step does not
      move.
    - Steps 1–2 can be left at any time (« Annuler », Escape, the close icon): the client calls
      `POST /api/auth/2fa/cancel`, which drops the enrolment in progress. Nothing was changed, and the
      card says nothing.
    - Step 3 closes on « Terminé » only (rule 6 unchanged), and « Terminé » waits for rule 45.
    - The dialog keeps its state if the page loses focus (the user switches to the authenticator app and
      comes back); on its return to the foreground (`visibilitychange`) the code field takes the focus.
41. **Step 2 is built for the device it runs on.** The server returns, besides `qrDataUrl` and the key
    grouped by four (`secret`), the `otpauthUri` and the two names the authenticator will show
    (`issuer` « GuestFlow », `accountLabel` « <company name> · <email> », company name from
    Réglages › Entreprise, the email alone when it is empty). The client picks the layout by capability
    (`(pointer: coarse)`), never by user agent or width:
    - **pointer fine (computer):** the QR code (200 px, white quiet zone), then a disclosure « Saisie
      manuelle de la clé » which reveals the key (monospace, groups of 4, `SecretRevealField`
      unmasked with « Copier ») and one line « Basé sur l’heure · 6 chiffres · 30 s ».
    - **pointer coarse (phone, tablet):** first « Ouvrir dans l’appli d’authentification » (a plain
      `<a href="otpauth://…">`, filled button), then « Copier la clé » (key shown under it), then
      « Afficher le QR code » (folded: to scan from another device). When no app answers the link the
      browser says so itself; « Copier la clé » is the fallback right below.
    - Both show the names the entry will carry (« GuestFlow — Domaine des Oliviers · a@b.fr ») so the
      user recognises it in a list of many.
    - The secret is returned only by `start`, only while the enrolment is pending; `status` never
      returns it (unchanged).
42. **One field, sent at the 6th digit, the refusal says the tries left** (amends rule 34 for the
    enrolment: no « Confirmer » button any more, as at login, rule 32). `OneTimeCodeField` under
    « Code affiché par l’appli », `onComplete` → `POST /2fa/confirm`.
    - A wrong code answers 400 `BAD_CODE` with `attemptsLeft` and a message built by the server:
      « Code incorrect : 4 essais restants. »; from the 3rd refusal it adds « Vérifier l’heure du
      téléphone. » (a skewed clock is the usual cause). Said under the cells (rule 33): red cells,
      one shake, digits selected.
    - The 5th wrong code still cancels the enrolment (rule 6, `TOO_MANY_CODES`): the step shows
      « Trop de codes incorrects : activation annulée. » and one button « Recommencer » (back to
      step 1, a new secret). The old QR is never reused.
43. **An enrolment expires after 15 minutes** (new). `start` stamps `pendingStartedAt`; `confirm` on an
    older enrolment answers 410 `ENROLMENT_EXPIRED` « Activation expirée : recommencer. » and drops it.
    Same screen as rule 42's 5th refusal.
44. **The email code is the fallback, not a peer** *(resolved 2026-10-28, §9 Q3)*. Step 2
    ends with a discreet link « Pas d’appli ? Recevoir le code par email » (only when
    `emailAvailable`). It calls `start` with `method: 'email'` **without the password again**, which the
    server accepts only while an enrolment it opened with the password is pending and less than 15
    minutes old (rule 43); otherwise it asks for the password (400 `BAD_PASSWORD`). Step 2 then shows
    « Code envoyé à a•••@b.fr », the same code field, « Renvoyer le code » (allowed 60 s after the last
    send, 5 sends per enrolment: 429 `RESEND_TOO_SOON` « Nouvel envoi possible dans 42 s. », then
    429 `TOO_MANY_SENDS`) and « Utiliser plutôt une appli » back to the app layout (a new secret). The
    step's title becomes « Email ».
    - **Amended 2026-10-28 (review, rule 54):** the password-free switch is for a FIRST activation only,
      and needs the enrolment's random token; it is never available on a replacement (rule 48), whose email
      link is therefore not offered. The switch keeps the enrolment's start: it never extends the 15
      minutes, and the sends counter carries over. An enrolment that has expired when the switch is tried
      ends (« Activation expirée : recommencer. » and « Recommencer »), never asks a password under the
      code cells.
    - « Renvoyer le code » is `POST /2fa/code`, which also sends a re-authentication code (rule 47)
      for an account on the email method. An account already on the email method cannot start an
      email enrolment (409 `SAME_METHOD`).
45. **The backup codes must be saved before « Terminé »** (amends rule 6's dialog). Step 3 shows the
    10 codes (two columns, monospace, `tabular-nums`, one column below 360 px), « Copier »,
    « Télécharger » (the `.txt` of today, now named `guestflow-codes-de-secours-<date>.txt`) and a box
    « Codes enregistrés en lieu sûr ». « Terminé » stays disabled until the box is ticked; copying or
    downloading ticks it. « Copié » / « Téléchargé » answer on the button itself for 2 s. The same panel
    is used after « Nouveaux codes de secours » (rule 47).
46. **Turned on, the card says what protects the account** (amends rule 9's display).
    - Badge « Activée »; one line per fact, each worded by the server: the method and its date
      (`methodLabel` « Appli d’authentification », `enabledLabel` « depuis le 12/10/2026 »); the codes
      (`backupCodesLabel` « 8 codes de secours sur 10 »).
    - When 3 or fewer are left, `backupCodesLow: true` (threshold on the server) turns that line to
      warning colour with the sentence the server words in `backupCodesWarning` (« Plus que 2 codes de
      secours. », « Plus qu’un code de secours. », « Aucun code de secours. ») and « Nouveaux codes »
      next to it.
    - Actions: « Changer d’appli » (rule 48), « Nouveaux codes de secours », « Désactiver » (error
      colour, last). Stacked full width on a phone.
    - The journal folds under « Historique (n) », closed by default; it shows the server's 10 latest
      entries as today.
47. **Sensitive actions ask the password and a current code** *(resolved 2026-10-28, §9 Q2: password +
    code, server and client ship together)*. « Désactiver », « Nouveaux codes de secours » and « Changer d’appli » open one re-auth
    dialog (`ReauthDialog`): « Mot de passe (confirmation) », then the current code — the app's, a
    backup code, or for the email method a code sent by « Recevoir un code »
    (`POST /api/auth/2fa/code`, the 60 s gap of rule 44).
    - The server checks both on `POST /2fa/disable`, `/2fa/backup-codes` and `/2fa/start` while a
      step is on; a TOTP code is spent like a login code (rule 28).
    - A wrong code counts toward rule 8's lock (5 → 15 min) like at login. A wrong password counts
      toward rule 49.
    - A wrong code answers 400 `BAD_CODE` with `attemptsLeft` and « Code incorrect : 3 essais restants. »,
      as for the enrolment (rule 42); the lock (429 `LOCKED`) and rule 49's carry `retryInSeconds`.
    - The code is sent as soon as its 6th digit arrives when the password is filled (as at login), with
      « Vérification… » under the cells; for an email-method account the field reads « Code reçu par
      email » and the switch link « Utiliser le code reçu par email » (as the login's code screen).
    - Without both, nothing changes. The admin's « Désactiver » for another user (rule 9) is
      unchanged: it is the lost-phone path.
    - Order of the checks: the password lock (rule 49), the password, whether a step is on (409
      `NOT_ENABLED`), the code lock (rule 8), then the code. A missing code answers 400 `CODE_REQUIRED`
      and a missing password 400 `BAD_PASSWORD`; neither counts as a guess. The password is checked
      before the code, so a wrong password never spends a code.
48. **Changing app does not leave the account unprotected** (new). « Changer d’appli » runs steps 2–3 of
    the activation (after rule 47's re-auth): a new secret is pending while the current method keeps
    working at login. Only the confirmation of a code from the new app replaces it, in one transaction,
    with new backup codes (step 3). Leaving midway (rule 40) keeps the current method untouched. From
    the email method, the same button reads « Passer à une appli ».
    - **Amended 2026-10-28 (review):** the steps are numbered « n sur 2 » and step 2 says « L’appli
      actuelle reste valable jusqu’à la validation du nouveau code. ». A box « Oublier les appareils de
      confiance », **ticked by default**, sends `forgetTrustedDevices` with the confirmation: the trusted
      devices of rule 7 are bound to `enabledAt`, which then becomes the date of the new app, so they are
      asked for a code again (a stolen device trusted for 30 days must not survive a change of app).
      Unticked, `enabledAt` is kept and they stay trusted (a server test names both).
    - A replacement is never switched to the email method inside the dialog (rule 44 amended): moving
      from the app to the email code on an active account is not offered, the app being the safer method.
      The API still accepts it with the password and a current code.
49. **The confirmation password is limited** (new; closes the gap above). 5 wrong passwords on
    `/2fa/start`, `/2fa/disable`, `/2fa/backup-codes` within 15 minutes, per account, refuse the next
    ones for 15 minutes: 429 `REAUTH_LOCKED` « Trop d’essais : réessayer après 14:32 (dans 12 min). »
    with `retryInSeconds`, said under the field (the dialog's submit stays disabled until it passes).
    **Amended 2026-10-28 (review): the same guard (`utils/reauthGuard.js`, one instance in
    `accountSecurityServices.js`) also stands in front of `POST /api/auth/change-password`**: its
    `verifyCredentials` had no limit, so a stolen session could guess the current password there and
    walk around the lock. A wrong current password still answers 401 `INVALID_CREDENTIALS` until the 5th,
    which answers 429 `REAUTH_LOCKED`; the right one is refused while locked. The lock writes « Trop d’essais du mot de passe » (a neutral label: the lock can be set from the second step or from the password change) in the
    journal, once, when the lock is set (the 5th wrong password itself answers `REAUTH_LOCKED`). While
    locked even the right password is refused, and the lock is per account (others are unaffected). In
    memory (`utils/rateLimiter.js`'s `createWindowCounter`, keyed by user id), like rule 3: a restart
    clears it. **Trade-off:** someone holding a stolen session can lock the victim's password change (and the
    second step's confirmation) for 15 minutes, again and again; the way out is « Mot de passe oublié »,
    and **a successful password reset by link clears the guard for that account** (the owner proved they hold
    the mailbox; other accounts are untouched). The lock is per process: a second process would count apart. Production runs a single
    process (one PM2 instance), which is what makes the in-memory lock sound; a clustered deployment
    would need a shared counter. An empty password is not a guess and is not counted.
50. **The journal names what happened** (amends rule 9's list). New events, worded by the server:
    `replaced_totp` « Appli d’authentification changée », `replaced_email` « Passage au code par
    email », `reauth_locked` « Trop d’essais du mot de passe » (rule 49). The existing labels read « Validation en deux étapes activée
    (appli) », « … (email) », « … désactivée », « … désactivée par <nom> », « … désactivée en ligne de
    commande »; « Nouveaux codes de secours » and « Mot de passe réinitialisé par lien » unchanged.
51. **The dashboard card opens the activation directly** (amends rule 10). Title « Validation en deux
    étapes », detail « Compte protégé par le seul mot de passe. »; « Activer » goes to
    `/mon-compte?activer=deux-etapes`, which opens the dialog at step 1 (the query is removed from the
    address once read). « Plus tard » unchanged.
52. **Mobile behaviour** (new). The dialog is full screen with its actions in a bar at the bottom,
    clear of the home indicator (`env(safe-area-inset-bottom)`), primary last. Every input is 16 px or
    more (no iOS zoom). The code field keeps `autocomplete="one-time-code"` and `inputmode="numeric"`
    (rule 32); when the entry was saved in the iPhone's Passwords app for this site, Safari offers its
    code in the keyboard bar. At 390 px the QR code is 200 px and the key wraps by groups, never
    mid-group.
53. **A support session still cannot touch it** (consistency with rules 15, 18). The card stays hidden
    to a support session (`AccountPage.jsx:115`, unchanged); the new writes (`/2fa/cancel`, `/2fa/code`)
    fall under `supportSessionPolicy`'s existing `/auth/2fa` write refusal
    (`supportSessionPolicy.js:53`), and a test names them.
54. **The password-free switch is held by a token, not by the session** (added 2026-10-28, security
    review). `POST /2fa/start` with the password returns a random `enrolmentToken` (32 bytes, hex); only
    its SHA-256 is stored (`pendingTokenHash`). The switch of rule 44 sends `{ method, enrolmentToken }`
    and no password, and is accepted only for a fresh enrolment of a FIRST activation, by a timing-safe
    comparison. A session cookie alone is not enough (a cookie thief rode a victim's open replacement and
    was handed a secret, the backup codes and the account), and a replacement is never switched without
    the password and a current code. A new enrolment makes the old token worthless.
55. **Mails are limited atomically** (added 2026-10-28, security review). Every code mail (enrolment,
    resend, re-authentication, login resend) first takes a slot in ONE conditional `UPDATE`
    (`reserveMailSlot`): no send within 60 s of the last, at most 5 per enrolment, at most 6 an hour
    (`mailsSent` / `mailsSince`), and only then is the mail sent — twenty parallel requests send one.
    A start with the password takes a slot too (restarting resets the enrolment, no longer its limits).
    The re-authentication code has its own hash (`actionCodeHash`): asking for one never cancels a login
    code in flight. `POST /2fa/resend` at login waits 60 s after the code just sent. The mail transport
    is checked before an enrolment is switched to email, so a refusal leaves the app enrolment on screen
    (400 `EMAIL_UNAVAILABLE`). The login resend has its **own** hourly budget (`loginMailsSent` /
    `loginMailsSince`, 6 an hour), apart from the one « Recevoir un code » and the enrolment share, so
    a stolen session cannot use the victim's login resend up (it can still make it wait the 60 s gap).
56. **After a refused code the next one replaces it** (added 2026-10-28, UX review; `OneTimeCodeField`,
    shared with the console's login). The field selects a complete code whole on focus and click; a
    REFUSED complete code that receives more digits keeps what was just typed or pasted (rule 35's
    « extra digit dropped » stays for a code not refused, which may already be on its way); a check in
    flight holds the field `readOnly`, never `disabled`, so a phone keeps its keyboard.
57. **The lock and the tries are said** (added 2026-10-28, UX review). Rules 47 and 49's refusals carry
    `retryInSeconds` and the message « … (dans 12 min). » (worded by the server); the re-authentication
    dialog disables its submit and counts the served seconds down. A wrong re-authentication code says
    the tries left (rule 47). « Vérification… » shows under the cells while a code is checked, in the
    activation dialog and the re-authentication dialog.
58. **Focus, announcements and motion** (added 2026-10-28, UX review). Step changes are announced by a
    polite live region (« Étape 2 sur 3 : Appli »); focus goes to « Copier » at the codes step and to
    « Recommencer » when the enrolment ended; after « Terminé » (or the new backup codes) focus returns
    to the card's first action; « Désactiver » ends with the toast « Validation en deux étapes
    désactivée. »; collapses and dialogs have no transition under `prefers-reduced-motion` (`FormDialog`
    included); the icon button of Paramètres › Utilisateurs is 44 × 44 px. The dialog is 480 px wide at
    most on a computer; the key is shown in non-breaking groups of 4 in both layouts, with « Copier la
    clé » copying it without spaces.

59. **Changing your own email asks the password** (added 2026-10-28, audit finding M1). `PUT /api/users/me`
    with an email that differs from the current one needs `currentPassword`, and `code` (app, backup or
    emailed code, rule 47) when the second step is on; a wrong or missing one answers 400 `BAD_PASSWORD` /
    `CODE_REQUIRED` / `BAD_CODE`, and the password shares rule 49's limit. The format is checked first.
    Once changed, the OLD address gets a notice (best effort: a mail failure never undoes the change).
    A save that leaves the email as it is asks for nothing. « Mon compte » opens the re-authentication
    dialog (rule 47) only when the email field changed (and shows a failure to read the second-step status
    instead of guessing). The user's OTHER sessions end, as after a password change; no notice goes to the
    bootstrap login `admin@guestflow.local`, which is nobody's mailbox. The start assistant's
    `PUT /api/onboarding/company` with `useAsLogin: true` (rule 37) rewrites the login email too: it needs the
    same `currentPassword` (and `code`), checked before anything is saved; the step shows a password field once
    the box is ticked.
60. **A support write is logged even if the client leaves** (added 2026-10-28, audit finding M2). The
    entry is written on `finish`, or on `close` without `finish` with the summary `aborted` (shown to the
    customer as « Interrompu »); never twice.
61. **A login costs the same hash whoever answers** (added 2026-10-28, audit finding L1). An unknown,
    deactivated or support account is checked against a dummy hash, so the time of a refusal does not
    tell whether an account exists (rule 1's reasoning, applied to the login).
62. **The login code mail is limited like every code mail** (added 2026-10-28, audit finding L3). For an
    email-method account the code mailed after the right password takes a login mail slot (rule 55: 60 s
    gap, 6 an hour, shared with « Renvoyer le code »). Over the limit no mail leaves. If a login code is
    still live (`emailCodeHash` set, not expired), the code step is shown on it (« Code déjà envoyé à … »);
    otherwise the login is refused 429 — `RESEND_TOO_SOON` with `retryInSeconds` (« Nouvel envoi possible dans
    N s. ») or `TOO_MANY_SENDS` — and the login page counts the wait down on its button. That 429 follows a RIGHT password, so the per-IP login limiter does not count it as a failure (`hosting-h2-login-mail-limit-ip-limiter.unit.test.js`).
63. **A reset link does not outlive the change of address or password** (added 2026-10-29, audit R2 finding
    N2). In the same transaction as an email change (`updateUser`) and as a password change
    (`updatePassword`, and the administrator's `resetUserPassword`), every unused `password_reset_tokens` row
    of that user is voided (`usedAt` set). A link mailed to the old address stops working the moment the
    address or the password changes.
64. **The assistant's login change ends the other sessions too** (added 2026-10-29, audit r3 L1). Rule 59's
    « the user's OTHER sessions end » also applies when `PUT /api/onboarding/company` with `useAsLogin: true`
    rewrites the login email: the other sessions are revoked (`revokeOtherSessionsForUser`) and
    `req.session.user` is refreshed, exactly as on « Mon compte ». Test: `onboarding-login-opt-in.unit.test.js`.

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
| `models/` | `usersModel.js` | T | Rule 21: `isSupport` from `isSupportAccount`, `findSupportAccount()`, every write refuses the support row. Rule 63: `voidResetLinks` runs in the transaction of an email change, a password change, an admin reset and the `reset-admin` recovery; `softDelete` and the role write also drop the user's push devices (pwa-push rule 13) |
| `models/` | `supportAccessModel.js` | C | `revoke` also deletes the support account's push devices (pwa-push rule 13) |
| `utils/` | `licence.js` | T | Rule 22: `slug()`, the instance's slug as the verified licence names it |

**Rules 38–53 (2026-10-28), server:**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `controllers/` | `twoFactorController.js` | T | Rules 41–50: `start` returns `otpauthUri`, `issuer`, `accountLabel`; the password-free switch of a first activation, held by the enrolment's token (44, 54); atomic mail slots, gap, cap, hour (44, 55); `confirm` with `attemptsLeft` + worded message (42) and expiry (43); `cancel`; `sendCode` (44, 47); password + code re-auth (47); replacement keeping the current method until confirmed (48); the re-auth lock through the shared `reauthGuard` (49); the separate re-auth code (55); new event labels (50); `status` gains `enabledLabel`, `backupCodesTotal`, `backupCodesLabel`, `backupCodesLow`, `backupCodesWarning`, `eventsCount`, `reauthNeedsCode` |
| `models/` | `twoFactorModel.js` | T | `setPending` stamps `pendingStartedAt` and the token's hash; `switchPending` keeps both; `reserveMailSlot` (the atomic slot, rule 55), `setActionCode` / `clearActionCode`; `dropPending` clears the enrolment (and its email code only); `activatePending(…, { keepEnabledAt })` for rule 48 (one transaction: method, secret, codes) |
| `utils/` | `accountSecuritySchema.js` | T | Additive columns of §5 (idempotent `ADD COLUMN` checks, run from `database.js`) |
| `utils/` | `accountSecurityServices.js` | T | Wires the company name reader (settings model) into the controller |
| `utils/` | `reauthGuard.js` | C | Rule 49: the shared confirmation-password limit (one `createWindowCounter` + the lock map), used by the second step's routes and `changePassword` |
| `utils/` | `rateLimiter.js` | — | Reused unchanged (rule 49) |
| `utils/` | `totp.js` | — | Reused unchanged: `otpauthUri({ secret, account, issuer })` already takes the label |
| `utils/` | `dashboardAttention.js` | T | Rule 51: title « Validation en deux étapes », detail « Compte protégé par le seul mot de passe. » |
| `controllers/` | `authController.js` | T | `twoFactorCancel`, `twoFactorCode` through the existing `self` gate (rule 6's 2026-10-23 gate); `self` answers 204 when the handler returns nothing; `changePassword` goes through the shared guard (rule 49) |
| `routes/` | `auth.js` | T | `POST /2fa/cancel`, `POST /2fa/code` (thin) |
| `utils/` | `supportSessionPolicy.js` | — | Unchanged; covers the new writes (rule 53) |
| `middleware/`, `tasks/` | — | — | None |

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
- **Rules 38–53 (2026-10-28):**
  - `components/TwoFactorSection.jsx` (T) — becomes the status card only (rules 39, 46): badge,
    server-worded lines, actions, folded « Historique (n) ».
  - `components/TwoFactorSetupDialog.jsx` (C, feature-specific) — the three steps (rules 40–45, 48);
    used for the first activation and for « Changer d’appli ». Specific to this feature: it orchestrates
    the 2FA endpoints, nothing generic to extract beyond the panels below.
  - `components/BackupCodesPanel.jsx` (C, generic) — the codes grid + « Copier » / « Télécharger » +
    the « enregistrés » box, `onSavedChange(bool)`; step 3 and `BackupCodesDialog` use it. Generic: any
    « shown once » list of secrets (the console's operator codes next).
  - `components/BackupCodesDialog.jsx` (T) — wraps `BackupCodesPanel`, « Terminé » gated (rule 45).
  - `components/ReauthDialog.jsx` (C, generic) — « Mot de passe (confirmation) » + optional
    `OneTimeCodeField` (`allowBackup`) + optional « Recevoir un code »; props `title`, `submitLabel`,
    `submitColor`, `needsCode`, `onSendCode`, `onSubmit({ password, code })`, `error`. Built on
    `FormDialog`. Generic: any action that must re-ask the credentials.
  - Reused unchanged: `OneTimeCodeField` (rules 32–35), `SecretRevealField` (`masked={false}`, the key),
    `StatusBadge`, `FormDialog`, `PasswordField`, `ErrorAlert`, `LoadingState`.
  - `constants/twoFactor.js` (C) — the feature name and the UI strings of rules 38–46.
  - `pages/AccountPage.jsx` (T) — reads `?activer=deux-etapes` (rule 51) and opens the dialog.
  - `components/TwoFactorNudgeCard.jsx` (T) — « Activer » → `/mon-compte?activer=deux-etapes`.
  - `pages/UserManagementPage.jsx` (T) — wording (rule 38).
  - `constants/settingsMenu.js` (T) — keywords (rule 38).
  - `api.js` (T) — `startTwoFactor(method, password?, code?)`, `cancelTwoFactor()`,
    `sendTwoFactorActionCode()`, `disableTwoFactor(password, code)`, `regenerateBackupCodes(password, code)`.
  - `hooks/`, `services/`, `utils/` — none. The layout choice of rule 41 is
    `useMediaQuery('(pointer: coarse)')`, presentational.
- Rule 37 (2026-10-27): `pages/OnboardingPage.jsx` shows the « Utiliser aussi cette adresse pour se
  connecter » box at step 1 when `GET /api/onboarding` returns `login.canAdopt`; server
  `controllers/onboardingController.js` (`adoptLoginEmail` only on `useAsLogin: true`, `login` in `get`).

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

**Rules 38–53 (2026-10-28):**

| Method | Path | Body → answer | Rule |
|---|---|---|---|
| GET | `/api/auth/2fa/status` | → `{ enabled, method, methodLabel, enabledLabel, backupCodesLeft, backupCodesTotal, backupCodesLabel, backupCodesLow, emailAvailable, reauthNeedsCode, nudge, events, eventsCount }` | 46, 47 |
| POST | `/api/auth/2fa/start` | `{ method: 'totp', password, code? }` (`code` required while a step is on) → `{ method, qrDataUrl, secret: 'ABCD EFGH …', otpauthUri, issuer, accountLabel, replacing, expiresAt }`; `{ method: 'email', password? }` → `{ method, sentTo, resendInSeconds: 60, replacing, expiresAt }` | 41, 44, 47, 48 |
| POST | `/api/auth/2fa/confirm` | `{ code }` → `{ backupCodes, status }`; 400 `BAD_CODE { message, attemptsLeft }`; 410 `ENROLMENT_EXPIRED`; 429 `TOO_MANY_CODES` | 42, 43, 48 |
| POST | `/api/auth/2fa/cancel` | → 204; drops the pending enrolment only | 40 |
| POST | `/api/auth/2fa/code` | → `{ sentTo, resendInSeconds }` (a pending email enrolment, else an account on the email method); 409 `NOT_EMAIL`; 429 `RESEND_TOO_SOON { message, retryInSeconds }` / `TOO_MANY_SENDS` | 44, 47 |
| POST | `/api/auth/2fa/disable`, `/backup-codes` | `{ password, code }` → as today; 400 `BAD_PASSWORD` / `BAD_CODE`; 429 `LOCKED` (rule 8) / `REAUTH_LOCKED` (rule 49) | 47, 49 |

All answers keep `{ error, message }` on failure; every `message` is the French sentence the client
shows as is.

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
- Rules 43–44 (2026-10-28): `user_two_factor.pendingStartedAt TEXT NULL` (the enrolment's start; also
  the 15-minute window in which the email switch needs no password), `pendingSends INTEGER NOT NULL
  DEFAULT 0` and `lastCodeSentAt TEXT NULL` (the 60 s gap and 5 sends), `pendingTokenHash TEXT NULL`
  (the enrolment token's hash, rule 54; it replaced the column `pendingSessionHash` added earlier on this
  branch, never released), plus `actionCodeHash` / `actionCodeExpiresAt` (the re-authentication code,
  rule 55), `mailsSent` / `mailsSince` (the hour's mails) and `loginMailsSent` / `loginMailsSince` (the
  login resend's own hour). Additive, nullable or
  defaulted: an existing row with a pending enrolment has `pendingStartedAt` NULL, which rule 43 reads
  as expired (the owner restarts in one click). No data is rewritten; no new table. The re-auth counter
  of rule 49 is in memory, not in the database. New `user_security_events.event` values only
  (`replaced_totp`, `replaced_email`, `reauth_locked`).

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

*2026-10-28 (rules 38–53):* the whole flow — card off, dialog steps 1–3 (computer and phone layouts),
a wrong code with the tries left, the 5th refusal, the email fallback, the gated « Terminé », the card on
with low codes, « Changer d’appli » and « Désactiver » with password + code — is mocked interactively in
[`docs/specs/2026-10-28-account-two-factor-ux.html`](../docs/specs/2026-10-28-account-two-factor-ux.html)
(desktop and 390 px). Phone specifics are rule 52.

## 7. Test plan

**Server unit tests:**
- `audit-r2-reset-links-void.unit.test.js` (5 tests, rule 63): an email change, a password change, an admin reset and the `reset-admin` recovery void the user's open reset links and only theirs; `usedAt` is ISO; a save that keeps the email leaves the link alone;
- `audit-r2-push-account-state.unit.test.js` (6 tests, pwa-push rule 13): revoking an access deletes the support account's devices;
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
- 2026-10-27 (audit): rule 37 — without the opt-in the bootstrap login is kept, only a literal
  `useAsLogin: true` changes it, `GET /api/onboarding` says whether to offer it
  (`onboarding-login-opt-in.unit.test.js`, 3); the rule 27 tests send the opt-in. Client
  `OnboardingPage.login-opt-in.test.jsx` (3: unticked by default and sent as `false`, ticked → `true`
  and « Connexion désormais avec … », not offered over a login the owner chose).

**Rules 38–53 (2026-10-28) — expected tests, one file per subject:**

- Server `hosting-h2-two-factor-activation-ux.unit.test.js` (16, planned 11): `start` returns `otpauthUri` with the
  issuer and the company · email label, the email alone without a company name (41); `status` never
  holds the secret (41); `attemptsLeft` counts down 4→1 and the 3rd refusal adds the clock hint (42);
  the 5th cancels (42); an enrolment older than 15 min → 410 and dropped, a NULL `pendingStartedAt`
  too (43); the email switch without password inside the window, refused after it (44); resend under
  60 s → 429 with `retryInSeconds`, the 6th send refused (44); `cancel` drops only the pending
  enrolment (40); `status` labels and `backupCodesLow` at 3 and not at 4 (46); dashboard wording (51).
- Server `hosting-h2-two-factor-reauth.unit.test.js` (9): disable / backup-codes / replacing start
  refused without a code, with a wrong code (counts toward rule 8's lock), accepted with an app code, a
  backup code (spent) and an emailed code (47); the TOTP code used for the re-auth cannot then open a
  session (47 + 28); 5 wrong passwords → `REAUTH_LOCKED` on all three routes, journal entry, other
  accounts unaffected (49); the admin's disable for another user needs neither (47); `/2fa/cancel` and
  `/2fa/code` refused to a support session (53).
- Server `hosting-h2-two-factor-replace.unit.test.js` (5): during a replacement the old method still
  opens a session (48); confirmation swaps method + secret + codes in one transaction and keeps
  `enabledAt` (a trusted device stays trusted) (48); cancel keeps the old method (48); the event labels
  of rule 50 (2).
- Client `TwoFactorSetupDialog.steps.test.jsx` (6): step 1 wrong password stays on step 1; sent at the
  6th digit with no button; the tries left under the cells; the 5th refusal shows « Recommencer »;
  Escape on step 2 calls cancel; step 3 has no close but « Terminé ».
- Client `TwoFactorSetupDialog.pointer-layout.test.jsx` (3): coarse pointer → « Ouvrir dans l’appli »
  with the server's `otpauth://` href first and the QR folded; fine pointer → QR first, key folded;
  « Copier la clé » copies the key without spaces.
- Client `TwoFactorSetupDialog.email-fallback.test.jsx` (3): link only with `emailAvailable`; switching
  shows the masked address; « Renvoyer le code » disabled with the server's countdown.
- Client `BackupCodesPanel.saved-gate.test.jsx` (3): « Terminé » disabled until the box; Copier ticks
  it; Télécharger ticks it.
- Client `TwoFactorSection.status-card.test.jsx` (4): off = badge + one button, no password field;
  on = the server's three lines; `backupCodesLow` shows the warning and « Nouveaux codes »; the history
  folded with its count. `TwoFactorSection.password-label` / `.mobile-layout` / `.enrol-error` are
  rewritten onto the dialog (their subjects move there), not appended to.
- Client `ReauthDialog.code.test.jsx` (3): needs both fields when `needsCode`; « Recevoir un code »
  for the email method; the server's refusal under the field.
- Client `AccountPage.activate-query.test.jsx` (1): `?activer=deux-etapes` opens step 1 and the query
  is dropped.
- E2E `e2e/specs/account-security/hosting-h2.spec.js`, test « rules 6-7 » rewritten: Activer → password
  → wrong code (tries left shown) → computed code at its 6th digit → « Terminé » disabled → download →
  « Terminé » → card « Activée » → logout/login with a computed code. New test « rules 47-48 »:
  « Changer d’appli » with password + code, the old app still accepted until the new one is confirmed.
- **Mobile check:** the whole flow at 390 px with `hasTouch` / coarse pointer (Playwright
  `isMobile`), the `otpauth://` button present and the dialog's bottom bar in view; then on a real
  iPhone: the link opens the Passwords app or the installed authenticator, the return keeps the dialog.

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

**Authz audit of 2026-10-28 (rules 18, 59–62):** server `hosting-h2-self-email-change` (8: password,
code, shared lock, old-address notice, other sessions, bootstrap login, format/uniqueness),
`hosting-h2-support-aborted-writes` (3), `hosting-h2-support-settings-fields` (10: keypad code, IBAN/BIC,
the RESOLVED recipient through `company.email` with an empty recipient, `PUT /onboarding/company`, unchanged
values pass, the logged 403), `users-model.login-timing` (2), `hosting-h2-two-factor-login-mail-throttle`
(5: live code kept, case A within 60 s of a successful login, case B six an hour), and
`onboarding-login-opt-in` (+2); client `AccountPage.email-change` (4), `LoginPage.mail-limit` (2),
`OnboardingPage.login-opt-in` (+1).

**E2E:**
- forgot password through the dev mail catcher;
- enable TOTP and log in with a computed code (2026-10-19: a wrong code first, said under the cells,
  then the right one sent at its 6th digit with no « Valider »);
- the support flow with a locally signed link.

**Mobile check:** the login with a code at 390px.

## 8. Out of scope

- Forcing two-step login on every account.
- WebAuthn and passkeys (also for rules 38–53: the natural next step, a separate spec).
- Forcing the second step on accounts, and showing each user's state in Paramètres › Utilisateurs
  beyond today's « Désactiver » action (rules 38–53).
- Several authenticator apps at once, SMS codes (rules 38–53).
- Printing the backup codes (« Télécharger » then the OS print covers it).
- SSO.
- Support access to a self-hosted instance.

## 9. Open questions

Rules 1–37: none. The options are the recommended ones, taken under the owner's instruction to run
the plan through.

Rules 38–53 (2026-10-28) — **Resolved 2026-10-28, all three on the recommended option:** Q1 « Validation
en deux étapes » everywhere; Q2 password + a current code, server and client shipping together; Q3 the
email method as a fallback link under the app. The options as they were put:

- **Q1 — the name (rule 38).** « Validation en deux étapes » (recommended: plain French, Google's
  wording, says what the user does) / « Double authentification » (the owner's word, common in France,
  slightly jargon) / « Authentification à deux facteurs (2FA) » (Apple/GitHub, longest).
- **Q2 — the re-auth of sensitive actions (rule 47).** Password + current code (recommended: a phished
  password plus a stolen session can no longer remove the protection or mint backup codes) / password
  only, as today (one field less; the lock of rule 49 still closes the guessing gap).
- **Q3 — the email method (rule 44).** Fallback link under the app (recommended: the usual pattern,
  the app is the safer method) / two equal choices as today / app only for new activations (email
  accounts keep working).

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

**UX review of 2026-10-28 (rules 38–53):** Implemented on `feature/account-two-factor-ux` (target
`inte/plugins`), in two commits — server, then client + E2E — shipping together (Q2 = password + code).

- **Server:** 3 new suites, one per subject — `hosting-h2-two-factor-activation-ux` (16), `-reauth` (12),
  `-replace` (6) — and the existing `hosting-h2-two-factor`, `auth-two-factor-self-gate`,
  `dashboard-attention`, `settings-summary` suites updated. Full suite 6886 / 6886.
- **Client:** `TwoFactorSetupDialog.steps` (7), `.pointer-layout` (5), `.email-fallback` (3),
  `BackupCodesPanel.saved-gate` (5, replaces `BackupCodesDialog.closing`), `TwoFactorSection.status-card`
  (8), `.reauth-flows` (4), `.password-label` (1, rewritten), `ReauthDialog.code` (5),
  `AccountPage.activate-query` (1). `TwoFactorSection.enrol-error` and `.mobile-layout` were removed: their
  subjects (the card's method picker, rule 29) no longer exist or moved to the dialog files above.
- **E2E:** `hosting-h2.spec.js` — « rules 6-7, 38-45 » rewritten onto the dialog, new « rules 47-48 »
  (change of app, history label, disabling with password + code).
- **Deviations from the draft:** the re-auth limit lives in `utils/reauthGuard.js` and is shared with the password change (review); `POST /2fa/code` also resends an enrolment's email code;
  the password-free switch is held by a random enrolment token, never by the session, and never on a replacement (rules 44, 54); rule 29 is
  withdrawn (its picker is gone); `backupCodesWarning` and the error codes `CODE_REQUIRED`, `SAME_METHOD`,
  `NOT_EMAIL`, `TOO_MANY_SENDS` were added. The console reuses `OneTimeCodeField` unchanged.

**Review fixes of 2026-10-28 (security + client UX, same branch):** rules 54–58 and the amendments of 44, 47,
48, 49 above. Server: `reauthGuard.js`, token instead of session, atomic mail slots, separate re-auth code,
`resendLogin` gap, mail transport checked first, forget-trusted-devices on a new app, `retryInSeconds` and
`attemptsLeft` on re-auth refusals. Client: `OneTimeCodeField` retype and `readOnly`, switch errors mapped,
480 px dialog, key groups in both layouts, « n sur 2 » for a replacement, email labels, focus and live
region, lock countdown, auto-submit, toast, reduced motion, 44 px target. Tests added: server
`hosting-h2-two-factor-*` (+13), client `OneTimeCodeField.refused-retype` (5),
`TwoFactorSetupDialog.accessibility` (6), `TwoFactorSection.after-actions` (3), `ReauthDialog.code` (+4),
`.email-fallback` rewritten (5), `.pointer-layout` (+2).

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

**Authz audit, 2026-10-28 (`fix/audit-authz`, target `inte/plugins`):** rules 59–62 and the widening of rule 18
(M3). `usersController.updateSelf` re-authenticates through `twoFactor.reauthenticateForChange`; the start
assistant's company step does the same for `useAsLogin`; `supportAudit` logs on `close`; `supportSessionPolicy`
judges the resolved e-mail identity; `usersModel.verifyCredentials` hashes against a dummy; `beginLogin` takes a
login mail slot (`markCodeSent` removed). Client: `AccountPage` (ReauthDialog), `LoginPage` (wait countdown),
`OnboardingPage` (password field). Not checked in a browser.
