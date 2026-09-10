# Guest gate access (open the gate from the guest's phone, for the stay only)

| Field | Value |
|---|---|
| **Status** | Approved (2026-09-09) |
| **Branch** | `feature/guest-gate-access` _(user-managed)_ |
| **Created** | 2026-09-09 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | Sowel side: `sowel-plugin-guest-access` (integration plugin) + `sowel-recipe-guest-gate` (recipe). This spec owns the contract they consume (§4.3). |

---

## 1. Context

The gate of the Domaine is driven by Sowel: the `Portail` equipment
(`d0d46d1b-3f92-4754-a901-69441d56035c`, type `gate`) carries an order
`command` whose only value is `pulse`, plus a real `closed` contact
(`contact_door`) that tells whether the gate stands open or shut. The pulse
travels to a LoRa node through the `lora2mqtt` bridge, which signs it.

Guests get in with a **single global code**: `portalCode`, one setting in
Réglages, shown by the arrival SAS (specs/arrival-departure-sas.md §3.1 rule
5.bis). That code is permanent, identical for every stay since the beginning,
never revoked, and nothing records who used it or when. Everyone who has ever
stayed here still knows it.

GuestFlow already knows exactly when a stay starts and ends
(`reservations.startDate/checkInTime`, `endDate/checkOutTime`), already mints
per-record capability tokens for public use (`reservations.publicToken`,
constant-time compared, uniform 404 — specs/public-online-payment.md §3 rule 2),
already runs a separate key-authenticated public tree (`/public/v1`,
specs/public-api.md) and already sends J-7 / J-2 arrival emails with `{{token}}`
substitution (specs/j1-arrival-reminder-email.md).

What GuestFlow has never had is a **guest-facing UI**. Everything public so far
is API-only, consumed server-to-server by the WordPress proxy.

### Why GuestFlow never talks to Sowel

Sowel API tokens (`swl_…`) inherit the role of the user who created them, and a
`standard` user may actuate **every** equipment in the house (Sowel spec 131
standard-write allowlist). There is no per-equipment scope. Holding such a token
in GuestFlow — the most internet-exposed machine of the estate — would mean that
a compromise of this app hands over the whole home automation.

The firewall says the same thing in its own way: VM 104 carries
`OUT DROP -dest 192.168.0.0/24`, deliberately (homelab `pve01/firewall/104.fw`).

**So the traffic is inverted: Sowel comes and asks.** A Sowel integration plugin
long-polls this app for pending open requests, a Sowel recipe decides whether to
honour them, and GuestFlow never holds any credential over the house. This spec
covers the GuestFlow half; the plugin and the recipe are separate packages.

## 2. Goal

A guest opens the gate from their phone — no app to install, no account, no
password — from the moment their stay begins until one hour after their
check-out, and can pass that access to their family. The owner sees every use,
can cut it at any time, and never has to change a printed code again.

## 3. Functional rules

### 3.1 The access and its code

1. **One access per reservation**, created lazily the first time it is needed
   (email rendering, SAS, or fiche display) and stored in `gate_accesses`
   (§5). A cancelled reservation (`cancelledAt` set) never gets one.
2. **The code is the only secret.** 8 characters drawn from Crockford base32
   minus the ambiguous ones (`ABCDEFGHJKMNPQRSTVWXYZ0123456789` — no I, L, O,
   U), displayed grouped as `4K7M-9QT2`, compared case-insensitively with the
   dash and spaces stripped. 40 bits of entropy, dictable over the phone
   without spelling mistakes.
2.bis **The code is unique among every access that can still be used**, because
   the code alone identifies the stay — there is no property picker on the
   unlock screen (§3.8). Minting draws again on collision with any non-expired,
   non-revoked access.
3. **Verification goes through a salted hash** (SHA-256 of the normalized code,
   per-row salt) — a submitted code is never compared to a stored clear value.
   The clear code is nevertheless kept alongside it in `gate_accesses.code`
   until 7 days after the stay, then nulled by the purge task (§3.7 rule 24):
   the operator has to be able to re-read it to dictate it over the phone, which
   a pure hash forbids. This is a deliberate trade — the value is a door code
   for a stay in progress, not a user credential, and it dies with the stay.
4. **The reservation number is never a secret.** It is sequential and printed on
   quotes, invoices and emails. It is displayed *next to* the code as a landmark
   (« séjour n° 2026-0142 ») and never accepted in its place.
5. **Regenerating** the code (fiche or SAS) mints a new one, revokes every
   registered device (§3.4) and invalidates every link already sent.
6. **Revoking** sets `revokedAt`; the access answers as if it never existed.
6.bis **A code belongs to one reservation and dies with it.** A returning guest
   gets a brand-new code on their new booking — codes are never carried over,
   reused, or re-derived from the client, and the previous one stays dead
   whatever happens to the new one. The access row is keyed on `reservationId`,
   which makes this structural rather than a rule someone has to remember.

### 3.2 The validity window

7. The window is **derived live from the reservation at every request**, never
   frozen at creation:
   `start = startDate + checkInTime`, `end = endDate + checkOutTime + 1 h`,
   both read as **Europe/Paris wall clock**. Moving the dates or the times moves
   the access with them, with no operator action.
8. **No tolerance before check-in** (decision 2026-09-09). A guest who arrives
   early sees a countdown, and the operator opens the access from the arrival
   SAS in one tap if they choose to (§3.6 rule 20).
9. A reservation cancelled mid-stay kills the access on the next request.

**Edge cases:**
- Request before `start` → `403 NOT_YET_ACTIVE` + the activation instant, so the
  page can display the countdown.
- Request after `end` → `403 EXPIRED`.
- **A just-expired code must still be recognised**, for two days after check-out.
  Otherwise the guest who presses in the car park an hour late is told « code
  incorrect » — they would retype it, then call. The `401` is reserved for a code
  that matches nothing at all; past the grace the two become indistinguishable,
  which is what keeps an old code from being confirmable as ever having existed.
- Reservation deleted → the access row cascades away; the link 404s.
- DST change inside a stay → the window must still land on the wall-clock hour;
  covered by a unit test on the March and October transitions.

### 3.3 Getting in

10. **Two doors, one secret.**
    - **From the email**: `https://guest.domainesolio.com/?c=4K7M9QT2` — one tap, nothing
      to type. The page consumes the parameter, opens the session, and removes
      it from the address bar (`history.replaceState`).
    - **From the permanent QR code**: `https://guest.domainesolio.com/` with no parameter
      → the code form. The QR **never changes and carries no secret**: it is
      printed once (welcome book, plate at the gate, magnet) and never
      reprinted.
11. **A wrong code answers `401`** — deliberately, not `403` and not a `200`
    carrying an error. That is the status the CrowdSec scenario
    `http-generic-401-bf` counts on the edge proxy (same arrangement that
    protects the solio-map console). Changing it would silently disarm the ban.
12. **Throttling**: 5 code attempts per 10 min per IP; a given code locks itself
    for 1 h after 10 failures across all IPs; 12 successful opens per hour per
    access. Every limit answers a uniform envelope that never says whether the
    code exists.
13. **The session is a signed httpOnly cookie** (`gate_sid`, `SameSite=Lax`,
    `Secure`), bound to the access, expiring at the end of the window. Losing it
    (private window, new phone) costs one code entry.

### 3.4 Sharing with the family

14. **Sharing is a feature, not an abuse.** The unlocked page carries a
    « Partager l'accès » button using the Web Share API, which shares the
    `?c=…` link through the guest's own apps (WhatsApp, SMS, AirDrop). Where the
    API is missing, it falls back to copy-to-clipboard.
15. **No hard device cap.** A cap would lock a legitimate brother-in-law out at
    23 h. Instead every device is registered in `gate_devices` (first seen, last
    seen, IP, user agent) and **beyond 6 devices the owner gets a push
    notification** (specs/pwa-push-notifications.md) — information, not a block.
16. Every attempt — successful or not — is journalled in `gate_events` with its
    reason, and rendered on the reservation fiche.

### 3.5 Opening the gate

17. Pressing the button creates a `gate_requests` row in state `pending`.
    **Two presses within 10 s return the same request** (dedup at the source:
    two pulses on a sequential gate mean *open then close*).
18. The Sowel poller (§4.3) takes the request, and reports back `opened`,
    `refused` (the recipe is disarmed) or `error`. The page shows the outcome:
    « Le portail s'ouvre… » with the 34 s travel time as a progress bar,
    « Accès coupé par le propriétaire », or the failure message with the owner's
    phone number.
19. **Availability is shown before the guest presses.** If no poller has been
    seen for more than 60 s, the button is disabled and the page says the
    service is unreachable and gives the phone number, instead of failing
    silently after the press. A request left `pending` for more than 30 s is
    marked `timeout`.
19.bis **GuestFlow does not know the gate; the poller tells it.** The `closed`
    contact lives in Sowel, so every long-poll carries the state the plugin
    currently sees (`?state=open|closed|unknown`), stored in `gate_runtime`
    (§5) with its timestamp. That single call is the heartbeat *and* the state
    feed — no second endpoint, no clock skew between the two. GuestFlow's copy
    is **advisory**: it drives the badge and lets the page pre-empt a press
    (§3.8 rule 28), while the authoritative refusal stays with the recipe,
    which reads the contact at the instant it would pulse. A state older than
    60 s renders as « état inconnu », never as « fermé ».

### 3.6 Operator surfaces

20. **Arrival SAS**: the « Code portail » step (specs/arrival-departure-sas.md
    §3.1 rule 5.bis) becomes **« Accès portail »**: the stay code in large type,
    a QR code **displayed on screen** carrying the `?c=…` link so the guest can
    scan it in front of the operator, a « Renvoyer le lien par email » button,
    and — when the stay has not started yet — « Ouvrir l'accès maintenant »,
    which stamps `earlyOpenedAt` and makes the window start immediately.
    The global `portalCode` setting stays in place, unused by this flow, until
    the physical fallback is retired.
21. **Reservation fiche**: a « Accès portail » card — code, window, device
    count, last use, the full event journal, and two actions: *Régénérer* and
    *Révoquer*.
22. **Departure SAS**: recap line « l'accès portail expire à HH:MM » plus a
    *Révoquer maintenant* action.
23. **Emails J-7 and J-2**: new context flags/tokens `hasGateAccess`,
    `gateAccessCode`, `gateAccessUrl`. The code and the link travel in the same
    message — no second channel, no PIN (decision 2026-09-09: the bar to clear
    is the permanent shared code this replaces, and the window, the journal and
    the revocation already clear it).

### 3.7 Housekeeping

24. A daily scheduled task nulls `gate_accesses.code` for stays ended more than
    7 days ago, deletes `gate_requests` older than 30 days, and keeps
    `gate_events` for 1 year (the journal is the only thing that answers « who
    came in that night »).

### 3.8 Two lodgings, one gate

25. **Several accesses are live at once, by design.** Le Gîte and La Lodge each
    host their own stay, each with its own window, and both open **the same
    gate**. Nothing in this feature is per-property except the label the guest
    reads: the access, the code, the window and the journal are per
    *reservation*.
26. **The unlock screen has no property picker.** The code identifies the stay
    on its own (§3.1 rule 2.bis); once unlocked, the page names the lodging
    (« Le Gîte », « La Lodge ») so the guest can see at a glance they are on
    their own access.
27. **The session is bound to one access.** Entering a different code on the
    same phone replaces the session — the family that stayed at the Gîte last
    year and books the Lodge this year needs no clearing of anything.
28. **The gate guard is gate-wide, never per-access.** A second pulse on a
    sequential gate does not open it twice: it **reverses the travel and closes
    it**, possibly on the car driving through. So a request is **satisfied
    without any pulse** whenever the gate is not already closed — the page
    answers « Le portail est déjà ouvert » (or « s'ouvre déjà ») and the guest
    simply drives in. That guard reads the real `closed` contact, not a timer,
    so it also covers a gate left open by the owner, by the night-closure recipe
    or by a delivery.
28.bis **The guard is enforced twice, and only one of them is authoritative.**
    GuestFlow refuses to even create a request while its advisory copy of the
    state (§3.5 rule 19.bis) says the gate is not closed — that is a UI courtesy,
    resolved in the phone's hand. The **recipe** re-reads the contact at the
    instant it would pulse and answers `already_open` if it moved in between.
    Never trust the advisory copy for the decision: it can be up to a poll
    interval stale, and a gate closes in 34 s.
29. **Requests queue, they do not race.** `gate_requests` is served to the
    poller FIFO, one at a time; the plugin resolves a request before taking the
    next. Two guests pressing within the same second produce one pulse and two
    honest answers.
30. **Ceilings are counted at both levels**: 12 opens per hour per access
    (§3.3 rule 12) *and* 30 per hour across the gate, so one compromised access
    cannot starve the other lodging.

**Edge cases:**
- Contact stuck reporting « open » → nothing ever pulses, and that is the right
  refusal: a guest whose goal is to drive in can drive in. The fiche shows the
  refusal reason, and the Sowel recipe surfaces the stale contact.
- Both lodgings press while the gate is closed → first request pulses, second is
  coalesced by rule 28 as soon as the contact leaves the closed position.

---

## 4. Architecture

> **Fat backend, thin frontend.** The guest page holds no rule: it renders what
> `/gate/v1/session` hands it and posts a button press. Every window check,
> every limit, every state transition is server-side.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `index.js` | `index.js` | T | Mounts the guest tree **before** the `/api` guard; mounts `requireGuestHost` first |
| `routes/` | `guest.js` | C | Guest-facing tree `/gate/v1/*` (session, open, status) + the static page |
| `routes/` | `gatePoller.js` | C | Sowel-facing tree `/public/v1/gate/*` (long-poll, result) |
| `controllers/` | `guestGateController.js` | C | Code check, session issue, open request, status |
| `controllers/` | `gatePollerController.js` | C | Long-poll queue, result callback, poller heartbeat |
| `controllers/` | `sasController.js` | T | Replaces the `portal` step payload with the access payload |
| `controllers/` | `reservationsController.js` | T | Exposes the access card on the fiche + regenerate/revoke |
| `models/` | `gateAccessModel.js` | C | CRUD on `gate_accesses`, `gate_devices`, `gate_events`, `gate_requests`, `gate_runtime` |
| `middleware/` | `requireGuestHost.js` | C | Fail-closed host guard: on the guest hostname only `/gate/v1/*` and the static page exist; everything else 404. Symmetrically, `/gate/v1/*` is refused on the admin hostname |
| `middleware/` | `requireGateApiKey.js` | C | Constant-time shared key for the Sowel poller — a **distinct** key from `PUBLIC_API_KEY` |
| `middleware/` | `rateLimiters.js` | T | `gateCodeLimiter` (5/10 min/IP), `gateOpenLimiter` (12/h/access) |
| `utils/` | `gateCode.js` | C | Generate / normalize / hash the code (pure) |
| `utils/` | `gateWindow.js` | C | Window from a reservation, Europe/Paris, DST-safe (pure) |
| `utils/` | `gateQr.js` | C | QR PNG/data-URI for the SAS and the emails (new dep: `qrcode`) |
| `utils/` | `emailContextBuilder.js` | T | Adds `hasGateAccess`, `gateAccessCode`, `gateAccessUrl` |
| `utils/` | `localEnv.js` | T | `getOrCreateSecret('GATE_API_KEY', 32)` at boot, like `PUBLIC_API_KEY` |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Daily purge (§3.7) + `timeout` sweep on stale requests |
| `database.js` | `database.js` | T | Idempotent migration block for the four tables |

**New dependencies:** `qrcode` (QR rendering, server-side only).

### 4.2 Client side

**The guest page is not part of the admin SPA.** A guest stands at a gate on
4G, possibly in the rain: they get a **standalone page of a few kilobytes**
(plain HTML + CSS + ~100 lines of vanilla JS, no React, no MUI), served by
express from `server/src/guest-page/`, not from `client/`. Loading the admin
bundle to draw one button would be indefensible here.

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `server/src/guest-page/` | `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `icon-*.png` | C | The whole guest UI, installable to the home screen |
| `client/src/components/sas/` | `ReservationSasDialog.jsx` | T | « Code portail » step → « Accès portail » (code, QR, resend, open-now) |
| `client/src/components/` | `GateAccessCard.jsx` | C | Fiche card: code, window, devices, journal, regenerate/revoke |
| `client/src/pages/` | `ReservationPage.jsx` | T | Mounts the card |
| `client/src/services/` | `gateAccessService.js` | C | Admin-side calls (read, regenerate, revoke, resend) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `PageActionBar`, `StatusBadge`, the SAS step shell | Pre-existing. |
| **Created (new generic)** | — | None: the guest page shares nothing with the admin app by design (different origin, different bundle). |
| **Specific (kept feature-local)** | `GateAccessCard` | Bound to this data shape and to the two destructive actions; not a composition candidate. |

### 4.3 API contract

**Guest tree** — guest hostname only, no key, cookie session:

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/` | — | the static page | Any unknown path on this host → 404 |
| POST | `/gate/v1/session` | `{ code }` | `{ stay: { guestLabel, propertyName, reservationNumber, window }, gate: { state }, service: { available } }` + `gate_sid` cookie | `401` on a wrong code (CrowdSec, §3.3 rule 11) |
| GET | `/gate/v1/session` | cookie | same shape | `403 NOT_YET_ACTIVE` \| `EXPIRED` \| `REVOKED` |
| POST | `/gate/v1/open` | cookie | `{ requestId, status: "pending" }` | Deduped within 10 s |
| GET | `/gate/v1/open/:requestId` | cookie | `{ status: "pending" \| "opened" \| "already_open" \| "refused" \| "error" \| "timeout", detail? }` | Polled by the page every 1 s for 40 s. `already_open` is a success, not a failure (§3.8 rule 28) |

**Sowel tree** — `Authorization: Bearer <GATE_API_KEY>`, server-to-server only:

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/public/v1/gate/requests?wait=25&state=closed` | — | `{ request: null }` or `{ request: { id, reservationId, reservationNumber, propertyName, requestedAt } }` | **Long-poll**: held open up to `wait` seconds, answers the instant a guest presses, one request at a time (§3.8 rule 29). `state` is what the plugin currently sees on the `closed` contact (`open`/`closed`/`unknown`) — this call is both the heartbeat and the state feed (§3.5 rule 19.bis) |
| POST | `/public/v1/gate/requests/:id/result` | `{ status: "opened" \| "already_open" \| "refused" \| "error", detail? }` | `204` | Idempotent; a second call on a resolved request is a no-op |

The Sowel plugin holds `GATE_API_KEY`; **GuestFlow holds no Sowel credential at
all**. The only network rule this needs is one line letting VM 102 reach VM 104
(`IN ACCEPT -source 192.168.0.26 -p tcp -dport 4000` in `pve01/firewall/104.fw`)
— the trusted machine calling the exposed one, never the reverse.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS gate_accesses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL UNIQUE,
  code          TEXT,                      -- clear, nulled 7 days after the stay (§3.1 rule 3)
  codeHash      TEXT NOT NULL,
  codeSalt      TEXT NOT NULL,
  earlyOpenedAt TEXT,                      -- set by the SAS "ouvrir maintenant"
  revokedAt     TEXT,
  createdAt     TEXT DEFAULT (datetime('now')),
  lockedUntil   TEXT,                      -- brute-force lockout (§3.3 rule 12)
  failedCount   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gate_devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  accessId    INTEGER NOT NULL,
  deviceId    TEXT NOT NULL,               -- random id carried by the signed cookie
  firstSeenAt TEXT DEFAULT (datetime('now')),
  lastSeenAt  TEXT,
  ip          TEXT,
  userAgent   TEXT,
  UNIQUE (accessId, deviceId),
  FOREIGN KEY (accessId) REFERENCES gate_accesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gate_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  accessId    INTEGER NOT NULL,
  deviceId    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending|opened|refused|error|timeout
  detail      TEXT,
  requestedAt TEXT DEFAULT (datetime('now')),
  resolvedAt  TEXT,
  FOREIGN KEY (accessId) REFERENCES gate_accesses(id) ON DELETE CASCADE
);

-- One row (id = 1). What the Sowel poller last told us: its heartbeat and the
-- gate state it saw. Advisory only — never the basis of the pulse decision.
CREATE TABLE IF NOT EXISTS gate_runtime (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  gateState    TEXT NOT NULL DEFAULT 'unknown',   -- open|closed|unknown
  gateStateAt  TEXT,
  pollerSeenAt TEXT
);

CREATE TABLE IF NOT EXISTS gate_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  accessId  INTEGER,
  kind      TEXT NOT NULL,   -- code_ok|code_ko|open|refused|revoked|regenerated|shared
  reason    TEXT,
  ip        TEXT,
  userAgent TEXT,
  deviceId  TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gate_events_access ON gate_events(accessId, createdAt);
CREATE INDEX IF NOT EXISTS idx_gate_requests_status ON gate_requests(status, requestedAt);
```

**Data impact:** additive only. No existing table or column is modified, no
backfill. Existing reservations get an access the first time one is asked for.

## 6. UI / UX

### 6.0 Visual identity — the guest page belongs to the estate, not to the admin app

The page wears the **Domaine Solio** identity, the one the showcase site already
carries (`integrations/wordpress/solio-site/mu-plugins/gf-site-style.php`,
« forêt et heure dorée », 2026-09). It is copied, not re-invented:

| Token | Value | Use |
|---|---|---|
| `--gf-paper` | `#F5F0E6` | page ground |
| `--gf-card` | `#FDFAF3` | fields, panels |
| `--gf-ink` / `--gf-ink-soft` | `#22271F` / `#5C6153` | text |
| `--gf-sapin` | `#2E3B2A` | headings, outline buttons |
| `--gf-ocre` / `--gf-ocre-deep` | `#B87B2A` / `#9A6318` | the primary action, links, eyebrows |
| `--gf-nuit` | `#161C16` | the night register (site header and « band ciel ») |
| `--gf-line` | `#DCD4C2` | rules and borders |

- **Marcellus** for headings (uppercase, `letter-spacing: .06em`), **Karla** for
  everything else — **self-hosted woff2, the very files the site serves**
  (`/wp-content/uploads/fonts/`), never `fonts.googleapis.com`: the page must
  paint fast on cellular and owes nothing to a third party.
- The signature eyebrow (Karla 700, uppercase, `letter-spacing: .38em`, ocre) and
  the square-cornered ocre button (2 px radius, uppercase) come across as-is. The
  gate button keeps that skin at 4 rem tall.
- **The night register is not a new theme, it is the site's own.** Under
  `prefers-color-scheme: dark` the page moves to `--gf-nuit` with the header's
  gold (`#E8C286`) — the same pairing the site uses for its header and its
  « band ciel ». A gate is used at night; blinding the guest would be a bug.


**Guest page** (`xs` first — it will almost never be seen on anything else;
`md`/`lg` simply centre the same column at `max-width: 480px`):

- **Code form** (no session): the property photo, « Domaine Solio », one field
  in `text-transform: uppercase` with `inputmode: text`, the dash inserted as
  you type, one button. Error: « Code incorrect ou expiré. » — never more.
- **Unlocked**: « Bonjour Camille », the stay dates, a badge reading the real
  gate contact (**Portail ouvert** / **Portail fermé**), a full-width button
  « Ouvrir le portail » at least 64 px high, and under it « Votre accès est
  actif jusqu'au 14/09 à 11:00 » plus « Partager l'accès ».
- **Pressing**: the button becomes a 34 s progress bar, « Le portail s'ouvre… ».
  Then « Portail ouvert » or the error with the owner's phone number as a
  `tel:` link.
- **Before the window**: « Votre accès sera actif le 12/09 à 16:00 » with a live
  countdown. **After**: « Votre séjour est terminé. Merci de votre visite. »
- **Service down** (§3.5 rule 19): the button is disabled and greyed, with
  « Ouverture à distance indisponible — appelez le 06.15.73.93.37 »,
  the number being a `tel:` link.
- Installable: `manifest.webmanifest` + `apple-touch-icon`, with a discreet
  « Ajouter à l'écran d'accueil » hint on first visit.

**SAS step « Accès portail »**: the code in 2.6 rem type (same treatment the
`portalCode` step uses today), the QR beneath it, then the buttons.

**Fiche card**: `PageActionBar` unchanged; the card carries *Régénérer* (warning
colour, confirmation dialog: « le lien déjà envoyé cessera de fonctionner ») and
*Révoquer* (error colour).

## 7. Test plan

### Server unit tests
- [ ] `tests/gate-window.unit.test.js` — window from a reservation; +1 h after
      check-out; March/October DST transitions (rules 7, 8).
- [ ] `tests/gate-code.unit.test.js` — alphabet excludes I/L/O/U; normalization
      of dashes, spaces and case; hash/verify round-trip (rule 2).
- [ ] `tests/gate-session.unit.test.js` — wrong code → 401; before window → 403
      `NOT_YET_ACTIVE`; after → `EXPIRED`; revoked → `REVOKED`; cancelled
      reservation → no access (rules 6, 9, 11).
- [ ] `tests/gate-throttle.unit.test.js` — per-IP attempts, per-code lockout,
      per-access open ceiling (rule 12).
- [ ] `tests/gate-request-dedup.unit.test.js` — two presses within 10 s yield
      one request; the second press after resolution yields a new one (rule 17).
- [ ] `tests/gate-poller.unit.test.js` — long-poll returns immediately on a
      pending request, `null` at timeout; result callback is idempotent;
      heartbeat drives `service.available`; a `state` older than 60 s renders
      `unknown`, never `closed` (rules 18, 19, 19.bis).
- [ ] `tests/gate-host-guard.unit.test.js` — `/api/*` is 404 on the guest host;
      `/gate/v1/*` is 404 on the admin host (fail-closed).
- [ ] `tests/gate-devices.unit.test.js` — device registration, 7th device fires
      the push, no blocking (rule 15).
- [ ] `tests/gate-code-uniqueness.unit.test.js` — a new booking for a returning
      client mints a different code; the previous one stays dead; minting draws
      again on collision with a live access (rules 2.bis, 6.bis).
- [ ] `tests/gate-shared.unit.test.js` — two live accesses on two properties;
      a request while the contact is not closed resolves `already_open` with no
      pulse; requests are served FIFO; the gate-wide ceiling holds (rules 28-30).
- [ ] `tests/gate-session-swap.unit.test.js` — entering the Lodge code on a phone
      that held a Gîte session replaces it cleanly (rule 27).

### Manual UI verification
- [ ] Happy path: email link on an iPhone → unlocked → open → the gate moves.
- [ ] Permanent QR → code typed → same result; code remembered on reload.
- [ ] Share to a second phone; both work; both appear in the journal.
- [ ] Revoke while the guest page is open → the next press is refused.
- [ ] Stop the Sowel plugin → the button greys out within 60 s.
- [ ] Two lodgings occupied: the Gîte guest opens, the Lodge guest presses two
      seconds later → one pulse, and the second phone reads « déjà ouvert ».
- [ ] The page in the night register, screen brightness low, outdoors.
- [ ] Regression: the arrival SAS still completes end to end; the J-2 email
      still renders for a reservation with no access.

## 8. Out of scope

- **The Sowel plugin and the recipe** — their own repos, their own docs. This
  spec only fixes the contract (§4.3).
- **Any equipment other than the gate.** The contract carries no equipment id
  precisely so that widening it later is a Sowel-side decision, not a GuestFlow
  release.
- **A welcome-book page** (wifi code, house rules, breakfast time) — the data is
  in GuestFlow and the page is the obvious home for it, but not here.
- **SMS**, second factor, PIN — decided against on 2026-09-09.
- **Retiring `portalCode`** — the physical fallback stays until the remote path
  has run a full season.

## 9. Open questions

- Q: Which hostname for the guest page?
  - A (2026-09-09, Adrien): **`guest.domainesolio.com`** — a new Caddy host
    pointing at `192.168.0.24:4000`. The zone is already on Cloudflare and the
    edge token covers it, so the certificate is issued in DNS-01 like every
    other host. The `?c=` parameter is stripped from the access log
    (`format filter … request>uri query { delete c }`), exactly as ClimbContest
    does for its judge token.
  - **Consequence to handle in implementation:** it is a *separate origin* from
    the admin app, which is the point — but it is a **sibling of
    `guestflow.domainesolio.com` under the same registrable domain**. A host-only
    cookie on the guest host is never sent to the admin host, yet an XSS on the
    guest page could still *set* a `.domainesolio.com` cookie and shadow the
    admin session cookie (cookie tossing). The admin session cookie must
    therefore be renamed to a **`__Host-` prefixed** name, which browsers refuse
    to accept from a parent-domain writer. One-time cost: the operator is logged
    out once at deploy.
- Q: Which phone number does the failure state show?
  - A (2026-09-09, Adrien): **06.15.73.93.37**, rendered as a `tel:` link so one
    tap calls from the failure state and from the pre-arrival screen.
- Q: Does mobile data actually reach the spot where cars stop at the gate?
  - A (2026-09-09, Adrien): **yes — 5G in front of the gate.** The blocking
    unknown is closed and the GSM fallback is dropped from consideration. The
    physical `portalCode` still stays as the backup for a wider outage
    (§8).
