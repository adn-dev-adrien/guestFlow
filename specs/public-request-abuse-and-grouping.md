# Website requests — bot-proof without a global lockout, one quote per stay

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/public-request-abuse-and-grouping` |
| **Created** | 2026-10-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

`POST /public/v1/booking-requests` (plugin `website-booking`, relayed by the WordPress plugin) is the
only public write. Each accepted request today:

- creates a **client** when the e-mail is unknown;
- creates a **draft devis**, which takes the next **devis number**;
- e-mails the operator (`notificationService.notifyNewSiteDevis`, specs/site-booking-notifications.md
  rule 6).

The protections are a honeypot field and `bookingRequestLimiter`, 5 requests per hour **per visitor
IP** (the IP the WordPress proxy relays). A bot that rotates IPs is not slowed down: thousands of
requests mean thousands of junk clients and devis numbers, and thousands of e-mails in the operator's
mailbox. (`specs/public-api.md` rule 9 also says « 20/hour/API-key »: the code never did that, and it
must not — the whole site shares one key, so it would be a lockout for every guest.)

A global ceiling was proposed and refused by Adrien (2026-10-27): it stops the service for everyone,
which is the denial of service we want to avoid. The defence must be **internal** (no third-party
captcha or service).

Separately, a guest who sends the same request twice (double click, back button, changed their mind
on the number of guests) gets two devis with two numbers for the same stay.

## 2. Goal

A bot cannot flood GuestFlow with quotes, clients or e-mails, and a real guest is never refused because
someone else is attacking. One guest asking twice for the same stay gets one quote, kept up to date.

## 3. Functional rules

### A. Proof of work — expensive for a bot, invisible for a guest

1. **Challenge.** `GET /public/v1/booking-requests/challenge` returns `{ challengeId, salt, difficulty,
   issuedAt, expiresAt, signature }`. The signature is an HMAC (server secret from
   `sdk.secrets.getOrCreate`) over every other field: GuestFlow keeps no state to issue one.
2. **Solving.** The WordPress booking drawer asks for a challenge **as soon as the drawer opens** and
   solves it in a Web Worker while the guest fills the form: find a `nonce` such that
   `SHA-256(salt + nonce)` starts with `difficulty` zero bits. At the base difficulty this takes well
   under a second on a phone; the guest never sees it unless they submit within that time (the button
   then reads « Vérification… » until it is done).
3. **Verification.** The request carries `{ challengeId, nonce, … }`. The server refuses with
   `403 CHALLENGE_INVALID` a missing, forged, expired (15 min) or wrong solution, and a challenge
   already used (a used `challengeId` is remembered until it expires). Verification is one hash: it
   costs the server nothing.
4. **Adaptive, never global.** The difficulty is chosen per requester when the challenge is issued:
   base for a visitor IP (or IPv6 /64) with no recent request, then +2 bits (×4 work) for each request
   that IP made in the last hour. One person sending 3 requests waits a second or two more; a bot
   sending 50 from the same address needs hours. A guest on another IP is never affected by an attack.
   Implemented with a base of **12 bits** and a total cap of **22 bits** (≈ 4 million hashes, about ten
   seconds on a phone); the address is part of the signature, so a challenge is spent from the address
   it was issued to.
5. **Minimum fill time.** A request submitted less than 3 seconds after its challenge was issued is
   refused like rule 3: no human fills the form that fast.

5b. **Slower under a flood, never closed.** When more than 20 site requests arrived in the last hour,
    the base difficulty of rule 4 rises by 2 bits per further 20, capped at +6 bits (≈ 64× the work: a
    few seconds on a phone). Every guest still gets through; a bot spreading requests over many IPs and
    e-mails pays that price on each one. Rules 9–10 bound what the remaining ones cost.

### B. Per-address limits — targeted, never global

6. The existing per-visitor limit (5/hour) and the honeypot stay.
7. **Per e-mail.** At most 3 **new** devis per normalised e-mail address per 24 h. Beyond that, a
   request is accepted only if it updates an open devis (rule 13); otherwise `429` with « Plusieurs
   demandes sont déjà en cours pour cette adresse. Elles seront traitées rapidement. »
8. No limit is ever shared by all visitors: no global counter, no per-API-key counter (public-api rule
   9 is corrected accordingly).

### C. What an unhandled request may consume

9. **Operator e-mails grouped.** The first site request of a 15-minute window e-mails the operator at
   once, as today. The following ones in the same window are gathered into one summary e-mail sent at
   the end of the window (« 3 nouvelles demandes du site »). Requests are never refused for this.
10. **Purge.** A site request that nobody acted on — never opened, sent, edited, paid or converted by
    the operator — is deleted 30 days after its creation, with its CGV acceptance; the client created
    for it is deleted too when it holds no other reservation, devis or payment. A devis number freed
    this way is not reused (a quote number may have gaps; invoice numbering is untouched).
11. The « Demandes du site » home alert keeps listing every pending request; when more than 20 arrive
    in an hour, it says so in one line (« 48 demandes en une heure — trafic inhabituel »), so the
    operator knows without opening each one.

### D. One quote per stay

12. **Same stay.** Two site requests are the same stay when they have the same normalised e-mail, the
    same property, and the same arrival and departure dates.
13. **Update in place.** When a new request is the same stay as an **open** devis (a devis, not yet
    paid, converted or cancelled), GuestFlow updates that devis instead of creating one:
    - party (adults, teens, children, babies, baby beds), times, options and resources are replaced by
      the new request's, and the price is recomputed by the engine, as on creation;
    - the guest's new message is appended to the notes, dated, after the previous ones;
    - the devis keeps its number, its public token (payment link) and its CGV acceptance; the new
      acceptance is recorded too;
    - the history records « Demande mise à jour depuis le site » with what changed;
    - the response is the same as a creation, with the **same** `requestId` and `reference`, and
      `updated: true`; the drawer says « Votre demande du <date> a été mise à jour. ».
14. A devis the operator already **sent** to the guest is updated the same way, flagged « Modifiée par
    le client après envoi » in the list and on the fiche, so the operator re-sends it.
15. Same e-mail and dates but **another property** → a new devis (a group may want both lodgings).
16. An update counts in the operator e-mails of rule 9 as « demande mise à jour », never as a new one,
    and does not count against rule 7.

**Edge cases:**
- A WordPress plugin too old to solve challenges → its requests are refused with « Le formulaire doit
  être mis à jour » only once the site has reported a version that supports them
  (`settings.recordPluginVersion`); until then, requests are accepted without proof and the
  Intégrations › Site tab says « Protection anti-robot inactive : mettre à jour l'extension ».
- Two identical requests within the same second (double click) → the second finds the first through
  rule 13 and returns it, unchanged.
- An e-mail typed with another case or spaces → normalised before rules 7 and 12.
- A request for the same stay whose new composition is no longer bookable (capacity, min stay) →
  refused as a creation would be; the open devis is left untouched.
- The guest's JavaScript disabled → the form cannot be sent; the drawer already requires JavaScript.

---

17. **Who opened it** (implementation, 2026-10-27). Nothing recorded that the operator had opened a
    devis, so rule 10 needed a signal: `reservations.operatorSeenAt` is stamped the first time
    `GET /api/devis/:id` (the fiche) reads it. A request counts as handled — never purged — once it has
    that stamp, a status other than draft, a conversion, a history line other than creation / website
    update / CGV acceptance (an operator edit), a guest e-mail logged against it, or any payment link.
18. **The « modifiée après envoi » flag ends with the operator's next action** (implementation,
    2026-10-27): saving the devis or setting its status clears `publicUpdatedAfterSendAt`. A devis
    counts as sent when its status is `sent` / `accepted` or a guest e-mail was logged for it.
19. **What an update keeps** (implementation, 2026-10-27): only a quote that came from the site is
    updated (one the operator typed for the same guest and dates is left alone); the beds the operator
    arranged, the discount and a custom price stay; the price is computed at today's tariffs with the
    property's default options, exactly as a creation. The first send attaches nothing else: no new
    attribution, no change of language.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/website-booking/` | `challenge.js` | C | Issue / verify signed challenges, adaptive difficulty (rules 1–5b). Pure. |
| `plugins/website-booking/` | `requestStore.js` | C | The plugin tables: spent challenges, request log (per address, 24 h), per-devis fingerprint + created client. |
| `plugins/website-booking/controllers/` | `publicChallengeController.js` | C | `GET /challenge` handler, `requireProof` middleware, the transition switch (version ≥ 1.18.0). |
| `plugins/website-booking/routes/` | `bookingRequests.js` | T | `GET /challenge`; verification before the controller. |
| `plugins/website-booking/controllers/` | `publicBookingRequestController.js` | T | Per-e-mail limit (7), same-stay lookup and update in place (12–16). |
| `plugins/website-booking/` | `requestPurge.js` | C | Daily purge of unhandled requests (10), registered with `ctx.jobs`. |
| `plugins/website-booking/` | `index.js`, `manifest.json` | T | Migration, secret, job, connection payload, version 1.8.0 (SDK ^2.5.0). |
| `plugins/website-booking/` | `siteConnectionController.js`, `pendingController.js`, `attention.js` | T | `antiBot` in the connection payload; `requestsLastHour` and the « trafic inhabituel » line (11). |
| `utils/` | `notificationService.js` | T | 15-minute grouping of site-request e-mails (9, 16): `notifyNewSiteDevis(id, { updated })`, `flushDueDigests()`. |
| `utils/` | `notificationDigest.js` | C | Generic window store (admit / takeDue) in the database. |
| `scheduledTasks.js` | — | T | `flushDueDigests` every minute, and 45 s after boot. |
| `models/` | `devisModel.js` | T | `updateFromPublicRequest` reusing the creation path (13), `markOperatorSeen`, `purgePublicRequest`; the flag set / cleared by `update` and `updateStatus`. |
| `controllers/` | `devisController.js` | T | `getOne` stamps `operatorSeenAt`. |
| `database.js` | — | T | The two columns, `devis_number_retired` (read by `generateDevisNumber`), the digest tables. |
| `utils/` | `publicLabels.js` | T | `challengeInvalid`, `challengeMissing`, `requestsPendingForEmail` (fr + en). |
| `plugins/website-booking/tests/` | `public-request-challenge.unit.test.js`, `public-request-grouping.unit.test.js`, `public-request-purge.unit.test.js` | C | Rules 1–16. |

### 4.2 Client side

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| WordPress `integrations/wordpress/guestflow-booking/` | `blocks/booking/view.js`, `assets/pow.js`, `assets/pow-worker.js`, `includes/class-gf-rest-proxy.php`, `includes/class-gf-blocks.php` | T/C | Proxy route for the challenge; fetch and solve it in a Web Worker (2), « Vérification… », « mise à jour » message (13). Plugin 1.18.0 ([wordpress-plugin.md](wordpress-plugin.md) rule 31). |
| `client/src/pages/` | `DevisPage.jsx`, `ReservationPage.jsx` | T | « Modifiée par le client après envoi » badge (14) — `StatusBadge`, existing component. |
| `client/src/components/reservation/` | `ReservationHistoryPanel.jsx` | T | Title of the `public_update` history entry. |
| `client/src/plugins/website-booking/` | `SettingsWebsiteSection.jsx` | T | « Protection anti-robot inactive » notice (edge case), MUI `Alert`. |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/public/v1/booking-requests/challenge` | New. `{ data: { challengeId, salt, difficulty, issuedAt, expiresAt, signature } }`, `Cache-Control: no-store`. Records the plugin version the proxy reports. |
| POST | `/public/v1/booking-requests` | Carries `challenge` (the object received, verbatim) and `nonce` (base 36). Returns `updated` (boolean) and `requestedOn` (`YYYY-MM-DD` of the first request). New errors `403 CHALLENGE_INVALID` (`details[0].issue` ∈ missing · forged · expired · tooFast · wrong · used), `429 TOO_MANY_REQUESTS` per e-mail. |
| GET | `/api/settings/website-connection` | Gains `antiBot: { active, pluginVersion, requiredVersion }`. |
| GET | `/api/dashboard/public-devis-pending` | Gains `requestsLastHour`. |
| GET | `/api/devis/:id` | Stamps `operatorSeenAt` the first time. The devis rows carry `publicUpdatedAfterSendAt`. |

## 5. Data model

- `public_request_challenges_used (challengeId TEXT PRIMARY KEY, expiresAt TEXT)` — plugin table,
  rows deleted after expiry.
- `public_request_log (id, at, ipKey)` — plugin table, one row per request past the proof, kept 24 h
  (rules 4, 5b, 11).
- `public_request_stays (reservationId PK, fingerprint, createdClientId)` — plugin table: the last
  request that wrote a site devis (double click) and the client created for it (purge).
- `reservations.publicUpdatedAfterSendAt TEXT` — rule 14 flag.
- `reservations.operatorSeenAt TEXT` — rule 17.
- `devis_number_retired (prefix PK, lastIncrement)` — core; the purge retires a number,
  `generateDevisNumber` skips past it (rule 10).
- `notification_digest_windows (digestKey PK, windowStartedAt)` and `notification_digest_items (id,
  digestKey, refId, kind, createdAt)` — core; rule 9 survives a restart.

All new columns are NULL on existing rows; nothing is rewritten.

## 6. UI / UX

See the interactive mock-up `docs/specs/2026-10-27-public-request-abuse-and-grouping.html`.

## 7. Test plan

- Challenge: forged, expired, reused, too fast, wrong nonce → refused; valid → accepted; difficulty grows
  per IP and not across IPs.
- Per e-mail: the 4th new devis in 24 h refused, an update accepted.
- Grouping: same stay → same id/number/token, recomputed price, appended notes, history; other property
  → new devis; sent devis → flagged; paid → new devis.
- E-mails: 1 immediate + 1 summary for 5 requests in 15 min.
- Purge: untouched 31-day request and its lone client deleted; opened or paid one kept.
- Manual: drawer on a phone (390 px), request sent before / after the check completes.

### Results (2026-10-27)

- `server/src/plugins/website-booking/tests/public-request-challenge.unit.test.js` — 9 tests (rules
  1-5b, transition).
- `public-request-grouping.unit.test.js` — 7 tests (rules 7, 12-16, double click, refused composition).
- `public-request-purge.unit.test.js` — 5 tests (rule 10, retired number, `operatorSeenAt`).
- `server/src/tests/site-request-email-digest.unit.test.js` — 2 tests (rules 9, 16, restart).
- `server/src/tests/wordpress-plugin-proof-of-work.unit.test.js` — 7 tests (the solver run against the
  server's check, proxy route, drawer, strings).
- Client: `SettingsWebsiteSection.anti-bot.test.jsx` (2), `DevisPage.public-update-flag.test.jsx` (2).
- Existing suites adjusted to the new contract: site connection payload, pending payload, migration
  count, plugin job list, a mocked database in `site-meal-portions`.
- Full suites: server **6 459 / 6 459**, client Vitest **2 190 / 2 190**.
- Manual, Playwright on an isolated stack (GuestFlow on 5580, the booking block's real `view.js`,
  `pow.js`, `pow-worker.js` and `style.css` served by a Node stand-in for the PHP proxy — no WordPress
  could run locally): at 390 px a request sent after the check (« Demande envoyée ! Référence :
  2026-10-001 »), the same stay sent again with 3 adults (« Votre demande du 27 octobre 2026 a été mise
  à jour. », same number), a submit before the check finished at 22 bits (« Vérification… » on the
  button, then sent); 900 and 1280 px sent; no horizontal scroll. Back-office (Vite on 5581) at
  390 / 900 / 1280: « Modifiée par le client après envoi » on the list and the fiche, the
  `public_update` history line (API — the devis fiche has no history panel), the « Protection
  anti-robot inactive » notice with a 1.17.1 site; a request without proof refused once 1.18.0 was
  reported.

## 8. Out of scope

- Third-party captchas (refused, 2026-10-27).
- A global ceiling of any kind (refused, 2026-10-27).

## 9. Open questions

- Q: Global ceiling? — A (2026-10-27, Adrien): no, it stops the service for everyone; internal defence
  only.
- Q: Grouping key? — A (2026-10-27, Adrien): same e-mail, same dates, same property.
- Q: Duplicate of an open devis? — A (2026-10-27, Adrien): update the open devis in place.
