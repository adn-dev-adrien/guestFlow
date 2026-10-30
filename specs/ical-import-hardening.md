# iCal import — hardening after the review of 2026-10-18

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/review-ical-intake` → `inte/plugins` |
| **Created** | 2026-10-18 |
| **Author** | Adrien |
| **Related PR** | #703 |
| **Depends on** | `specs/lodgify-decommission.md` (Booking echo filter, rules 5–10), `specs/ical-sync-mapping-resilience.md` (empty-feed guard), `specs/platforms-and-ical-rework.md` (the platforms tab), `specs/booking-extranet-intake.md` rules 27–28 |

---

## 1. Context

The review of 2026-10-18 (iCal sync and platform intakes, on a copy of the Solio database with every
feed served locally) found the import trustworthy on its main path — takeover, echo filter, locked
drift, cancellation approval all held — and a set of defects around it, all already present in
v3.10.0:

- **B1** — every iCal stay without a guest name shared one placeholder client per feed (« Closed Not
  available » behind every Booking stay, « Reserved Ical » behind every Airbnb stay). The Booking
  intake wrote the guest onto that client, and every other stay took the guest's name and e-mail. The
  intake itself is fixed by `specs/booking-extranet-intake.md` rules 27–28; the shared placeholder is
  this spec's.
- **M2** — « Synchroniser » on an inactive source (`isActive = 0`, the state of both Lodgify sources
  since 16/10) imported it again and re-created a stay deleted after retirement; the row never showed
  the source was stopped.
- **M3** — an imported stay overlapping an existing reservation was flagged only on the Booking feed.
- **M4** — the fetch had no timeout: a platform that accepted the connection and never answered held
  the manual sync for 5 minutes, and the hourly pass with it.
- **m1** — a truncated feed (no `END:VCALENDAR`) was trusted: the stays it lost raised cancellation
  alerts.
- **m2** — two stays sharing one UID: one never existed, the other was « mis à jour » at every pass.
- **m3** — a UTC instant (`…T230000Z`) was dated in UTC, one day early for Paris.
- **m4** — a stray « 0 » after the chips of every platform row (`disabled` sent as a number).
- **m5** — imported guests named « Closed Not available » / « Reserved Ical ».
- **m6** — the sync status was the engine's sentence (« 0 créé(s), 0 mis à jour, … 15 inchangé(s) »),
  with a date and no time, over three lines on a phone.

## 2. Goal

An imported stay never shares a client it does not own, a stopped calendar stays stopped, an overlap
is shouted whatever the platform, one silent platform costs one timeout, a damaged feed changes
nothing, and the platforms tab says in one short line what the last sync did.

---

## 3. Functional rules

1. **One placeholder client per nameless stay.** A stay whose summary names nobody (rule 8) gets a
   client of its own, « Ical <platform> », created with the stay. A summary that names the guest still
   reuses that guest's client, as before. At boot, every client that is plainly a shared placeholder —
   a name made of platform words only, no e-mail, phone, address or note, used by iCal stays only — is
   split: the first stay keeps it, each other stay gets a copy, and its history records « Client :
   <old name> → <new name> ». Every such placeholder is renamed « Ical <platform> ». A shared client
   carrying a guest's coordinates is **never** split: which stay it belongs to is the operator's call
   (`server/scripts/diagnose-shared-clients.js`, `specs/booking-extranet-intake.md` rule 28). The pass
   is idempotent.
2. **A stopped source stays stopped.** An inactive source (`isActive = 0`) is skipped by the hourly
   pass and « Synchroniser tout » (unchanged) and its own « Synchroniser » is refused:
   `409 « Calendrier arrêté. »`, nothing fetched. The platforms tab shows the chip « Arrêté », the line
   « Calendrier arrêté : plus rien n'est importé. » and no « Synchroniser » on that row.
3. **An overlap is flagged on every feed.** A new stay from any feed whose nights are partly or fully
   held by a reservation of another origin is created and flagged `bookingConflictAt` (badge on the
   fiche and the calendar), and the conflict notification is sent instead of the « nouvelle
   réservation » one. A pristine stay that a feed moves onto taken nights is flagged too, once, and
   notified. Only the Booking feed still **skips** a full echo (`specs/lodgify-decommission.md` rules
   6–8): other platforms do not mirror GuestFlow's export as stays. The notification and its e-mail
   name the platform (« Conflit de dates — flux Airbnb »); the badge's tooltip reads « Ces dates
   chevauchent une autre réservation : doublon à supprimer, remboursement ou relogement. »
4. **A fetch is bounded.** Each feed is fetched with a 20-second timeout; past it the source line
   reads « Plateforme injoignable (délai dépassé). », a refused connection « Plateforme injoignable. ».
   The hourly pass and « Synchroniser tout » start every fetch at once, then apply the feeds one after
   the other in source order, as before: a stuck platform costs one timeout, not one per source behind
   it, and the takeover / cross-source matching sees the sources in the same order.
5. **A truncated feed is refused.** A body without `END:VCALENDAR`, or with a `BEGIN:VEVENT` left
   unclosed, is a failed fetch: « Flux iCal incomplet — synchronisation ignorée. », no mapping
   touched, no cancellation alert raised. The next complete feed syncs normally.
6. **A repeated UID keeps both stays.** When a feed gives the same UID to several events, each is keyed
   on its `RECURRENCE-ID` when present, on its arrival date otherwise (`<uid>#<date>`). A UID that
   appears once is left exactly as it was, so no existing mapping moves. The source's sync detail
   counts them (« 2 au même identifiant »).
7. **A UTC instant is a day in the server's zone.** `DTSTART:20261124T230000Z` is the 25/11 in
   Europe/Paris (`GUESTFLOW_TZ`), not the 24/11. Date-only values and floating local times are
   unchanged.
8. **Platform words are not a name.** A summary made only of platform words — `airbnb`, `booking`,
   `abritel`, `greengo`, `direct`, `réservation`, `réservé`, `reserved`, `blocked`, `bloqué`,
   `indisponible`, `closed`, `not available`, `unavailable`, `ical` (and `booked`, rule 11) — is
   « no name »: the stay's client is « Ical <platform> ». Whole words only (« Closer » stays a name).
9. **The status line says when and what changed.** The platforms tab prints the server's `syncStatus`:
   « Synchronisé à 02:05 » (« le 17/10 à 02:05 » on another day), followed by the non-zero changes only
   — nouvelles, modifiées, reprises, annulations à valider, en conflit, sur une fermeture, au même
   identifiant. An error reads « Échec à 02:05 : <message> ». The engine's full sentence is the line's
   tooltip.
10. **`disabled` is a boolean** in the `/platforms` payload, and the tab never prints it.
11. **« BOOKED » is not a name either.** The Gîtes de France feed sends `SUMMARY:BOOKED` for every stay:
    `booked` joins rule 8's words, so each such stay gets its own « Ical Gîtes de France » client, and
    the boot pass of rule 1 splits the « Booked Ical » client the import shared until then. Whole word
    only (« Booker » stays a name). *(Added 2026-10-18, second review, Ma1.)*
12. **A UID that starts repeating keeps its stay on its dates.** When a UID already mapped to a stay
    appears several times in the feed (rule 6), the stay goes to the event arriving on the stay's
    mapped arrival date; the other events under that UID never re-claim it through the same-summary
    match. No move, no drift alert, no duplicate on the stay's own dates. *(Added 2026-10-18, second
    review, mi1.)*
13. **The conflict flag follows the dates.** A pristine stay that its feed moves off every taken night
    loses `bookingConflictAt` (the badge goes); moved back onto taken nights, it is flagged and notified
    again (rule 3). A locked stay keeps its flag: its dates only move through the drift approval.
    *(Added 2026-10-18, second review, mi2.)*
14. **A placeholder nobody uses is deleted.** An intake moves the stay onto the guest's own client
    (`specs/booking-extranet-intake.md` rule 27, `specs/gites-de-france-mail-intake.md`), leaving the
    « Ical <platform> » placeholder without a stay. Every sync deletes the clients named « Ical … » with
    no e-mail, phone, address or note and no reservation or quote. *(Added 2026-10-18, second review.)*
15. **A nameless summary never merges two platforms' stays.** The cross-source de-dup (the same booking
    seen in two feeds: same dates, same summary) only applies when the summary names someone
    (`parseGuestName(...).isFallback` is false). Two platforms each sending « Reserved » on the same
    dates are two stays sold twice: both are created and the second is flagged in conflict (rule 3).
    *(Fixed at the 2026-10-27 audit: the Abritel stay was mapped onto the Airbnb one, one reservation,
    no flag — a hidden overbooking.)*
16. **Three valid feed shapes are read as they are meant** *(fixed at the 2026-10-27 audit)*:
    - `BEGIN:VEVENT` / `END:VEVENT` followed by blanks still delimit an event (it parsed to 0 events,
      while `isCompleteIcs` already accepted the document);
    - `DURATION` (RFC 5545 §3.8.2.5: `P5D`, `P1W`, `P4DT18H`) gives the departure when `DTEND` is
      absent (it used to import one night); a timed arrival counts the duration from its time;
    - the unavailability words (« blocked », « non disponible »…) in `DESCRIPTION` only drop an event
      whose summary names nobody: « Jean Dupont » with « non disponible pour le ménage » is a stay. A
      summary carrying those words is still dropped, as before.
17. **A feed is read bounded and public-only** _(added 2026-10-28, audit)_. The URL is operator input
    fetched from inside the LAN (next to the database host and the other containers): the import now
    refuses, with « Adresse du flux non autorisée (réseau privé). », a loopback, private (RFC 1918),
    carrier-grade, link-local (`169.254.x.x`, cloud metadata), unique-local or multicast address — written
    as a literal (IPv4-mapped IPv6 included: the URL parser rewrites `::ffff:127.0.0.1` as
    `::ffff:7f00:1`, so addresses are classified on their bytes; `64:ff9b::/16` NAT64 and `2002::/16` 6to4 are
    refused), reached through a name that resolves to one, or reached through a redirect (redirects are
    followed by hand, at most 3, each hop checked). The address checked is the address **dialled**: the
    connection goes through an undici `Agent` whose `lookup` validates what it resolves, on every hop, so a
    name that answers a public address to a check and a private one to the connection (DNS rebinding) is
    refused; a failed lookup is a refusal. The body is capped at 5 MB, by `Content-Length` and
    while streaming (« Flux iCal trop volumineux. »). `GUESTFLOW_ICAL_ALLOW_PRIVATE=1` lifts the address
    check for a development box whose test feed lives on localhost; it is not set in production.

17. *(Added 2026-10-28, audit finding F9.)* **A date is a day of the calendar, and a stay is bounded.** `20270231`
    and `20271399` used to import as `2027-02-31` / `2027-14-00`, and `DTEND:99991231` as a placeholder blocking
    every later night. An impossible date (also inside a UTC instant) now parses to nothing, so the event is
    dropped (an invalid `DTEND` is not turned into a one-night stay; a missing one still is, and a departure not
    after the arrival is still one night). An event is also dropped when it starts more than 730 days from now,
    ends more than 1 095 days from now, or lasts more than 366 nights. `parseIcsEvents(ics, { now })` takes the
    reference day for the tests. Test: `server/src/tests/ical-import-dates-bounds.unit.test.js`.

18. **A redirect response is drained before the next hop** _(added 2026-10-29, audit R2)_. `safeFeedFetch`
    cancels the body of a 3xx response before following `location`; closing the connection pool waits for an
    unread body, so a large redirect body used to hold the feed until the 20 s timeout.
19. **Overlap checks judge the nights a stay really takes** _(added 2026-10-29, audit R2)_. The Booking
    cover test, the overlap test of a new or moved stay (rule 3) and the drift approval
    (`icalDateDriftModel.overlapsTakenNights`) read each GuestFlow stay through `utils/occupancy.effectiveRange`
    (early check-in takes the night before, late check-out the night after), exactly as the iCal export
    publishes them. A platform stay on the extra night of a late check-out is flagged, not created unflagged.
20. **A pass in flight honours a stop or a correction made since it started** _(added 2026-10-30, audit R6-1)_.
    Rule 2 holds for the pass that is already running, not only for the next one. Once a feed is back, and
    before anything is applied, `syncSource` reads the source row again: if it is gone, inactive
    (`isActive = 0`), or its `url` is no longer the one the observation fetched, the result is `skipped` and
    no status row is written. A stay the operator deleted after stopping a source (the Lodgify clean-up) does
    not come back as a fresh import with a notification, and the feed of a wrong URL is not applied once more
    after the fix. Rule 8 (staleness) is evaluated after this check and is unchanged.

**Edge cases:**
- A stay arriving on another stay's departure day shares no night: no conflict (rule 3).
- A feed that times out resets the empty-feed streak like any failed fetch
  (`specs/ical-sync-mapping-resilience.md` rule 4).
- A repeated-UID stay mapped before rule 6 is re-claimed by its dates and summary (step ②) or, on
  Booking, by its exact dates; the old mapping is dropped, no duplicate.
- A client split by rule 1 whose stay is later deleted is deleted at the next sync (rule 14); one the
  operator filled stays an orphan client, listed by the existing orphan cleanup in « Clients ».
  *(2026-10-18 — was « stays an orphan client » before rule 14.)*

---

## 4. Architecture

> **Fat backend, thin frontend.** The overlap, the timeout, the feed checks, the placeholder split and
> the status line are all server-side; the tab renders `syncStatus` and two booleans.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `/api/properties/:id/ical-sources/:sourceId/sync` and `/platforms` unchanged) |
| `controllers/` | — | — | (none) |
| `models/` | `models/propertyIcalModel.js` | T | `fetchFeed(source)` (rules 4–5); `syncSource(source, { prefetched })`; `syncMany(sources)` (rule 4); per-stay placeholder in `getOrCreateIcalClient` (rule 1); overlap stamp on create and on a date move for every feed (rule 3), cleared when the move leaves every taken night (rule 13); a repeated UID's former mapping kept by the event on its date (rule 12); orphan placeholders deleted after each sync (rule 14); `repeatedUidCount` (rule 6); `syncOne` refuses an inactive source (rule 2); cross-source de-dup only on a named summary (rule 15). |
| `models/` | `models/platformsModel.js` | T | `listForProperty` rows carry `isActive`, `syncStatus`, boolean `disabled` (rules 2, 9, 10). |
| `utils/` | `utils/icalParser.js` | T | `isCompleteIcs` (rule 5), repeated-UID keys with their `baseUid` (rules 6, 12), UTC instant in the server zone (rule 7), placeholder words (rules 8, 11); trailing blanks on the event markers, `DURATION`, description-only unavailability (rule 16). |
| `utils/` | `utils/icalSyncStatus.js` | C | Pure `describeIcalSync(row, { now, timeZone })` → `{ tone, text, detail }` (rule 9). |
| `utils/` | `utils/icalPlaceholderClientsMigration.js` | C | `splitSharedIcalPlaceholderClients(db)` (rule 1, data side); `removeOrphanIcalPlaceholders(db)` (rule 14). |
| `utils/` | `utils/notificationService.js` | T | The `ical` conflict copy names the platform (rule 3). |
| `scheduledTasks.js` | — | T | `performAutoSync` goes through `syncMany` (rule 4). |
| `database.js` | — | T | Runs the placeholder split at boot (rule 1). |
| `middleware/` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/property/` | `PropertyPlatformsTab.jsx` | T | « Arrêté » chip and no « Synchroniser » on a stopped source (rule 2); renders `syncStatus` with its detail as tooltip (rule 9); `Boolean(row.disabled)` (rule 10). |
| `components/` | `ReservationConflictBadge.jsx` | T | Tooltip no longer says « paiement en ligne » only (rule 3). |
| `components/` | `IcalExportCard.jsx` | T | Copy only (§6). |
| `pages/`, `hooks/`, `services/`, `utils/`, `constants/` | — | — | (none) |

No new generic component: the status line stays a `Tooltip` around the existing icon + caption.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| POST | `/api/properties/:id/ical-sources/:sourceId/sync` | `409 { error: 'Calendrier arrêté.' }` on an inactive source. Timeouts and truncated feeds answer `400` with the messages of rules 4–5. |
| GET | `/api/properties/:id/platforms` | Each row adds `isActive: boolean`, `syncStatus: { tone: 'manual'\|'stopped'\|'never'\|'error'\|'success', text, detail }`; `disabled` becomes a boolean. |

---

## 5. Data model

No schema change. `ical_sources.lastSyncCounts` gains the key `repeatedUids`. Data migration (rule 1):
shared placeholder clients are split at boot, idempotently; nothing is deleted, every move is in
`reservation_history`.

## 6. UI / UX

- **Platforms tab row** (`Logement › Plateformes & iCal`): status line « Synchronisé à 02:05 ·
  1 nouvelle » (one line at 390 px in the usual case), full sentence on hover / long-press. A stopped
  source: chip « Arrêté », pause icon, « Calendrier arrêté : plus rien n'est importé. », buttons
  « Modifier l'URL » and « Désactiver » only. Mobile: same content, the chips wrap as before.
- **Export card** (review n3): title « Lien d'export iCal », line « À coller dans chaque plateforme
  pour bloquer les dates prises ici. Seules les dates sont transmises. » — no emoji, no « vous ».
- **Conflict badge**: same badge, the tooltip of rule 3.

## 7. Test plan

### Server unit tests — `server/src/tests/ical-import-hardening.unit.test.js` (20 cases)

- Rule 1: two nameless Booking stays get two clients; a named guest is still reused; the boot split
  (move, rename, history, idempotence); a client with an e-mail, a real name or a direct stay is never
  split.
- Rule 2: `syncOne` on an inactive source → 409, no fetch; `/platforms` says `isActive: false` and
  `syncStatus.tone = 'stopped'`.
- Rule 3: an Airbnb stay over a direct one is flagged and notified (back-to-back is not); a pristine
  stay moved onto taken nights is flagged once.
- Rule 4: a server that never answers fails within the timeout with the French message; `syncMany`
  starts every fetch before applying any.
- Rule 5: truncated feed refused, no cancellation, mappings intact.
- Rule 6: two stays under one UID both exist and the second pass is unchanged; `RECURRENCE-ID` keys.
- Rules 7–9: UTC instant in Paris; placeholder words; the status line.
- Rule 11: two GdF « BOOKED » stays get two clients; the boot split also covers « Booked Ical ».
- Rule 12: a locked stay mapped under `X`, then `X` twice in the feed → the stay keeps its dates, one
  new stay, no drift, no cancellation.
- Rule 13: moved off the taken nights → flag cleared; moved back → flagged and notified again.
- Rule 14: the placeholder an intake left is deleted at the next sync; a client with an e-mail is kept.
- Updated: `properties-ical.unit.test.js` (UTC instant now in Paris), `platforms-and-ical-rework.unit.test.js`
  (`disabled: false`), `lodgify-decommission-native-feeds.unit.test.js` (the conflict mail names the
  platform it is given).

### Server unit tests — 2026-10-27 audit

- `server/src/tests/ical-nameless-summary-matching.unit.test.js` (6 cases, with
  `specs/ical-summary-fallback-cross-uid.md` rule 7) — rule 15: two platforms' « Reserved » on the same
  dates → two stays, the second flagged; a guest named on two feeds is still one stay.
- `server/src/tests/ical-parser-edges.unit.test.js` (4 cases) — rule 16.
- `server/src/tests/ical-safe-feed-fetch.unit.test.js` (11 cases, 2026-10-28) — rule 17: address classes, literal / name / redirect refusals, redirect cap, 5 MB cap (declared, streamed, text), the dev setting, the source-level message.
- `ical-import-hardening.unit.test.js` sets `GUESTFLOW_ICAL_ALLOW_PRIVATE=1`: its fetch tests use a loopback server.

### Client tests

- `components/property/__tests__/PropertyPlatformsTab.sync-status.test.jsx` (rules 2, 9, 10).
- `components/__tests__/IcalExportCard.copy.test.jsx` (§6 copy).

### Manual UI verification

- Logement › Plateformes & iCal on a copy of the Solio database at 390 and 1280 px: a stopped source
  shows « Arrêté » and no « Synchroniser »; the status lines are one short sentence; no « 0 ».

## 8. Out of scope

- Unifying « Désactiver » (`disabled`) and « arrêté » (`isActive`) into one control: still the open
  arbitration of `specs/lodgify-decommission.md` rule 10.
- `DTSTAMP` as a DATE-TIME and `VALUE=DATE` on the export (review n2): left for after the
  `master` hotfix lands, so the export model merges cleanly between the two branches.
  **Re-examined at the 2026-10-27 audit and kept as is:** the export is read today by Booking,
  Airbnb, Abritel, Gîtes de France, GreenGo and Abracadaroom, and all of them block the dates with the
  current `DTSTART:YYYYMMDD`. Nothing in the repository says how each importer parses the line; one
  that matches `DTSTART:` literally would stop blocking every date — an overbooking on every channel,
  silent until a guest arrives. The change needs a verification per channel (one blocked date read
  back by quote on each extranet, `platform-tariff-rollout` style) before it ships; it is not worth
  that risk without such a check.
- Re-attributing, in production data, the stays whose shared client already carries a guest's
  e-mail: the diagnostic script lists them; the repair is by hand.

## 9. Open questions

- Q: Should « Désactiver » also stop the import, so that one flag exists for the operator?
  - Open — `specs/lodgify-decommission.md` rule 10's arbitration.

## 10. Implementation progress

- 2026-10-18 — implemented on `fix/review-ical-intake` → `inte/plugins`.
- 2026-10-27 — audit: rules 15 (nameless cross-source de-dup) and 16 (parser edges) added; the export
  format decision recorded in §8.
- 2026-10-18 — second review: rules 11–14 added (GdF « BOOKED », repeated UID keeps its stay, conflict
  flag cleared, orphan placeholders deleted); 20 server cases.
