# Gate access v2 — Portier: pushed configuration, a secure channel, derived keys

| Field | Value |
|---|---|
| **Status** | Draft — **the HTML summary is what decides** (`specs/gate-access-portier.html`) |
| **Branch** | `spec/gate-access-portier` _(spec only — no code)_ |
| **Created** | 2026-09-14 |
| **Author** | Adrien |
| **Supersedes** | the transport, activation and code model of [guest-gate-access.md](guest-gate-access.md) (PR #547); absorbs [gate-access-list-and-manual-accesses.md](gate-access-list-and-manual-accesses.md) |

---

## 1. Context

PR #547 delivered gate access for guests with four properties the owner has now rejected
(2026-09-14, after reading the timeline in `docs/rapports/acces-portail-chronologie.html`):

- **Polling.** The house long-polls guestFlow every 25 s, day and night, and the guest page re-asks
  its state every 20 s and the fate of a command every second. The owner wants **a secure channel
  and push** instead.
- **Activation tied to guestFlow's own surfaces.** The access is minted lazily by the first email,
  fiche read or SAS visit, and lives in guestFlow's database. The owner wants a **separate
  application that keeps the list of accesses**: guestFlow *configures* an access in it when a
  reservation exists, and from then on that application manages it. No SAS step is needed.
- **A shared secret code as the credential.** Every command is authorised by a session cookie
  obtained with the stay code. The owner wants each gate command to carry **a security key derived
  from a master key**, verified against that master, and revocable on the server.
- **No install guidance and no brand.** The page never tells the guest they can install it, and its
  icon is not guestFlow's logo.

Three gaps found while drawing the timeline also land here: no notification is sent to the owner
past six devices; the page has no install invitation; an iPhone home-screen app may not share
Safari's storage.

## 2. Goal

A guest receives an access automatically when their reservation exists, installs a branded web app
from a guided page, and opens the gate with a signed request that reaches the house over a channel
the house holds open — while the owner keeps every access, stay or hand-made, in one application
where any key can be revoked at once.

## 3. Functional rules

> **Rules are bulleted, not numbered, while this spec is a draft.** In this repository numbering a
> rule commits a test that names it (`scripts/check-spec-coverage.mjs`), and nothing here is built.
> Numbers arrive with the tests. Refer to rules by section.

### 3.1 Portier — the application that keeps the list

- **Portier is a separate application**, its own repository, its own service. It is the single
  source of truth for accesses, devices, keys, the journal, and the gate commands. guestFlow no
  longer stores any gate data (§4.8 lists what leaves guestFlow).
- Portier serves three audiences on separate hostnames: the **guest web app**, the **owner's list**,
  and two machine interfaces — guestFlow's configuration API and the house channel (§4.2).
- Portier **opens no connection to anyone.** guestFlow calls it, the house calls it, the phones call
  it. It answers, and it pushes only down the channel the house has opened.

### 3.2 How an access comes to exist and changes

- **guestFlow pushes the access when the reservation exists**, whatever created it: the reservation
  form, an accepted devis, an iCal import, a confirmed online payment. The push carries the stay
  window already computed (check-in → check-out + 1 h, Europe/Paris, both DST transitions handled —
  the tested `gateWindow.js` stays in guestFlow), the lodging, the guest's first name and the
  reservation number.
- **From then on Portier manages it.** Exactly two things may change an access afterwards:
  - **a change of dates or times in guestFlow** → guestFlow pushes an update of the stay window;
  - **a manual change in Portier** → early opening, prolongation, time windows, suspension,
    regeneration, deletion.
- **A cancellation in guestFlow revokes the access** (also a deletion, and a reservation turned back
  into a devis). *Not in the owner's list of two — added because otherwise a cancelled stay keeps a
  working gate access. To confirm (§9).*
- **The two sources never overwrite each other.** guestFlow owns the stay window; Portier owns the
  manual overrides, stored in separate fields. The window in force is the **widest** of the stay
  window and the overrides, so a date change never cancels a promise made by hand.
- **A deletion in Portier is final for that reservation.** Later pushes from guestFlow for it are
  acknowledged and ignored; only « Recréer l'accès » in Portier brings it back.
- **Pushes are ordered and idempotent.** Each carries the reservation id and a revision that only
  grows; Portier applies a revision once and discards an older one arriving late.
- **No push is lost.** guestFlow writes every push to an outbox in the same transaction as the
  reservation change, and retries a failed one with back-off until Portier acknowledges it. Nothing
  runs while the outbox is empty.
- **guestFlow reads the invitation when it needs it** — to compose the J-7 and J-2 emails, to show
  the fiche — and never stores it. A regeneration in Portier therefore reaches the next email
  without any push back to guestFlow.
- The **arrival SAS no longer activates anything.** « Ouvrir l'accès maintenant » leaves the SAS;
  early opening is a manual change in Portier.

### 3.3 Keys

- **One master key, `K_master`, lives only in Portier**, in a secret file outside the database.
- **Every key is derived, none is stored.** An access key is `HMAC(K_master, access id + access
  generation)`; a device key is `HMAC(access key, device id)`; the dictable invitation code is
  derived from the access key and an invitation generation. A stolen database holds no key.
- **A gate command carries a signature, never the key.** The phone signs the access id, the device
  id, a timestamp and a nonce with its device key. Portier re-derives the device key from
  `K_master`, compares in constant time, refuses a timestamp outside ±2 min and a nonce already
  seen. Reading a thousand requests does not let anyone forge the next one.
- **Four levels of revocation**, each immediate:
  - **one device** — that phone stops, the rest of the family keeps working;
  - **the invitation** — no new phone can join; enrolled phones keep working;
  - **the access** — the access generation changes, so every device key and the invitation die;
  - **everything** — rotating `K_master` kills every key at once. Emergency only: every guest needs
    a new invitation.
- **The device key never leaves the phone after enrolment.** The page imports it as a
  non-extractable WebCrypto key and stores it in IndexedDB: the page can sign with it, no script can
  read it back.

### 3.4 The guest web app

- **Enrolment happens once per phone.** The link carries the invitation (`?i=` + code); the page
  exchanges it for a device key and removes it from the address bar. Typing the dictable code does
  the same. A wrong code answers 401; 5 attempts per 10 minutes per address.
- **Sharing is enrolment by another phone.** The shared link lets a relative's phone enrol its own
  device, so it can be revoked on its own.
- **The state is checked only in the foreground**: once when the app starts, and again each time it
  comes back to the foreground. No timer runs, and nothing happens in the background.
- **A command is one request and one answer.** The slide sends a signed request; Portier pushes the
  pulse down the house channel and answers the same request with the outcome — `opened`, `refused`,
  `error` — within 8 s, or at once with « maison injoignable » when the channel is down. The page
  never asks twice.
- Unchanged from #547: slide-to-confirm (« Glisser pour actionner »), no gate state shown to the
  guest, silence on success, a message and the phone number on failure.

### 3.5 Installing the app

- **The page invites to install and explains how**, for the platform it runs on: iPhone (Safari →
  Partager → « Sur l'écran d'accueil »), Android (an « Installer » button when the browser offers
  it, the menu otherwise), anything else (the browser menu). The invitation never shows once the app
  runs installed.
- **Installing never blocks opening.** A guest can enrol and open from the browser first; the
  invitation is a card, not a wall.
- **The installed app may not share the browser's storage** (iPhone). The invitation therefore shows
  the dictable code with « Copier » before sending the guest to the home screen, and an installed app
  with no key opens on the code form.

### 3.6 The icon and the brand

- **The app's icon is guestFlow's logo.** guestFlow pushes it to Portier when the logo changes in its
  settings, and once when Portier is first paired.
- **Portier has a setting that can override it**: « Logo de guestFlow (synchronisé) » or « Logo
  personnalisé ». Portier generates the icon sizes (180, 192, 512, maskable) from the chosen image.
- An installed icon is frozen at install time on iPhone. The logo must be set before the first guest
  installs; the setting says so.

### 3.7 The house

- **The house opens the channel and keeps it open**: a WebSocket over TLS from the Sowel plugin to
  Portier, authenticated by a challenge on connection and a signature on every frame (§4.3).
- **Portier pushes commands down it; the house pushes back results and the gate state.**
- **The house keeps its own brakes**, independent of Portier: the recipe's arm switch, a ceiling of
  pulses per hour, and a journal of every command it executed.

### 3.8 The owner's list

- Everything validated in the mockups of 2026-09-14 moves into Portier unchanged: stay and manual
  accesses, edit dates and hours, widest window, daily time windows, suspend, regenerate, delete,
  finished stays under their own filter, no 90-day surfacing.
- **Devices become visible and revocable one by one** on each access.
- **Past six devices on one access, Portier notifies the owner** (web push to the owner's browser),
  closing the gap found in #547.

**Edge cases:**
- Portier down when guestFlow saves a reservation → the push waits in the outbox; the reservation is
  saved normally.
- Portier down at 08:00 when the J-7 email is composed → the email waits rather than leaving
  without its link (§9).
- A guest's phone restored from backup or cleared → no key; the invitation link or code enrols it
  again as a new device.
- The house channel drops during a command → the request answers « maison injoignable »; nothing
  is queued for later, so the gate never moves minutes after the guest gave up.
- A date change pushed for an access deleted in Portier → acknowledged, ignored, journalled.

---

## 4. Architecture

### 4.1 Components and who opens which connection

| From → to | Opened by | Transport | Carries |
|---|---|---|---|
| guestFlow → Portier | guestFlow | HTTPS request, public name via edge | stay upserts and cancellations (push), invitation reads, logo |
| House → Portier | the house | **WebSocket over TLS, held open** | Portier pushes commands; the house pushes results and gate state |
| Phone → Portier | the phone | HTTPS | enrolment, foreground state check, signed commands |
| Owner → Portier | the owner's browser | HTTPS + session | the list, the settings |
| Portier → anyone | **nobody** | — | Portier only answers, and pushes down the house's channel |
| guestFlow → house | **impossible** | — | VM 104 keeps `OUT DROP` to the LAN |

**Where Portier runs.** A new LXC on pve01 with the firewall profile of VM 104 — reachable from edge,
`OUT DROP` to `192.168.0.0/24` — so a compromise of the exposed Portier gives no foothold in the
LAN. Co-hosting it on VM 104 is cheaper and shares guestFlow's blast radius (§9).

**Hostnames**, through edge's Caddy:
- `guest.domainesolio.com` → guest routes only (the web app, enrolment, state, commands);
- `portier.adn-dev.fr` → the owner's list, `/api/v1` for guestFlow, `/house/v1` for the channel.

guestFlow reaches `portier.adn-dev.fr` by its public name, as the Sowel plugin reaches guestFlow
today: the Freebox hairpin, no new firewall rule.

**What is periodic, said plainly.** Three things run on a clock, none of them asks for data:
WebSocket ping/pong every 30 s on the house channel (without it a line silently cut by a NAT
timeout would look alive for hours), the outbox retry *only while a push is failing*, and the daily
purge.

### 4.2 guestFlow → Portier: the configuration API

Authentication: a key identifying guestFlow (`Authorization: Bearer`) **and** a signature
`X-Portier-Signature = HMAC(K_gf, method | path | timestamp | sha256(body))` with
`X-Portier-Timestamp` (±2 min). `K_gf` never travels. The key is **scoped**: it can create, update
and cancel `stay` accesses and read their invitations — it cannot open the gate, read device keys,
or touch manual accesses.

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| PUT | `/api/v1/stays/{reservationId}` | `{ revision, startsAt, endsAt, checkInLabel, checkOutLabel, propertyName, guestFirstName, reservationNumber }` | `{ applied \| stale \| ignored_deleted, accessId }` | idempotent upsert; `revision` must grow |
| DELETE | `/api/v1/stays/{reservationId}` | `{ revision, reason: cancelled \| deleted \| devis }` | `{ applied \| stale }` | revokes; the row stays for the journal |
| GET | `/api/v1/stays/{reservationId}/invitation` | — | `{ url, code, state, window }` or `404` | read at need, never stored by guestFlow |
| PUT | `/api/v1/branding` | `{ name, logo: base64, mime, updatedAt }` | `{ applied }` | ignored while Portier is set to a custom logo |

**Policy bound on guestFlow's pushes**: a stay window longer than 60 days, or starting more than
18 months ahead, is refused and journalled. A compromised guestFlow can still create stay accesses;
it cannot create unbounded ones, and each is tagged « guestFlow » in the list.

### 4.3 House ↔ Portier: the channel

- **Opening.** The Sowel plugin connects to `wss://portier.adn-dev.fr/house/v1`. Portier sends
  `{ type: "challenge", nonce, ts }`; the house answers `HMAC(K_house, nonce | ts)`. No valid answer
  in 5 s → closed. Only one house connection at a time; a new valid one replaces the old.
- **Every frame is signed** — `{ seq, ts, type, payload, sig = HMAC(K_house, seq|ts|type|payload) }`
  — with a sequence number per direction that must grow. A replayed or reordered frame is dropped
  and journalled.
- **Frames Portier → house:** `pulse { commandId, accessLabel, deadline }`.
- **Frames house → Portier:** `result { commandId, status: opened | refused | error, detail }`,
  `gate_state { state, at }`, `hello { pluginVersion, armed }`.
- **A pulse past its deadline is not executed** (deadline = sent + 8 s). A command either happens
  while the guest waits, or not at all.
- **Liveness:** WebSocket ping every 30 s from Portier; no pong in 10 s → the channel is declared
  down, commands answer « maison injoignable » at once. The house reconnects with back-off (1 s → 60 s).
- **House-side brakes:** the plugin refuses more than 30 pulses per hour whatever Portier says; the
  recipe's arm switch still refuses everything when off.

### 4.4 Phone → Portier: the guest API

| Method | Endpoint | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/enrol` | invitation code | `{ code }` | `{ accessId, deviceId, deviceKey (base64, once), stay }` or `401` |
| GET | `/v1/state` | signed | — | `{ access: active \| before \| after \| suspended \| revoked, device: ok \| revoked, house: up \| down, stay }` |
| POST | `/v1/open` | signed | — | `{ status: opened \| refused \| error \| unreachable \| outside_window \| too_many }` — answered within 8 s |

Signed requests carry `X-Access`, `X-Device`, `X-Ts`, `X-Nonce` and
`X-Sig = HMAC(K_device, method | path | accessId | deviceId | ts | nonce)`. Nonces are remembered
10 minutes. The throttles of #547 stay: 5 enrolments per 10 min per IP, 12 opens per hour per access,
30 per hour for the gate, duplicates within 2 s collapse into one command.

### 4.5 The key derivation

```
K_access  = HMAC-SHA256(K_master, "access|"  + accessId + "|" + accessGen)
K_device  = HMAC-SHA256(K_access, "device|"  + deviceId)
invite    = base32nopad(HMAC-SHA256(K_access, "invite|" + inviteGen))[0..8]   // alphabet without I/L/O/U
```

- Verification of a typed code scans the live accesses (a few dozen) and compares derived codes in
  constant time — the same candidate scan as #547.
- `accessGen` and `inviteGen` are integers on the access row; `deviceId` is random (128 bits).
- `K_master` rotation: a new master with an id; access rows record the master id they were derived
  under; rotating re-derives nothing and simply makes every old key fail.

### 4.6 guestFlow side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `portierClient.js` | C | Signed HTTPS calls to Portier |
| `utils/` | `portierSync.js` | C | `schedulePush(reservationId)` / `scheduleCancel(reservationId, reason)` → outbox; drain with back-off |
| `models/` | `portierOutboxModel.js` | C | The outbox rows |
| `controllers/` | `reservationsController.js` | T | create (≈l.853), update (≈l.1187), remove (≈l.1405) call `portierSync` beside `googleCalendarSync` |
| `controllers/` | `devisController.js`, `reservationCancellationController.js` | T | same hooks as Google Calendar |
| `models/` | `propertyIcalModel.js` | T | pushes the stays an import created or moved |
| `utils/` | `paymentPollRunner.js` | T | pushes a stay confirmed by payment |
| `utils/` | `emailAutoSendRunner.js`, `reservationEmailSender.js`, `controllers/emailsController.js` | T | read the invitation from Portier instead of `buildGateAccessCard` |
| `controllers/` | `settingsController.js` | T | pushes the logo on upload |
| `utils/` | `gateWindow.js` | kept | computes the window sent to Portier |

Hooks mirror `googleCalendarSync` exactly, **with one difference**: Google Calendar is
fire-and-forget corrected by a periodic reconcile; a gate access cannot wait for a reconcile, so
Portier pushes go through a durable outbox instead.

### 4.7 Sowel side

- **`sowel-plugin-guest-access` v1.0**: the long-poll is replaced by the WebSocket client of §4.3.
  It keeps its device (`requests` counter, `last_stay`, `link`) and its orders (`result`,
  `gate_state`), so **the recipe does not change**.
- **`sowel-recipe-guest-gate`**: unchanged.

### 4.8 What happens to PR #547

| Kept, moved into Portier | Removed from guestFlow | Added to guestFlow |
|---|---|---|
| `gateCode.js` alphabet, the guest page (slide, no state), `gateWindow.js` tests, host separation, the throttles | `gate_*` tables, `/gate/v1/*`, `/public/v1/gate/*`, `gateQueue` long-poll, `GATE_API_KEY` / `GATE_SIGNING_SECRET`, the SAS early-open | `portierSync` + outbox, invitation reads, logo push, settings « Portier » (URL + keys) |

**Recommendation: do not merge #547 as it stands.** Most of what it adds would be removed by this
spec. Its reusable pieces move with it (§9).

---

## 5. Data model (Portier, SQLite)

| Table | Columns | Notes |
|---|---|---|
| `accesses` | `id, kind (stay\|manual), label, reservationId UNIQUE NULL, reservationNumber, propertyName, stayStartsAt, stayEndsAt, stayRevision, validFrom, validUntil, earlyFrom, extendedUntil, timeWindows JSON, accessGen, inviteGen, masterId, suspendedAt, revokedAt, cancelledAt, deletedAt, createdBy, createdAt, updatedAt` | `stay*` written only by guestFlow; overrides only by the owner; `deletedAt` is the tombstone that makes later pushes ignored |
| `devices` | `id, accessId, deviceId UNIQUE, userAgent, firstSeenAt, lastSeenAt, revokedAt` | no key column — keys are derived |
| `events` | `id, accessId NULL, deviceId NULL, kind, reason, source (guest\|owner\|guestflow\|house), ip, at` | no foreign key: the journal outlives deletions |
| `commands` | `id, accessId, deviceId, status, requestedAt, sentAt, resolvedAt, detail` | one row per slide |
| `house_link` | `id=1, connectedAt, lastPongAt, pluginVersion, armed, gateState, gateStateAt, lastSeqIn, lastSeqOut` | |
| `branding` | `id=1, source (guestflow\|custom), logoPath, mime, updatedAt` | icons generated on write |
| `owner_push_subscriptions` | `id, endpoint, keys, createdAt` | the notification past 6 devices |

Secrets are files, never rows: `K_master` (with its id), `K_house`, `K_gf`, the owner session secret.

**guestFlow:** one new table, `portier_outbox (id, reservationId, type (upsert\|cancel\|branding), payload JSON, revision, attempts, nextAttemptAt, lastError, createdAt, ackedAt)`.
The `gate_*` tables of #547 are never created in production if #547 is not merged.

## 6. UI / UX

Shown interactively in `specs/gate-access-portier.html`; strings in French.

- **Guest, first visit from the link**: « Bonjour Camille », the stay, the slider — and under it a card
  « Installer l'application » with the steps for the detected platform and the code with « Copier ».
  « Plus tard » folds the card for the session.
- **Guest, installed app with no key**: « Saisissez votre code d'accès » (the card said to copy it),
  one field, the dash inserted as you type. Wrong code: « Code incorrect ou expiré. »
- **Guest, installed app ready**: the slider screen of #547, no card, no gate state.
- **Foreground**: nothing visible changes; a state change found on return (revoked, finished) swaps
  the screen.
- **Owner, Portier → Réglages → Application des clients**: the logo source (synchronised / custom
  with an upload), the preview of the icon on a home screen, and the warning that an icon already
  installed on an iPhone does not change.
- **Owner, the list**: the mockups of 2026-09-14 unchanged, plus a « Téléphones » line per access
  where each device can be revoked.
- Responsive: the guest app is `xs`-first (a phone at a gate); the owner's list follows the table →
  cards swap of guestFlow.

## 7. Test plan

### Portier unit tests
- [ ] derivation: same inputs → same keys; a different generation, device or master → different keys
- [ ] a signature with a tampered path, access, device, timestamp or nonce is refused; a replayed nonce is refused
- [ ] each revocation level kills exactly what it should, and nothing else
- [ ] upsert ordering: a stale revision is ignored; a deleted access ignores later upserts; widest window with overrides
- [ ] house channel: a bad challenge answer closes; a reordered or replayed frame is dropped; a pulse past its deadline is not sent; no pong → down → `unreachable` at once
- [ ] guestFlow key scope: cannot open, cannot read devices, cannot touch a manual access; policy bounds on windows

### guestFlow unit tests
- [ ] every hook (create, update, devis accepted, iCal import, payment, cancellation, deletion) writes an outbox row in the same transaction
- [ ] the outbox drains in order per reservation, backs off on failure, stops when empty
- [ ] the J-7 email reads the invitation; Portier down → the email waits

### Manual verification
- [ ] Two phones, one stay: enrol by link, enrol the second by shared link, revoke one device, the other still opens
- [ ] iPhone: open the link in Safari, install, launch the icon — code form or ready, both acceptable, never a dead end
- [ ] Android: « Installer » button appears and installs with guestFlow's logo
- [ ] Unplug the house: the next slide answers « maison injoignable » immediately; replug: the channel is back within a minute
- [ ] Change the dates of a reservation in guestFlow: the list in Portier shows the new window within seconds

## 8. Out of scope

- Native apps (App Store / Play Store). The web app is the app.
- Bluetooth or NFC opening at the gate.
- Changing the gate hardware, the LoRa bridge signature, or the recipe.
- Days of the week on time windows (confirmed 2026-09-14).
- Moving guestFlow's own push notifications to Portier.

## 9. Open questions

- Q: The name « Portier » for the application that keeps the list?
  - A: —
- Q: A cancellation (and a deletion, or a stay turned back into a devis) revokes the access — the owner listed only date changes and manual changes. Confirm?
  - A: —
- Q: The owner's list reachable from anywhere (login + second factor, like any exposed admin) or from the house network only?
  - A: —
- Q: Portier on its own LXC (recommended) or co-hosted on VM 104?
  - A: —
- Q: Portier unreachable when the J-7 email is composed: the email waits (recommended) or leaves without the gate paragraph?
  - A: —
- Q: The arrival SAS: keep a read-only display of the code for a guest who lost the email, or remove the step?
  - A: —
- Q: One key per device (recommended: a lost phone is revoked alone) or one key per access?
  - A: —
- Q: PR #547: close it and carry its reusable pieces into Portier (recommended), or merge the reusable utilities first?
  - A: —
