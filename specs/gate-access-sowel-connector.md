# Gate keys — guestFlow's part: a list of keys for Sowel, and the outcomes it reports back

| Field | Value |
|---|---|
| **Status** | Implemented (2026-09-27) |
| **Branch** | `feature/gate-keys-sowel` |
| **Created** | 2026-09-20, rewritten 2026-09-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Supersedes** | PR #563 (`claude/sowel-guestflow-connector-y0df44`): its stay **feed** (`GET /stays` with revisions and a cursor, the `gate_stay_feed` table, its reconciler and its purge) and its `POST /invitations`. What #563 got right is kept as it was: the signed channel, the window computation, the email tokens, the SAS step with its QR, the fiche card and the settings card |
| **Wire contract** | « guestFlow ↔ Sowel gate keys — wire contract (v1) », implemented on the Sowel side by the `guestflow` plugin. §4.3 below is guestFlow's copy of it |

## 0. The feature at a glance

A guest of the gîte or the lodge opens the gate from their phone, for their stay only. The keys
live in **Sowel** (its native shared access): Sowel creates them, holds their codes, opens the gate,
and keeps working if guestFlow is stopped. guestFlow knows **who arrives and when**.

| Connection | Opened by | Carries |
|---|---|---|
| Sowel → guestFlow `GET /public/v1/gate/keys` | **Sowel**, hourly | the keys to create or revoke |
| Sowel → guestFlow `POST /public/v1/gate/results` | **Sowel**, after each read | the outcome of every key: code and link, or the error |
| guestFlow → Sowel | **nobody** | guestFlow holds no credential over the house and opens nothing towards it |

**Why not #563's feed.** A feed with revisions and a cursor makes the consumer responsible for
never missing a page, and guestFlow responsible for a table that only grows, a reconciler and a
purge. A **list of the keys that should exist right now** is idempotent by construction: Sowel reads
it whole every hour and applies it, a missed hour costs nothing, and there is nothing to purge.

---

## 1. Context

PR #563 (2026-09-20) gave guestFlow a stay feed and a copy of the invitations pushed by a Sowel
plugin. It was never merged, and the Sowel side has since moved: shared access became native in
Sowel's core, and the plugin was reduced to a connector (`guestflow`) that upserts or revokes a key
per stay. A feed with a cursor is more than such a connector needs, and it drifted 60 commits behind
`master`.

A second need appeared: **when a key cannot be created, somebody has to know**. With #563 an error
on the Sowel side (the default profile not granted to the plugin, a profile listing no gate…) only
showed in Sowel's logs, and the operator discovered it when a guest stood in front of a closed gate.

## 2. Goal

guestFlow tells Sowel which gate keys should exist, shows the code and the link Sowel made for each
stay wherever a guest needs them, and warns every admin — on the dashboard and on their phone — when
a key could not be made or when Sowel stopped asking.

## 3. Functional rules

### 3.1 The list of keys

1. **The house pulls, guestFlow never pushes.** Sowel reads `GET /public/v1/gate/keys` and posts
   `POST /public/v1/gate/results`; guestFlow knows no address of the house and holds no credential
   over it.
   > **Sans test** — architectural: there is no outbound call to test, the property is that no code
   > in guestFlow knows where the house is.
2. **`create`**: a live stay (a reservation that is neither cancelled nor deleted, never a devis)
   whose `endsAt` is after now and whose `startsAt` is at most **7 days** ahead. A stay booked less
   than 7 days ahead is in the list at once, at the next read.
3. **A stay that may already hold a key stays listed** as `create` with its **current** dates, even
   when they moved more than 7 days ahead: changing the dates of a stay already created simply lists
   it again with its new dates, and Sowel moves the key. Otherwise a key would keep opening on the
   old dates.
4. **The window**: `startsAt` = arrival date + the reservation's `checkInTime`; `endsAt` = departure
   date + `checkOutTime` + 1 h. Both are **Europe/Paris wall clock**, converted to UTC ISO, across
   both DST transitions (`gateWindow.js`, taken from #547 with its tests).
5. **The label** is short and human, with no family name: `property name · reservation number ·
   guest first name` (« Gîte · R-2026-041 · Marie »). A family name has no business on an equipment
   that opens a gate.
6. **`revoke`**: a cancelled or deleted stay for which guestFlow holds a result that is **not already
   a successful revoke** (i.e. a key may exist in Sowel), and whose `endsAt` is after now. A deleted
   stay is revoked with the window stored with its last result. A cancelled stay guestFlow holds no
   result for is never listed: no key can exist for it.
7. **An ended stay is never listed**, neither to create nor to revoke: its key expires on its own
   `endsAt`.
8. **Every successful read records `lastReadAt`**. A refused call (bad key, bad signature, stale
   timestamp) records nothing.

### 3.2 The results

9. guestFlow keeps **the latest result per reservation**: each one replaces the previous. The window
   and the label listed with a key are kept on the row, so a reservation deleted afterwards can still
   be revoked (rule 6).
10. **The code and the link are opaque.** They are stored and shown as Sowel handed them — guestFlow
    never builds, parses or rewrites a link. `code` may be null (a profile without a code), `url`
    may be null (Sowel has no public address).
11. The request carries at most **500** results: `400` without `results[]`, `413` above 500. An entry
    that cannot be filed (no positive `reservationId`, an `action` other than `create`/`revoke`, no
    boolean `ok`) is skipped; the answer is `{ stored: <n> }`, the entries actually filed.
12. **Posting the same results again changes nothing** but their reception time, and sends no second
    push: Sowel posts a result for every key of the list at every read.

### 3.3 The alerts

13. **A failed result is a dashboard alert** — number, first name and reason — until a success
    replaces it or the stay ends.
14. **A failed result is a Web Push to every active admin**, with no preference to opt in: these are
    faults to fix, not news. Once per reservation and error; again only if the error changes; a later
    success clears it, so a failure coming back afterwards pushes again.
15. **The push is short and in French.** Title « Clé portail non créée » (« … non révoquée » for a
    revoke); body `R-2026-041 · Marie — <reason>`, the reason being Sowel's error code in words
    (`unknown_profile` → « le profil par défaut n'est pas accordé au plugin », …). An unknown code
    shows Sowel's message instead.
16. **The dashboard alert is the admins'.** The reception role never sees it (its allowlist does
    not list the endpoint), and it renders nothing when there is nothing to say.
17. **« Not read for more than 3 h »**: an hourly pass checks `lastReadAt`. When Sowel has read the
    list at least once and not for more than 3 hours, the dashboard shows a warning and every admin
    is pushed **once**. A guestFlow that was never read raises nothing — the connector is simply not
    set up yet.
18. **A read clears it**: the warning disappears, and the next time Sowel stops, the admins are
    pushed again.

### 3.4 The channel

19. Every call carries **a key** (`Authorization: Bearer <GATE_API_KEY>`) *and* **a signature**:
    `X-Gate-Timestamp` (unix ms) and `X-Gate-Signature` = hex HMAC-SHA256(`GATE_SIGNING_SECRET`,
    `METHOD \n originalUrl \n timestamp \n sha256hex(rawBody)`), the raw body being empty for a GET.
    The key proves the caller; the signature proves the call, and its secret never travels.
20. **The key is distinct from `PUBLIC_API_KEY`**: the WordPress proxy's key has no business reading
    who sleeps here tonight, nor reporting a gate key.
21. **We fail closed**: without either secret, everything is refused (`401`). A timestamp more than
    ± 2 minutes off, too.
22. Both secrets are **auto-generated in `server/.env.local`** at startup, **never logged**, and
    **never returned by an API** — the operator reads them there, like the site's key.

### 3.5 What guestFlow shows

23. **The emails** have `{{gateAccessCode}}`, `{{gateAccessUrl}}` and the flag
    `{{#if hasGateAccess}}`, from the stored successful result: **composing an email never reaches
    the house and waits for nothing**. With no usable key the paragraph is skipped and the email
    leaves. A code alone or a link alone is enough for the flag.
24. **The SAS** keeps its « Portail » step: the code in large type and a QR of the very link the
    email carries — flashing it installs the key with nothing to type. The QR stays on screen: never
    on a PDF, never attached to an email, never logged.
25. **The SAS activates nothing.** With no usable key, the gate keypad's code (Réglages) stays there,
    to dictate.
26. **The fiche** carries a compact read-only card: the state, the window, the code and the link —
    or « Échec » with the reason when Sowel could not make the key. It renders nothing when guestFlow
    holds no result, and points at Sowel for every action.
27. **Reception reads** the key (it runs the SAS). It can change nothing — nobody can from here.
28. A revoked, ended or gateless (`no_gate`) key, or a failed one, is **never shown as usable**:
    printing a dead code is worse than printing nothing.

### 3.6 The settings

29. **Réglages → Intégrations** carries one read-only card: are both secrets configured, when Sowel
    last read the list, how many keys it reports as created — and where the two secrets live
    (`server/.env.local`, `GATE_API_KEY` and `GATE_SIGNING_SECRET`), never their values.

**Edge cases:**
- Sowel is stopped → the emails leave with the last known code, the SAS shows what it has; 3 hours
  after the last read the admins are warned (rule 17).
- A stay created then cancelled before Sowel's first read → it never appears: no key was made.
- A stay cancelled after its key was made → listed as `revoke` until Sowel reports the revoke.
- A cancelled stay reinstated → it is live again: listed as `create`, Sowel recreates the key.
- A failure for a stay that has since ended → it leaves the dashboard (rule 13); no push.
- The same failure every hour → one push (rule 14).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `gateWindow.js` | C (from #563) | A stay's window, Paris wall clock, DST-safe |
| `utils/` | `gateKeys.js` | C | The list of keys (rules 2-7), the label, the French reasons, « is Sowel late » |
| `utils/` | `gateResults.js` | C | Files the results, pushes the admins once per error, the stale-read pass, the dashboard payload |
| `utils/` | `gateInvitationView.js` | C (from #563, rewritten) | What the email, the SAS and the fiche show of the stored result |
| `models/` | `gateKeysModel.js` | C | `gate_key_results`, `gate_connector_state`, the stays around now, the admins |
| `middleware/` | `requireGateConnector.js` | C (from #563) | Key + signature + freshness, failing closed |
| `controllers/` | `gateConnectorController.js` | C | `keys`, `results`, `ping`, the dashboard and settings reads |
| `routes/public/` | `gate.js` | C | The `/public/v1/gate` tree, **beside** the public tree |
| `routes/` | `dashboard.js`, `settings.js` | T | `GET /api/dashboard/gate-keys`, `GET /api/settings/gate-connector` |
| `controllers/` | `reservationsController.js` | T | `GET /reservations/:id/gate-access` (card + SAS step) |
| `controllers/` | `sasController.js` | T | `gateAccess.available` in the SAS payload |
| `utils/` | `emailContextBuilder.js` | T | `gateAccessCode`, `gateAccessUrl`, `hasGateAccess` |
| `utils/` | `emailAutoSendRunner.js`, `reservationEmailSender.js`, `guestEmailSequenceRunner.js` | T | Pass the stored key into the context |
| `controllers/` | `emailsController.js` | T | Same, on its three compositions |
| `middleware/` | `enforceRoleAccess.js` | T | Reception reads `/reservations/:id/gate-access` |
| `scheduledTasks.js` | — | T | The hourly stale-read pass |
| `schema.sql` | — | T | `gate_key_results`, `gate_connector_state` |
| `index.js` | — | T | Both secrets, and mounting the tree |

**No reservation write path is touched**: the list is computed on read from the reservations as they
stand, so a hand-made fix, an iCal import or a restore is seen like everything else.

**New dependency:** `qrcode` (the SAS's QR, rendered on demand, never stored).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `GateKeysAlert.jsx` | C | Dashboard alert: failed keys and a Sowel that stopped reading |
| `pages/` | `Dashboard.jsx` | T | Mounts it with the other admin alerts |
| `components/sas/` | `SasGateAccessStep.jsx` | C (from #563) | The step: code, QR, window, fallback to the keypad code |
| `components/sas/` | `ReservationSasDialog.jsx` | T | Mounts the step in place of the bare code |
| `components/` | `GateAccessCard.jsx` | C (from #563) | The fiche's card |
| `components/` | `SettingsGateAccessSection.jsx` | C (from #563) | The connector's state |
| `pages/settings/` | `IntegrationsSettingsPage.jsx` | T | Mounts it (the settings were split per page on `master`) |
| `pages/` | `ReservationPage.jsx`, `EmailTemplatesPage.jsx` | T | The fiche card + the two tokens and the condition in the editor |
| `api.js` | — | T | `getReservationGateAccess`, `getGateConnector`, `getGateKeysAlerts` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `SummaryItem` | Pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `GateKeysAlert`, `SasGateAccessStep`, `GateAccessCard`, `SettingsGateAccessSection` | Each only makes sense in its own screen. `GateKeysAlert` follows the dashboard alerts' own pattern (`TariffRecipeRunsAlert`). |

### 4.3 API contract

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/public/v1/gate/keys` | — | `{ now, keys[] }` | `keys[]` = `{ reservationId (string), action: "create"\|"revoke", label, startsAt, endsAt }`; stamps `lastReadAt` |
| POST | `/public/v1/gate/results` | `{ results[] }` | `{ stored }` | `results[]` = `{ reservationId, action, ok, state?, code?, url?, error?, message? }`; 400 without the list, 413 past 500 |
| GET | `/public/v1/gate/ping` | — | `{ ok, now }` | Checks key, signature and clock in one call |
| GET | `/api/dashboard/gate-keys` | — | `{ failures[], stale, lastReadAt }` | Admin; `failures[]` = `{ reservationId, reservationNumber, guestFirstName, name, action, title, reason, exists }` |
| GET | `/api/reservations/:id/gate-access` | — | `{ card, sas }` | Session; a read for reception |
| GET | `/api/settings/gate-connector` | — | `{ configured, lastReadAt, keysCreated, secretsFile, secretNames }` | Admin; no secret value |

`state` is Sowel's access status (`live | outside_hours | not_yet | ended | suspended | revoked |
no_gate`); `error` is one of Sowel's codes (`disabled`, `unknown_profile`, `profile_incomplete`,
`no_end`, `outside_profile`, `invalid_date`, `label_required`, `internal_error`). The three
`/public/v1/gate/*` routes refuse anything unsigned (§3.4) with the public tree's error envelope.

---

## 5. Data model

| Table | Columns |
|---|---|
| `gate_key_results` | `reservationId` (PK, no FK — it must outlive a deleted reservation), `action`, `ok`, `state`, `code`, `url`, `error`, `message`, `label`, `startsAt`, `endsAt`, `receivedAt`, `alertedError` (the error the admins were last pushed about) |
| `gate_connector_state` | one row (`id = 1`): `lastReadAt`, `staleAlertedAt` |

Both tables are created empty by `schema.sql` and touch no existing data. **Data impact:** none;
dropping both would return guestFlow to its previous state. #563's `gate_stay_feed` and
`gate_invitations` were never on `master` and are not created.

## 6. UI / UX

| Surface | Content |
|---|---|
| **Dashboard** | « Clés portail » alert (warning): one row per failed key — « R-2026-041 · Marie — Clé portail non créée » and the reason under it; a click opens the reservation. A row « Sowel ne lit plus les clés depuis le … » when rule 17 holds. Nothing otherwise |
| **SAS, « Portail » step** | « Flashez pour installer l'accès au portail », the QR, the code under it, the window; the keypad code as a fallback |
| **Fiche** | « Accès portail » card: state badge, code, validity, link — or « Échec » and the reason; the sentence pointing at Sowel |
| **Réglages → Intégrations** | « Accès portail (Sowel) » card: configured or not, last read, keys created, where the secrets live |
| **Email editor** | Two tokens (`Code portail`, `Lien portail`) and one condition (`Si accès portail`) |

Strings in French. Responsive: every surface is a `Stack`/`SummaryItem` layout that stacks on `xs`;
the alert rows are full-width tap targets of at least 44 px; the QR is 220 px and never below 180 px;
nothing overflows horizontally.

**Action bar:** no new page — every surface is a card inside a page that already has its bar.

## 7. Test plan

### Server unit tests
- [x] `gate-keys-list.unit.test.js` — J-7 boundary, booked late, dates moved after a key, cancelled
      with and without a result, deleted, ended, devis, label, the read stamp
- [x] `gate-key-results.unit.test.js` — validation (400/413/skips), latest result wins, window kept
      for a deleted stay, one push per error, a new error pushes, a success clears, admins only,
      French texts, the stale-read pass and its clearing, the dashboard payload
- [x] `gate-key-view.unit.test.js` — usable or not per state, opaque link, the fiche card (failure
      included), the SAS step and its QR, missing table
- [x] `gate-connector-auth.unit.test.js` (from #563) — signature vectors, failing closed, wrong key,
      wrong secret, replay, query or body altered in flight, the site's key
- [x] `gate-email-tokens.unit.test.js` (from #563) — tokens present, absent, code alone, link alone
- [x] `gate-reception-read.unit.test.js` (from #563) — reception reads the key, never writes; the
      dashboard alert stays the admins'
- [x] `gate-connector-settings.unit.test.js` — the settings card, no secret value
- [x] `gate-window.unit.test.js` (from #547) — both DST transitions

### Client unit tests
- [x] `GateKeysAlert.test.jsx` — nothing to say, a failure row, the stale row, a silent server
- [x] `GateAccessCard.test.jsx`, `SasGateAccessStep.test.jsx`, `SettingsGateAccessSection.test.jsx`
      (from #563, adapted)

### Manual verification
- [ ] Paste both secrets into Sowel's `guestflow` plugin: the keys of the next 7 days appear in Sowel
- [ ] Revoke the default profile's grant: the dashboard lists the failures and the admins' phones ring once
- [ ] Stop Sowel for 3 hours: the dashboard warns and the phones ring once; start it: the warning goes
- [ ] Flash the SAS's QR with a phone: the key installs with nothing typed

## 8. Out of scope

- Any action on a key from guestFlow. Holding, extending, revoking, regenerating: Sowel.
- A push preference for these alerts: they go to every admin, always (rule 14).
- Sending the key by SMS.
- The global `portalCode` setting, which stays as it is while the physical keypad exists.

## 9. Questions settled

- Q: a feed with a cursor, or the list of the keys that should exist now?
  - A (2026-09-27, Adrien): **the list**, read hourly by the Sowel plugin, which posts every outcome
    back. It supersedes #563's feed.
- Q: who is told when a key cannot be made?
  - A (2026-09-27, Adrien): **every admin**, on the dashboard and by Web Push, once per error.
- Q: a stay whose dates move beyond 7 days after its key was made?
  - A (2026-09-27): it stays listed with its new dates (rule 3) — the wire contract says a stay
    whose dates change is « simply listed again with its new dates », and dropping it would leave a
    key open on the old ones.
