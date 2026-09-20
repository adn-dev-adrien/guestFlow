# Gate access — guestFlow's part: a stay feed, and a copy of the invitation

| Field | Value |
|---|---|
| **Status** | Implemented (2026-09-20) |
| **Branch** | `claude/sowel-guestflow-connector-y0df44` |
| **Created** | 2026-09-20 |
| **Author** | Adrien |
| **Supersedes** | PR #547 (`feature/guest-gate-access`) in full: both v1 (`specs/guest-gate-access.md`) and the v2 « Portier » model (`specs/gate-access-portier.md`), which stayed on that never-merged branch |
| **Other parts** | `sowel-plugin-guest-access` `specs/guest-access.md` · Sowel core `specs/180-plugin-pages-and-public-tree/` · `sowel-recipe-guest-gate` |

## 0. The feature at a glance

> This section is **identical in the repositories that carry a part of the feature**. Each then
> details its own component only.

**Goal.** A guest of the gîte or the lodge opens the gate from their phone, for their stay only.
The owner keeps every access — stay or hand-made — in one list where any of them can be edited,
suspended, revoked or deleted. **And all of it keeps working without guestFlow.**

| Component | Repository | Owns |
|---|---|---|
| **Sowel core** | `mchacher/sowel` | two generic capabilities (spec 180): a plugin may bring a page into the UI, and may serve anonymous callers under `/p/<id>/*` |
| **The plugin** | `adn-dev-adrien/sowel-plugin-guest-access` | the accesses, their codes, their hours, the journal, the owner's page, the guests' page, the guestFlow connector |
| **The recipe** | `adn-dev-adrien/sowel-recipe-guest-gate` | decides and pulses; reports the outcome and the gate contact |
| **guestFlow** | `adn-dev-adrien/guestFlow` | the reservations: publishes a feed of stays, stores the invitation it is handed, shows the code and the QR in the SAS, the fiche and the emails |

| Connection | Opened by | Carries |
|---|---|---|
| phone → Sowel | the phone | enrolment, a state read, a press |
| Sowel → guestFlow | **Sowel** | the stay feed (read) and the invitations (written) |
| guestFlow → Sowel | **nobody** | guestFlow holds no credential over the house and opens nothing towards it |

**Why the inversion.** v1 put the accesses in guestFlow because a Sowel API token inherits its
creator's role and actuates *every* equipment in the house — so the internet-facing machine could
not be given one. That reasoning is sound, and it has a better answer: **nobody holds a token at
all.** The house holds the rules, the recipe holds the trigger, and guestFlow is reduced to what it
is actually good for, which is knowing who is arriving and when.

**What it removes.** Three things v2 needed and v3 does not: a second service to deploy and back up,
an outbox with its retries inside guestFlow, and emails that waited on a machine being up. guestFlow
now holds a copy of the invitation, pushed to it, and composes its emails from what it already has.

---

## 1. Context

PR #547 delivered, on a branch that was never merged, two successive architectures: the `gate_*`
tables served by guestFlow (v1), then « Portier », a private service running on guestFlow's own
machine (v2). On 2026-09-20 the owner asked for the management interface to be on the Sowel side,
for the connector to be bidirectional, and for the whole thing to work **even without guestFlow**.

That is not a rearrangement: it moves the source of truth. Everything #547 had built on this side —
the « Accès portail » page, the outbox, the signed client, the emails that waited, the event
receiver — has no reason left to exist. What stayed true is taken as it was: the window computation
in `gateWindow.js` and its tests on both DST transitions.

## 2. Goal

guestFlow publishes its stays to the house, files away what the house hands back, and shows the code
and its QR wherever a guest needs them — without ever holding a key that opens a gate, and without
waiting on a machine it cannot reach.

## 3. Functional rules

### 3.1 The stay feed

1. **guestFlow publishes one snapshot per stay change**, numbered by a strictly increasing revision.
   The revision is the consumer's cursor: it resumes where it left off, and a replayed page changes
   nothing there.
2. A snapshot carries the window computed by `gateWindow.js` (check-in → check-out + 1 h, Paris wall
   clock, both DST transitions), the lodging, the guest's **first name** and the reservation number.
   The family name is not in it: it has no business on an equipment that opens a gate.
3. **The feed is computed on read**, by comparing the current state of the stays against the last
   published snapshot — no write path hooks anything. That is what makes a « forgotten hook »
   impossible: v2 hooked six of them and its own test plan admitted two had nothing to hook. A
   hand-made fix in the database, a future import, a restore from backup are all seen like the rest.
4. **A cancellation** (`kind = 'cancelled'`) is published as such, with no window. **A deletion** is
   discovered by the row's absence and published once.
5. A stay that drifts away (finished more than 30 days ago) **leaves the watch without being
   announced as deleted**: its access ends on its own end date.
6. A devis is not a stay.
7. **Nothing to backfill at deployment**: the house's first read publishes everything under watch.
8. The purge only deletes a row that is **both superseded and old** (90 days): a consumer that has
   fallen behind must still be able to catch up on the latest state of everything.

### 3.2 The copy of the invitation

9. For each stay access, the house pushes the code, the link, the state, the window in force, the
   number of phones and the last use. guestFlow **replaces** what it had: the house is authoritative.
10. **It is a copy.** Nothing here opens a gate: a stale code left lying around would be refused by
    the house, which is the only one that decides.
11. A batch is taken **whole or not at all**: a partial answer would let the house believe everything
    went through, and the next push would not carry it again.

### 3.3 The channel

12. **Outbound only, both ways.** guestFlow opens nothing towards the house and holds no credential
    over it.
13. Every call carries **a key** (`GATE_API_KEY`) *and* **a signature** (`GATE_SIGNING_SECRET`) over
    the method, the path with its query, the timestamp and the body byte for byte. The key proves the
    caller; the signature proves the call, and its secret never travels.
14. **The key is distinct from `PUBLIC_API_KEY`**: the WordPress proxy's key has no business reading
    who sleeps here tonight, nor writing a gate code.
15. **We fail closed**: without either secret, everything is refused. Outside ± 2 minutes, too.
16. Both secrets are auto-generated in `server/.env.local` at startup, **never logged**, and **never
    returned by an API** — the operator reads them there, like the site's key.

### 3.4 What guestFlow shows

17. **The emails** J-7 / J-2 have `{{gateAccessCode}}`, `{{gateAccessUrl}}` and the flag
    `{{#if hasGateAccess}}`. They come from the local copy: **composing an email never reaches the
    house and waits for nothing**. With no invitation, the paragraph is skipped and the email leaves.
18. **The SAS** keeps its « Portail » step: the code in large type and a QR of the very address the
    email carries — flashing it sets the access up with nothing to type. The QR stays on screen:
    never on a PDF, never attached to an email, never logged.
19. The SAS **activates nothing**: the only thing it does is show. With no invitation, the gate
    keypad's code (Réglages) stays there, to dictate.
20. **The fiche** carries a compact card: the state, the window, the code, the phones, the last use —
    and the sentence that says where the actions are. It renders nothing when there is nothing.
21. An access **deleted from the list** is visible on the fiche: the guest has no code left, and only
    Sowel can make another.
22. **Reception reads** the access (it runs the SAS). It can change nothing — nobody can from here.
23. A revoked, finished or deleted access is **never shown as usable**: printing a dead code is worse
    than printing nothing.

### 3.5 The settings

24. One read-only card: is the connector configured, how many invitations are filed, **when the house
    last spoke**. It is the only question asked here when a guest says they never received their code.

**Edge cases:**
- The house is stopped → guestFlow does not notice and has nothing to do: its emails leave with the
  last known code, and the SAS shows what it has. Only the settings card grows old.
- A stay created then cancelled before the first read → the house only ever sees the cancellation,
  and no access is created.
- Dates changed while the house is stopped → the revision waits in the feed; it is read as it stands
  when the house comes back.
- A reservation reinstated after a cancellation → the access resumes, **with the same code**.
- Two guestFlow instances restored from the same backup → same feed, same revisions: the house
  ignores what it has already seen.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `gateWindow.js` | C (taken from #547) | A stay's window, Paris wall clock, DST-safe |
| `utils/` | `gateStayFeed.js` | C | The reconciler: publishes what changed, paginates, purges |
| `utils/` | `gateInvitationView.js` | C | What the email, the SAS and the fiche show of the copy |
| `models/` | `gateInvitationModel.js` | C | The local copy (factory + instance) |
| `middleware/` | `requireGateConnector.js` | C | Key + signature + freshness, failing closed |
| `controllers/` | `gateConnectorController.js` | C | `stays`, `invitations`, `ping` |
| `routes/public/` | `gate.js` | C | The `/public/v1/gate` tree, **beside** the public tree |
| `controllers/` | `reservationsController.js` | T | `GET /reservations/:id/gate-access` (card + SAS step) |
| `controllers/` | `sasController.js` | T | `gateAccess.available` in the SAS payload |
| `controllers/` | `settingsController.js` | T | `GET /settings/gate-connector` |
| `utils/` | `emailContextBuilder.js` | T | `gateAccessCode`, `gateAccessUrl`, `hasGateAccess` |
| `utils/` | `emailAutoSendRunner.js`, `reservationEmailSender.js` | T | Pass the local copy into the context |
| `controllers/` | `emailsController.js` | T | Same, on its three compositions |
| `middleware/` | `enforceRoleAccess.js` | T | Reception reads `/reservations/:id/gate-access` |
| `scheduledTasks.js` | — | T | The feed purge, once a day |
| `database.js` | — | T | `gate_stay_feed`, `gate_invitations` |
| `index.js` | — | T | Both secrets, and mounting the tree |

**No reservation write path is touched** — that is the property being sought (§3.1 rule 3).

**New dependency:** `qrcode` (the SAS's QR, rendered on demand, never stored).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/sas/` | `SasGateAccessStep.jsx` | C | The step: code, QR, window, fallback to the keypad code |
| `components/sas/` | `ReservationSasDialog.jsx` | T | Mounts the step in place of the bare code |
| `components/` | `GateAccessCard.jsx` | C | The fiche's card |
| `components/` | `SettingsGateAccessSection.jsx` | C | The connector's state |
| `pages/` | `ReservationPage.jsx`, `SettingsPage.jsx`, `EmailTemplatesPage.jsx` | T | Mounts + the two tokens in the editor |
| `api.js` | — | T | `getReservationGateAccess`, `getGateConnector` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `SummaryItem` | Pre-existing. |
| **Created (new generic)** | — | None: the three creations are surfaces of this feature. |
| **Specific (kept feature-local)** | `SasGateAccessStep`, `GateAccessCard`, `SettingsGateAccessSection` | Each only makes sense inside its own screen, and is a composition of generics plus this feature's wording. |

### 4.3 API contract

| Method | Endpoint | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/public/v1/gate/ping` | — | `{ ok, now, invitations }` | Checks key, signature and clock in one call |
| GET | `/public/v1/gate/stays?since=&limit=` | — | `{ stays[], cursor, hasMore }` | `stays[]` = `{ revision, reservationId, reservationNumber, property, guestName, startsAt, endsAt, state }` |
| POST | `/public/v1/gate/invitations` | `{ invitations[] }` | `{ stored, received }` | 400 when the list is missing, 413 past 500 entries |
| GET | `/api/reservations/:id/gate-access` | — | `{ card, sas }` | Session; a read for reception |
| GET | `/api/settings/gate-connector` | — | `{ configured, invitations, lastReceivedAt }` | No secret |

The three `/public/v1/gate/*` routes refuse anything unsigned (§3.3); the error envelope is the
public tree's own.

---

## 5. Data model

| Table | Columns |
|---|---|
| `gate_stay_feed` | `revision` (PK AUTOINCREMENT — the cursor), `reservationId`, `state`, `payload` JSON, `createdAt` |
| `gate_invitations` | `reservationId` (PK), `accessId`, `state`, `code`, `url`, `validFrom`, `validUntil`, `devices`, `lastUsedAt`, `updatedAt`, `receivedAt` |

Both tables are **created empty** and touch no existing data: no column added anywhere else, no
backfill, no risk to the reservations. `revision` is AUTOINCREMENT: a purged row never lends its
number to a later publication.

**Data impact:** none. Dropping both tables would return guestFlow to its previous state.

## 6. UI / UX

| Surface | Content |
|---|---|
| **SAS, « Portail » step** | « Flashez pour installer l'accès au portail », the QR, the code `4K7M-9QT2` under it, the window in force; the keypad code as a fallback |
| **Fiche** | « Accès portail » card: state badge, code, validity, phones, last use, link; the sentence pointing at Sowel |
| **Réglages** | « Accès portail » card: configured or not, invitations received, last exchange |
| **Email editor** | Two tokens (`Code portail`, `Lien portail`) and one condition (`Si accès portail`) |

Strings in French. Responsive: the three surfaces are `Stack`/`SummaryItem` layouts that stack on
`xs`; the QR is 220 px and never goes below 180 px; nothing overflows horizontally.

**Action bar:** no new page — the three surfaces are cards inside pages that already have theirs.

## 7. Test plan

### Server unit tests (43 new, plus the 11 of `gateWindow` taken from #547)
- [x] `gate-stay-feed.unit.test.js` (12) — publication, date and hour changes, cancellation, a
      deletion discovered on its own, a stay drifting away, devis ignored, pagination, cursor, purge
- [x] `gate-connector-auth.unit.test.js` (12) — signature vectors, failing closed, wrong key, wrong
      secret, replay, cursor altered in flight, body altered in flight, X-API-Key, the site's key
- [x] `gate-invitation-copy.unit.test.js` (11) — replacement, invalid row, non-showable states,
      missing table, the fiche's card, the window on the Paris clock, the SAS step and its QR
- [x] `gate-email-tokens.unit.test.js` (4) — tokens present, absent, code without link, link without code
- [x] `gate-reception-read.unit.test.js` (4) — reception reads, never writes; the accountant stays out
- [x] `gate-window.unit.test.js` (11, taken from #547) — both DST transitions

### Client unit tests (17 new)
- [x] `GateAccessCard.test.jsx` (6) — nothing to show, state and code, deleted access, « jamais »
- [x] `SasGateAccessStep.test.jsx` (6) — QR and code, fallback to the keypad, « not configured yet »,
      retry, missing QR, no action at all
- [x] `SettingsGateAccessSection.test.jsx` (5) — not configured, the house talks, waiting, no secret
      handed back, a silent server

### End-to-end verification (2026-09-20)
The plugin's real connector (`dist/guestflow.js`) was run against a real guestFlow server on a
scratch database: the stay arrived with its window **16:00 → 11:00 Paris wall clock**, the invitation
pushed back was filed, the fiche, the SAS (QR included) and the email tokens used it, a second sync
republished nothing, and a wrong signing secret was refused with a `401`. That is the check that both
halves of the signature agree — the bug both specs fear: two green suites and a dead channel in
production.

### Manual verification
- [ ] Install the Sowel plugin, open the public access, paste both keys: the list fills up
- [ ] Move a reservation's dates: the window follows in Sowel
- [ ] Cancel: the access is revoked; reinstate: the same code comes back
- [ ] Flash the SAS's QR with a phone: the access installs with nothing typed
- [ ] Stop Sowel: the J-7 email leaves anyway, with the last known code
- [ ] Log in as reception: the SAS shows the code, nothing is editable

## 8. Out of scope

- Any action on an access from guestFlow. Holding, extending, revoking, regenerating: Sowel.
- A QR for a hand-made access: it is shared by its link, from Sowel.
- Sending the invitation by SMS.
- The global `portalCode` setting, which stays as it is while the physical keypad exists.

## 9. Questions settled

- Q: the management interface, on guestFlow's side or Sowel's?
  - A (2026-09-20, Adrien): **Sowel's**, as a native page (core spec 180).
- Q: the guests' page, served by whom, so that it works without guestFlow?
  - A (2026-09-20, Adrien): **by Sowel**, under its existing name.
- Q: what does guestFlow keep?
  - A (2026-09-20, Adrien): **the source of stays and the display** — the code and the QR in the SAS,
    the fiche and the emails.
- Q: start again from `master` or from #547's branch?
  - A (2026-09-20, Adrien): « whichever is best ». Answer: **`master`**, taking from #547 what stays
    true (`gateWindow.js` and its tests). The rest — the outbox, the signed client, the emails that
    waited, the « Accès portail » page, the event receiver — served an architecture now abandoned.
