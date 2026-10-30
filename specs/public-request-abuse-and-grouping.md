# Website requests — bot-proof without a global lockout, one quote per stay

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/public-request-abuse-and-grouping` |
| **Created** | 2026-10-27 |
| **Author** | Adrien |
| **Related PR** | #805 |

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
2. **Solving.** The WordPress booking drawer asks for a challenge **as soon as the drawer opens** —
   in the block, once its contact form is in view or touched, never on a mere page view (rule 29) — and
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
   that IP made in the last hour (requests sent, not challenges fetched — rule 29). One person sending 3 requests waits a second or two more; a bot
   sending 50 from the same address needs hours: the per-visitor limit (rule 6) lets 5 through an hour,
   and from its fifth request on each one is solved at the cap, a challenge fetched ahead at a lower
   difficulty being refused (rule 32). A guest on another IP is never affected by an attack.
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
    paid, converted or cancelled), GuestFlow updates that devis instead of creating one — **narrowed by
    rules 20-21 (review of PR #805): only an untouched draft is updated, and its ids and token are
    answered only to the holder of its token**:
    - party (adults, teens, children, babies, baby beds), times, options and resources are replaced by
      the new request's, and the price is recomputed by the engine, as on creation;
    - the guest's new message is appended to the notes, dated, after the previous ones;
    - the devis keeps its number, its public token (payment link) and its CGV acceptance; the new
      acceptance is recorded too;
    - the history records « Demande mise à jour depuis le site » with what changed;
    - the response is the same as a creation, with the **same** `requestId` and `reference`, and
      `updated: true`; the drawer says « Votre demande du <date> a été mise à jour. ».
14. A devis the operator already **sent** to the guest is updated the same way, flagged « Modifiée par
    le client après envoi » in the list and on the fiche, so the operator re-sends it. **Replaced by
    rule 21 (2026-10-27): a sent devis is never changed; the flag reads « Message du client après
    envoi ».**
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
20. **Never hand a quote to whoever knows the stay** (review of PR #805, operator decision 2026-10-27
    « Brouillon seul, jamais le lien »). The answer to a request for an existing quote's stay carries
    that quote's `requestId`, `reference`, price and `publicToken` **only** when the request carries
    the quote's current token (`publicToken` in the body — the drawer that created it holds it).
    Otherwise it is a receipt without any of them: `{ status, updated, messageAdded?, requestedOn,
    propertyId, startDate, endDate }`, and the drawer offers no payment for it. A double click is
    answered the same way.
21. **Only an untouched draft is updated** (same review and decision). A quote is touched once the
    operator did anything with it: a status other than draft, an opening (`operatorSeenAt`), an edit
    (any history entry besides creation, website update, website message, CGV acceptance), a guest
    e-mail logged against it, or a payment link of any status. A touched quote never changes — party,
    options, lines, offered flags, price all stay: the request only appends its message, dated
    (« Message ajouté depuis le site le … »), records a `public_message` history line, flags a quote
    already sent `publicUpdatedAfterSendAt` (« Message du client après envoi » on the list and the
    fiche), and counts in the operator e-mails as « demande mise à jour ». The response says
    `messageAdded: true`; the drawer reads « Votre demande du <date> a déjà été transmise : votre
    message a été ajouté. ». No CGV acceptance is recorded for it (nothing was accepted anew).
22. **What a request may write** (review). `message` is at most 2 000 characters (`422
    VALIDATION_FAILED`, `details[0].field = 'message'`; the drawer's textarea stops there). At most 10
    messages are appended to one quote; beyond, the request still succeeds, nothing is appended, and
    the operator e-mail says « message non ajouté : limite atteinte ».
23. **Replaced by rule 29 (2026-10-27 spec review)** — counting issued challenges made every page view
    cost the next request 2 bits, and `tooEasy` refused a challenge issued just before the hour crossed
    20. As first written: **A challenge fetched ahead is no bargain** (review). Every challenge handed out to an address is
    logged (`public_request_issued`, 24 h) and counts in the next one's difficulty, like a request. At
    verification, a challenge whose difficulty is below what the address must solve **now** (the
    flood surcharge of the moment, +2 bits per request it sent in the hour) is refused
    `CHALLENGE_INVALID` / `tooEasy`; the drawer fetches a fresh one and retries once, so a real guest
    still gets through. Cap unchanged; nobody is refused for someone else.
24. **The proof stays required** (review). Once the site reported a plugin that solves it, the
    plugin setting `proofEnforcedSince` is stamped and the proof stays required whatever version is
    reported later. There is no reset: going back to an older plugin closes the site form until it is
    updated again.
25. **The purge counts from the last request and sees every read** (review). The 30 days of rule 10
    run from the guest's last request for the stay (`public_request_stays.lastRequestAt`), else the
    creation. `operatorSeenAt` is stamped by every admin read of one devis: the fiche, its PDF (also
    downloaded from the list), its history and the extension preview.
26. **A summary leaves before it is forgotten** (review). The rows of a 15-minute summary are marked
    while it is sent and deleted only once it left; a failed send keeps them for the next flush; a
    mark older than 10 minutes (a crash mid-send) is taken again.
27. **Paying again after changing the stay** (re-review of PR #805). A payment link on a quote the
    operator never touched (draft, never opened, sent, edited or e-mailed) can only come from the
    guest's own drawer. For a request that carries the quote's token, such links do not make it
    « touched »: the quote is updated and re-priced (rule 13), and the update itself retires the old link
    (amended 2026-10-28, audit: it stayed payable at the old price until the next payment;
    [public-online-payment.md](public-online-payment.md) rule 14), deactivated at the provider after the
    commit; the next payment mints one at the new amount. Without the
    token, or once the operator touched it, rule 21 applies. The drawer never starts a payment on a
    `messageAdded` answer.
28. **The summary is pushed even without e-mail** (re-review). Like the immediate notification, the
    15-minute summary is pushed whatever the e-mail settings, once, before its e-mail; with e-mail off
    or SMTP unconfigured the rows are then cleared, and a retried e-mail never pushes twice.
29. **A page view costs nothing; a challenge keeps its signed difficulty** (2026-10-27 spec review,
    replaces rule 23). The difficulty of rule 4 counts the requests the address **made** in the hour
    (`public_request_log`), never the challenges it was handed: the drawer used to fetch one at every
    page load, and after five or six page views a phone faced 22 bits (10-20 s). The drawer fetches its
    challenge once the contact form is in view (the Solio drawer opened on it, the page scrolled to it)
    or touched, and again when it is seen after its 15 minutes; a send before that fetches one then. At
    verification a challenge is judged at the difficulty signed into it when it was issued — the HMAC
    is what makes that number trustworthy — so a challenge issued just before the hour crossed 20 is
    accepted just after; there is no `tooEasy` any more. Fetching challenges ahead stays bounded by
    their 15 minutes of validity, the per-visitor `publicApiLimiter` on the challenge route and the
    per-visitor `bookingRequestLimiter` (5 an hour) on the sends. The `public_request_issued` table is
    dropped (plugin migration `public_request_tables_v3`).
30. **Past the message cap, the answer says nothing about a message** (same review). Rule 22's eleventh
    message on a touched quote used to answer `messageAdded: true` and the drawer read « votre message a
    été ajouté ». A quote the operator touched now always answers a boolean `messageAdded`: `true` (and
    `updated: true`) when the message was appended, `false` (and `updated: false`) past the cap. The
    drawer reads « Demande reçue. Nous vous recontactons rapidement. » for the latter, and never starts
    a payment on any answer carrying `messageAdded` (rule 27). The operator e-mail still says « message
    non ajouté : limite atteinte ». An untouched draft's answer carries no `messageAdded`.
31. **The summary has one line per quote, the dates read the French way** (same review). The
    15-minute summary of rule 9 groups its rows by quote: one line per quote, tagged « nouvelle »,
    « mise à jour », « nouvelle, puis 12 mises à jour » or « 3 mises à jour » (plus « message non
    ajouté : limite atteinte » when one was dropped); the subject counts quotes, new when one of its
    requests created it in the window. One stay sent 13 times used to read as 13 lines. The immediate
    e-mail writes the stay `du 01/07/2027 au 11/07/2027`, like the summary (it printed ISO dates).
32. **A challenge fetched ahead is spent at what the address owes now** (adversarial review of the
    2026-10-27 fixes). Rule 29 judged a challenge only at its signed difficulty, so a bot could fetch
    five challenges at the base 12 bits and spend them all (reproduced: 5 fetched, 5 accepted). At
    verification the signed difficulty must now be at least base + 2 bits × the requests this same
    address **sent** in the hour (the current one excluded) + the flood surcharge of the moment minus
    one 2-bit step, capped at 22 bits; below, `403 CHALLENGE_INVALID` / `tooEasy` (the challenge stays
    spent). Per address only: another address's flood never refuses a challenge issued just before it,
    and the one-step grace lets a challenge issued just before the hour crosses a threshold through. A
    real guest is never refused: the drawer fetches a fresh challenge after every send (issued at what
    the address owes then) and retries once on `CHALLENGE_INVALID`, so 2-3 requests in a row pass at
    12, 14, 16 bits, and a second tab whose challenge predates the first tab's send passes on its retry.
    Spent-before-judged: a challenge sent twice still reads `used`.

33. **A value on a « label : value » line of an operator e-mail is one line** (audit 2026-10-28, F5). The
    notification e-mails (new/updated site devis, the digest, an imported iCal reservation, a booking conflict)
    replace control characters and Unicode line separators in every interpolated value (names, e-mail, phone,
    property, platform, option and resource titles, iCal summary) by a space, so a visitor cannot forge a line
    (« IMPORTANT : le client a déjà payé : <link> ») above « Ouvrir le devis ». The mails are plain text, so there
    is nothing to HTML-escape. The phone is also validated at the boundary (`specs/public-api.md` rule 21). Test:
    `plugins/website-booking/tests/public-request-line-injection.unit.test.js`.
34. **`proofEnforcedSince` and `lastSeenPluginVersion` are internal settings** (audit r5, authz review of PR #874,
    2026-10-30; `website-booking` 1.8.7, SDK 2.17.0). Rule 24 says nothing resets the proof-of-work latch, yet a settings PUT
    with `null` did. Both keys are now refused by `PUT /api/plugins/website-booking/settings` and left out of the GET; the
    plugin still writes them and the online-booking card reads its own endpoint. Test: `tests/internal-settings.unit.test.js`.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/website-booking/` | `challenge.js` | C | Issue / verify signed challenges, adaptive difficulty (rules 1–5b), the least difficulty a challenge must carry when spent (`requiredDifficulty`, rule 32). Pure. |
| `plugins/website-booking/` | `requestStore.js` | C | The plugin tables: spent challenges, request log (per address, 24 h), per-devis fingerprint, created client, appended messages, last request; `migrateV3` drops the issued-challenge log (rule 29) and opening the store on first use never creates it. |
| `plugins/website-booking/controllers/` | `publicChallengeController.js` | C | `GET /challenge` handler (difficulty from the requests made, rule 29), `requireProof` middleware (a challenge judged at its signed difficulty, which must cover what the address owes now — rule 32), the sticky transition switch (rule 24). |
| `plugins/website-booking/` | `settings.js` | T | `proofEnforcedSince` (rule 24). |
| `plugins/website-booking/routes/` | `bookingRequests.js` | T | `GET /challenge`; verification before the controller. |
| `plugins/website-booking/controllers/` | `publicBookingRequestController.js` | T | Per-e-mail limit (7), same-stay lookup and update in place (12–16); the boolean `messageAdded` of a message-only answer (30). |
| `plugins/website-booking/` | `requestPurge.js` | C | Daily purge of unhandled requests (10), registered with `ctx.jobs`. |
| `plugins/website-booking/` | `index.js`, `manifest.json` | T | Migrations (v3 drops the issued-challenge log, rule 29), secret, job, connection payload, version 1.8.0 (SDK ^2.5.0), 1.8.1 after the 2026-10-27 spec review, 1.8.2 after its adversarial review (rule 32). |
| `plugins/website-booking/` | `siteConnectionController.js`, `pendingController.js`, `attention.js` | T | `antiBot` in the connection payload; `requestsLastHour` and the « trafic inhabituel » line (11). |
| `utils/` | `notificationService.js` | T | 15-minute grouping of site-request e-mails (9, 16): `notifyNewSiteDevis(id, { updated })`, `flushDueDigests()`; one summary line per quote and French dates (31). |
| `utils/` | `notificationDigest.js` | C | Generic window store (admit / takeDue) in the database. |
| `scheduledTasks.js` | — | T | `flushDueDigests` every minute, and 45 s after boot. |
| `models/` | `devisModel.js` | T | `updateFromPublicRequest` reusing the creation path (13), `appendPublicMessage` (rule 21), `markOperatorSeen`, `purgePublicRequest`; the flag set / cleared by `update` and `updateStatus`. |
| `controllers/` | `devisController.js` | T | `getOne`, `pdf`, `history`, `extensionPreview` stamp `operatorSeenAt` (rule 25). |
| `database.js` | — | T | The two columns, `devis_number_retired` (read by `generateDevisNumber`), the digest tables. |
| `utils/` | `publicLabels.js` | T | `challengeInvalid`, `challengeMissing`, `requestsPendingForEmail` (fr + en). |
| `plugins/website-booking/tests/` | `public-request-challenge.unit.test.js`, `public-request-grouping.unit.test.js`, `public-request-purge.unit.test.js` | C | Rules 1–16. |

### 4.2 Client side

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| WordPress `integrations/wordpress/guestflow-booking/` | `blocks/booking/view.js`, `assets/pow.js`, `assets/pow-worker.js`, `includes/class-gf-rest-proxy.php`, `includes/class-gf-blocks.php` | T/C | Proxy route for the challenge; fetch it once the contact form is in view or touched (`armProof`, rules 2, 29) and solve it in a Web Worker, « Vérification… », « mise à jour » message (13), « Demande reçue. » on `messageAdded: false` (30). Plugin 1.18.0 ([wordpress-plugin.md](wordpress-plugin.md) rule 31). |
| `client/src/pages/` | `DevisPage.jsx`, `ReservationPage.jsx` | T | « Modifiée par le client après envoi » badge (14) — `StatusBadge`, existing component. |
| `client/src/components/reservation/` | `ReservationHistoryPanel.jsx` | T | Title of the `public_update` history entry. |
| `client/src/plugins/website-booking/` | `SettingsWebsiteSection.jsx` | T | « Protection anti-robot inactive » notice (edge case), MUI `Alert`. |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/public/v1/booking-requests/challenge` | New. `{ data: { challengeId, salt, difficulty, issuedAt, expiresAt, signature } }`, `Cache-Control: no-store`. Records the plugin version the proxy reports. |
| POST | `/public/v1/booking-requests` | Carries `challenge` (the object received, verbatim) and `nonce` (base 36). May carry `publicToken` (the quote the drawer created). Returns `updated` (boolean), `messageAdded` (rule 21; a boolean on every message-only answer, `false` past the cap — rule 30) and `requestedOn` (`YYYY-MM-DD` of the first request); for an existing quote, `requestId` / `reference` / `finalPrice` / `publicToken` only to the token's holder (rule 20). New errors `403 CHALLENGE_INVALID` (`details[0].issue` ∈ missing · forged · expired · tooFast · wrong · used · tooEasy; `tooEasy` removed by rule 29, back with rule 32), `429 TOO_MANY_REQUESTS` per e-mail, `422 VALIDATION_FAILED` on a message over 2 000 characters. |
| GET | `/api/settings/website-connection` | Gains `antiBot: { active, pluginVersion, requiredVersion }`. |
| GET | `/api/dashboard/public-devis-pending` | Gains `requestsLastHour`. |
| GET | `/api/devis/:id` | Stamps `operatorSeenAt` the first time. The devis rows carry `publicUpdatedAfterSendAt`. |

## 5. Data model

- `public_request_challenges_used (challengeId TEXT PRIMARY KEY, expiresAt TEXT)` — plugin table,
  rows deleted after expiry.
- `public_request_log (id, at, ipKey)` — plugin table, one row per request past the proof, kept 24 h
  (rules 4, 5b, 11).
- `public_request_stays (reservationId PK, fingerprint, createdClientId, appendCount, lastRequestAt)`
  — plugin table: the last request that wrote a site devis (double click), the client created for it
  (purge), the appended messages (rule 22), the last request's time (rule 25).
- ~~`public_request_issued (id, at, ipKey)`~~ — plugin table of rule 23, dropped by migration
  `public_request_tables_v3` (rule 29).
- Plugin setting `proofEnforcedSince` (rule 24).
- `notification_digest_items.takenAt` (rule 26).
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

After the adversarial review of the 2026-10-27 fixes (rule 32; the suite failed on the code before):
- `public-request-challenge-ahead.unit.test.js` — 7 tests (five challenges fetched ahead: the first
  passes, the four others `tooEasy`; the drawer's protocol — fresh challenge after every send, one retry
  — sends three requests in a row, and a second tab whose challenge predates the first tab's send passes
  on its retry; the one-step flood grace; another address's flood refuses nothing; the cap; opening the
  store never creates `public_request_issued`).

After the spec review of 2026-10-27 (rules 29-31; each new suite failed on the code before the fix):
- `public-request-challenge-cost.unit.test.js` — 4 tests (six page views stay at 12 bits; a request
  made still raises the next; seven challenges issued at 18 requests sent in parallel at 25 all pass;
  the issued log is gone). The two rule-23 tests of `public-request-challenge` were removed with the
  rule (→ 10).
- `public-request-message-cap-answer.unit.test.js` — 3 tests (rule 30, server answer and drawer).
- `src/tests/site-request-email-digest-grouping.unit.test.js` — 2 tests (rule 31).
- Adjusted: `wordpress-plugin-proof-of-work` (the drawer arms the proof on the contact form, pays only a
  non-message-only answer), `phase-2-website-booking` (4 migrations).

After the review of PR #805 (rules 20-26):
- `public-request-takeover.unit.test.js` — 9 tests (rules 20-22, F2: an operator-edited draft keeps
  its lines); `public-request-challenge` +3 (rules 23-24) → 12; `public-request-purge` +2 (rule 25) →
  7; `site-request-email-digest` +1 (rule 26) → 3; `wordpress-plugin-proof-of-work` +2 → 9. Each was
  run first against the pre-review code and failed there.
- Adjusted: `public-request-grouping` (the drawer sends the token; a sent quote only gains the
  message), migration count 3, `DevisPage.public-update-flag` (new label).
- Re-review (rules 27-28): `public-request-pay-retry.unit.test.js` — 3 tests (the full scenario:
  first payment link, new party with the token, re-priced quote, old link cancelled then a new one at
  the new amount); `site-request-email-digest` +1 → 4; `wordpress-plugin-proof-of-work` +1 → 10. The
  scenario and the two others failed on `d0005113` first.
- Full suites: server **6 476 / 6 476** after the review, **6 481 / 6 481** after the re-review; client Vitest **2 190 / 2 190**; E2E 148 passed, 1 skipped.
- Manual at 390 px (same isolated stack): the stay of a quote already sent, sent again with another
  message → « Votre demande du 27 octobre 2026 a déjà été transmise : votre message a été ajouté. »,
  the quote keeps its party and gains the dated message and the flag; an untouched draft sent again
  from a fresh page → « … a été mise à jour. », no number nor token in the answer; the mock-up's new
  « Opérateur : envoyer le dernier devis » path shows the same.

First implementation:

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
- Q: Should a challenge handed out raise the next one's difficulty (rule 23)? — A (2026-10-27, spec
  review): no — page views made a phone solve 22 bits; the requests made count, a challenge keeps its
  signed difficulty (rule 29).
- Q: May a request for a known stay update a quote the operator already handled, and answer its
  payment link? — A (2026-10-27, Adrien, review of PR #805): « Brouillon seul, jamais le lien » —
  rules 20-21.
