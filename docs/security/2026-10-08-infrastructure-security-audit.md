# Infrastructure security audit — 2026-10-08

| Field | Value |
|---|---|
| **Status** | Report delivered — remediation not started |
| **Branch** | `claude/infrastructure-security-audit-ze9syy` |
| **Date** | 2026-10-08 |
| **Requested by** | Adrien |
| **Method** | Source-code review of this repository (eight parallel reviews, every finding re-read in the code), dependency audit of the three lockfiles, secret scan of the git history, review of every deployment document in the tree. **No live host was reached** — see §1.2. |
| **Previous audit** | 2026-06-01 (findings referenced as "L1"/"M1" in code comments; no report in the tree) |

---

## 0. Executive summary

The codebase is in good shape for a project of this size. The previous audit's work shows: helmet with an explicit CSP, server-side sessions with an auto-generated secret, scrypt password hashing, fail-closed role allowlists, a constant-time API key for the public tree, an HMAC-verified Qonto webhook, AES-256-GCM secrets at rest, a self-update engine that validates checksums, redirects, archive members and rolls back on failure, and **no live credential anywhere in the repository or its history**.

What remains is mostly **blast-radius** work: what happens when a trusted party (GitHub, the WordPress host, a deactivated employee, a calendar platform) turns hostile or leaks. The nine items below are the ones worth doing first; §4 lists every finding: 2 High, 31 Medium, 46 Low, plus 12 Info entries recording what was checked and found sound.

| # | Finding | Severity | Why it matters |
|---|---|---|---|
| 1 | Releases are checksummed but **not signed**, and the in-app updater runs `npm ci` with lifecycle scripts enabled and every `.env.local` secret in the environment ([§4.5 SUP-1](#45-supply-chain-and-release-pipeline)) | **High** | A compromised GitHub account, token or Action = code execution on the production VM with the guest database and every key. |
| 2 | **Live sessions are never re-validated**: deactivating a user, demoting them or resetting their password does not log them out ([AUTH-1](#41-authentication-sessions-and-accounts)) | **High** | The one control you reach for after an employee leaves does not work for a session already open on their phone. |
| 3 | **Production topology is ambiguous** and the two settings that depend on it disagree: `bootstrap-vm.sh` defaults `TRUST_PROXY_HOPS=1` + `HTTPS_ENABLED=false` ("behind Caddy") while `index.js` and the README describe Node exposed directly ([INFRA-3, INFRA-4](#47-infrastructure-cicd-and-operations)) | **High** (to verify on the VM) | Direct exposure with `TRUST_PROXY_HOPS=1` lets anyone spoof `X-Forwarded-For` and defeat the login brute-force limiter. Behind Caddy with `HTTPS_ENABLED=false`, the session cookie is not `Secure` and no HSTS is sent. |
| 4 | **Property documents (contracts, règlement) are served without authentication** under `/uploads`, with guessable names, and are never deleted from disk ([FILE-1, FILE-2](#44-files-uploads-and-self-update)) | Medium | Anyone who ever saw a link keeps it forever; a former reception user included. |
| 5 | The **public iCal feed** carries every guest's full name and e-mail, for the whole history, with no rate limit ([PUB-1](#42-public-internet-facing-surface)) | Medium | That URL is pasted into Booking, Airbnb and Google Calendar: their staff, logs and breaches get your guest list. |
| 6 | The **reception role** can read every resource booking's price, paid flag, phone and notes through one unprojected endpoint ([AUTH-4](#41-authentication-sessions-and-accounts)) | Medium | Exactly the data the role was designed never to see. |
| 7 | **Guest-controlled text** reaches the accountant's CSV unneutralised (formula injection) and the iCal feed unescaped (CR/LF injection); public booking inputs have no length cap ([DATA-3, PUB-5](#43-data-layer-and-input-handling)) | Medium | A public booking form is the attacker's entry point; the accountant's Excel is the target. |
| 8 | Operator-configured **iCal feed URLs are fetched with no timeout, size cap or private-IP policy** ([INT-1](#46-integrations-secrets-and-outbound-calls)) | Medium | SSRF into the LAN from the admin UI, and one stalled platform feed blocks every property's anti-overbooking sync. |
| 9 | **domainesolio.com**: dead unauthenticated REST relays that fan out to GuestFlow, PHP execution not blocked under `uploads/`, Host-header-driven URLs (reset-link poisoning), 2FA not enforced for admins, Umami proxy scope to verify ([WP-1..6](#49-wordpress-site-domainesoliocom-mu-plugins-apache-rules-deploy-scripts)) | Medium | The public site holds the GuestFlow API key; its admin account is the softest externally reachable login you own. |

Dependency scan: 1 critical (`proxy-addr`, via express 5.2.1), 2 critical dev-only (`shell-quote` via `concurrently`), 2 high (`braces` via nodemon, `source-map-js` via vite) — all transitive, all fixable by bumping ([§5](#5-dependency-audit)).

**What this audit could not do** is look at the running hosts. §6 gives you a read-only script to run on each VM and the checklist to compare it against; §1.2 explains how to let a second pass probe the public hostnames from outside.

---

## 1. Scope

### 1.1 What was audited

| Surface | Where | Covered by |
|---|---|---|
| GuestFlow admin API (`/api/**`) — auth, sessions, roles, every controller/model, SQL, validation | `server/src/**` | §4.1, §4.3 |
| GuestFlow public API (`/public/v1/**`, `/preferences`, iCal export, gate connector, Qonto webhook) | `server/src/routes/public`, `controllers/public`, middleware | §4.2 |
| File handling: uploads, static serving, PDF, self-update engine, backups | `server/src/utils/update*`, `propertyUploads`, `dbBackup`, `scripts/*.sh` | §4.4 |
| Integrations and secrets: Google OAuth, Qonto, Neat, SMTP, Web Push, iCal import, encryption at rest, logging | `server/src/utils/*Client.js`, `encryption.js`, `localEnv.js`, `scheduledTasks.js` | §4.6 |
| React client, CSP, service worker | `client/**`, `server/src/utils/securityConfig.js` | §4.8 |
| CI/CD and deployment: workflows, release pipeline, bootstrap/backup/restore/TLS scripts | `.github/workflows`, `release.sh`, `scripts/`, `server/scripts/` | §4.5, §4.7 |
| WordPress plugin `guestflow-booking` (PHP proxy, updater, blocks) | `integrations/wordpress/guestflow-booking` | §4.2 |
| WordPress site domainesolio.com (30 mu-plugins, Apache rules, deploy scripts) | `integrations/wordpress/solio-site` | §4.9 |
| Dependencies | three `package-lock.json` | §5 |
| Git history (50 commits available in this clone) and tree | secret-pattern scan | §4.6 (clean) |

### 1.2 What was NOT audited, and how to close the gap

- **The running VMs and the Proxmox node.** This session runs in a cloud container with no route to `192.168.0.0/24` and no SSH credentials. Operating-system patch level, firewall rules, SSH configuration, Docker settings, the Caddy configuration, the WordPress core/plugin versions actually installed, `wp-config.php`, the Proxmox web UI exposure and 2FA — none of it can be read from the repository. **§6 gives you `scripts/security/host-audit.sh`**, a read-only inventory script to run on each host, and the checklist to read its output against.
- **External probing of the public hostnames** (`domainesolio.com`, `guestflow.adn-dev.fr`): the environment's network policy denied both hosts, so TLS configuration, response headers and exposed paths were not observed live. To allow a second pass, add the two hostnames under *Allowed domains* in the cloud environment settings (Edit → Network access), keeping *Allow package managers* ticked.
- **Third-party services** (Qonto, Google, Neat, Squarespace DNS, Freebox, Netlify for adn-dev.fr, GitHub organisation settings such as branch/tag protection, secret scanning and 2FA enforcement) — only their integration code was reviewed.
- **Dynamic testing** (fuzzing, running the app) — the review is static; a handful of findings are marked *to verify* where behaviour depends on a library's runtime path.

---

## 2. Infrastructure inventory (as documented in the repository)

Reconstructed from `specs/`, `README.md`, `integrations/wordpress/solio-site/*.md` and `scripts/`. Anything marked **?** must be confirmed with §6.

| Host | Role | Exposure | Software | Notes |
|---|---|---|---|---|
| `pve01` — Proxmox VE | Hypervisor for everything below; its postfix relays Alertmanager mail | LAN (web UI :8006 **?**) | Proxmox VE | Single point of failure: a compromise of the node is a compromise of every guest. 2FA on the web UI, firewall, and backup jobs to the NAS are to verify. |
| VM 104 `guestflow` — `192.168.0.24` | GuestFlow production (`guestflow.adn-dev.fr`) | Internet via Caddy `edge` **?** or Freebox port forward 443→4000 **?** | Node 24, PM2, SQLite, user `adrien` | The two documented topologies contradict each other (INFRA-3/4). Holds the guest DB, `.env.local` (AES key, session secret, API keys), TLS key. |
| VM 103 `wordpress` — `192.168.0.23` | Public site `domainesolio.com` (Docker container `wp_app`, volume `soliowebsite_wp_data`) | Internet (HTTPS) | WordPress + plugins `guestflow-booking`, `ml-slider`, `polylang`, `two-factor` + 30 `gf-*` mu-plugins | Calls GuestFlow's public API server-to-server with `PUBLIC_API_KEY`. `wp-admin` reachable from the Internet **?** |
| LXC `edge` | Caddy reverse proxy; serves `/_s/*` (Umami) and presumably the public vhosts | Internet (80/443) | Caddy | Configuration outside the repo. HSTS, rate limiting and TLS policy live here. |
| LXC 109 `stats` — `stats.maison.adn-dev.fr` | Umami analytics (Node + PostgreSQL) | LAN only (by spec); `/_s/` public through Caddy | Debian 13, Umami | 25-month purge job. |
| VM 108 | Prometheus, Grafana, Alertmanager, blackbox_exporter | LAN **?** | | Grafana default credentials / anonymous access to verify. |
| Legacy Raspberry Pi — `192.168.0.196` | Former GuestFlow + WordPress host | Was port-forwarded from the Freebox | | **Still powered on? Still forwarded?** Decommission or audit. |
| NAS | Backup target (per Notion « Serveur Proxmox et NAS ») | LAN | | Backup encryption and restore test to verify (INFRA-8). |
| Freebox | Router; DDNS `*.freeboxos.fr`; port forwards 80 and 443 | Internet | | Only forwards that are still needed should exist (the acme.sh HTTP-01 path keeps 80 open permanently). |
| Operator Mac | Runs backups, restores, the release skill, WordPress deploy scripts over SSH | | | Holds plaintext DB backups (INFRA-8) and SSH keys to every host. |
| External | GitHub (code, releases, Actions), Qonto (payments), Google (OAuth, Calendar), Neat (insurance), SMTP provider, Météo-France, education.gouv, Squarespace DNS, Netlify (adn-dev.fr) | | | GitHub is the trust root of the update chain (SUP-1). |

---

## 3. Severity scale

| Level | Meaning here |
|---|---|
| **High** | Reachable by an unauthenticated party or a trusted-but-external party (GitHub, WordPress host, platform), or breaks a control the operator relies on. Fix within the month. |
| **Medium** | Needs a low-privilege account, a leaked secret, or an operator action; or a DoS of the single production box. Fix within the quarter. |
| **Low** | Hardening, defence in depth, hygiene. Batch into normal work. |
| **Info** | Verified non-issue or note. |

Finding IDs: `AUTH` (§4.1), `PUB` (§4.2), `DATA` (§4.3), `FILE` (§4.4), `SUP` (§4.5), `INT` (§4.6), `INFRA` (§4.7), `CLI` (§4.8), `WP` (§4.9), `DEP` (§5).

---

## 4. Findings

### 4.1 Authentication, sessions and accounts

**AUTH-1 — High — Live sessions are never re-validated; deactivation, demotion and password reset do not revoke access.**
`server/src/middleware/requireAuth.js:10-20` trusts the `req.session.user` snapshot (no DB lookup, no `isActive` check). `controllers/authController.js:45-54` (`me`) only destroys the session when the row is *missing*; an `isActive=false` row is returned 200. `usersController.js:310-325` (soft delete), `:230-264` (role update), `:267-307` (admin reset) and `models/usersModel.js` never purge the `sessions` table; the only purge is `server/scripts/reset-admin.js:19`.
*Scenario:* a deactivated or demoted user keeps a working 30-day *sliding* session on any client that does not call `/auth/me` (curl, a saved cookie, a script). The SPA happens to refresh roles on load, which hides the problem in the browser.
*Fix:* in `requireAuth`, re-read the user row by id on every request (one indexed read), 401 + destroy when missing or inactive, rebuild `req.user` from the row; and on deactivate / role change / password change delete that user's rows from `sessions` (`DELETE FROM sessions WHERE json_extract(sess,'$.user.id') = ?`) or compare a `sessionVersion` column. Tests: deactivated → 401, demoted admin → 403.

**AUTH-2 — Medium — No session regeneration at login or password change (session fixation).**
`authController.js:12-22` writes `req.session.user` into the pre-existing session; `:84-86` likewise after a voluntary password change. No `regenerate()` anywhere in `server/src`.
*Scenario:* the attacker obtains a legitimately issued `guestflow.sid` (their own reception account), plants it in the victim's browser (cookie injection from a sibling host, or on plain HTTP), waits for the admin to log in.
*Fix:* `req.session.regenerate()` before writing the user at login, after password change and after e-mail change.

**AUTH-3 — Medium — Any user can claim the bootstrap admin e-mail; `reset-admin` then promotes that account.**
`PUT /users/me` (`usersController.js:92-134`, reachable by accountant and reception) accepts `admin@guestflow.local`. `usersModel.js:309-326` (`resetAdminToDefault`) resets *whichever row holds that e-mail* to the default password and grants `admin`.
*Fix:* reject `DEFAULT_ADMIN_EMAIL` in `updateSelf`/`createUser`/`updateUser`; make `resetAdminToDefault` act only on a row that already holds `admin` (oldest first) and abort loudly otherwise.

**AUTH-4 — Medium — Reception role receives finance and PII through `GET /resource-bookings/planning-events`.**
Allowed by `enforceRoleAccess.js` (RECEPTION_MATCHERS). `controllers/resourceBookingsController.js:11-15` returns `model.listPlanningEvents(from, to)` with no reception projection; `models/resourceBookingsModel.js:12-22,110-113` selects `rb.*` (`clientPhone`, `notes`, `totalPrice`, `paid`) plus `resourcePrice`. Every other reception-reachable endpoint was checked and is correctly projected through `utils/receptionView.js`.
*Fix:* project through a new whitelist (`id, resourceId, resourceName, propertyId, propertyName, date, startTime, endTime, displayName, reservationId`) when `isReceptionOnly(req.user)`; validate `from`/`to` as ISO dates; pin the key set in a unit test.

**AUTH-5 — Low — scrypt with Node defaults (N=16384) and no parameter versioning; synchronous.** `utils/passwordHash.js:18,30`. Below the current OWASP recommendation (N=2^17) and impossible to upgrade transparently. *Fix:* `{ N: 131072, r: 8, p: 1, maxmem: 256 MiB }`, encode params in the stored string, re-hash on login when stale, use async `crypto.scrypt`.

**AUTH-6 — Low — Sensitive self-service changes need no re-authentication and do not evict other sessions.** `PUT /users/me` changes the login e-mail without `currentPassword`; a password change keeps the user's other sessions alive. *Fix:* require the current password for e-mail change; destroy other sessions on password change (see AUTH-1).

**AUTH-7 — Low — Brute-force surface.** Timing-based user enumeration (`usersModel.js:148-153` returns before scrypt on unknown e-mail); no per-account lockout (per-IP only, 10/15 min); `POST /api/auth/change-password` is a password oracle under the broad 3000/15 min limiter (`index.js:152-158`); `409 EMAIL_ALREADY_EXISTS` on `PUT /users/me` is an e-mail-existence oracle for low roles. *Fix:* dummy scrypt on unknown e-mail; per-e-mail failure counter; mount `loginLimiter` on change-password.

**AUTH-8 — Low — No audit trail for auth and account events** (login success/failure, password/role/e-mail change, deactivation). *Fix:* structured `console.info('[auth] …')` lines without secrets.

**AUTH-9 — Low — 30-day sliding session with no absolute lifetime** (`index.js:104`, `securityConfig.js:101`). *Fix:* absolute cap (e.g. 90 days) checked in `requireAuth`.

**AUTH-10 — Low — Legacy `role` string shim in `constants/roles.js:21-24`** treats `{ role: 'admin' }` without a `roles` array as admin. Not exploitable today (sessions are server-written) but a latent escalation path. *Fix:* delete; missing `roles` = no role.

**AUTH-11 — Low — Session ids live in the main DB and therefore in every pre-update backup** (`dbBackup.js:34-37`). Cookies are HMAC-signed with `GUESTFLOW_SESSION_SECRET`, so backup + `.env.local` = every live session. *Fix:* truncate `sessions` in backups or use a separate store file.

**AUTH-12 — Info — Verified sound.** CSRF: `httpOnly` + `SameSite=Lax` + JSON-only bodies + exact-match credentialed CORS — acceptable without a token; the two state-changing GETs (`GET /api/payments/qonto/refresh-connection`, `GET /api/ical/token/:propertyId`) should become POST. No `mustChangePassword` bypass. Mass assignment on users blocked. Accountant allowlist matches the routes. `CORS_ORIGINS` defaults to `http://localhost:3000` in production when unset: set it explicitly or empty.

### 4.2 Public internet-facing surface

**PUB-1 — Medium — The public iCal feed ships every guest's full name and e-mail, for the whole history, with no rate limit and a DB write per fetch.**
`models/icalModel.js:103-133` selects `r.*, c.firstName, c.lastName, c.email` for all reservations (no date window), emits `SUMMARY:<First Last>`, guest counts and `ATTENDEE:mailto:<email>`. `index.js:152-155,166-168` exempt `GET /api/ical/export/*` from `apiLimiter` and the session guard; `icalModel.js:147-149` refreshes `icalExportRanges` on every hit. Token entropy is fine (32 random bytes). `specs/ical-export-closures.md:193-195` already lists this as an open question.
*Fix:* neutral `SUMMARY` (`Réservé` or the reservation number), drop `ATTENDEE` and guest counts, window to `endDate >= today − 30 d`, dedicated limiter (≈60/15 min/IP), ETag/short cache so the snapshot write is not attacker-triggerable.

**PUB-2 — Medium — Public rate limits are keyed only on the proxy-relayed visitor IP; the per-API-key cap promised by `specs/public-api.md:127` does not exist.**
`middleware/rateLimiters.js:51-53,67-103`: all three public limiters use `req.visitor?.ip || req.ip`; `visitorContext.js:17-25` honours any syntactically valid `X-GuestFlow-Visitor-IP` once the key matches.
*Scenario:* if `PUBLIC_API_KEY` leaks (it sits in plaintext autoloaded `wp_options` and every WordPress DB dump — PUB-8), a caller rotates the header per request and gets unbounded booking requests (client + devis rows, push + e-mail each), unbounded Qonto link creation on `/pay` and one Qonto API call per `/status` poll. Conversely an empty relayed IP (plugin `trusted_proxies` unset) collapses every visitor into one bucket.
*Fix:* add a second limiter keyed on `req.ip` with a global budget (e.g. 20 booking requests/h, 60 `/pay`/h, 600 `/status`/15 min); optional `PUBLIC_API_ALLOWED_IPS`; log when `req.visitor.ip` is empty.

**PUB-3 — Medium — Unbounded stay length and option quantities on the unauthenticated quote path.**
`utils/publicInputValidation.js:74-78,107-113,124-130` checks only `endDate > startDate` (the availability query caps 365 days, the quote/booking path does not). `utils/pricing.js:1386-1400` iterates every night; `controllers/public/publicQuoteController.js:205-217` runs the engine twice and makes a live Neat call per unique date/amount hash. `POST /wp-json/guestflow/v1/quote` has `permission_callback => __return_true` and the solio `gf-search.php` fans out one quote per property per anonymous GET.
*Scenario:* `{"startDate":"2026-01-01","endDate":"2999-12-31","options":[{"optionId":1,"quantity":1e9}]}` → ~355 000-night loop and a multi-MB response, 600 times per 15 minutes; each distinct date pair burns a Neat call.
*Fix:* cap nights (60 or the property's `maxNights`), `endDate <= today + 24 months`, `quantity <= 99`, array lengths `<= 50`; cache or limit `gf-solio/v1/search`.

**PUB-4 — Medium — The WordPress plugin installs an unverified update zip from any `github.com` URL, and TLS verification can be switched off in the UI.**
`integrations/wordpress/guestflow-booking/includes/class-gf-updater.php:53-61,110-137` checks scheme + host only (no repo path pin, no checksum, no signature); `class-gf-settings.php:138-144,264-269` exposes an `ssl_verify` checkbox that `class-gf-api-client.php:88` honours; `specs/wordpress-plugin-self-update.md:154` records it having been off in production.
*Scenario:* MITM with `ssl_verify` off, a compromised GuestFlow host, or a compromised GitHub account → arbitrary PHP on the public website as the web user.
*Fix:* publish the plugin zip's SHA-256 in the manifest (extend `release.yml` + verify in `pluginUpdateController`), verify it in an `upgrader_pre_install` hook; pin `download_url` to `https://github.com/adn-dev-adrien/guestFlow/releases/download/`; refuse `ssl_verify=0` unless the API host is loopback/RFC1918; prefer the `GUESTFLOW_SSL_VERIFY` constant.

**PUB-5 — Low — No length or charset limits on public booking inputs; CR/LF survives into the iCal feed.**
`publicInputValidation.js:158-170` only trims `firstName/lastName/phone`; `publicBookingRequestController.js:168` stores `message` uncapped (body limit 256 KB). `icalModel.js:26-29` (`escapeIcalText`) escapes `\n , ;` but not `\r` or backslash and never folds lines.
*Scenario:* `lastName = "X\r\nSUMMARY:CLOSED\r\nDTSTART:…"` → forged VEVENT lines in the feed Booking/Airbnb consume.
*Fix:* cap names 100, phone 40, e-mail 254, message 2000; strip `[\x00-\x1f\x7f]`; escape `\\` and `\r`, fold at 75 octets.

**PUB-6 — Low — A booking request silently attaches to any existing client matched by e-mail and may overwrite their language** (`publicBookingRequestController.js:129-144`). *Fix:* create a new client or flag `identityMismatch` when the name differs; never touch `emailLanguage` on a match.

**PUB-7 — Low — Gate connector: signed requests are replayable within the ±2 min window; posted `url`/`code` are stored unvalidated and the URL is e-mailed to guests.** `middleware/requireGateConnector.js:22,66-82` (no nonce cache); `utils/gateResults.js:33-50`; `emailContextBuilder.js:436,459`; rendered as `<Link href>` in `client/src/components/GateAccessCard.jsx:76` for admin and reception. *Fix:* 5-minute LRU of `(timestamp, signature)`; accept `url` only when `new URL()` succeeds with `https:` and an allowlisted host; cap `code`/`message`.

**PUB-8 — Low — WordPress stores `PUBLIC_API_KEY` in plaintext, autoloaded `wp_options`** (`class-gf-settings.php:50,196-197`); readable by every plugin, any SQLi, every DB dump. The `GUESTFLOW_API_KEY` constant path exists (`get_api_key():120-126`) but is not enforced. *Fix:* document the constant as the production path, store with `autoload=no` otherwise, rotate on host change, pair with PUB-2.

**PUB-9 — Low — Provider error text relayed verbatim to visitors on `/pay`** (`publicPaymentController.js:97-100` sends `err.message`, including Qonto JSON error bodies). *Fix:* map to the generic translated `paymentProviderError`; log server-side only.

**PUB-10 — Info.** `uninstall.php` leaves `gf_stale_*` and `gf_booking_update_manifest` transients. Public `details[]` carry raw French engine diagnostics (fingerprinting). `emailTemplateRenderer.js:44-52` does not HTML-escape variables — harmless today (all mail is plain text) but escape if a template ever becomes HTML. `/api/version` discloses `NODE_ENV` and commit SHA unauthenticated.

**PUB-11 — Info — Verified sound.** Constant-time API key, fail-closed when unset, visitor headers honoured only after the key; explicit allowlist projections (no iCal URLs, notes, payment state, tax config leak); 192-bit devis capability token with constant-time compare and 404 on both bad id and bad token; payment amounts always re-derived from the stored devis, `returnPath` restricted to same-origin; Qonto webhook HMAC over raw bytes, ±5 min, constant-time, re-reads paid state at Qonto before acting, idempotent; unsubscribe link with per-client 192-bit token, GET never mutates, uniform page, every value escaped; honeypot returns a fake 201; global error handler never sends `err.message`; plugin REST proxy has a fixed route table (no open proxy), nonce-gated writes, honest visitor IP from `REMOTE_ADDR`/right-most non-trusted XFF hop, DOM built with text nodes only.

### 4.3 Data layer and input handling

**DATA-1 — Medium — Unbounded date range on `GET /planning/laundry` (reception-reachable) is a CPU/SQL DoS.**
`controllers/planningController.js:66-121` validates ISO shape and ordering only; `utils/laundryWindow.js:50-64` walks the whole span; `utils/laundryTripLedger.js:74-99,139-185` runs ~10 prepared queries per date. `?from=0001-01-01&to=9999-12-31` → ~521 000 dates × 10 queries, single-threaded. *Fix:* reject spans > 400 days (as `validateAvailabilityQuery` already does publicly); same cap on `GET /reservations?from&to` and `/resource-bookings/planning-events`.

**DATA-2 — Medium — Non-finite / unbounded amounts accepted on SAS commits (reception-writable).**
`models/reservationsModel.js:2702` filters `complementItems` with `Number(i.amount) > 0` (`Infinity` passes) and stores it at `:2770`; departure lines `:3061-3073` + `writeEndOfStayDetail` `:511-522` use `round2` (`:57`) which returns `Infinity` for `Infinity`. `validateFinanceInputs` is not called in `sasController.commitArrival/commitDeparture` (`:283-411`, `:413-441`). `JSON.parse('1e999')` is `Infinity`.
*Scenario:* `{"complementItems":[{"label":"x","amount":1e999}]}` corrupts `complementAmount`, `remainingDue`, dashboard sums and the accounting export (Σ débit ≠ Σ crédit silently). No upper bound either. `specs/security-hardening.md` rule 10 claims every money write is validated; these are gaps, as is `customOptions[].amount` on `POST/PUT /reservations` (`utils/pricing.js:1803`).
*Fix:* `validateMoneyAmount` (finite, ≥ 0, ≤ `MAX_AMOUNT`) on every client-supplied line amount before the transaction; make `round2`/`roundMoney` return 0 or throw on non-finite input; update the spec's rule 10.

**DATA-3 — Medium — CSV formula injection in the accountant export from guest-controlled names.**
`utils/csv.js:27-35` quotes `; " \n \r` but never neutralises a leading `= + - @ \t`; `utils/accountingExport.js:96-104` builds the label from raw `firstName lastName`; names from the public form are only trimmed. Served as `text/csv` to the accountant (`accountingController.js:33-49`). Uppercasing does not defuse `=HYPERLINK(…)` or `=cmd|'/C calc'!A0`. Same gap in `translationCsv.js:44-47` (admin-authored cells, Info).
*Fix:* prefix a `'` and force quoting when a cell starts with `= + - @ \t \r` (OWASP); cap guest names at 80 chars and reject control characters.

**DATA-4 — Low — Finance dashboard custom window unbounded** (`utils/financeWindow.js:40-43`, `financeDashboardModel.js:201-215`; admin-only, ~520 000 iterations and a ~50 MB payload for a 10 000-year window). *Fix:* cap custom windows at 5 years.

**DATA-5 — Low — Laundry manual additions accept non-finite counts** (`laundryManualAdditionsModel.js:36-42`, reception-writable). *Fix:* `Number.isFinite` + clamp.

**DATA-6 — Low — Devis `cautionAmount` and reservation `customOptions[].amount` skip the money validator** (`devisController.js:13-20`, `devisModel.js:653`, `pricing.js:1800-1803`; admin-only). *Fix:* add to the `validateFinanceInputs` map.

**DATA-7 — Low — SQLite file created with the default umask** (`database.js:7-13`; contrast `.env.local` 0600). `VACUUM INTO` backups at `:679` inherit it. *Fix:* `process.umask(0o077)` at boot and `chmodSync(dbPath, 0o600)`.

**DATA-8 — Info.** Internal error messages echoed to admins in a few 409/502s (`reservationsController.js:1309,1331`, `neatController.js:159,211,256,308`, `routes/settings.js:19`). `LIKE` wildcards unescaped in search (parameterised, harmless). Translation import accepts any header text as a language code (`translationCsv.js:34-37`). `?propertyId=1&propertyId=2` reaches a bind parameter as an array → noisy 500.

**DATA-9 — Info — Verified sound.** Every `${}` inside a `prepare`/`exec` resolves to a constant, a `PRAGMA table_info`-derived identifier, or a frozen list (`assertSafeIdentifier` in `dbHygiene.js`); all user values go through binds including IN-lists and LIKE. No `Object.keys(req.body)` loops; the single `...req.body` feeds a fixed SET list. No deep merges (prototype pollution). The only `new RegExp` is over a constant. Tariff recipes are filesystem-only with `horizonYears` bounded 1–5. `journal_mode=WAL`, `foreign_keys=ON`. 256 KB JSON cap.

### 4.4 Files, uploads and self-update

**FILE-1 — Medium — `/uploads` is served without authentication and holds property documents (contracts, règlement, PDF/DOC/XLS/CSV/TXT up to 10 MB), under guessable names.**
`server/src/index.js:135` mounts `express.static` before the session guard (needed for photos/logo). `utils/propertyUploads.js:15-20` writes documents to the same directory as `${Date.now()}-<original name>`; `propertiesModel.js:982-989` stores `/uploads/<name>`; `client/src/components/property/PropertyDocumentsTab.jsx:90` links to it directly. `Cross-Origin-Resource-Policy: cross-origin` (`securityConfig.js:93`) lets any site hot-link them.
*Fix:* keep `/uploads` public for photos and `company-logo.*` only; store documents under `data/documents/` outside the static tree, serve through `GET /api/properties/:id/documents/:docId/download` (id lookup, `Content-Disposition: attachment`), name files with `crypto.randomBytes(16)`; migrate existing rows in `database.js`; in the client fetch through `api.js` with credentials.

**FILE-2 — Medium — Deleting a document (or its property) never removes the file from disk** (`propertiesModel.js:991-994`, `:613-636`), so it stays publicly reachable forever. *Fix:* read `filePath` before the delete, `removeUploadedFile` after; loop in `remove()`; unit test.

**FILE-3 — Medium — Uploads validate only the declared MIME type and extension; the logo is stored byte-for-byte and fed to pdfkit and the favicon handler.** `utils/uploadSafety.js:38-42`; `middleware/multerLogoUpload.js:18-25`; `devisPdf.js:194-195`; `dynamicFavicon.js:58-60`. Mitigations verified: `nosniff` on every response, content type derived from the allow-listed extension, no SVG/HTML, `object-src 'none'`. *Scenario (admin-only):* a malformed PNG named `logo.png` stalls devis PDF generation. *Fix:* normalise the logo through `sharp(buf, { limitInputPixels: 25e6 }).png()`; sniff documents with `file-type` and reject on mismatch.

**FILE-4 — Low — `PUT /api/properties/:id` accepts `body.photo` verbatim**; the next upload then unlinks whatever path is stored (`propertiesModel.js:563-564,605-606`) — an admin can delete any file in `uploads/` or publish an off-site URL through the public API. *Fix:* ignore `body.photo` except the explicit empty-string "remove"; validate `^\/uploads\/\d+-\d+\.webp$`.

**FILE-5 — Low — sharp photo pipeline has no `limitInputPixels`** (`propertyUploads.js:69-78`): a 5 MB PNG bomb can OOM the VM and take every session down for the restart. *Fix:* `sharp(buf, { limitInputPixels: 30e6, failOn: 'error' })`, surface as 400.

**FILE-6 — Low — `/uploads` serves PDFs/Office files inline with no `Content-Disposition`; the favicon map includes `.svg`** (`dynamicFavicon.js:26-33`). *Fix:* `setHeaders` → `attachment` for non-image extensions; drop `.svg`.

**FILE-7 — Low — Archive member validation gaps in `updateStaging.js:96-128`** (FIFOs not rejected; `\n` in a member name splits the listing — safe by redundancy with GNU tar; `tar`/`npm` resolved via PM2's `PATH`). *Fix:* reject any listing line not starting with `-`/`d`, refuse control characters, resolve binaries once at boot and log them.

**FILE-8 — Info — Verified sound.** No HTTP backup/restore endpoint exists (backup/restore is SSH-only). Update lock TOCTOU is benign (single-threaded, no `await` between check and write, 30-min stale, reconciled on boot); `startUpdate` re-fetches the feed and requires `release.version === targetVersion`. Version string strictly `^\d+\.\d+\.\d+$`, argv-only spawn without shell; `apply-update.sh` quotes everything. Download URL from module constants, every redirect hop re-checked against the host allowlist, 200 MB cap on header and stream, TLS validated. `path.basename` + `path.resolve` + prefix check on every delete/read. pdfkit escapes PDF string syntax; `Content-Disposition` from the server-generated devis number. Pre-update backup via the online backup API, 0700, keeps 5. multer 2.4.0 (past the 2025 DoS CVEs). `.env.local` 0600, gitignored, symlinked per release.

### 4.5 Supply chain and release pipeline

**SUP-1 — High — Release archives are checksummed but not signed; the updater trusts whatever `contents: write` publishes; `npm ci` runs lifecycle scripts with every production secret in its environment.**
- `.github/workflows/release.yml:220-228` produces `SHA256SUMS` in the same job, with the same token, as the archive; `:244-280` publishes with `github.token`. `releaseClient.js:15-35` pins repo + hosts; `updateStaging.js:207-212,232-237` compares SHA-256 only. `specs/self-update-and-releases.md:836-841` records that signing was offered and declined.
- `updateStaging.js:170-183` runs `npm ci --omit=dev` **with scripts enabled** and the full `process.env` (which `loadLocalEnv()` filled with `GUESTFLOW_ENCRYPTION_KEY`, `GUESTFLOW_SESSION_SECRET`, `PUBLIC_API_KEY`, `GATE_*`, `VAPID_PRIVATE_KEY`, Google/Qonto secrets); `updateHelper.js:105-115` spawns the helper with the same env. `server/package.json:57-59` `allowScripts` is a lavamoat/pnpm key that npm ignores; there is no `.npmrc`.
*Scenario:* a compromised collaborator account/PAT, a moved tag on one of the four unpinned Actions, or a malicious transitive package locked in by a Dependabot bump publishes or rides `v99.0.0`. Every instance polls hourly, the operator clicks « Installer », and the code runs as `adrien` with the guest DB, the AES key, the session secret, the API keys and the TLS key. The checksum detects corruption, not a hostile publisher.
*Fix:* (1) sign `SHA256SUMS` with a key held outside GitHub — the `/guestflow-release` skill already runs on the operator's Mac: minisign there, upload `SHA256SUMS.minisig`, embed the public key in `releaseClient.js`, refuse unsigned releases in `stageRelease`; (2) `npm ci --omit=dev --ignore-scripts` then an explicit `npm rebuild better-sqlite3` (sharp ships prebuilt binaries), or `server/.npmrc` with `ignore-scripts=true`; pass a minimal `env` (`PATH`, `HOME`, `npm_config_*`) to `execFile`/`spawn`; (3) GitHub side: tag protection/ruleset on `v*`, required signed tags, `publish` behind an Environment with a required reviewer.

**SUP-2 — Medium — No top-level `permissions:` block; `GITHUB_TOKEN` scope is the repository default; checkout keeps credentials on disk.** `e2e.yml`, `unit-tests.yml`: none; `release.yml` scopes only `publish`. *Fix:* `permissions: { contents: read }` at the top of every workflow; `persist-credentials: false` on every checkout that does not push; set the repository default to read-only.

**SUP-3 — Medium — Third-party Actions pinned to mutable major tags** (`actions/checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8` across the three workflows). A moved tag executes attacker code with the job's token and, in `package`, shapes the archive before it is checksummed. *Fix:* pin to the 40-char SHA with a version comment; Dependabot already covers `github-actions`.

**SUP-4 — Medium — `release.sh` does not exclude secrets or data and copies `server/uploads/` into the archive.** `release.sh:51` excludes only `node_modules`, `*.log`, `guestflow.db`, `uploads`, not `.env.local`, `certs/*.key`, `*.db-wal/-shm`, `*.bak`, `update-*.json`; `:53-56` then copies `server/uploads` in anyway; `:89` ships the whole root `scripts/` (including the WordPress migration scripts, INFRA-5). CI runs it on a clean checkout, so today's published archives are clean; the README's "build by hand" path from a dev tree is the risk. *Fix:* exclude `.env*`, `certs`, `*.db*`, `*.bak`, `update-*.json`, `runtime-state.json`; delete the uploads copy (it contradicts `releaseLinks.js`); `set -euo pipefail`; add a `tar -tzf … | grep -E '\.env|\.key|\.pem|\.db|uploads/'` tripwire in both the script and the `verify` job.

**SUP-5 — Low — Node version policy inconsistent, no `engines`.** `.nvmrc` 22.22.2 vs CI/release on Node 24 vs prod 24.19; no `engines` field. This ABI mismatch is the failure that took production down before. *Fix:* `engines.node: ">=24 <25"`, `.nvmrc` 24.x, `setup-node` with `node-version-file`.

**SUP-6 — Low — `${{ }}` interpolation inside `run:`** (`unit-tests.yml:66-67`, `release.yml:72,90,111`) — safe today because of trigger filtering and the version regex; move to `env:` so a trigger change cannot turn them into injection.

**SUP-7 — Low — No CodeQL, no `npm audit` gate, no `SECURITY.md`, no `CODEOWNERS`.** Secret scanning + push protection, branch and tag protection are repository settings not verifiable from the tree. *Fix:* enable them; add `npm audit --omit=dev --audit-level=high` to `verify`.

### 4.6 Integrations, secrets and outbound calls

**INT-1 — Medium — iCal feed fetch has no timeout, no size cap, no redirect or private-IP policy (SSRF + sync-loop DoS).**
`models/propertyIcalModel.js:226` `await fetch(source.url, { method: 'GET' })`; input at `:131` is checked for `^https?://` only; scheduled sequentially under one `syncInProgress` flag by `scheduledTasks.js:50-87`; the upstream status code is echoed into `lastSyncMessage`.
*Scenario:* an admin session (or anyone who gets one) sets the URL to `http://127.0.0.1:4000/…`, `http://192.168.0.1/…` or `http://169.254.169.254/…` and uses the status oracle to map the LAN and fire GET side effects on internal HTTP UIs (Proxmox, Grafana, router); any internal response containing `BEGIN:VCALENDAR` is parsed into reservations. A stalled or multi-GB platform feed blocks the pass for up to 300 s per hop and can OOM the VM, stalling every other property's anti-overbooking sync.
*Fix:* `AbortController` (15–20 s), `redirect: 'manual'` with per-hop re-validation (max 3), resolve the host and reject loopback/link-local/RFC1918/ULA/metadata ranges and non-80/443 ports (or an allowlist of platform hosts), stream with a 2–5 MB cap, require `https:` in production, do not echo upstream status codes.

**INT-2 — Medium — Google OAuth/gaxios errors can be logged whole, including the request config with `client_secret`, the auth code or a bearer token.** `controllers/googleCalendarController.js:150,175,252` and `utils/googleCalendarSync.js:158,176,187,215,222` log `(err.response && err.response.data) || err`; the `|| err` branch fires on network/TLS/DNS failures and a `GaxiosError` carries an enumerable `config` with body and headers. The global handler (`index.js:270`) logs the full error object too. PM2 logs are documented as shippable. *Fix:* a `describeGoogleError(err)` helper (message, code, status, `response.data.error`); strip `config`/`request` before logging in the global handler; never pass raw gaxios/undici errors to `console.*`.

**INT-3 — Low — Web-push `subscribe` stores any endpoint URL → authenticated blind SSRF (POST) from the server** (`models/pushSubscriptionsModel.js:51-57`, fan-out `utils/pushService.js:21-46`). *Fix:* `new URL()`, `https:` only, reject private hosts or allowlist the known push services, validate `p256dh` (65 bytes) and `auth` (16 bytes).

**INT-4 — Low — SMTP transport allows a plaintext fallback on port 587 (no `requireTLS`) and sets no timeouts** (`utils/emailService.js:32-37`). Certificate verification is intact. *Fix:* `requireTLS: !secure`, `connectionTimeout`/`greetingTimeout`/`socketTimeout` 10–15 s.

**INT-5 — Low — `.env.local` secret generation is not atomic across processes** (`utils/localEnv.js:43-62`: read-check-append with no lock; `parseEnv` is last-wins). Two concurrent boots (PM2 cluster mode, dev + prod on one file) can each generate a different `GUESTFLOW_ENCRYPTION_KEY`, making earlier ciphertext unreadable. *Fix:* `O_EXCL`/lock file, temp file + `renameSync`, loud error on duplicate keys.

**INT-6 — Low — `encrypt()` treats any input starting with `enc:v1:` as already encrypted** (`utils/encryption.js:38`), so a secret that happens to start that way is stored in clear and then unreadable; no AAD binds a ciphertext to its column. *Fix:* remove the shortcut (`migrateEncryption` already checks `isEncrypted`); optional `setAAD(columnName)` with a `v2` prefix.

**INT-7 — Low — Qonto and Neat clients use global `fetch` with no timeout** (undici default 300 s); a stalled provider pins `paymentPollInProgress`/Neat `passInProgress` for minutes. *Fix:* `AbortSignal.timeout()`.

**INT-8 — Info — Verified sound.** Secret scan of the tree and the available history: only test fixtures, the e2e fixed session secret, the README example password and the documented default admin password (forced change at first login). AES-256-GCM with a fresh 12-byte IV per call, tag verified, raw 32-byte key, idempotent migration, `safeDecrypt` degrades gracefully. Settings API returns masked booleans (`passwordSet`, `apiKeySet`…) and the 3-way write (absent/`''`/value) cannot be tricked into writing the mask. OAuth `state` is a 16-byte per-session nonce consumed once; both callbacks sit behind the session guard; redirect URIs come from config, never the request. Qonto webhook as in PUB-11. All e-mail is plain text; from-name/recipient validated against C0/DEL; nodemailer 10 scrubs headers. Server-rendered HTML limited to the preferences page (escaped) and the CGV renderer (escape-first, `https?://` links only). ICS parser is linear, ignores RRULE, pollutes only a local object (use `Object.create(null)` as hygiene). `educationGouvClient` (30 s abort, page cap) and `meteoVigilance` (8 s abort, fixed hosts) are well done. Scheduled passes each have try/catch + re-entrancy flags. Hard-coded brand constants (`vapid.js:20` `mailto:contact@domainesolio.com`, `emailPreferencesController.js:12-29`) belong in settings.

### 4.7 Infrastructure, CI/CD and operations

**INFRA-1 — Medium — Backups: production secrets and all guest PII in clear, world-readable temp snapshot on the host, manual-only, no off-site, restore never verified.**
`scripts/backup-from-pi.sh:58,77-78` snapshots to a predictable `/tmp/guestflow-backup-<stamp>.db` with the SSH user's umask (symlink pre-creation possible by any local user); the local set is 0700/0600 but unencrypted; `specs/backup-restore.md:155-168` defers encryption, off-site and scheduling. `scripts/restore-to-pi.sh:198-201,234-237` never checks `checksums.sha256` nor runs `PRAGMA integrity_check` before stopping PM2 and moving the live DB aside; the restored DB is not `chmod 600`. The on-host `data/backups/` sits on the same disk as the DB.
*Fix:* `umask 077` + `mktemp` under `$REMOTE_DIR/data/tmp`; encrypt before leaving the host (`age -r <pubkey>`); schedule (launchd/cron) and push an encrypted copy off-site (NAS + one remote); in restore, verify checksums and `integrity_check` *before* `pm2 stop`, `chmod 600` the result; rehearse a restore on a spare LXC once.

**INFRA-2 — Medium — `curl | sh` as root and a root cron that may self-upgrade from GitHub (acme.sh); private key left group-readable.**
`server/scripts/issue-letsencrypt-cert-http01.sh:148` (`curl -fsSL https://get.acme.sh | sh` as root, no pin), `:387-390` (root crontab daily; acme.sh enables `AUTO_UPGRADE=1` by default), `:55` (`eval echo "~${SUDO_USER}"`), `:253-258` (`chmod 640` on the key). The HTTP-01 path also keeps WAN port 80 permanently forwarded to the host.
*Fix:* install acme.sh from a pinned release with a verified checksum and `--no-auto-upgrade`, `chmod 600` the key, replace the `eval` with `getent passwd`; better, terminate TLS in Caddy `edge` (automatic ACME, no root script, no port 80 on the app host) — which also resolves INFRA-3/4.

**INFRA-3 — Medium (High if confirmed) — `TRUST_PROXY_HOPS` defaults to `1` in `scripts/bootstrap-vm.sh:31` while `index.js:46-51`, `README.md:406-420,470-480` and `specs/public-online-payment.md:115` describe Node exposed directly.** On a host reached directly with hops=1, every request may carry a forged `X-Forwarded-For`; `loginLimiter` (10 failed / 15 min) and `apiLimiter` key on it → unlimited password guessing against the admin account. *Fix:* default to unset/`0`, make the operator opt in, log the effective `trust proxy` value at boot, and decide ONE production topology (INFRA-9). **Verify with §6 which value `ecosystem.config.js` carries today and whether Caddy or a port forward is in front.**

**INFRA-4 — Medium — `HTTPS_ENABLED` conflates "serve TLS myself" with "the edge is HTTPS".** `index.js:66-67,283`, `securityConfig.js:182,198-205`: the one flag drives HSTS + `Secure` cookie + `upgrade-insecure-requests` *and* `buildServer` (which then requires cert files). `bootstrap-vm.sh:30-31,156-158` defaults production to `HTTPS_ENABLED=false`, `TRUST_PROXY_HOPS=1` ("Derrière Caddy"). Behind a TLS-terminating Caddy the 30-day session cookie is therefore issued **without `Secure`** and no HSTS is emitted by the app; one `http://` request (typed URL, captive portal, old bookmark before Caddy's redirect) sends the cookie in clear. *Fix:* add `EDGE_HTTPS=true` (or express-session `cookie.secure: 'auto'` with `trust proxy`, which honours `X-Forwarded-Proto`) to turn on `Secure`/HSTS/upgrade whenever the edge is HTTPS, independently of own-TLS; warn at boot when `NODE_ENV=production` and neither is set. Confirm Caddy sends HSTS and redirects 80→443.

**INFRA-5 — Medium — Shell command injection and secret-in-argv in the WordPress migration script, shipped in every release archive.** `scripts/import_domain_to_wordpress.sh:318-327,340-349` interpolates scraped page title/slug via Python `repr()` into `sh -c` and pastes page content into an unquoted heredoc (`$(…)` in a scraped page executes in the `wordpress:cli` container holding `WORDPRESS_DB_PASSWORD`); `:286-287,308-311,406` pass the DB password with `-e` (visible in `ps`); `:43-44` unpinned `pip install`. `release.sh:89` ships `scripts/` wholesale. *Fix:* the migration is done and WordPress lives elsewhere — delete `import_domain_to_wordpress*.sh`, `debug-migration.sh`, `howto.txt`; make `release.sh` ship an allowlist (`bootstrap-vm.sh` only).

**INFRA-6 — Low — Policy drift: five documents still tell the operator to re-install the self-hosted runner or push a `release` branch.** `specs/backup-restore.md:107-109`, `scripts/restore-to-pi.sh:145-152`, `README.md:978`, `:406-420`, `scripts/backup-from-pi.sh:111`, `integrations/wordpress/INSTALL.md:193,277,297`. The day the host dies, the DR runbook re-creates the banned inbound trust path. Verified: no `runs-on: self-hosted`, no inbound webhook, no SSH from CI to production anywhere. *Fix:* rewrite to the release-archive model.

**INFRA-7 — Low — LAN inventory, VM ids and the SSH user name are published in a public repository.** `specs/self-update-and-releases.md:20,858` (`192.168.0.24`, `adrien`), `integrations/wordpress/solio-site/{README.md,BASCULE.md,rapports/seo-2026-10-05/deploy*.sh}` (`adrien@192.168.0.23`, `192.168.0.196`, `docker exec -u 0`), `INSTALL.md:291-296`, `reset-dev-processes.sh:119`. Not secrets, but a ready-made map for anyone with a foothold. *Fix:* placeholders as the README already does; deploy scripts take the host from env.

**INFRA-8 — Low — No host hardening baseline in the tree** (ufw/nftables, key-only SSH, unattended-upgrades, fail2ban, pm2-logrotate; explicitly out of scope in `specs/security-hardening.md:174`). The Pi-era README puts a Node process straight on WAN 443. *Fix:* §6 checklist becomes the baseline; Caddy in front everywhere.

**INFRA-9 — Low — No log rotation** (`pm2 logs` only; `index.js:270` logs full unhandled error objects, which can carry request data). Logging is otherwise clean: no guest PII or secret in any `console.*`. *Fix:* `pm2 install pm2-logrotate` (10M, retain 14, compress).

**INFRA-10 — Low — Default admin password printed to stdout by `server/scripts/reset-admin.js:290`** → PM2 logs; the forced change mitigates but the window between reset and first login is open. *Fix:* print a one-time random password instead.

**INFRA-11 — Low — Path strings embedded into `node -p` source** (`bootstrap-vm.sh:56`, `backup-from-pi.sh:113`); `apply-update.sh:73` probes health with `curl -k`. *Fix:* pass paths as argv; `--cacert` on the own cert.

**INFRA-12 — Low — TLS server uses Node defaults** (`utils/httpsBootstrap.js:91`: no `minVersion`, `ciphers`, `honorCipherOrder`; key file mode never checked). Node 24 defaults to TLS 1.2 minimum, so hardening only. *Fix:* `{ minVersion: 'TLSv1.2', honorCipherOrder: true }`, warn when the key is group/world-readable.

**INFRA-13 — Info — Verified sound.** The move away from the self-hosted runner is real and consistent: outbound-only production, `pull_request` (not `pull_request_target`), tag-derived version regex-validated before interpolation, `verify` job refusing to publish without matching versions/changelog/digest, lockfile v3 with integrity hashes and no git sources, Dependabot on all four ecosystems, `bootstrap-vm.sh` refuses root, E2E uses fixed test credentials only.

### 4.8 Client (React SPA, CSP, service worker)

**CLI-1 — Medium (to verify) — `?from=` back-navigation parameter is passed to `navigate()` unvalidated — probable open redirect via a protocol-relative URL.** `client/src/utils/navigation.js:9-24` (`getFromParam` → `navigate(from)`), used in `ReservationPage.jsx` and `PropertyDetail.jsx`. `?from=//evil.example/login` → React Router pushes `//evil.example/login`; the browser throws on the cross-origin `pushState` and React Router's fallback (`window.location.assign`) performs a real navigation to the phishing page. Could not be executed in this environment (no `client/node_modules`). *Fix:* accept only `^\/(?!\/)` paths (optionally a known route prefix); unit test `navigation.from-param.test.js`; verify with `navigate('//example.org')` in the dev server.

**CLI-2 — Medium — Gate-access `url` from the Sowel plugin is rendered as `href` without scheme validation** — same root cause as PUB-7 (`gateResults.js:46`, `gateKeysModel.js:16,66`, `GateAccessCard.jsx:76`); in production the CSP blocks `javascript:` but not a phishing `https://`. Also `TariffRecipeCard.jsx:320` (`h.sourceUrl`, operator-authored today). *Fix:* validate on ingest (`https:` + allowlisted host); render the link only when `/^https:\/\//` matches.

**CLI-3 — Low — Service worker trusts `data.url` from the push payload** (`client/public/sw.js:19-32,36-49`). Payloads are server-produced and end-to-end encrypted, so exploitation needs the VAPID private key; still an open redirect by design. *Fix:* resolve against `self.location.origin` and keep only same-origin paths.

**CLI-4 — Low — `window.location.href = r.connectionLocation`** (`PaymentsSettingsPage.jsx:200-203`) navigates to a URL from Qonto's API without a scheme check. *Fix:* `https:` check server-side (`paymentsController.js:184`) and client-side.

**CLI-5 — Low — CSP: `style-src 'unsafe-inline'` (justified by Emotion/MUI) plus a stale Google Fonts allowlist** (`securityConfig.js:68-71`; fonts are self-hosted via `@fontsource`), no `report-to`, and CSP fully disabled in development so dev never exercises it. *Fix:* drop the two Google hosts, add a report endpoint, keep `frame-src` default (needed by `SandboxedHtmlFrame`).

**CLI-6 — Low — No CSRF token; defence rests on `SameSite=Lax` + JSON-only bodies + CORS allowlist** (see AUTH-12). *Fix (defence in depth):* `X-Requested-With: GuestFlow` on every `api.js` call and reject `/api` writes without it; document that `CORS_ORIGINS` must stay empty in production.

**CLI-7 — Info.** Gate connector secrets are fetched eagerly on Settings mount and kept in React state (`SettingsGateAccessSection.jsx:40-46`, by design, admin-only, `no-store`) — fetch on « Afficher »/« Copier » instead. `SandboxedHtmlFrame` uses `sandbox=""` (good) so CGV links are inert; add only `allow-popups allow-popups-to-escape-sandbox` if needed. `window.__guestflowBeforeNavigate` global hook (harmless). e2e fixtures hold test defaults only.

**CLI-8 — Info — Verified sound.** Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`/`window.open` in `client/src`; the only foreign HTML (CGV) is server-escaped Markdown inside an empty-`sandbox` `srcdoc` iframe. No `localStorage`/`sessionStorage`/cookie usage; secrets never present in memory after load (`MaskedTextField` 3-way semantics). Login and OAuth returns read enums only; server callbacks redirect to fixed paths. Service worker has no `fetch` handler (nothing cached, no poisoning). Role gating in the UI is UX only; every API path is independently allow-listed server-side. Vite 8 emits no inline scripts (compatible with `script-src 'self'`), `sourcemap: false`, no CDN assets (SRI not applicable), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `Permissions-Policy` set, HSTS gated on real TLS.

### 4.9 WordPress site domainesolio.com (mu-plugins, Apache rules, deploy scripts)

All 30 mu-plugins, `apache/uploads.htaccess`, `scripts/webp-twins.php`, the `rapports/seo-2026-10-05/` deploy scripts, `README.md`, `BASCULE.md` and the footer template were read. Two assumptions of the brief turned out false and are recorded as non-findings: there is **no contact form** (`gf-contact.php` is a map page with `tel:`/`mailto:` links; no `wp_mail`, `wp_ajax` or `admin_post` handler exists anywhere in the site code) and `gf-caps.php` draws capacity icons (no `add_cap`/`add_role` anywhere). The only raw `$wpdb` query (`gf-seo-images.php:56-61`) is prepared.

**WP-1 — Medium — Dead, unauthenticated REST relays fan out to GuestFlow with no cache.** `mu-plugins/gf-booking.php:11-54` registers a second proxy namespace `gf-solio/v1/*` (all `permission_callback => '__return_true'` except `booking-requests`) that forwards the browser's raw JSON to `GF_Api_Client` with no transient cache; `gf-search.php:24-79` makes `1 + N` upstream calls per anonymous GET. Both widgets are dead since `/disponibilites` was removed on 2026-09-24 (`README.md:109-112`, 301 in `gf-seo-redirects.php:363`), and the `/availability` closure calls an undefined `$langue` (fatal on every call). *Scenario:* 600 GETs on `/wp-json/gf-solio/v1/search` → 1 800 pricing computations on the GuestFlow VM, which also serves the back-office. *Fix:* delete `gf-booking.php` and the REST half of `gf-search.php` (or the whole file). If `/search` returns, go through `GF_Rest_Proxy`'s cached reads, add a transient per `(from,to,adults)`, validate dates with `DateTime::createFromFormat`.

**WP-2 — Medium (verify) — Whole-site shared rate-limit budget if the plugin's « Proxys de confiance » option is empty.** `class-gf-api-client.php:38-56,92-94` derives the visitor IP from `REMOTE_ADDR` unless that address is trusted, in which case it reads the right-most non-trusted `X-Forwarded-For` hop. Inside `wp_app` behind Caddy, `REMOTE_ADDR` is Caddy's or the Docker bridge's address for everyone; the option defaults to empty. *Scenario:* five junk booking requests from one IP exhaust GuestFlow's `bookingRequestLimiter` (5/hour) for every real guest. *Fix:* set `trusted_proxies` to the `edge` LXC address (and the Docker bridge if Apache sees it); confirm Caddy appends to `X-Forwarded-For`; add a `curl -H 'X-Forwarded-For: 203.0.113.9'` smoke test to the `stats` probe. (Same root cause as PUB-2 on the GuestFlow side.)

**WP-3 — Medium — `uploads/.htaccess` does not disable PHP execution under `wp-content/uploads`.** `apache/uploads.htaccess:1-31` only adds the WebP rewrite and cache headers; the `wordpress:6-apache` image has `AllowOverride All`, so the file is honoured once copied by hand (unverified). *Scenario:* any arbitrary-upload bug in `ml-slider`, `polylang` or `two-factor` becomes RCE inside `wp_app`, which holds the GuestFlow API key. *Fix:* prepend `<FilesMatch "\.(?i:ph(p[0-9]*|tml|ar)|phps|pl|py|cgi|sh)$"> Require all denied </FilesMatch>` and `php_flag engine off`; verify with `docker exec wp_app cat /var/www/html/wp-content/uploads/.htaccess`.

**WP-4 — Medium (conditional) — Absolute URLs follow the request `Host` header → password-reset-link poisoning if a forged Host reaches WordPress.** `gf-seo-urls.php:30-55` filters `home_url`/`site_url`/`network_*` to `$_SERVER['HTTP_HOST']` after a regex that accepts any `[a-z0-9.-]+(:\d+)?`; `BASCULE.md:25-27` says `wp-config.php` derives `WP_HOME`/`WP_SITEURL` the same way; `gf-i18n.php:398,502` redirect to such URLs with `wp_redirect`. *Scenario:* `POST /wp-login.php?action=lostpassword` with `Host: evil.example` → the admin receives a genuine reset mail whose link points at the attacker. Exploitable from the Internet only if Caddy has a catch-all site; fully exploitable on the LAN (`:8080`). *Fix:* allowlist (`domainesolio.com`, `www.domainesolio.com`, the LAN address) in both places; `wp_safe_redirect()` in `gf-i18n.php`; Caddy `respond 444` for unmatched hosts.

**WP-5 — Medium (verify) — No login throttling, IP restriction or enforced 2FA for `wp-login.php` / `wp-admin`.** `zz-adn-security.php` is sound as far as it goes, but the `two-factor` plugin is opt-in per user and nothing forces it for administrators; `login_errors` is generic but the lost-password form still reveals whether a username exists; `robots.txt` advertises `/wp-admin/` and `/wp-login.php`. *Fix:* require 2FA for the administrator role (`two_factor_enabled_providers_for_user` filter or the plugin's setting); Caddy `rate_limit` on `/wp-login.php` and `/xmlrpc.php`, ideally LAN/VPN-only `wp-admin`; filter `lostpassword_errors`.

**WP-6 — Medium (verify) — Umami exposure under `/_s/*`.** `gf-analytics.php` is clean (website id filtered, every attribute escaped, no PII in events — verified against `blocks/booking/view.js:900-966`). The risk is the Caddy block: if `handle_path /_s/*` forwards everything, `/_s/api/auth/login`, `/_s/api/websites` and the dashboard are Internet-reachable. *Fix:* proxy only `@umami path /_s/script.js /_s/api/send`, `respond 404` for the rest; add the two negative probes.

**WP-7 — Low — JSON-LD emitted without `JSON_HEX_TAG`; FAQ text is entity-decoded after tag stripping** (`gf-seo-schema.php:360-382,619-627`, `gf-seo-activites.php:313`): a page answer containing `&lt;/script&gt;&lt;script&gt;…` becomes a literal `</script><script>` inside the JSON-LD → stored XSS, needs Editor rights (who hold `unfiltered_html` anyway). *Fix:* `JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT`, drop `JSON_UNESCAPED_SLASHES`.

**WP-8 — Low — No security headers set by the site code** (`nosniff`, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, HSTS, CSP); whether Caddy adds them is unknown. *Fix:* a `header { … }` block in Caddy, or `send_headers` in `zz-adn-security.php`.

**WP-9 — Low — TLS verification to GuestFlow disabled by documented configuration** (`INSTALL.md:121-127`, `class-gf-api-client.php:88`): the bearer key and every booking travel on an unverified TLS session on the LAN. *Fix:* a certificate from the internal CA implied by `*.maison.adn-dev.fr`, or pin via `sslcertificates`; turn verification back on (see PUB-4).

**WP-10 — Low — Internal topology published** (`README.md:5-22,189-216`, `BASCULE.md`, `deploy*.sh:6-7`, `INSTALL.md:119-127`): LAN addresses, SSH user, container and volume names, backup paths, exact deploy procedure. No credentials (the IndexNow key is public by protocol). Merged with INFRA-7.

**WP-11 — Low — `wp_redirect()` where `wp_safe_redirect()` is meant** (`gf-i18n.php:398,502`); no open redirect today, but the host is attacker-influenced under WP-4.

**WP-12 — Low — Google Maps embed loads a third party with cookies** (`gf-contact.php:51-57`), contradicting the "no third party, no consent banner" position of the analytics spec. *Fix:* load on click behind a static poster.

**WP-13 — Low — Deploy hygiene.** `rapports/seo-2026-10-05/apply.php:17` backs up a page to `/tmp` *inside* the container (lost on recreate); `apply.php:28` and `README.md:191` call `kses_remove_filters()` from a root CLI; `deploy*.sh` `chown 1000:1000` vs README's `www-data` (undocumented inconsistency); `INSTALL.md:106-108` puts the bearer key on a `curl` command line (shell history). Positive: no hard-coded credentials, no `StrictHostKeyChecking=no`, `set -e`, `php -l` before copy, live copy backed up first.

**WP-14 — Info.** `innerHTML` with GuestFlow-authored data in the dead widgets (`gf-search.php:280-284`, `gf-booking.php` `renderOpts`/`fillModal`) — a compromised GuestFlow operator account would become stored XSS on the public site; moot once WP-1 deletes them. The anonymous `wp_rest` nonce is CSRF-only protection (the honeypot and GuestFlow's limiter are the real anti-spam controls). Language cookie could be `httponly`. `wp-config.php` is not in the repo: `DISALLOW_FILE_EDIT`, `DISALLOW_FILE_MODS`, salts and `FORCE_SSL_ADMIN` are to verify (§6 items 14–18). WordPress core lives in the `soliowebsite_wp_data` volume: pulling a new `wordpress:6-apache` image updates PHP/Apache but **not** WP core — core and plugin versions are recorded nowhere; add them to the runbook.

**WP-15 — Info — Verified sound.** Every admin write is nonce-checked and capability-gated (`gf-seo-admin.php:107-113,155-160`, `gf-seo-activites.php:167-178`); every PHP-side output from meta/options/content goes through `esc_html`/`esc_attr`/`esc_url`/`esc_textarea`; `gf-seo-redirects.php` and `zz-adn-security.php` use `wp_safe_redirect` and let only `utm_*` through, capped and encoded; the API key never reaches the browser and all pricing is computed in GuestFlow; `zz-adn-security.php` neuters XML-RPC, disables Application Passwords, closes REST/`?author=`/sitemap user enumeration, hides the generator and generic-ises login errors; the Umami tracker is first-party, cookieless, never loaded for logged-in users; the language redirect is cache-safe (`302` + `Vary` + `no-store`).

---

## 5. Dependency audit

`npm audit --package-lock-only` on 2026-10-08:

| Lockfile | Advisory | Package (locked) | Severity | Direct? | Prod impact | Fix |
|---|---|---|---|---|---|---|
| server | GHSA-jqcg-44mw-7w3h — IP spoofing via IPv4-mapped IPv6 trust subnet | `proxy-addr` 2.0.7 (via `express` 5.2.1) | Critical (CVSS 9.1) | transitive | Only when `trust proxy` is a **subnet/CIDR** value; GuestFlow uses a hop count or `false`, so not exploitable as configured — but it is the module behind every `req.ip` decision (INFRA-3). | **DEP-1** bump `express` (pulls `proxy-addr` ≥ 2.0.8); `npm audit fix` |
| server | GHSA-vfj7-8cjw-p6xm — `braces` stack exhaustion | `braces` 3.0.3 (via `chokidar` ← `nodemon`) | High | dev-only | None in production (`--omit=dev`). | **DEP-2** bump `nodemon` |
| client | GHSA-68fv-2mgg-jv7q — `source-map-js` event-loop DoS | via `vite` 8.3.2 | High | build-time | Build tooling only; not shipped. | **DEP-3** bump `vite` |
| root | `shell-quote` 1.8.4–1.10.0 command injection | via `concurrently` 10.0.5 | Critical | dev-only | `npm run dev` on the developer machine only. | **DEP-4** bump `concurrently` |

Counts: server 195 prod / 28 dev packages; all lockfiles v3 with integrity hashes; no git/GitHub sources. Dependabot is configured for npm (3 ecosystems) and `github-actions` with weekly grouped bumps. Recommendation: add `npm audit --omit=dev --audit-level=high` to the `verify` job (SUP-7) so a new advisory blocks a release rather than waiting for the next bump.

---

## 6. Hosts and VMs — what to run and what to look for

`scripts/security/host-audit.sh` is a **read-only** inventory (no state change; secrets redacted to their length). Run it on every host in §2, as root where possible, and keep the outputs next to this report:

```bash
scp scripts/security/host-audit.sh adrien@<host>:/tmp/
ssh adrien@<host> 'sudo bash /tmp/host-audit.sh' > "audit-$(date +%F)-<host>.txt"
```

Read each report against this checklist. Anything that fails is a finding to add to §7.

**Every host (pve01, VM 103, VM 104, VM 108, LXC edge, LXC stats, the legacy Pi, the NAS)**
1. OS supported and patched; `unattended-upgrades` enabled with automatic security updates; no pending reboot older than a week.
2. SSH: `PermitRootLogin no` (or `prohibit-password`), `PasswordAuthentication no`, keys only; `authorized_keys` 0600 with only the keys you recognise; `fail2ban` or Proxmox firewall rate-limit on 22 if 22 is reachable from outside the LAN (it should not be).
3. Firewall: only the ports the host's role needs are open (edge: 80/443; GuestFlow: 4000 from edge only; WordPress: 80/8080 from edge only; Umami: its port from edge only; Prometheus/Grafana: LAN or VPN only; Proxmox 8006: LAN only).
4. Listening sockets: nothing bound to `0.0.0.0` that should be `127.0.0.1` (Docker publishes to all interfaces by default — check `wp_app`'s DB port).
5. Accounts: one named admin per person, `sudo` with password, no `NOPASSWD: ALL`, no empty passwords, no shared `pi`/`admin` account left from the Pi era.
6. Time synchronised (OAuth, HMAC windows and TLS all depend on it).
7. No world-writable files under `/home`, `/opt`, `/srv`, `/var/www`.
8. Cron/timers you recognise only; a root cron pulling from the Internet (acme.sh `AUTO_UPGRADE`) is INFRA-2.

**VM 104 — GuestFlow**
9. `ecosystem.config.js`: `NODE_ENV=production`; **`TRUST_PROXY_HOPS` matches the topology** (unset/0 if the Freebox forwards straight to :4000, exactly 1 if Caddy is in front); `HTTPS_ENABLED=true` with a cert if direct, and INFRA-4 applied if behind Caddy.
10. `data/.env.local` 0600, `data/guestflow.db` 0600 (DATA-7), `data/backups` 0700, `certs/server.key` 0600 (INFRA-2).
11. Node 24.x matching `engines` (SUP-5); PM2 runs as `adrien`, not root; `pm2-logrotate` installed (INFRA-9).
12. Port 4000 reachable only from the edge host (or only via the Freebox forward); port 80 closed unless acme.sh needs it that minute.

**VM 103 — WordPress (`wp_app`)**
13. WordPress core, every plugin and theme at current version; `ml-slider`, `polylang`, `two-factor` auto-updating; remove anything inactive.
14. `wp-config.php`: `DISALLOW_FILE_EDIT`, `DISALLOW_FILE_MODS` (you deploy by `docker cp`, so nothing needs the installer), `FORCE_SSL_ADMIN`, `WP_DEBUG=false`, unique salts, `GUESTFLOW_API_KEY` as a constant (PUB-8).
15. `wp-admin` and `wp-login.php` not reachable from the Internet, or behind Caddy rate limiting + 2FA enforced for every administrator (the `two-factor` plugin is installed: is it *required*?). `xmlrpc.php` disabled (the `zz-adn-security.php` mu-plugin claims to; verify with `curl -X POST https://domainesolio.com/xmlrpc.php`).
16. `wp-content/uploads/.htaccess` blocks PHP execution (the `apache/uploads.htaccess` in the repo only does WebP negotiation — add the `php_flag engine off` / `<FilesMatch "\.php$"> Require all denied` block); no `*.php` under uploads.
17. The MariaDB/MySQL container port is not published to the host or the LAN; the DB password is not in the shell history.
18. The `wp_app` container is not `--privileged`, does not mount `docker.sock`, image tag pinned and rebuilt in the last 90 days (PHP and Apache patches come from the image).
19. `soliowebsite_wp_data` volume is in the nightly backup and a restore has been rehearsed.

**LXC edge — Caddy**
20. HSTS with a long max-age on every public vhost; automatic HTTPS with HTTP→HTTPS redirect; TLS 1.2 minimum.
21. Rate limiting on `/wp-login.php`, `/wp-json/guestflow/*`, `/public/v1/*` (defence in depth over PUB-2) and on GuestFlow `/api/auth/login`.
22. Request body size limits; `X-Forwarded-For` **overwritten**, not appended, so GuestFlow's hop count is honest.
23. Only the paths that need to be public are proxied for Umami (`/_s/script.js`, `/_s/api/send`); the Umami admin UI is not reachable through any public vhost.

**VM 108 — Prometheus / Grafana / Alertmanager**
24. Grafana: anonymous access off, default `admin/admin` changed, not exposed to the Internet; Prometheus and Alertmanager have no auth by design → LAN/VPN only.
25. Blackbox probes include the GuestFlow login page and `/public/v1/properties` from *outside* the LAN (the spec notes the probes run inside).

**pve01 — Proxmox**
26. Web UI 8006 on the LAN only (or VPN); 2FA (TOTP/WebAuthn) on `root@pam` and every user; root SSH key-only; datacenter firewall enabled with a default-deny for the management interface.
27. Enterprise or no-subscription repository configured so `apt` actually gets PVE updates; host rebooted after kernel updates.
28. Backup jobs (`vzdump`) to the NAS for every guest, encrypted if the NAS leaves the house, retention set, a restore tested once.
29. The legacy Pi `192.168.0.196`: powered off and its Freebox forwards deleted, or audited like the others.

**Freebox**
30. Only forwards that are still used: 80/443 → edge (or → VM 104). Remove the Pi-era forwards. UPnP disabled. Freebox OS admin password set, remote access off.

---

## 7. Remediation plan

Grouped so that each line is one pull request with one spec update and its tests; the order follows risk and the "what breaks if it is wrong" rule.

### P0 — this week (no code, or a few lines)
| # | Action | Findings |
|---|---|---|
| 1 | Run `host-audit.sh` on every host; confirm `TRUST_PROXY_HOPS`/`HTTPS_ENABLED` against the real topology and fix `ecosystem.config.js` on the spot; delete Pi-era port forwards | INFRA-3, INFRA-4, §6 |
| 2 | GitHub settings: default `GITHUB_TOKEN` read-only, tag protection on `v*`, secret scanning + push protection, 2FA required | SUP-1, SUP-2 |
| 3 | WordPress: `GUESTFLOW_API_KEY` constant in `wp-config.php` then rotate `PUBLIC_API_KEY`; re-tick `ssl_verify`; 2FA required for admins; `DISALLOW_FILE_MODS` | PUB-8, PUB-4, §6 |
| 4 | `npm audit fix` on the three lockfiles, run the suites, release a patch | DEP-1..4 |
| 4b | WordPress host: block PHP under `uploads/` (WP-3), set `trusted_proxies` (WP-2), restrict the Caddy `/_s/*` matcher (WP-6), rate-limit `wp-login.php` in Caddy (WP-5) | WP-2, WP-3, WP-5, WP-6 |

### P1 — this month (small PRs)
| # | PR | Findings |
|---|---|---|
| 5 | `fix(auth): revalidate sessions, regenerate sid, purge on deactivate/role/password change, reject seed e-mail` | AUTH-1, AUTH-2, AUTH-3, AUTH-6 |
| 6 | `fix(roles): reception projection on planning-events + date-span caps` | AUTH-4, DATA-1 |
| 7 | `fix(public): bounded quotes, input caps, ICS escaping, proxy-keyed limiter, neutral iCal feed with window + limiter` | PUB-1, PUB-2, PUB-3, PUB-5 |
| 8 | `fix(finance): money validation on SAS lines, custom options, caution; finite rounding; CSV formula neutralisation` | DATA-2, DATA-3, DATA-5, DATA-6 |
| 9 | `fix(update): --ignore-scripts + minimal env for npm ci and the helper; .npmrc` | SUP-1 (part 2) |
| 10 | `fix(ical-import): timeout, size cap, redirect and private-IP policy` | INT-1 |
| 11 | `fix(logging): never log raw gaxios/undici error objects` | INT-2 |
| 12 | `ci: SHA-pin actions, top-level permissions, persist-credentials:false, npm audit gate, engines` | SUP-2, SUP-3, SUP-5, SUP-6, SUP-7 |
| 12b | `fix(solio-site): delete dead gf-booking/gf-search relays, Host allowlist in gf-seo-urls + wp-config, wp_safe_redirect, JSON_HEX_* in JSON-LD, uploads .htaccess deny block, security headers` — then copy into `wp_app` per the solio README | WP-1, WP-4, WP-7, WP-8, WP-11, WP-3 |

### P2 — this quarter
| # | PR / task | Findings |
|---|---|---|
| 13 | `feat(release): minisign SHA256SUMS on the operator Mac; updater refuses unsigned releases` (spec: `self-update-and-releases.md` §9) | SUP-1 (part 1) |
| 14 | `feat(documents): private storage + authenticated download route + unlink on delete + random names` | FILE-1, FILE-2, FILE-6 |
| 15 | `fix(uploads): sharp normalisation for the logo, limitInputPixels, content sniffing, photo field validation` | FILE-3, FILE-4, FILE-5 |
| 16 | `feat(ops): EDGE_HTTPS flag; Caddy terminates TLS for GuestFlow; retire acme.sh on the app host` | INFRA-4, INFRA-2 |
| 17 | `chore(scripts): delete WordPress migration scripts; release.sh allowlist + secret tripwire; backup umask/mktemp/encryption/verification; DR docs to the archive model` | INFRA-5, SUP-4, INFRA-1, INFRA-6 |
| 18 | `fix(client): validate ?from=, gate url, sw.js origin pin, connectionLocation; prune CSP fonts; X-Requested-With` | CLI-1..6, PUB-7, CLI-2 |
| 19 | `fix(push,smtp,env): endpoint validation, requireTLS + timeouts, atomic .env.local, encrypt() shortcut, fetch timeouts` | INT-3..7 |
| 20 | `fix(auth): scrypt params + versioning, per-account lockout, change-password limiter, auth audit log, absolute session cap, drop role shim` | AUTH-5, AUTH-7..11 |
| 21 | Hygiene: DB 0600 + umask, finance window cap, `/api/version` minimal, placeholders for LAN IPs, pm2-logrotate, reset-admin random password | DATA-4, DATA-7, INFRA-7, INFRA-9..12 |
| 22 | WordPress: internal CA cert for GuestFlow + `ssl_verify` on; Maps embed behind a click; deploy script ownership convention; record WP/plugin versions in the runbook | WP-9, WP-12, WP-13, WP-14 |

Each PR that touches behaviour updates the matching spec (`security-hardening.md`, `security-auth-encryption.md`, `public-api.md`, `ical-export-closures.md`, `self-update-and-releases.md`, `backup-restore.md`, `reception-role-checkin-only.md`) in the same commit, per CLAUDE.md §4.1, and ships its unit tests in a file of its own.

---

## 8. What is done well

Worth saying plainly, because it is why none of the findings above is a trivial takeover: the auth core (scrypt with per-password salt and constant-time compare, server-side sessions with an auto-generated 32-byte secret stored 0600 and never logged, `httpOnly`/`Lax`/`Secure`-when-TLS cookie, a boot that refuses to start when TLS is claimed but absent); a fail-closed `requireAuth → enforceRoleAccess` chain with anchored per-role allowlists and drift tests; a public tree that is a separate, allowlisted surface with a constant-time key, explicit projections, server-only pricing and payment amounts, a correctly implemented HMAC webhook, and a two-secret gate channel signed both ways; a consistently parameterised data layer where even dynamic column names come from frozen lists; AES-256-GCM with fresh IVs and a masked-boolean settings contract that cannot be tricked into echoing or overwriting a secret; a self-update engine with host-allowlisted redirects, size caps, checksum-before-extract, archive member sanitisation, native-ABI smoke test before the swap, atomic symlink swap, health check and rollback; a thin client with zero raw-HTML sinks, no browser storage of anything sensitive, an enforced and unit-tested CSP, and a fetch-free service worker; a release pipeline that validates its inputs before interpolating them and makes production outbound-only; and no live credential anywhere in the repository or its history.
