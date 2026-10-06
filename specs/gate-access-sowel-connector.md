# Gate keys — guestFlow's part: a list of keys for Sowel, and the outcomes it reports back

| Field | Value |
|---|---|
| **Status** | Implemented (2026-09-27) |
| **Branch** | `feature/gate-keys-sowel` |
| **Created** | 2026-09-20, rewritten 2026-09-27, contract v2 the same day |
| **Author** | Adrien |
| **Related PR** | #623 |
| **Supersedes** | PR #563 (`claude/sowel-guestflow-connector-y0df44`): its stay **feed** (`GET /stays` with revisions and a cursor, the `gate_stay_feed` table, its reconciler and its purge) and its `POST /invitations`. What #563 got right is kept as it was: the signed channel, the window computation, the email tokens, the SAS step with its QR, the fiche card and the settings card |
| **Wire contract** | « guestFlow ↔ Sowel gate keys — wire contract » v1 + its « v2 changes » (2026-09-27: wider window, signed responses, `implausible_stay`, the secrets in Réglages) + **v3** (2026-10-05, additive: the `stay` block on every key, `specs/sowel-stays-in-keys.md`), implemented on the Sowel side by the `guestflow` plugin. §4.3 below is guestFlow's copy of it |

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
4. **The window**: `startsAt` = arrival date + the reservation's `checkInTime` **− 3 h**; `endsAt` =
   departure date + `checkOutTime` **+ 2 h**. Check-in and check-out are read on the **Europe/Paris
   wall clock**; the two margins are real durations applied to those instants, so a DST night never
   stretches them; the result is sent as UTC ISO (`gateWindow.js`, taken from #547 with its tests).
   The check-in time is the planned arrival: a guest a little early is let in (contract v2).
4b. **The stay** (contract v3, `specs/sowel-stays-in-keys.md`): every key, `create` and `revoke`,
   carries `stay: { propertyId, propertyName, arrival, departure }` — the reservation's property and
   its check-in / check-out themselves, **without** the −3 h / +2 h: the same inputs and fallbacks
   as rule 4 (`checkInTime` / `checkOutTime`, else 15:00 / 10:00), sent as Europe/Paris wall clock
   **with the numeric offset** (`2026-10-06T16:00:00+02:00`), so a stay across a DST night reads
   right on both ends. It is what Sowel's heating needs to know a property is occupied. A deleted
   reservation's revoke rebuilds it from its stored result: the property kept on the row (rule 9)
   and the stored window minus its margins. The block is **optional**: it is left out when the
   property is not known any more — a result filed before the column existed for a reservation
   deleted since, or a property deleted — rather than sent half-filled.
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

9. guestFlow keeps **the latest result per reservation**: each one replaces the previous. The window,
   the label and the property listed with a key are kept on the row, so a reservation deleted
   afterwards can still be revoked (rule 6), with its stay (rule 4b).
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
    (`unknown_profile` → « le profil par défaut n'est pas accordé au plugin », `implausible_stay` →
    « séjour de plus de 31 jours refusé par Sowel », …). An unknown code shows Sowel's message
    instead.
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
22. Both secrets are **auto-generated in `server/.env.local`** at startup and **never logged**. The
    only API that returns them is the admin-only secrets endpoint of the settings card (rule 29b).
22b. **guestFlow signs its answers.** Every 2xx response of `/public/v1/gate/*` (keys, results,
    ping) carries `X-Gate-Response-Signature` = hex HMAC-SHA256(`GATE_SIGNING_SECRET`,
    `"response\n" + <the request's X-Gate-Signature> + "\n" + sha256hex(<exact response body
    bytes>)`). A server posing as guestFlow can then neither make Sowel create keys nor harvest the
    codes and links Sowel posts back: Sowel verifies it before using a list or considering results
    delivered.
22c. **The signed bytes are the sent bytes**: the body is serialised once, signed, and written as is
    with `Content-Type: application/json` (no re-serialisation, no ETag/304 that would drop it). Bound
    to the request's signature, an old answer is useless for a new request. Pinned vector, shared
    with the plugin: secret `s3cret`, request signature `abc`, body `{"ok":true}` →
    `12ac7139e4bc81ce30b413a9c7f1880b33b1f055a045affde5d2765dcfb65190`.
22d. **One place signs**, for the whole gate router: a gate route cannot answer 2xx unsigned. Error
    answers (4xx/5xx) are not signed.

### 3.5 What guestFlow shows

23. **The emails** have `{{gateAccessCode}}`, `{{gateAccessUrl}}` and the flag
    `{{#if hasGateAccess}}`, from the stored successful result: **composing an email never reaches
    the house and waits for nothing**. With no usable key the paragraph is skipped and the email
    leaves. A code alone or a link alone is enough for the flag.
24. **The SAS** keeps its « Portail » step, shown **whenever a usable key exists**: the code in large
    type and a QR of the very link the email carries — flashing it installs the key with nothing to
    type — and, on the same page, the gate keypad's code when there is one. The QR stays on screen:
    never on a PDF, never attached to an email, never logged.
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
    last read the list — and « Sowel ne lit plus » rather than « Sowel lit les clés » once that read
    is more than 3 hours old (rule 17) —, how many keys it reports as created.
29b. **The card hands the admin the three values the plugin's settings need**, labelled exactly like
    the plugin's fields: « guestFlow address », « API key (GATE_API_KEY) », « Signing secret
    (GATE_SIGNING_SECRET) ». Both secrets are masked by default, each value has « Afficher » (the
    secrets) and « Copier ». They come from an **admin-only** endpoint answering with
    `Cache-Control: no-store`, and are never logged.
29c. **guestFlow's address** is the public URL typed in Réglages → Système (« Adresse de
    l'application », the one the emails and the Google return use), without its trailing slash. When
    it was never typed, the origin the admin is browsing from stands in, and the card says so.

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
| `utils/` | `gateWindow.js` | C (from #563) | A stay's window, Paris wall clock, DST-safe; `toParisIso` writes an instant with its Paris offset (rule 4b) |
| `utils/` | `gateKeys.js` | C | The list of keys (rules 2-7), the `stay` block (rule 4b), the label, the French reasons, « is Sowel late » |
| `utils/` | `gateResults.js` | C | Files the results, pushes the admins once per error, the stale-read pass, the dashboard payload |
| `utils/` | `gateInvitationView.js` | C (from #563, rewritten) | What the email, the SAS and the fiche show of the stored result |
| `models/` | `gateKeysModel.js` | C | `gate_key_results`, `gate_connector_state`, the stays around now, the admins; `migratePropertyId` (rule 4b) |
| `plugins/gate-access/index.js` | — | T | Runs `migratePropertyId` once, as the plugin migration `stay_property_v1` (the tables live in the plugin since phase 2) |
| `middleware/` | `requireGateConnector.js` | C (from #563) | Key + signature + freshness, failing closed |
| `middleware/` | `signGateResponse.js` | C | Signs every 2xx answer of the gate router over the exact bytes sent |
| `controllers/` | `gateConnectorController.js` | C | `keys`, `results`, `ping`, the dashboard and settings reads, the secrets for the plugin |
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
| `components/` | `SettingsGateAccessSection.jsx` | C (from #563) | The connector's state and the three values for the plugin |
| `components/` | `SecretRevealField.jsx` | C | Generic: a read-only value, masked until « Afficher », with « Copier » |
| `pages/settings/` | `IntegrationsSettingsPage.jsx` | T | Mounts it (the settings were split per page on `master`) |
| `pages/` | `ReservationPage.jsx`, `EmailTemplatesPage.jsx` | T | The fiche card + the two tokens and the condition in the editor |
| `api.js` | — | T | `getReservationGateAccess`, `getGateConnector`, `getGateConnectorSecrets`, `getGateKeysAlerts` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `SummaryItem` | Pre-existing. |
| **Created (new generic)** | `SecretRevealField` | A value handed to another system (key, secret, address): generic by nature, unlike `MaskedTextField` which edits a stored secret. |
| **Specific (kept feature-local)** | `GateKeysAlert`, `SasGateAccessStep`, `GateAccessCard`, `SettingsGateAccessSection` | Each only makes sense in its own screen. `GateKeysAlert` follows the dashboard alerts' own pattern (`TariffRecipeRunsAlert`). |

### 4.3 API contract

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/public/v1/gate/keys` | — | `{ now, keys[] }` | `keys[]` = `{ reservationId (string), action: "create"\|"revoke", label, startsAt, endsAt, stay? }`; stamps `lastReadAt` |
| POST | `/public/v1/gate/results` | `{ results[] }` | `{ stored }` | `results[]` = `{ reservationId, action, ok, state?, code?, url?, error?, message? }`; 400 without the list, 413 past 500 |
| GET | `/public/v1/gate/ping` | — | `{ ok, now }` | Checks key, signature and clock in one call |
| GET | `/api/dashboard/gate-keys` | — | `{ failures[], stale, lastReadAt }` | Admin; `failures[]` = `{ reservationId, reservationNumber, guestFirstName, name, action, title, reason, exists }` |
| GET | `/api/reservations/:id/gate-access` | — | `{ card, sas }` | Session; a read for reception |
| GET | `/api/settings/gate-connector` | — | `{ configured, lastReadAt, stale, keysCreated, secretsFile, secretNames }` | Admin; no secret value |
| GET | `/api/settings/gate-connector/secrets` | — | `{ address: { value, source: setting\|request\|none }, apiKey, signingSecret }` | Admin; `Cache-Control: no-store` |

**Contract v3 (2026-10-05) — `stay`**, on every key, optional (rule 4b):

```json
"stay": {
  "propertyId": 1,
  "propertyName": "Gîte",
  "arrival": "2026-10-06T16:00:00+02:00",
  "departure": "2026-10-09T10:00:00+02:00"
}
```

`propertyId` is an integer, `propertyName` the property's name; `arrival` / `departure` are ISO-8601
with the Europe/Paris offset of that instant, not UTC. Additive: a v0.3.0 plugin validates only
`reservationId`, `action`, `label`, `startsAt`, `endsAt` and ignores it; nothing else in the
contract moved (endpoint, auth, signatures, the 7-day lead, the results).

`state` is Sowel's access status (`live | outside_hours | not_yet | ended | suspended | revoked |
no_gate`); `error` is one of Sowel's codes (`disabled`, `unknown_profile`, `profile_incomplete`,
`no_end`, `outside_profile`, `invalid_date`, `label_required`, `internal_error`, `implausible_stay`).
The three `/public/v1/gate/*` routes refuse anything unsigned (§3.4) with the public tree's error
envelope, and sign every 2xx answer with `X-Gate-Response-Signature` (rules 22b-22d).

---

## 5. Data model

| Table | Columns |
|---|---|
| `gate_key_results` | `reservationId` (PK, no FK — it must outlive a deleted reservation), `action`, `ok`, `state`, `code`, `url`, `error`, `message`, `label`, `startsAt`, `endsAt`, `receivedAt`, `alertedError` (the error the admins were last pushed about), `propertyId` (contract v3, rule 4b — the reservation's property, kept for a deleted reservation's stay) |
| `gate_connector_state` | one row (`id = 1`): `lastReadAt`, `staleAlertedAt` |

Both tables are created empty by `schema.sql` and touch no existing data. **Data impact:** none;
dropping both would return guestFlow to its previous state.

**Migration (contract v3, 2026-10-05):** `gate_key_results.propertyId INTEGER`, nullable, added by
`migratePropertyId` (the gate-access plugin's `stay_property_v1` migration) on databases that predate it and backfilled from the reservation for every row
whose reservation still exists. A row whose reservation was deleted before the migration stays NULL:
its revoke goes out without `stay` (rule 4b). No data is lost or rewritten. #563's `gate_stay_feed` and
`gate_invitations` were never on `master` and are not created.

## 6. UI / UX

| Surface | Content |
|---|---|
| **Dashboard** | « Clés portail » alert (warning): one row per failed key — « R-2026-041 · Marie — Clé portail non créée » and the reason under it; a click opens the reservation. A row « Sowel ne lit plus les clés depuis le … » when rule 17 holds. Nothing otherwise |
| **SAS, « Portail » step** | « Flashez pour installer l'accès au portail », the QR, the code under it, the window; the keypad code as a fallback |
| **Fiche** | « Accès portail » card: state badge, code, validity, link — or « Échec » and the reason; the sentence pointing at Sowel |
| **Réglages → Intégrations** | « Accès portail (Sowel) » card: configured / read / « Sowel ne lit plus », last read, keys created; then « guestFlow address », « API key (GATE_API_KEY) », « Signing secret (GATE_SIGNING_SECRET) », each with « Copier », the secrets masked behind « Afficher ». The buttons stack under the value on `xs` |
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
- [x] `gate-connector-settings.unit.test.js` — the settings card, no secret value, « late » past 3 h
- [x] `gate-connector-secrets.unit.test.js` — the three values, `no-store`, admins only, the address
- [x] `gate-response-signature.unit.test.js` — the pinned vector, exact bytes, bound to the request,
      errors unsigned, every gate route behind the signer
- [x] `gate-window.unit.test.js` (from #547) — − 3 h / + 2 h, both DST transitions
- [x] `gate-keys-stay.unit.test.js` (contract v3) — the Paris offset, the `create` and `revoke`
      shapes, each stay's own times and their fallback, a stay across 2026-10-25, a deleted stay
      rebuilt from the results table, no block without a known property, the stored property kept,
      the migration and its backfill

### Client unit tests
- [x] `GateKeysAlert.test.jsx` — nothing to say, a failure row, the stale row, a silent server
- [x] `GateAccessCard.test.jsx`, `SasGateAccessStep.test.jsx`, `SettingsGateAccessSection.test.jsx`
      (from #563, adapted)

### Visual verification (2026-09-27)
- [x] Real server on a scratch database, both endpoints called with signed requests: the list came
      back with the Paris window, the results were filed. Dashboard (desktop and 390 px): the
      « Clés portail » alert with the stale row and the failed key; Réglages → Intégrations card;
      the fiche card for a created key and for a failed one. The SAS step is covered by its unit
      tests only (the SAS opens on the day of arrival).

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
- Q: when does the key open and close?
  - A (2026-09-27, Adrien, contract v2): **3 hours before check-in, 2 hours after check-out**.
- Q: how does Sowel know it is talking to the real guestFlow?
  - A (2026-09-27, Adrien, contract v2): guestFlow **signs its answers** (rules 22b-22d).
- Q: where does the operator find what to paste into the plugin?
  - A (2026-09-27, Adrien, contract v2): in the settings card, admins only, masked (rule 29b).
- Q: a stay whose dates move beyond 7 days after its key was made?
  - A (2026-09-27): it stays listed with its new dates (rule 3) — the wire contract says a stay
    whose dates change is « simply listed again with its new dates », and dropping it would leave a
    key open on the old ones.
