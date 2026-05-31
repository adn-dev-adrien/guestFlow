# Changelog

All notable changes to GuestFlow are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Let's Encrypt cert via Freebox port-forward + HTTP-01** (`server/scripts/issue-letsencrypt-cert-http01.sh`).
  The path Adrien's prod actually uses to make `https://guestflow.domainesolio.com` reach the Pi
  with a publicly-trusted cert (no browser warning) and a hands-off auto-renewal — without
  migrating DNS hosting (Squarespace stays as registrar + DNS host). The architecture is a chain
  of three boring steps: a CNAME `guestflow → maisonadrisoph.freeboxos.com` at Squarespace, two
  Freebox port-forwards (WAN 80 → Pi:80 for ACME, WAN 443 → Pi:4000 for HTTPS), and a single
  acme.sh standalone invocation on the Pi. acme.sh's daily cron re-issues at the 60-day mark,
  briefly re-binds port 80 to answer the ACME challenge, drops the renewed fullchain into
  `~/guestflow/certs/server.{crt,key}`, and triggers `pm2 restart guestflow` via `--reloadcmd`.
  The script defensively pre-flights (cert + key file paths, root requirement for port 80,
  port-busy check via ss / netstat, FQDN format) and surfaces a self-contained troubleshooting
  cheatsheet on failure (DNS propagation, Freebox forward, ISP port-80 blocking, staging fallback).
  README §HTTPS gets a full operator walkthrough — DHCP reservation pinning the Pi at
  192.168.0.196, the exact Freebox port-forwarding table, the `dig`-based DNS verification, and
  caveats (CNAME chain self-updates via Free's DDNS so the dynamic public IP is a non-issue;
  hostname-only access since the cert SAN is the FQDN). Complements the earlier
  `feat/prod-https-self-signed` (still ships the script + behaviour for offline / LAN-only
  deploys) and supersedes the abandoned `feat/letsencrypt-cert-via-cloudflare` branch (the
  Cloudflare migration was a heavier path Adrien chose not to take).
- **Dynamic favicon from the company logo (works in dev AND prod).** When the admin has
  uploaded a logo via Settings → *Informations sur votre activité*, the browser tab favicon
  becomes that logo on every page. Two cooperating layers:
  - **Server-side middleware** (`server/src/middleware/dynamicFavicon.js`, mounted BEFORE
    `express.static(clientBuildDir)` in `index.js`) serves the logo on `/favicon.ico` AND
    `/favicon.svg` whenever the page is served by Node — covers the production build, bookmarks,
    initial tab load, and any client that ignores JS. Path-safety pinned by 7 traversal test
    cases (`/etc/passwd`, `..`, URL-encoded payloads, etc. all caught), and transient
    `settingsModel.read()` failures (SQLITE_BUSY during a hot migration) are swallowed → the
    favicon endpoint never turns into a 500. 5-minute `Cache-Control`.
  - **Client-side hook** (`client/src/hooks/useDynamicFavicon.js` + `utils/setFavicon.js`)
    fetches `/api/settings` on AppShell mount + every user change and rewrites the document's
    `<link rel="icon">` directly. **This is what makes the favicon update in DEV** (CRA's
    :3000 dev server serves `public/favicon.ico` from disk and never proxies it to Node, so the
    server middleware can't fire there), and it also defeats the browser's aggressive favicon
    cache via a `?v=<updatedAt>` buster on the href. `SettingsPage.handleUploadLogo` /
    `handleDeleteLogo` push a new icon directly via `setFavicon` after the API resolves, so the
    tab updates the very second the upload completes — no reload needed. The setter strips
    every prior `<link rel~="icon">` so Firefox (which picks the FIRST declaration) honours the
    dynamic one, and it sets the correct `type` attribute from the extension. 23 unit tests
    across `setFavicon.test.js` (idempotency, default-restore, cache buster, MIME mapping,
    null-doc no-op, etc.) and `useDynamicFavicon.test.js` (initial fetch, no-logo restore,
    silent failure on pre-login 401, refresh on key change, stale-fetch-after-unmount guard).
  Result: drop in your logo via Settings, the tab favicon updates immediately in dev, and the
  next prod deploy serves it on `/favicon.ico` for every visitor including new tabs and
  bookmarks.
- **Self-service profile editor on `/account`** (spec `admin-account-management.md` follow-up #6).
  A new "Mes informations" card sits **above** "Mon mot de passe" and lets every authenticated
  user (admin or accountant) edit their own `firstName`, `lastName`, `companyName` and `notes`.
  Email stays locked (same rule as the admin form in edit mode). **Roles are NOT exposed
  anywhere** — neither in the UI nor accepted by the server. The new endpoint
  `PUT /api/users/me` deliberately omits both `roles` and `email` from the model call so an
  authenticated user cannot grant themselves admin via a hand-rolled payload (privilege guard,
  asserted by 3 dedicated unit tests). On a successful save the page triggers `useAuth().refresh()`
  so the sidebar + dialogs pick up the new name immediately. Field-level server errors
  (`{ field, detail }`) land under the matching input; generic errors fall to the page snackbar.
  Tests: 6 new server cases (`users-controller`), 7 new client cases (`SelfProfileSection`), and
  4 new page cases (`UserManagementPage`). Full suite green at 63 / 63 server + 37 / 37 client.

### Changed
- **Sidebar is rendered by a single code path for every role** (spec
  `admin-account-management.md` follow-up #5). The dedicated accountant branch is gone — there's
  one `NavContent` tree, and each item (top-level + every submenu child) is conditionally rendered
  via `canSeeRoute(user, path)`. Per-route allowlist lives in
  `client/src/constants/roles.js#ROUTE_ROLES` (admin everywhere; accountant only on `/comptabilite`
  + `/account`). Submenu **parents** survive iff at least one of their children is visible
  (`canSeeAnyRoute`), so an accountant sees `Suivi financier > Comptabilité` and
  `Paramètres > Gestion utilisateur` with the parent labels intact instead of a flattened
  two-item list. When the parent's own path isn't reachable (accountant on `/settings`), the row
  drops its `Link` props and only toggles the submenu — drawer-close is suppressed in that case
  so the user can still pick their authorised child. New client tests pin the accountant scope
  (8 cases on `canSeeRoute` / `canSeeAnyRoute`); a drift here will be caught before it ships.
  Resolves Adrien's "afin de ne pas dupliquer le code du menu de gauche" feedback.
- **"Gestion utilisateur" page moved under `Paramètres`** (spec
  `admin-account-management.md`). Same route `/account`, same content gating — only the sidebar
  entry-point moved: it's now a submenu of "Paramètres" alongside Logements / Options / Clients /
  Vacances scolaires / Fermetures, with `<AdminPanelSettingsIcon />`. The Paramètres submenu
  auto-opens when `/account` is the current path. For accountants, the entry is now also reachable
  via `Paramètres > Gestion utilisateur` (follow-up #5 above unified the sidebar code so the
  accountant sees the same shell with admin-only items hidden).
- **Outgoing emails sign with the SMTP sender's display name + carry an "auto-generated" notice.**
  Welcome / reset / SMTP-test bodies now end with `Ce message est généré automatiquement.` followed
  by `— {smtpFromName}` (falls back to `GuestFlow` when no name is configured). Replaces the
  previous hardcoded "— GuestFlow" trailer.
- **SMTP password input strips all whitespace before saving.** Gmail App Passwords are displayed in
  a `abcd efgh ijkl mnop` 4-by-4 format; copy-pasting them verbatim used to bounce with
  `5.7.8 Username and Password not accepted` because the transport sent the literal spaces. The
  cleanup is server-side in `settingsController.updateSettings`, transparent to the user, and only
  touches the password field. Adrien's reset / restore flow no longer needs the "tap each space"
  ritual.

### Fixed
- **`issue-letsencrypt-cert-http01.sh` (6 bugs) + `.github/workflows/deploy.yml` (CI Node
  alignment + native rebuild) — everything caught during the 2026-05-31 prod bringup that
  previously needed manual workarounds on every run.**
  - *acme.sh installer flag dropped upstream* (`Unknown parameter: ----install-online`): the
    legacy `sh -s -- --install-online --email <addr> --home <path>` form was rejected by the
    current `get.acme.sh`. Switched to the documented key=value form
    `sh -s email=<addr>`; acme.sh now installs into `/root/.acme.sh` automatically. A
    re-anchor step picks up the actual install path so a non-standard `ACME_HOME` doesn't
    bite, and the script bails with a clear error if the binary still isn't where expected.
  - *acme.sh refusal under sudo* (`It seems that you are using sudo`): when invoked via
    `sudo ./script.sh`, `SUDO_USER` is set + `HOME` is preserved, which acme.sh treats as a
    misuse pattern and refuses to issue. The script now wipes `SUDO_USER/SUDO_UID/SUDO_GID/
    SUDO_COMMAND` and pins `HOME=/root` immediately before the `--issue` call — the
    pre-flight `id -u` check already guarantees we're effectively root.
  - *Cert installed where Node doesn't read it* (the silent killer): `CERTS_DIR` defaulted
    to `$HOME/guestflow/certs`. Under sudo that's `/root/guestflow/certs/`, while PM2 runs
    Node as the calling user (e.g. `pi`) and reads `/home/pi/guestflow/certs/server.{crt,key}`.
    Result: the cert was issued and installed perfectly, but Node kept serving the old
    self-signed one because the two paths never intersected. The script now derives
    `CERTS_DIR` from `$SUDO_USER`'s home (or honours an explicit `CERTS_DIR=...` env
    override), and the `chown` step targets `$SUDO_USER:$SUDO_USER` instead of the
    previously-hardcoded `adrien` — works on Adrien's Pi where the deploy user is `pi`. As
    a side-effect, the daily renewal cron now writes to the same path because acme.sh
    persists `--install-cert` targets in its per-domain conf.
  - *`--reloadcmd` ran as root, didn't reach the `pi`-owned PM2 daemon* (caught right after
    the first prod-cert install: cert file on disk was the real Let's Encrypt one, but
    `openssl s_client -connect localhost:4000` kept showing the previous staging cert). The
    reloadcmd was `pm2 restart guestflow --update-env >/dev/null 2>&1 || true` — invoked
    from acme.sh's root context, root's PM2 doesn't know the `guestflow` process and the
    call silently no-op'd; the `|| true` then masked the failure. The script now wraps the
    reload in `sudo -u $CERT_OWNER` when CERT_OWNER is non-root, and removes the noise
    suppression so any failure surfaces in acme.sh's output (and in cron emails at renewal
    time). acme.sh persists `--reloadcmd` per-domain, so re-running `--install-cert` (which
    this script does on every invocation) updates the value for all future renewals.
  - *Staging cert silently re-installed when re-running against prod* (the trap that left
    Adrien's Node serving `O=Let's Encrypt, CN=YE2` — a staging intermediate — even after
    a prod re-issue with `--force`): acme.sh keeps per-domain state in
    `<acme_home>/<domain>_ecc/` regardless of CA endpoint. When you iterate with
    `--staging` then switch to prod, the stale staging leaf sometimes survives
    `--install-cert` and Node ends up serving it. Browsers reject; `openssl verify` fails
    with `error 20 at 0 depth lookup: unable to get local issuer certificate`. The script
    now reads `Le_API` from the per-domain conf BEFORE the issue step; if it points at
    `acme-staging-v02` while the script is about to issue against `acme-v02` (or vice
    versa), the per-domain dir is wiped via `--remove -d <host> --ecc` + `rm -rf`. The
    acme.sh install and the account stay intact — only the per-domain cert tracking is
    reset. Idempotent: a same-endpoint re-run does nothing.
  - *No post-install sanity check, so a bad install was silent*: after `--install-cert`
    the script now prints `subject / issuer / dates` of the installed cert and runs
    `openssl verify -CAfile <system bundle>` against the leaf. For a prod cert,
    verification MUST pass (otherwise the script `exit 1`s with the exact recovery
    command). For a staging cert (intermediates not in any OS trust store), verification
    failure is tolerated. System CA bundle is auto-detected across the three common paths
    (Debian, RHEL, Alpine). Catches the staging-survives-prod scenario above + any other
    silent install corruption before the operator has to discover it via a browser warning.
- **`.github/workflows/deploy.yml` — CI Node version aligned with the Pi's runtime + force
  rebuild of native modules after install.** Every release deploy was leaving the
  `better-sqlite3` native compiled for the wrong Node ABI, then PM2 silently crashed on
  next restart (`ERR_DLOPEN_FAILED`, `NODE_MODULE_VERSION 127 ... 137`). Two compounding
  causes:
  - `actions/setup-node@v4` was pinned to `node-version: '22'`, but the Pi's system Node
    (which the PM2 daemon runs under) had been bumped by apt unattended-upgrades to v24.
    The deploy built `better-sqlite3` against the v22 ABI; PM2 spawned Node v24 → load
    refused. Pin bumped to `'24'` to match the current system. Comment added explaining
    that bumping the Pi's Node requires bumping this pin in the same PR.
  - Even with the right pin, `npm ci` happily downloads `better-sqlite3`'s prebuilt
    binaries from GitHub releases (matching the pinned major), which historically have
    drifted from the running Node's exact ABI. Added an explicit `npm rebuild
    --build-from-source better-sqlite3` step right after `npm ci` and a `require()` smoke
    test — a broken rebuild fails the deploy loudly here, rather than later via the PM2
    errored / crash-loop state. Plus a `Sanity-check Node + npm versions` step at the top
    that prints `node -v`, `npm -v`, `NODE_MODULE_VERSION` and warns if the existing PM2
    daemon's Node major differs from the runner's — surfaces drift in the deploy log.
  Manual recovery on a Pi that hit the bad state: `cd ~/guestflow/current/server && npm
  rebuild --build-from-source better-sqlite3 && pm2 restart guestflow --update-env`.
  README §HTTPS — *Real Let's Encrypt cert via Freebox port-forward* — gains the operator
  walkthrough split into staging-first + `--force` for prod, plus a *Troubleshooting* block
  covering the four pitfalls actually hit on 2026-05-31: the `.com` vs `.fr` DDNS suffix
  (Free's Freebox DDNS lives under `.fr` — Squarespace CNAMEs pointing at
  `maisonadrisoph.freeboxos.com` return NXDOMAIN), the cached-NXDOMAIN behavior on
  carrier resolvers (browser sees `DNS_PROBE_FINISHED_BAD_CONFIG` while `dig @8.8.8.8`
  resolves fine), the sudo-HOME / CERTS_DIR mismatch (and the `openssl s_client` one-liner
  to verify which cert Node is **actually** serving on `localhost:4000`), and the
  unrelated-but-co-occurring `NODE_MODULE_VERSION 127 ... 137` PM2 crash after a Pi-side
  Node bump (fix: `cd ~/guestflow/current/server && npm rebuild better-sqlite3 && pm2
  restart guestflow --update-env`).

### Added
- **Test coverage for the Gestion utilisateur feature** (Adrien feedback 2026-05-30):
  - **Server** (`server/src/tests/`): new `settings-controller-smtp-password.unit.test.js`
    (7 cases on the password whitespace strip — Gmail 4×4, tabs/newlines, no-whitespace
    pass-through, empty/null clear, absent preserve, whitespace-only → clear); extended
    `email-templates.unit.test.js` (every template signs with `fromName` + carries the
    auto-generated notice + falls back to GuestFlow); extended `users-controller.unit.test.js`
    (`fromName` flows from `settingsModel.decryptedSmtpSettings()` to the welcome + reset
    templates). All M3 server suites: 88 / 88 green.
  - **Client** (`client/src/`): new Jest + RTL tests — `constants/__tests__/roles.test.js`
    (6 cases on `ROLES` / `roleLabel` / `userHasRole` including the legacy `role` string
    back-compat shim and array-wins-over-string precedence); `pages/__tests__/UserManagementPage.test.js`
    (6 cases on role-gated section visibility, listUsers fetch gating, multi-role admin+accountant,
    null user, listUsers failure surfaced as Alert); `components/__tests__/AccountFormDialog.test.js`
    (5 cases on email lock in edit, self-protection of own admin role, fieldErrors landing,
    submit payload shape). 17 / 17 client tests green.
- **Admin account management — unified "Gestion utilisateur" page** (spec
  `admin-account-management.md`). One page at `/account` (sidebar entry "Gestion utilisateur",
  available to every authenticated role). Top section "Mon mot de passe" lets the current user
  change their own password (same forced-first-login redirect-to-login flow as before). For admins,
  a second section "Gestion des comptes" lists every user with full CRUD: create with first/last
  name, email, multi-role (admin + accountant via a multi-select), optional company + free-form
  note; edit; reset password; soft delete (deactivate) and hard delete (only when the user has
  never logged in). Temporary passwords are generated server-side and **emailed via SMTP** — never
  displayed or logged. The flow uses an "email first, persist second" ordering so a failed email
  never leaves a half-created account behind. Self-protection guards on both client and server:
  cannot delete self, cannot remove own `admin` role, cannot reset own password from the admin
  table (use the "Mon mot de passe" section on the same page). A "last admin" guard rejects any
  action that would leave zero active admins (`400 LAST_ADMIN`). The legacy paths
  `/settings/password` and `/comptes` redirect to `/account`; the `Paramètres > Mot de passe`
  submenu and the standalone `Comptes` sidebar entry have been removed.
- **Forced first-login re-authentication.** When a user changes the temporary password they
  received by email, the server now **destroys the session** and the client redirects to
  `/login?reason=password-changed` with a one-shot snackbar. Voluntary password changes from
  `/settings/password` (when `mustChangePassword` was already cleared) keep the session active —
  unchanged UX.
- **SMTP configuration in `/parametres`** (`Envoi d'emails (SMTP)` card). Fields: host, port,
  STARTTLS/TLS implicit, username, password (encrypted at rest with AES-256-GCM, masked on read
  via `passwordSet: boolean`), `fromEmail`, `fromName`, `publicUrl` (used in the welcome email).
  "Envoyer un mail de test" button hits `POST /api/settings/smtp-test` which dispatches an
  "Email de test GuestFlow" to the current admin's address; the response detail surfaces transport
  errors verbatim for diagnosing creds.
- **Multi-role users.** The single `users.role` column is replaced by a `user_roles(userId, role)`
  join table with `ON DELETE CASCADE`. A user holds an array `roles` everywhere (safe shape,
  session, JWT-like payload). The middleware (`enforceRoleAccess`) and the client now read from
  this array; combined `admin + accountant` always wins as admin. `server/src/constants/roles.js`
  is the new single source of truth (mirrored client-side as `client/src/constants/roles.js`).
- **Shared `MonthYearPicker` component** (`client/src/components/MonthYearPicker.js`). Single source
  of truth for the month + year selection card, with optional `description` caption,
  `maxMonth = 'YYYY-MM'` to disable forward months, and `helperText` under the Mois field. Exposes
  `toYearMonth({month,year})` / `fromYearMonth('YYYY-MM')` helpers so callers that hit endpoints
  expecting the string format (tourist tax) can convert without owning the logic. Now used by
  `/comptabilite` and `/finance/tourist-tax` — both pages look and read the same.
- **Per-platform tourist tax collection** (spec `per-platform-tourist-tax-collection.md`).
  Each iCal source now carries a **`collectsTouristTax`** flag (default `1`, mirrors the previous
  hardcoded "non-direct = platform collects" rule). The pricing engine resolves it per reservation:
  direct → owner always collects; non-direct → look up the property's iCal source for that platform
  key (case-insensitive), follow its flag; no matching source → default to "collects" (legacy
  safe). The **Suivi taxe de séjour** extraction now lists direct bookings **plus** non-direct
  bookings whose platform was explicitly switched to "owner collects" — coherent with what's
  charged on the quote. New UI: a `Switch` "La plateforme collecte la taxe de séjour" under the
  iCal source form on the property page, plus a "Taxe collectée" column (`Plateforme` / `Vous`
  chip) in the sources table. Unit tests: `pricing-tourist-tax-platform-collection` (6 cases).
  Full server suite green at 446.
- **Reservation: 3rd payment slot "Complément à percevoir"** (spec
  `accountant-accounting-export.md`, rule 28). When the deposit and the balance are marked paid and
  the total stay TTC has *since* grown — typical case: options or extras added after the payments
  were recorded — the pricing engine now surfaces the leftover as `complementAmount =
  max(0, totalStayPrice − depositAmount − balanceAmount)`. The FinanceSection renders a 3rd block
  (orange-tinted) under Solde with a single "Marquer complément payé" button + a "Payé le" date,
  visible **only** when the complement is > 0. Once paid the amount is frozen in the DB like
  deposit/balance — the engine never erodes received money. Typically settled at end of stay for
  on-site extras. The accounting export treats it as a 3rd encaissement type alongside deposit and
  balance (same balanced double-entry shape, dated at `complementPaidDate`). Migration backfills
  the column on existing fully-paid reservations so any silent gap (e.g. production res #12087:
  240 € unbilled) becomes immediately visible. Unit tests: `pricing-complement` (7). Full suite
  green at 440. Also fixes a quiet inaccuracy: the export now pro-rates against `totalStayPrice`
  (= finalPrice + tourist tax) instead of `finalPrice`, so D + B + C = 100 % exactly.
- **Accountant access + monthly accounting CSV export** (spec
  `accountant-accounting-export.md`, PR 3 — closes the feature):
  - New **`accountant`** user role and a dedicated **`/comptabilite`** page (nested under "Suivi
    financier" in the admin sidebar). The accountant logs in, picks a month + year, downloads the
    sales CSV, and changes their own password — and can do **nothing else** (read-only by construction).
  - **Sales CSV** (`GET /api/accounting/sales.csv?month=&year=`) — one row per double-entry journal
    line, balanced: client auxiliary account `C<NAME>` debited TTC, revenue accounts (`70600000` /
    `70600010` / `70601000`) credited HT pro-rated per encaissement, VAT accounts (`44571100` /
    `44571200`) credited per rate. One entry **per encaissement** (deposit or balance) whose
    `depositPaidDate` / `balancePaidDate` falls in the month, so a reservation paid across two months
    appears in both. Caution and tourist tax are excluded; `kind='devis'` rows never exported.
    Trailing info columns (`Plateforme`, `Prix payé client`, `Commission`) carry the platform data on
    the debit row only. **Format:** `;` separator, UTF-8 BOM, comma decimals, FR-Excel friendly.
  - **Platform commissions preview** (`GET /api/accounting/platforms?month=&year=`) — JSON used by
    the page table.
  - **Turnover basis = net** (the owner-received `finalPrice`) — chosen as the simple default; the
    brut + commission appear only in info columns. One-line switch in
    `constants/accounting.js::RECOGNISE_REVENUE_ON` when the accountant's example CSV arrives.
  - **Role enforcement** — new `middleware/enforceRoleAccess.js` (fail-closed): accountants reach
    only `GET /api/accounting/*` + self routes (`me`, `logout`, `change-password`, `version`); every
    other endpoint returns **`403 FORBIDDEN_ROLE`**. Admin keeps full access.
  - **Admin can create / reset the accountant** from **Paramètres → Accès comptable** (new
    `SettingsAccountantAccessSection`). The accountant must change the temporary password on first
    login (reuses `mustChangePassword`).
  - **Client account format:** `C` + first 6 chars of the last name, uppercased, accent-stripped,
    padded with `X` if shorter — a common French convention. Trivially tunable in `accounting.js`.
  - **Visual journal preview** above the platforms table — one card per encaissement mirroring
    exactly what will be in the CSV, with the per-line account number paired with its human label
    (`Location gîte`, `TVA 10 %`, `Compte client`…), coloured by type (client/amber, revenue/green,
    VAT/blue), balanced badge per card and `Tout équilibré` chip in the header. Backed by a new
    `GET /api/accounting/sales` JSON endpoint (strict mirror of the CSV via
    `buildStructuredEntries`). For **admin only**, the client name is a link to the reservation file
    (accountant sees plain text).
  - **Dedicated change-password page** at `/settings/password`, accessible to every authenticated
    role (admin and accountant). Replaces the previous duplicate "Sécurité" cards on `SettingsPage`
    and `AccountingPage`. Admin sees a "Mot de passe" sub-item at the bottom of the Paramètres
    group; accountant has a minimal sidebar (Comptabilité, Mot de passe, Se déconnecter) and is
    client-side-redirected to `/comptabilite` from anywhere outside the two allowed paths.
  - New files: `constants/accounting.js`, `middleware/enforceRoleAccess.js`, `models/accountingModel.js`,
    `models/usersModel.js` (extended), `controllers/{accountingController, usersController}.js`,
    `routes/{accounting, users}.js`, `utils/{csv, accountingExport}.js`,
    `pages/AccountingPage.js`, `pages/ChangePasswordPage.js`,
    `components/SettingsAccountantAccessSection.js`.
  - Unit tests: `csv` (6), `accounting-export` (19), `enforce-role-access` (8), `users-model-admin` (7) —
    full server suite green (433).
- **Reservation payment dates + platform gross / commission** (spec
  `accountant-accounting-export.md`, PR 2): each reservation now records the **real encaissement date**
  for the deposit and the balance (`depositPaidDate`, `balancePaidDate`) — defaulted to today when the
  user marks paid, editable in the FinanceSection ("Payé le"), cleared on un-pay. For
  platform-sourced bookings, a new **"Prix payé par le client"** field (`clientGrossAmount`) captures
  the TTC amount the guest paid the platform; the **commission** is derived (`gross − finalPrice`,
  clamped at 0) and served alongside reservations as `commissionAmount`. Both the gross field and the
  commission caption are **hidden** for direct bookings. The write boundary rejects a gross below the
  net (`400 GROSS_BELOW_NET`). Unit tests: `client-gross-amount` (7), `reservations-commission` (7).
  Foundation for the monthly accounting CSV (PR 3).
- **iCal import — cross-platform de-duplication** (`propertyIcalModel.syncSource`): the same booking
  appearing in two platforms' feeds (same dates + guest name, different source + UID) now maps to the one
  existing reservation instead of creating a duplicate. Stale removal is cross-source-safe — a shared
  booking is only deleted once **every** feed drops it. Combined with the existing UID / per-source-fallback
  matching and the `icalSyncLocked` guard, a re-import never duplicates or overwrites a (user-modified)
  reservation. New `reservations.icalOriginalSummary` column stores the authoritative original guest name
  at import time (hidden from the frontend), so the date-scan legacy match stays reliable even after the
  user renames the client or edits the notes — instead of re-parsing the fragile `Résumé:` notes line.
  Guards: `property-ical-dedup.unit.test.js` (7).
  - **Migration:** `ALTER TABLE reservations ADD COLUMN icalOriginalSummary TEXT`; existing iCal rows are
    best-effort backfilled from their notes' `Résumé:` line.
- **Server-owned payment status** — new `utils/paymentStatus.js` (`computePaymentStatus`) is the single
  authority for `remainingDue` / `paymentComplete` / `depositOverdue` / `balanceOverdue` / `overdueAmount` /
  `oldestDueDate`, replacing two divergent client `getRemainingDue` copies. New
  `GET /api/finance/operational` returns the whole "Suivi opérationnel" section ready to render
  (overdue sorted + count + total, pending list, flat upcoming with `nights`). Reservation list + detail
  payloads now carry `remainingDue` + `paymentComplete`. Unit tests: `payment-status` (8), `finance-model` (4).
- **Server-side French public holidays** — new `GET /api/public-holidays?years=2025,2026` endpoint
  (`utils/frenchHolidays.js` Easter computation → `[{ date, label }]`, validated `?years=`, auth-gated).
  The calendar and the pricing-seasons page now **fetch** their "férié" markers instead of computing
  them client-side. Unit tests: `french-holidays` (5).
- **Show/hide password toggle** — new reusable `PasswordField` component (MUI TextField + eye
  adornment) used on the login screen and the change-password form (forced first-login change +
  Settings). Lets the user verify what they type, which notably surfaces browser-autofilled values.
- **Admin account recovery** — `cd server && npm run reset-admin` restores the default admin
  (`admin@guestflow.local` / `ChangeMe!2026`) with a forced password change and clears sessions, for
  when the password is lost (no manual DB editing). Backed by `usersModel.resetAdminToDefault()`
  (recreates the admin if missing) + unit tests. The admin password already persists across restarts
  (the seed only runs when the `users` table is empty).
- **Security hardening — headers, rate limiting, uploads, validation** (Bloc S PR 2, spec
  `security-hardening.md`):
  - **HTTP security headers** via `helmet`, including a CSP tuned for the SPA
    (`script-src 'self'` thanks to `INLINE_RUNTIME_CHUNK=false`; `style-src`/`font-src` allow MUI inline
    styles + Google Fonts; `img-src` allows uploaded images). Verified against a production build.
  - **Rate limiting** (`express-rate-limit`): login 10 failed/15 min/IP, global API 3000/15 min/IP
    (`429`), env-configurable; public iCal export exempt. Replaces PR 1's minimal throttle.
  - **Upload hardening**: document upload gains a 10 MB limit + extension/MIME allowlist; logo extension
    is whitelisted; file deletion is path-contained (`safeUploadPath`). New pure util `utils/uploadSafety.js`.
  - **Money/percentage validation at write boundaries**: reservations `POST`/`PUT`/`PATCH payment` and
    devis `POST`/`PUT` reject negative/NaN/out-of-range values (`400`) before any DB write
    (resourceBookings computes its price server-side, nothing to validate).
  - New deps: `helmet`, `express-rate-limit`. Unit tests: `upload-safety` (6). Full suite green (247).
- **Security foundation — authentication + credential encryption** (Bloc S PR 1, spec
  `security-auth-encryption.md`):
  - **All `/api` routes now require a logged-in session** (fail-closed in `index.js`), except
    `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, the public
    `GET /api/ical/export/:token` feed, and `GET /api/version`.
  - Server-side sessions (`express-session` + `better-sqlite3-session-store`) via an httpOnly,
    `sameSite=lax`, prod-`secure` cookie (30-day sliding); password hashing with `scrypt` (no new crypto
    dep). New `users` table (multi-user-ready, `role` default `admin`).
  - **Default admin + forced first-login password change**: seeded `admin@guestflow.local` /
    `ChangeMe!2026` with `mustChangePassword`; the default password only opens the "set password" screen
    (other routes return `403 PASSWORD_CHANGE_REQUIRED`). Documented in the README.
  - **Google credentials encrypted at rest** (AES-256-GCM) in `settingsModel`, key auto-generated into
    `server/.env.local`; transparent one-time boot migration of legacy cleartext values.
  - Client: `LoginPage`, `useAuth` context (gates the app), forced password-change screen, "Se
    déconnecter" in the sidebar, "Sécurité → Changer le mot de passe" in Settings; `api.js` sends the
    session cookie and redirects to login on 401. Minimal login throttle (full rate limiting in PR 2).
  - New server files: `utils/encryption.js`, `utils/localEnv.js`, `utils/passwordHash.js`,
    `models/usersModel.js`, `middleware/requireAuth.js`, `controllers/authController.js`,
    `routes/auth.js`, `constants/authDefaults.js`.
  - Unit tests (+28): `encryption`, `password-hash`, `users-model`, `require-auth`, `auth-controller`,
    `settings-model-encryption`. Full suite green (241).
- **Pricing engine — server-authoritative, thin client** (Bloc 2, spec `pricing-engine-thin-client.md`):
  - Quote now returns `engineFinalPrice` (engine-computed price ignoring any manual override) and
    `priceOverridden`, so the UI shows the engine price struck through with the manual price in green.
    The manual price (`customPrice`) overrides the **accommodation** amount and drives the accommodation
    VAT base; options/resources add on top.
  - New `server/src/utils/financeValidation.js` (`validateMoneyAmount`, `validatePercentage`,
    `validateFinanceInputs`) enforced at `POST /api/reservations/calculate-price` (rejects negative/NaN
    amounts and out-of-range percentages with `400 NEGATIVE_AMOUNT|NOT_A_NUMBER|INVALID_PERCENTAGE`).
  - Option/resource summary lines are returned in display order (by title / name) instead of insertion
    order; custom options keep their input order last.
  - Unit tests: `finance-validation.unit.test.js` (6 cases), `pricing-offered-engine.unit.test.js`
    (6 cases). Full suite green (213).
- **School holidays** redesigned with auto-sync + Gantt timeline (spec `school-holidays.md`):
  - Page `/school-holidays` rebuilt as a **Gantt-style annual timeline**: one card per French school year (Sept → Aug), 12-month axis, 3 stacked zone lanes (A/B/C) with colored bands per period. Click a band → edit dialog.
  - **Auto-sync from `data.education.gouv.fr`** ([fr-en-calendrier-scolaire](https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/)) via Node's built-in `fetch` (no new dependency). User-configurable interval (default 60 d, range 1–365) and horizon (default 24 months, range 1–60). Scheduling is a 1-hour tick that re-reads the config from DB on every fire — settings changes take effect without a restart.
  - **Lock semantics** (per user choice "Manuel verrouille auto"): editing an auto-imported row sets `isLocked = 1`, the sync engine then skips it. A "Réactiver la mise à jour automatique" button in the edit dialog flips it back.
  - **Manual sync trigger** + **settings gear** on the page (banner + `PageActionBar` icon).
  - Full MVC backend: `routes/schoolHolidays.js` (thin), `controllers/schoolHolidaysController.js`, `models/schoolHolidaysModel.js` (factory), `utils/schoolHolidaysValidation.js`, `utils/schoolHolidaysSync.js`, `utils/educationGouvClient.js`.
  - New client components: `SchoolHolidaysTimeline`, `SchoolYearStrip`, `SchoolHolidayBand`, `SchoolHolidaysSyncBanner`, `SchoolHolidaysSyncSettingsDialog`. New `client/src/constants/schoolHolidayZoneColors.js` is the single source of truth for the zone color palette. New util `client/src/utils/schoolYear.js` groups periods by school year.
  - Unit tests: `school-holidays-validation.unit.test.js` (14 cases), `school-holidays-model.unit.test.js` (15 cases), `school-holidays-sync.unit.test.js` (10 cases) — all green.
- **Establishment closures** feature — revives orphan code into a working flow:
  - Top-level sidebar entry "Fermetures" → CRUD page at `/establishment-closures` built around the shared `PageActionBar` + `TableCard` + `FormDialog`.
  - Per-property + global scoping (`propertyId IS NULL` = blocks all logements, `propertyId = X` = blocks only logement X).
  - Server-side overlap detection: reservations conflicting with a closure return `409 CLOSURE_COVERS_DATE`; competing closures return `409 CLOSURE_OVERLAP`.
  - Calendar visualization: closed days render as gray-striped bands with the closure label, tooltip showing `<label> — du <start> au <end>`. Drag-create on closed days is auto-blocked because `getOccupiedDates` now appends closure dates.
  - Full MVC backend: `routes/establishmentClosures.js` (thin), `controllers/establishmentClosuresController.js`, `models/establishmentClosuresModel.js` (factory), `utils/establishmentClosuresValidation.js`.
  - New schema: `establishment_closures` table + `idx_establishment_closures_propertyId_dates` (added to the DB-hygiene index catalog).
  - New client util `utils/closureCalendar.js` (`expandClosuresToDates`, `getClosureForDate`).
  - Unit tests: `establishment-closures-validation.unit.test.js` (6 cases), `establishment-closures-model.unit.test.js` (~15 cases covering global/per-property semantics, night-block expansion, excludeId on edit).
- **DB Hygiene pass** (Bloc 0) — `server/src/utils/dbHygiene.js`:
  - 30 foreign-key indexes (`CREATE INDEX IF NOT EXISTS`) covering every FK column that is filtered or joined in routes — eliminates table scans on `WHERE propertyId = ?`, `WHERE reservationId = ?`, etc.
  - 2 iCal anti-overbooking lookup indexes: `idx_reservations_ical_source(sourceIcalSourceId, sourceIcalEventUid)` (primary sync lookup) and `idx_ical_import_events_reservationId` (reverse lookup on reservation deletion). Documented in `specs/db-hygiene-quick-wins.md` §1.1.
  - 2 unique indexes blocking duplicates at the DB level: `uniq_resource_bookings_slot(resourceId, date, startTime, endTime)` and `uniq_ical_sources_property_platform(propertyId, platformKey)`. Pre-check warns and skips the index when existing data already contains duplicates (no breakage).
- Unit tests: `server/src/tests/db-hygiene.unit.test.js` (13 cases covering index presence, unique-constraint rejection, duplicate pre-check warning path, FK-blocked drop graceful handling, query-planner usage).
- Shared sticky `PageActionBar` component used by every page (built-in Save + Cancel + `actionsBefore` / `actionsAfter` slots, icon-only with French tooltips, bordered IconButton style matching the legacy ReservationPage bar).
- Generic UI components: `LogoUpload`, `MaskedTextField`, `HelpedTextField`, `StatusBadge`, `StatusCard`, `SummaryItem`.
- `useDirtyFormGuard` hook encapsulating dirty-state detection + `beforeunload` + `popstate` + `window.__guestflowBeforeNavigate` integration.
- Settings page (Paramètres) redesign — three section cards (Société + Devis + Google Agenda) under the shared `PageActionBar`, humanized French vocabulary and helper texts everywhere, server-side validation for every critical field.
- "Tester la synchronisation" action on the Google Agenda section + `POST /api/google-calendar/test-connection` endpoint with friendly French error mapping (NOT_CONFIGURED / INVALID_CREDENTIALS / FORBIDDEN / CALENDAR_NOT_FOUND / UNKNOWN).
- Server-side validators (`utils/settingsValidation.js`): email, SIRET (14 digits, whitespace-tolerant), TVA intracommunautaire, IBAN (mod-97), BIC, PEM (permissive — accepts RSA, EC, PKCS8), quote validity days.
- Unit tests: `settings-validation.unit.test.js`, `settings-response.unit.test.js`, `settings-model.unit.test.js`, `google-calendar-test-connection.unit.test.js` (44 new test cases, all passing).

### Changed
- **VAT — two global rates instead of three per-property** (spec `accountant-accounting-export.md`, PR 1):
  VAT is now configured by two app-wide rates in **Paramètres → Taux de TVA** — **accommodation**
  (`vatRateAccommodation`, default 10 %) and **standard** (`vatRateStandard`, default 20 %, used by
  options, custom options and resources). The pricing engine, the reservation/devis quote, the devis PDF
  and the reservation TVA summary read these globals; the per-property `vatPercentage*` columns have
  been **dropped** entirely (not just dormant). TTC totals are unchanged (VAT is extracted from TTC).
  New unit tests: `pricing-vat-two-rates` (5).
- **Integrations — MVC extraction** (Bloc 6, spec `integrations-mvc.md`): `routes/ical.js`,
  `googleCalendar.js`, `options.js`, `calendarNotes.js` become thin routes over controllers + models.
  The iCal token lifecycle + `.ics` export move out of `database.js` into `icalModel`; the Google event
  builders → `utils/googleCalendarEvents.js` (pure) with the reservations+options read in
  `googleCalendarModel`; options + calendar-notes get their own model/controller. No API/UX change. New
  unit tests (ical-model, options-model, calendar-notes-model); suite green (350).
- **Devis ↔ Reservation table fusion** (spec `devis-reservation-fusion.md`): devis are now rows in the
  unified `reservations` table (`kind='devis'`), their lines in the `reservation_*` children — the parallel
  `devis_*` tables are gone. `devisModel` reads/writes `reservations WHERE kind='devis'` (status stored as
  `devisStatus`, aliased back to `status` so the devis API/PDF/convert are unchanged). Every reservation
  read (occupancy, availability, blocked-night/cleaning, baby beds, resource availability, finance
  summary/projection/operational/tourist-tax, Google Calendar push, client delete-impact/orphan cleanup)
  now filters `kind='reservation'`, so a devis never blocks a date or counts as revenue. No API/UX change.
- **Properties — MVC extraction** (spec `properties-mvc.md`): `routes/properties.js` (**1260 LOC**, the
  last CRITICAL monolith) becomes a thin route over `propertiesController` + `propertyIcalController` over
  `propertiesModel` (CRUD + enriched detail + pricing rules/apply-to + documents + options + platform
  colours) and `propertyIcalModel` (sources CRUD + the anti-overbooking **sync engine moved verbatim**).
  Pure iCal parsing → `utils/icalParser.js`; upload plumbing → `utils/propertyUploads.js`. The iCal
  source **status-update was triplicated** (the `/sync` route, `/sync-all`, and `scheduledTasks`) and is
  now one `syncSourceAndRecord` method. API contract, payloads and behaviour unchanged; no schema change.
  New tests: `property-ical-sync` (7, anti-overbooking) + `properties-model` (7); migrated
  `properties-ical` to `utils/icalParser`. Server suite **346** green.
- **Finance & Dashboard — server-owned money, MVC, render-only pages** (Bloc 5, spec
  `finance-dashboard-thin.md`): `routes/finance.js` (403 LOC) is now a thin route over `financeController`
  + `financeModel`, with pure helpers in `utils/financeCalcs.js`. All payment math + overdue derivation +
  aggregation + upcoming grouping moved server-side. `FinancePage` and `Dashboard` are **render-only** —
  the two duplicated `getRemainingDue` implementations, the overdue `map/filter/sort/reduce`, the
  upcoming-by-property grouping and the inline `nights`/`remainingDue` math are gone; both pages read
  server fields. `/summary` reservations are enriched with `remainingDue` + overdue flags. No schema change.
- **CalendarPage — structural decomposition** (Bloc 3, spec `calendar-page-decomposition.md`):
  `CalendarPage.js` drops from **1255 → ~430 LOC**, becoming a thin orchestrator (data loading + drag
  selection + wiring). The intricate rendering moves **verbatim** into focused, page-specific pieces:
  `utils/calendarVisuals.js` (pure date/%/colour/label helpers, unit-tested), `hooks/useInfiniteMonthScroll.js`
  (months list + scroll/preload/focus machinery), and components `CalendarToolbar`, `CalendarDayCell`
  (the occupancy gradients + click-zone hit-testing), `CalendarMonthGrid` (sticky header + cells→rows
  assembly), `CalendarNoteDialog`. **No behaviour or visual change** (the pricing engine was already
  removed with the dead reservation dialog — this is a readability refactor). Verified in-browser
  (gradients, closures, holidays, 0 console errors) + clean `CI=true` build.
- **Devis — MVC refactor + PDF service extraction** (Bloc 4, spec `devis.md`): `routes/devis.js` (1543 LOC)
  is now a thin route over `devisController` + `devisModel` (CRUD with a single shared persist helper,
  enrich, payment schedule, history/audit, both convert flows). The ~574-LOC inline `pdfkit` generator is
  extracted **verbatim** into `utils/devisPdf.js` (`generateDevisPdf(devis, settings) → Buffer`); shared
  money/date/format helpers moved to `utils/devisHelpers.js`. Pricing stays in the shared engine; no schema
  change; the API contract is unchanged and the PDF layout is preserved **except one deliberate footer fix**
  (see Fixed). New unit tests, including money-critical create/update persistence + the audit fix
  (`devis-model-create.unit.test.js`); server suite green (315). The `devis_*`/`reservation_*` table fusion
  remains a deferred follow-up.
- **Resources — MVC refactor + applicability pivot + safe delete** (Bloc 1, spec `resources.md`):
  `routes/resources.js` and `routes/resourceBookings.js` are now thin routes over
  `resourcesController`/`resourcesModel` and `resourceBookingsController`/`resourceBookingsModel` (price
  resolution, availability, slot-conflict and the server-computed booking price now live in models).
  Resource↔logement applicability is normalized into a **`resource_properties` pivot** (mirrors
  `property_options`); the API still exposes `propertyIds` arrays, and `utils/pricing.js`, the baby-bed
  availability and the baby-bed seed all read the pivot. Resource writes are validated (`400`). Deleting a
  resource that is used by reservations or bookings now asks for confirmation stating the impact
  (`409 RESOURCE_IN_USE` + `?force`). New unit tests; full server suite 297.
- **Clients — MVC refactor + single phone** (Bloc 1, spec `clients.md`): `routes/clients.js` is now a thin
  route over `clientsController` + `clientsModel` (reusing `clientValidation`). A client now has a single
  `phone` (the multi-number list is gone — see Migration); the client form shows one Téléphone field.
  The deletion-impact endpoint is server-shaped (reservations sorted + `nights`) and now also surfaces the
  **devis** that the cascade will delete — so a client with only devis is no longer deleted silently, and
  the delete dialog lists both reservations and devis. The devis PDF reads the single `client.phone`.
  New unit tests (model, controller, migration); server suite green (274).
- **Devis editor — accept-to-convert flow + "Actualiser tarifs"** (spec `devis-accept-to-reservation.md`):
  removed the standalone "Passer en réservation" action; converting a devis to a reservation now happens
  by setting its status to **Accepté** in the dropdown, which asks for confirmation before, on confirm,
  **saving the devis, converting it into a persisted reservation, and opening that reservation** —
  whose "Annuler"/retour goes back to the **calendar centered on it** (`?from=/calendar`). The Finance
  section's **"Actualiser tarifs"** button is now also available in devis mode (recompute with current
  rates + clear any manual price).
- **ReservationPage form split into section components via a form context** (Bloc 3 slice 3c-3, spec
  `reservation-form-sections.md`) — the long left-column form JSX is decomposed into focused, feature-local
  components under `client/src/components/reservation/`: `StaySection`, `GuestsBedsSection`, `ExtrasSection`
  and `FinanceSection` (Client / Canal / Notes kept inline). A new `ReservationFormContext` +
  `useReservationForm()` hook exposes the form bundle (state, derived capacity/pricing values, handlers,
  catalogs, flags) so the sections consume what they need with **no prop-drilling**. ReservationPage keeps
  owning all state, the pricing effect and every handler — it just assembles them into one context value
  and renders `<ReservationFormProvider>…<StaySection/>…`. No behavior or visual change. Added React
  Testing Library + `setupTests.js`; **19 component tests** (one suite per section + a context-guard test)
  pin each feature against regressions. Verified by a clean `CI=true` build + in-browser (dates → quote
  refreshes to 740.88€ total, 0 app console errors).
- **PricingSummary extracted from ReservationPage** (Bloc 3 slice 3c-2, spec
  `pricing-summary-extraction.md`) — the ~525-LOC right-panel pricing summary moved to a presentational
  `client/src/components/PricingSummary.js`. Renders the server quote (accommodation struck/green,
  options/resources with "Offrir", extra-guest, tourist tax + detail, VAT breakdown, total,
  deposit/balance/caution); owns its display-detail toggles internally; lifts "Offrir" interactions to
  the page via callbacks. No behavior/visual change; verified by a clean `CI=true` build + in-browser
  (0 console errors, identical rendering).
- **ReservationPage action bar → shared `PageActionBar`** (Bloc 3 slice 3c-1, spec
  `reservation-page-action-bar.md`) — the bespoke `position: fixed` bar (and its `mt` layout
  compensation + hard-coded sidebar offset) is replaced by the shared sticky `<PageActionBar>`, same
  actions/conditions/handlers (back, créer/transformer devis, statut devis, PDF, passer en réservation,
  Save, Cancel, Supprimer). `PageActionBar` gained two backward-compatible capabilities: an `onBack`
  handler (for computed back navigation) and custom-node action items (`{ node }`, e.g. the devis-status
  `<Select>`). Verified in-browser (reservation + devis modes, 0 console errors).
- **CalendarPage dead reservation dialog removed** (Bloc 3 slice 3b, spec `calendar-dead-dialog-removal.md`)
  — pure dead-code removal, no behavior change. The unreachable in-page reservation create/edit dialog
  (`dialogOpen` was never set true; all entry points navigate to the ReservationPage route) and
  everything used only by it (form state, debounced pricing effect, option/resource setters,
  `applyQuoteToForm`, capacity/baby-bed loaders, inline create-client flow, related imports) were
  deleted: `CalendarPage.js` 2274 → 1251 LOC (−1023). The live calendar (rendering, navigation, note
  dialog, occupied/closure/cleaning bands) is unchanged; verified by a clean `CI=true` build + in-browser
  check (calendar renders, reservation click → `/reservations/:id`, 0 console errors).
- **Reservations backend MVC extraction** (Bloc 3 slice 3a, spec `reservations-backend-mvc.md`) — pure
  structural refactor, **no API/behavior change**. The 1317-LOC `routes/reservations.js` monolith is now
  thin (verb/path → controller); logic moved to `controllers/reservationsController.js`,
  `models/reservationsModel.js` (all SQL), and pure utils `utils/occupancy.js`,
  `utils/reservationAudit.js`, `utils/bedDistribution.js`, `utils/reservationHelpers.js`. Same endpoints,
  payloads, status codes, history/iCal-lock/pricing-snapshot behavior. New unit tests (occupancy, audit)
  + manual create/conflict/history/delete verification; full suite green (255).
- **Pricing (Bloc 2):** `PlanningPage` now renders the server-computed effective quantity (`billedUnits`)
  instead of recomputing per-price-type multipliers client-side (`getMultiplier`/`getEffectiveQty`
  removed). `CalendarPage`'s dead local `recalcPrice` duplicate was removed. `ReservationPage`'s
  "Actualiser les tarifs" now also clears any manual price (reverts fully to engine pricing), and the
  redundant "Remise sur hébergement" summary line was removed (the struck engine price already conveys it).
- `GET /api/school-holidays` response shape changed from `Array` to `{ periods, syncState }`. Updated existing callers (`CalendarPage.js`, `PropertyPricingSeasonsPage.js`) to extract `.periods`. New endpoints `POST /api/school-holidays/sync`, `GET/PUT /api/school-holidays/sync-settings`, `PUT /api/school-holidays/:id/unlock`. `POST` and `PUT /:id` now validate (`400 INVALID_PERIOD`) and `PUT /:id` flips `isLocked = 1` when editing an officially-imported row.
- `scheduledTasks.js` runs a new hourly tick for school-holidays auto-sync, plus a 60s boot tick that fires the first sync if the configured interval has elapsed since the last run.
- `POST /api/reservations` and `PUT /api/reservations/:id` now reject overlapping closures with `409 CLOSURE_COVERS_DATE` and a French message naming the closure label + range.
- `GET /api/reservations/occupied-dates/:propertyId` now appends closure-covered date strings to its result (shape kept as `string[]` for backward compatibility) so the Calendar drag-gate automatically blocks closed days.
- `resources` no longer relies on the legacy `propertyId` single-FK column for property scoping. All callers (`routes/resources.js` baby-bed availability, `routes/reservations.js` baby-bed validation in POST + PUT, `database.js` baby-bed seed) now read/write `propertyIds` JSON exclusively. Single source of truth.
- Settings backend extracted to MVC: `routes/settings.js` → thin route → `controllers/settingsController.js` → `models/settingsModel.js`. Validation in dedicated `utils/settingsValidation.js`. Response shaping in `utils/settingsResponse.js`. Multer logo config in `middleware/multerLogoUpload.js`.
- `GET /api/settings` response wrapped under `{ company, quote, googleCalendar, updatedAt, updatedAtLabel }`; the Google Calendar private key is masked server-side (`privateKeyMasked` + SHA-256 `privateKeyFingerprint`); service account email is also exposed in a masked form for display.
- `PUT /api/settings` validates inputs and supports per-field "absent = preserve" semantics within each group, plus 3-way `privateKey` semantics (absent → preserve, `""` → clear, non-empty → validate + store).
- Google Calendar helpers (`getGoogleCalendarConfig`, `getGoogleCalendarClient`, `sanitizePrivateKey`) moved from `routes/googleCalendar.js` to `utils/googleCalendarClient.js`. `googleapis` is now `require`'d lazily so a missing dependency does not break boot or other endpoints.
- `routes/devis.js` now sources app settings via `settingsModel` (instead of the removed `db.getAppSettings`).

### Added
- **Production now serves HTTPS directly on `:4000`** (no Nginx / Caddy in front). On first deploy
  the GitHub Actions workflow runs `server/scripts/generate-self-signed-cert.sh` and stores the
  result in `~/guestflow/certs/` (persistent across deploys), then PM2 starts with
  `HTTPS_ENABLED=true` + `TLS_CERT_PATH` / `TLS_KEY_PATH` pointing at the persistent location.
  Node loads the cert via the new `server/src/utils/httpsBootstrap.js` builders and uses
  `https.createServer` instead of plain `http.createServer`. The cert generation script
  auto-detects every local IPv4 + hostname + localhost for the SAN list; it can also be invoked
  manually with explicit IPs / hostnames or with `--force` to regenerate before expiry. Cert + key
  are gitignored (`server/certs/*.crt` / `*.key`). Bootstrap pins a hard safety: when
  `HTTPS_ENABLED=true` but the cert or key files are missing, the server **refuses to boot** with
  a clear error pointing at the helper script — no silent downgrade to HTTP that would leak a
  `Secure` cookie over plain transport. 9 new test cases in `https-bootstrap.unit.test.js` lock
  the boot decision (HTTP path, HTTPS path, both files missing, one missing, env var overrides,
  no-app guard). The browser warns once per device that the cert isn't trusted by a known CA
  (expected — self-signed for a LAN-only deploy); after acceptance HSTS makes HTTPS sticky for
  1 year. README §HTTPS documents the per-device cert-trust workflow (accept-once OR install
  rootCA) + the HSTS-clearing instructions for every major browser. Access changes from
  `http://192.168.0.196:4000` to `https://192.168.0.196:4000`.

### Fixed
- **Production deploy over plain HTTP hit "Une erreur TLS a provoqué l'échec de la connexion
  sécurisée".** When the Helmet config was introduced (V02.00.00), HSTS + CSP's
  `upgrade-insecure-requests` + the `Secure` flag on the session cookie were all gated on
  `NODE_ENV === 'production'`. That conflates "this is a production build" with "TLS is available
  at the network edge" — fine when the prod stack runs behind an HTTPS reverse proxy, fatal on a
  Raspberry Pi serving plain HTTP (Safari upgraded every asset URL to `https://`, TLS handshake
  failed, the SPA never loaded). Worse, the symptom is sticky: once HSTS was emitted by the prior
  deploy, the browser keeps refusing HTTP for the host up to the `max-age` (Helmet's default = 1
  year) until cleared by hand. Fix:
  - New env var `HTTPS_ENABLED` is the explicit switch for the network-edge TLS policy. `true` →
    HSTS on + CSP `upgrade-insecure-requests` on + session cookie `Secure`. Anything else (incl.
    `NODE_ENV=production` alone) → all three off.
  - Helmet + cookie options extracted to `server/src/utils/securityConfig.js` (pure builders, no
    side effects) so the rules are testable and version-controlled in one place.
  - Helmet's `useDefaults: true` is replaced with `useDefaults: false` — Helmet's default CSP
    directives include `upgrade-insecure-requests`, exactly what we are trying NOT to emit when
    HTTPS isn't available. Listing the directives ourselves makes it impossible for a future
    Helmet release to silently turn the upgrade back on.
  - GitHub Actions deploy workflow now sets `HTTPS_ENABLED=true` (with `TLS_CERT_PATH` /
    `TLS_KEY_PATH` pointing at the persistent `~/guestflow/certs/` directory provisioned in the
    new "Added" entry above) so the Pi serves HTTPS directly. If you ever need to disable TLS
    (private LAN tunnel, etc.) it's a one-line unset in the deploy workflow.
  - README §HTTPS gets the full rule table + per-browser HSTS-clearing instructions (Safari macOS
    + iOS, Chrome `chrome://net-internals/#hsts`, Firefox).
  - Regression test `server/src/tests/security-config.unit.test.js` (11 cases) pins the entire
    rule table; the explicit "NODE_ENV=production alone does NOT re-enable HTTPS enforcement"
    case will turn red if anyone reverts to the conflated logic.
- **"Nouveau devis" button was invisible on the Devis page.** `DevisPage` was passing an
  `actions={<Button>}` prop to the legacy `PageHeader` component, which expects
  `actionLabel` / `actionIcon` / `onAction` instead — the button (and the page subtitle) were
  silently dropped. Migrated `DevisPage` to the standard `<PageActionBar>` per CLAUDE.md §7;
  the create button now lives in `actionsBefore` as a custom node so it keeps its full label
  ("Nouveau devis") rather than collapsing to an icon-only IconButton. Click navigates to
  `/reservations/new?mode=devis` (the existing devis editor). New regression test
  `DevisPage.test.js` (3 cases: button visible, navigation target, button reachable while the
  list is still loading).
- **Per-platform tourist tax (owner-collect) leaked into the accountant journal:** with the new
  "tax in complement" schedule, the accounting export still pro-rated deposit + balance against
  `totalStayTtc` and pro-rated the complement (= pure tax) as if it were stay revenue. Result on
  owner-collect non-direct entries: deposit + balance under-counted HT/VAT (the difference dumped
  into the residue / last VAT line), and the complement emitted bogus accommodation HT/VAT lines
  for an amount that is *not* revenue (it's tax owed to the commune). Fix in
  `accountingModel.buildEntry`: when the engine flags `touristTaxCollectedOnArrival = true`,
  pro-rate deposit + balance against `finalPrice` (no tax inside those amounts), and carve the
  tax portion out of the complement entry — dropping the entry entirely if it boils down to pure
  tax (the tourist tax is reported via Suivi taxe de séjour, never via the accountant journal).
  Direct + platform-collect cases unchanged. Regression tests:
  `accounting-model-tourist-tax.unit.test.js` (7 cases). Specs
  `per-platform-tourist-tax-collection.md` + `accountant-accounting-export.md` updated.
- **Per-platform tourist tax (owner-collect) was invisible on the reservation panel and the wrong
  amount was scheduled in the balance:** two distinct bugs in the same flow. (1) `PricingSummary`
  derived "tax offered by platform" from the legacy hardcoded `platform !== 'direct'` instead of
  reading `quote.touristTaxOfferedByPlatform`, so flipping `collectsTouristTax` to 0 on a non-direct
  source had no visible effect — the line kept the strike-through and the "Offert" chip. Compounded
  by `totalSejour = isIcalSource ? raw - tax : raw`, which silently stripped the tax from the total
  for any iCal-imported reservation regardless of the resolved flag. (2) The pricing engine baked
  the owner-collected tax into the balance even though Adrien actually collects it on check-in. Fix:
  - `PricingSummary` now reads `quote.touristTaxOfferedByPlatform` (with a benign legacy fallback
    while the first quote is in flight) and trusts `quote.totalStayPrice` as authoritative.
  - The engine now flags `touristTaxCollectedOnArrival = true` when the platform is non-direct AND
    `collectsTouristTax = 0`, derives `acompte` + `solde` from `finalPrice` (stay excl. tax), and
    routes the tax into `complementAmount` from save 1 (not gated on deposit/balance being paid).
    `totalStayPrice` still equals `finalPrice + tax`. Direct + platform-collect cases are unchanged.
  - `PricingSummary` renders an "À collecter à l'arrivée (incluse dans le complément)" caption
    when the new flag is set.
  Tests: `pricing-tourist-tax-on-arrival-schedule` (5 cases — non-direct owner-collect, direct
  unchanged, platform-collect unchanged, depositPaid mid-state recomputes balance against
  `finalPrice`, complementPaid frozen). Engine-consumer suites (pricing / devis / accounting /
  reservations) green at 98 / 98. Spec `per-platform-tourist-tax-collection.md` updated (functional
  rules 5 + 7, architecture, test plan, UI/UX). No retroactive recompute on past reservations.
- **Per-platform tourist tax toggle didn't update the property's iCal sources table:** the SELECT in
  `propertiesModel.getByIdWithDetails` (powering `GET /api/properties/:id`) was missing
  `collectsTouristTax`, so the nested `icalSources` array always returned the field as `undefined`.
  The "Taxe collectée" chip on `/properties/:id` then fell back to "Plateforme" regardless of the
  saved value, even though the dedicated `GET /api/properties/:id/ical-sources` endpoint (and the
  pricing engine + Suivi page) had the right value. SELECT now includes `collectsTouristTax`;
  regression test added (`properties-model`). Spec `per-platform-tourist-tax-collection.md` updated.
- **Public iCal export leaked devis (introduced by the devis↔reservation fusion):** the `.ics` feed
  selected all `reservations` rows for a property without a `kind` filter, so after the fusion a devis was
  exported as a booked event — external platforms would treat a tentative quote as unavailable and block
  real bookings. The export now advertises only `kind='reservation'`. Regression-tested (`ical-model`).
- **Selecting a non-hourly resource broke the quote (price + summary):** the pricing engine's
  resource-line builder referenced an undefined `priceType` (instead of `resource.priceType`) when a
  resource was **not** `per_hour`/complex/free-minutes, throwing `ReferenceError` and failing the whole
  quote. `per_stay` / `per_person` / `per_night` / `per_person_per_night` resources now price correctly
  (e.g. a 20€ per-person-per-night resource over 2 guests × 3 nights = 120€). Regression test added
  (`pricing-resource-types`).
- **Non-hourly resources couldn't be offered:** the "Offrir" button in the pricing summary was gated
  behind `isPerHour`, so only complex/hourly resources could be comped. It now shows for **every**
  selected resource (like options) — the model/engine/persistence already supported it.
- **iCal sync created an orphan client on a renamed-guest update:** the iCal client was resolved for
  every event, but the update path never relinks `clientId`, so a changed guest name produced an unused
  client row. The client is now resolved only in the insert branches (guarded by a new sync test).
- **Client creation was broken (POST /api/clients hung):** the `clientsController` attached its
  `create(model)` factory as `.create`, overwriting the `create` request handler — so the route called the
  factory and never responded. The factory is now `.buildController` on the Bloc-1 controllers
  (clients/resources/resource-bookings), and POST/PUT handlers work again. Covered by the controller tests.
- **Devis PDF footer wrapped SIRET/TVA onto two lines:** the per-page footer's center column was too narrow,
  so `SIRET : … • N° TVA : …` could wrap. The column is now widened and set to a single line
  (`lineBreak: false`), keeping SIRET and TVA on one line.
- **Devis update history never recorded changes:** the audit "before" snapshot was captured *after* the
  row was already updated, so update diffs were always empty. The devis MVC refactor captures the baseline
  before persisting, so editing a devis now records a real history entry.
- **False "Modifications non enregistrées" prompt on a freshly loaded reservation/devis:** the on-mount
  server pricing recalc reshaped the loaded form after the unsaved-changes baseline was captured, so a
  just-opened (or just-converted) record was wrongly flagged dirty and prompted on "Annuler"/navigation.
  The baseline is now captured **after** the first quote applies for existing records (new/prefilled
  records still baseline immediately); genuine edits still flag dirty. Spec `devis-accept-to-reservation.md`.
- **Devis PDF ignored the manual accommodation price:** when a manual price (`customPrice`) overrode the
  accommodation, the PDF still printed the engine-computed price on the accommodation line, so the HT and
  TTC subtotals were wrong (only the grand total TTC, which uses `finalPrice`, was right). The PDF now
  renders a single accommodation row at the manual amount with the original engine price struck through
  (in either direction, like an offered line), so the rows sum to `finalPrice` and the HT/TTC subtotals
  reconcile with the total.
- **Devis PDF download returned 401 ("Impossible de générer le PDF"):** the PDF was fetched with a raw
  `fetch` that didn't send credentials. With `REACT_APP_API_URL` absolute (cross-origin in dev), the
  default fetch omits the session cookie → `401`. Added `api.getDevisPdfBlob(id)` (fetch with
  `credentials: 'include'`) used by both the Devis list page and the reservation devis-mode download.
- **Dev TLS error in Safari (page would not load over HTTP):** Helmet's default CSP includes
  `upgrade-insecure-requests` and HSTS pins the host to HTTPS, so a plain-HTTP dev session upgraded
  `http://localhost/main.<hash>.js` to `https://localhost` → "Une erreur TLS a provoqué l'échec de la
  connexion sécurisée". CSP and HSTS are now enforced in **production only** (`NODE_ENV === 'production'`,
  behind the HTTPS reverse proxy); they are disabled in development. Spec: `security-hardening.md`.
- **Missing favicon (404) + default icon:** added a default GuestFlow favicon (`favicon.svg` + `favicon.ico`
  for Safari/legacy) referenced from `index.html`, so the app shows a brand icon and stops requesting a
  missing `/favicon.ico` even when no company logo is configured. When a company logo *is* set, it still
  overrides the favicon (the default icon links are replaced in `App.js`).
- **Offered options/resources price bug (Bloc 2):** an option/resource that was "offert" (billed 0) on a
  saved reservation, then made paid again, no longer stays at 0 — the real price is always recomputed and
  restored. The fragile `totalPrice = 0 → offered` inference (in `pricing.js`, plus the SQL fallbacks in
  `reservations.js` and `devis.js`) was replaced by a single lossless rule: `offered` only zeroes the
  billed total while the real price is preserved as `originalTotalPrice`. Covered by a round-trip unit test.
- Private key is no longer returned in clear text by `GET /api/settings`.
- The Settings form no longer wipes the private key when saved without re-entering it (handled by `MaskedTextField` + 3-way payload semantics).
- The Google Calendar section now exposes a "Tester la synchronisation" button — no need to go to Réservations to verify credentials.

### Removed
- **Legacy "Accès comptable" card** in `/parametres` (`SettingsAccountantAccessSection.js`). Its
  single-purpose "create the accountant + show the temp password on screen" hack is canonicalized
  by `/comptes` (admin only) where the temp password is emailed instead. The schema column
  `users.role` is dropped in the same migration — see Migration below.
- **"Extraction Taxe de séjour" navigation card on `/finance`** — the same page is reachable from
  the sidebar (Suivi financier → Taxe de séjour), so the redundant card on the overview was just
  noise. The Suivi page itself is unchanged.
- **Dead `recalcPrice` wrapper** in `ReservationPage.js` — a no-op (`return { ...updatedForm }`) left over
  after the pricing engine moved server-side (Bloc 2). Its 9 call sites now spread the form directly.
  Behavior-preserving; closes out the client-side pricing logic removal.
- **`devis_*` tables** (`devis`, `devis_options`, `devis_custom_options`, `devis_resources`,
  `devis_nights`, `devis_history`) — folded into the `reservations` family (`kind='devis'`). Data migrated
  (see Migration).
- **`GET /api/finance/pending`** — folded into the new `/finance/operational` (its only consumer was
  FinancePage). The endpoint now returns `404`.
- **Client-side payment math** — both `FinancePage.getRemainingDue` and `Dashboard.getRemainingDue`, plus
  FinancePage's client-side overdue derivation + upcoming-by-property grouping (now server-computed).
- **Client-side public-holiday computation** (`getFrenchPublicHolidays` in `client/src/frenchHolidays.js`)
  — moved server-side; the file now keeps only the `getSchoolHolidayInfo` lookup.
- **Dead `PRICE_TYPE_LABELS` constant in `CalendarPage.js`** — leftover from the removed reservation
  dialog, referenced nowhere.
- **Dead `client/src/pages/DevisForm.js` (501 LOC)** — unrouted and imported nowhere (all devis editing
  goes through `ReservationPage ?mode=devis`). Removed during the devis MVC refactor.
- `db.getAppSettings` / `db.upsertAppSettings` (logic moved to `settingsModel`). `database.js` keeps only DDL + migrations + the singleton bootstrap for `app_settings`.

### Migration
- **Admin account management:** `users` gains `firstName`, `lastName`, `companyName`, `notes`
  (all `TEXT NOT NULL DEFAULT ''`) and `lastLoginAt TEXT NULL`. New `user_roles(userId, role)`
  table with `ON DELETE CASCADE`. On boot, existing single-role values are backfilled into the
  join table and the legacy `users.role` column is dropped (native `ALTER TABLE DROP COLUMN`
  supported by better-sqlite3 v11). `app_settings` gains 8 SMTP/public-URL columns
  (`smtpHost`, `smtpPort` default 587, `smtpSecure` default 0, `smtpUsername`,
  `smtpPasswordEncrypted` — AES-256-GCM at rest —, `smtpFromEmail`, `smtpFromName` default
  `'GuestFlow'`, `publicUrl`). Idempotent; replaying the migration on an already-migrated DB is a
  no-op.
- **Per-platform tourist tax collection:** `ical_sources` gains
  `collectsTouristTax INTEGER NOT NULL DEFAULT 1`. The default `1` preserves the prior
  hardcoded behaviour (non-direct = platform collects = tax offered) until the owner explicitly
  flips a source to `0` on the property page. Idempotent.
- **Complément à percevoir columns:** `reservations` gains `complementAmount REAL NOT NULL DEFAULT 0`,
  `complementPaid INTEGER NOT NULL DEFAULT 0`, `complementPaidDate TEXT`. For existing fully-paid
  reservations (`depositPaid = 1 AND balancePaid = 1`), `complementAmount` is backfilled to
  `max(0, finalPrice + touristTaxTotal − depositAmount − balanceAmount)` so any silent gap from
  before this fix is visible the moment the migration runs.
- **Reservation payment dates + platform gross:** `reservations` gains `depositPaidDate TEXT`,
  `balancePaidDate TEXT` and `clientGrossAmount REAL`. Paid-dates are backfilled once from the
  corresponding due-dates for rows already marked paid (sensible accounting date for legacy data);
  `clientGrossAmount` stays NULL on existing rows. Idempotent.
- **Global VAT rates:** `app_settings` gains `vatRateAccommodation` (default 10) and `vatRateStandard`
  (default 20). Backfilled once from any existing property's `vatPercentageAccommodation` (→
  accommodation) and `vatPercentageOptions` (→ standard) so a single-gîte install keeps its configured
  values; the per-property `vatPercentage*` columns are then **dropped** via `ALTER TABLE … DROP COLUMN`.
  Migration is defensive (skips backfill if old columns absent) and idempotent.
- **Devis ↔ Reservation fusion (one-time, backed up):** on boot, `reservations` gains
  `kind`/`devisNumber`/`devisStatus`/`validUntil`/`convertedReservationId` (+ a unique index on
  `devisNumber` and a `kind` index). If the legacy `devis` table exists, the DB is first copied to a
  timestamped `*.pre-devis-fusion-*.bak` backup, then `migrateDevisIntoReservations` folds every devis into
  `reservations` (`kind='devis'`) with its options/custom options/resources/nights/history moved into the
  `reservation_*` children — insert + verify + drop run in one transaction (all-or-nothing). Idempotent
  (skips once `devis` is gone). Rollback = restore the `.bak`. Existing reservations are untouched.
- **Resource applicability pivot (Bloc 1):** new `resource_properties` table (`resourceId`, `propertyId`).
  On boot, `migrateResourcePropertiesFromJson` backfills it from the legacy `resources.propertyIds` JSON
  (empty stays global; stale property ids skipped), then drops the `propertyIds` column. Idempotent;
  lossless.
- **Clients single-phone (Bloc 1):** the legacy multi-number `clients.phoneNumbers` JSON column is
  dropped. On boot, `migrateClientPhonesToSingle` keeps each client's **first** listed number in the
  scalar `phone` (extras discarded) before the column is removed; idempotent (no-op once gone). Locally
  lossless (0 clients had >1 number); in prod, multi-number clients keep only their first number.
- **Users + sessions (Bloc S):** new `users` table (`CREATE TABLE IF NOT EXISTS` + `uniq_users_email`)
  seeded with the default admin on first launch (`mustChangePassword = 1`); a `sessions` table is
  created by `better-sqlite3-session-store`. Existing Google credentials in `app_settings` are
  encrypted in place once on boot (idempotent, tagged `enc:v1:`); `server/.env.local` gains
  auto-generated `GUESTFLOW_ENCRYPTION_KEY` and `GUESTFLOW_SESSION_SECRET` (git-ignored).
- `school_holidays` table gains three additive columns: `externalRef TEXT`, `isLocked INTEGER NOT NULL DEFAULT 0`, `lastSyncedAt TEXT` (idempotent `ALTER TABLE ADD COLUMN` block). Existing rows: `externalRef = NULL`, `isLocked = 0`. New singleton table `school_holidays_sync_state` auto-created. New index `idx_school_holidays_externalRef` added via the DB hygiene catalog.
- New table `establishment_closures` auto-created on boot via the existing `CREATE TABLE IF NOT EXISTS` pattern. No data migration needed — the table never existed before.
- On boot, the DB hygiene pass attempts to drop the legacy `resources.propertyId` column. SQLite refuses to drop a column that is part of a `FOREIGN KEY` definition, so on existing databases the column stays in the schema but is no longer read or written by any code — an info log explains this is harmless. Fresh installations / minimal test schemas without the FK definition do drop the column cleanly.
