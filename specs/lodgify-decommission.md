# Lodgify decommission — Booking, Airbnb and Abritel back on native iCal

| Field | Value |
|---|---|
| **Status** | Implemented (amendment rule 14, 2026-10-22) |
| **Branch** | `feature/lodgify-decommission` _(Claude-managed)_ |
| **Created** | 2026-09-21 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Decision page** | [docs/specs/2026-09-21-lodgify-decommission.html](../docs/specs/2026-09-21-lodgify-decommission.html) — rule 14: [docs/specs/2026-10-22-booking-tombstone-owner.html](../docs/specs/2026-10-22-booking-tombstone-owner.html) |

---

## 1. Context

Lodgify was bought for two jobs: the booking engine on domainesolio.com and the channel manager that
pushes prices and availability to **Airbnb, Booking.com and Vrbo/Abritel** through their APIs. The
first job is gone: since 2026-09-15 the site is WordPress and direct bookings go through the
WordPress → GuestFlow tunnel. Only the channel manager is left, and the operator wants it gone too so
that **GuestFlow is the only hub**, as it already is for Gîtes de France, GreenGo and Abracadaroom.

How the two properties are wired today (read on a copy of the production database, 2026-09-21):

| Property | Lodgify rental | GuestFlow iCal sources feeding the three channels |
|---|---|---|
| Aventura Lodge (L'Estiva) | 741262 | `Lodgify` (#5) — carries Lodgify, Booking, Airbnb and Abritel bookings |
| Gîte (La Granja) | 739140 | `Lodgify` (#10) + a native `Airbnb` feed (#2, listing 1398287456607254737) |
| both | — | `Booking` (#11, #12) exist **without URL**: a channel-managed Booking property has no iCal |

Three facts shape the work:

1. **GuestFlow is not a channel manager and will not become one** (decision of 2026-08-13, see
   `.claude/skills/platform-tariff-rollout/`). After the switch, availability travels by iCal both
   ways; prices, promotions, minimum stays and descriptions are edited by hand in each extranet.
2. **The channel bookings already in GuestFlow were imported through the Lodgify feed.** Their
   mapping is `(source #5 or #10, Lodgify UID)`. The native feeds will present the same stays under
   new UIDs and anonymous summaries (`Reserved`, `CLOSED - Not available`), so none of the existing
   fallbacks — all of which key on the guest name — will recognise them. Left alone, every future
   channel booking would be **duplicated** at the first native sync.
3. **Booking.com labels every unavailable date `CLOSED - Not available` in its iCal export, real
   reservations included.** `isUnavailableIcalEvent`
   ([icalParser.js](../server/src/utils/icalParser.js)) drops that summary on purpose, because on
   Airbnb and Vrbo it only means a host block. On a Booking feed it would drop **every Booking
   reservation**: GuestFlow would never know about them, and its export would leave those dates open
   on every other channel — an overbooking machine.

The Booking feed also **echoes back** what it imported from GuestFlow's export: a GreenGo stay
exported to Booking returns as a `CLOSED - Not available` event on the same dates. Treating every
Booking event as a reservation would therefore turn every other channel's booking into a phantom
Booking one.

## 2. Goal

The operator disconnects Lodgify from Booking, Airbnb and Abritel, points each channel at GuestFlow's
iCal export and each native feed at GuestFlow, and GuestFlow keeps an exact picture of every booking —
no duplicate, no lost Booking reservation, no phantom — before the Lodgify subscription is cancelled.

## 3. Functional rules

### A. Taking over the bookings imported through Lodgify

1. **Takeover step in the matching cascade.** An incoming event that found no mapping through steps
   ① to 3.5 of `syncSource` is matched to an existing reservation when **all** hold:
   - same property, **exact** same `startDate` and `endDate`;
   - the reservation is `sourceType = 'ical'` and was imported by **another** source;
   - the reservation's `platform` equals the incoming source's platform label
     (`formatPlatformName`, case-insensitive) — an echo of a GreenGo stay carries `GreenGo`, never
     `Booking`, so it cannot be taken over;
   - exactly **one** reservation qualifies (a property cannot host two stays on the same dates; two
     candidates mean the data is already broken, and the event falls through to the normal flow).
2. On takeover the reservation's `sourceIcalSourceId` / `sourceIcalEventUid` move to the incoming
   source and event, a mapping is upserted for the incoming source, and the **old source's mapping is
   deleted** so the old source can never raise a cancellation alert for it. The reservation itself is
   left untouched (a native feed carries no name and no guest count). A `reservation_history` `update`
   entry records the move (« Origine » : `Import iCal (Lodgify)` → `Import iCal (Booking)`).
2bis. **The old UID is recorded as superseded** (`ical_superseded_events`). While the retired source
   is still active, its sync skips that UID silently — no re-import, no duplicate, no alert. The switch
   therefore does not depend on deactivating Lodgify in the same minute as the first native sync.
3. The takeover runs **before** the Booking echo filter (rule 6): a Booking stay imported through
   Lodgify is a real Booking booking, not an echo, and must be claimed by the native Booking feed.
4. A reservation whose platform is still `Lodgify` but which really came from a channel is **not**
   claimed — the platform equality is the safety. The runbook (§10 step 3) has the operator relabel
   those before the switch. On a Booking feed such a stay is covered, hence skipped as an echo (no
   duplicate, but no link either); on Airbnb or Abritel it is created next to the old one.
4bis. **Booking re-issuing a UID.** The Booking feed has no guest name, so the summary fallbacks are
   blind there. A Booking event with no mapping re-claims this source's own stay with the exact same
   dates when that stay's UID has left the feed and it is the only one. The summary-based re-claim of
   a moved stay (step 3.5, specs/ical-summary-fallback-cross-uid.md) is **off** on a Booking feed:
   every Booking event shares its summary, so a cancelled stay A and a new stay B arriving in the same
   sync would hand A's fiche — notes, payments — to B.

### B. The Booking.com feed

5. For a source whose `platformKey` is `booking`, `isUnavailableIcalEvent` does **not** drop events:
   every event is a candidate reservation, then goes through takeover (rule 1) and the echo filter
   (rule 6). Airbnb, Vrbo/Abritel and all other sources keep today's filter unchanged.
6. **Echo filter (Booking only).** After takeover, a Booking event is an **echo** and is skipped —
   no insert, no mapping — when its nights are **entirely covered** by:
   - reservations of the property imported by another source or entered in GuestFlow, and/or
   - closures applying to the property (`closuresModel`), and/or
   - **tombstones** (rule 7).
   Echoes are counted in the sync result (`échos Booking ignorés`).
7. **Tombstones.** When a range stops being exported by GuestFlow (stay deleted, cancelled, or its
   dates changed), it is written to `ical_export_tombstones` with the time. A tombstone covers an echo
   for **72 hours**, the time for Booking to re-import GuestFlow's feed and drop the dates; tombstones
   older than 7 days are purged by the existing iCal scheduled task. Without it, a cancelled GreenGo
   stay would come back as a phantom Booking reservation for a few hours.
   **Mechanism:** tombstones are not written by the code paths that remove or move a stay (there are
   five of them). `ical_export_ranges` keeps a snapshot of the ranges each property's feed last
   published; the snapshot is diffed against the current reservations **each time the feed is served**
   and **right before each Booking sync**, and every range that disappeared becomes a tombstone. One
   choke point, nothing to forget when a sixth path appears.
8. **Partial coverage.** A Booking event whose nights are only **partly** covered is either a real
   Booking stay adjacent to an existing one that Booking merged into one block, or a genuine
   overbooking. GuestFlow cannot tell, so it **creates** the Booking reservation and flags it
   `bookingConflictAt = now` — the existing conflict badge (fiche + calendar) and admin notification
   do the rest. An overlap is never silently dropped.
9. Booking reservations created from the native feed have no guest name (the feed has none): client
   « Booking », platform `Booking`, as the empty-summary fallback already does today.

### C. Retiring the Lodgify sources

10. A Lodgify source is retired by setting it **inactive** (`isActive = 0`, existing toggle), never by
    deleting it or emptying its URL: an inactive source is not synced, so its mappings raise no
    cancellation alert, and its past reservations keep their origin for the history.
    > **Sans test** — an operator action on the existing `isActive` toggle; that inactive sources are never synced is pre-existing behaviour (`scheduledTasks.performAutoSync` selects `isActive = 1`), covered by its own suites.
    >
    > ⚠️ **Measured 2026-10-16 — this rule cannot be applied from the interface.** The property's
    > platforms tab offers « Désactiver » / « Réactiver » only, and that button writes
    > `ical_sources.disabled`, not `isActive` (`PropertyPlatformsTab.jsx:214`). `disabled` hides the
    > platform's bookings from the property views and blocks the *manual* sync button; the hourly
    > `performAutoSync` ignores it. A source shown « Désactivé » therefore keeps importing every
    > hour. Both Lodgify sources are in that state today — see §11, 2026-10-16. Pending
    > arbitration: give the UI a control that writes `isActive`, make the hourly job honour
    > `disabled`, or rewrite this rule. **Applied 2026-10-16** on both Lodgify sources with a
    > `PUT /api/properties/<id>/ical-sources/<sourceId>` carrying `isActive: false` — which is not a
    > procedure to leave in a runbook, hence the arbitration.
11. The `Lodgify` platform row stays: 17 reservations and their accounting entries reference it, and
    `isDirectChannel()` keeps counting it as an own channel. No new reservation is filed under it.
    > **Sans test** — nothing is changed: the row and `isDirectChannel()` stay as they are.

### D. Abritel

12. `Abritel` is created as a platform (Paramètres → Plateformes, existing UI) with a **15 %**
    commission (« Performance – 2 », measured 2026-08-17), so native Abritel bookings stop landing
    without commission (open item since 2026-08-14).
    > **Sans test** — configuration done by the operator in the existing Plateformes screen (runbook step 3), no code.

**Edge cases:**
- Booking event exactly equal to a closure → echo, skipped (covered by rule 6).
- Booking event on dates GuestFlow has free and no tombstone → a real Booking booking, created.
- Operator blocks dates by hand in the Booking extranet → it arrives as a Booking reservation « Booking ».
  The runbook tells the operator to block in GuestFlow (Réglages → Fermetures), never in an extranet.
- Native feed of Airbnb/Abritel shows a stay whose Lodgify twin is labelled `Lodgify` → not taken
  over, created as a new reservation next to the old one → two stays on the same dates in the calendar,
  fixed by hand (a Booking feed skips it as an echo instead).
- Lodgify feed and native feed both active during the transition → the takeover moves each booking
  once; the Lodgify feed still lists the UID, but it is superseded (rule 2bis), so its next syncs skip
  it and never raise a cancellation alert for it.
- A Booking event overlapping a closure → skipped by the pre-existing closure guard (counted as
  « ignoré (fermeture) »), before the echo filter is reached.
- A stay moved on a channel after takeover → handled by the existing UID and 3.5 steps on the native
  source, like any other feed.

13. **Sync result reporting.** The per-source sync message gains `N reprise(s)`, `N écho(s) ignoré(s)`
    (Booking) and `N en conflit` next to the existing counters, and the counts are stored in
    `lastSyncCounts` (`takenOver`, `echoSkipped`, `conflicts`).

14. **A tombstone never covers the source that owned the stay** _(amendment 2026-10-22)_. A
    tombstone is the 72-hour afterlife of a range GuestFlow exported, so it obeys the same exclusion
    as the live stay did: rule 6 already leaves a Booking source's **own** reservations out of the
    cover, and a tombstone left by one of them is left out too. Concretely, the export snapshot
    records, for each range, the `sourceIcalSourceId` of the stay that held it — `NULL` when the
    range is held by a hand-entered stay or by several stays of different origins — and the
    tombstone inherits it. When a Booking source runs the echo filter, tombstones whose owner is
    **that same source** are not part of the cover; tombstones with another owner or `NULL` cover as
    before.
    **Why** (incident 2026-10-22, gîte, Booking 6669322709): a Booking guest whose card failed
    cancelled and re-booked the same nights (6 → 8 November 2026). The first stay (fiche 22309,
    Booking source #12) left the feed, the operator approved the cancellation alert, the fiche was
    deleted and its range became a tombstone. The new booking then came back — with the **same
    UID** — and every sync skipped it as an echo of the tombstone: the stay was invisible in
    GuestFlow and its nights stayed open in the export to every other channel for 72 hours, which
    is exactly the overbooking the echo filter exists to prevent. A Booking stay cannot be an echo
    of itself: Booking only echoes what it **imports** from GuestFlow, and the import is set to
    « Uniquement les dates réservées » on both properties (§9 Q3), so Booking's feed carries its own
    reservations only (measured 2026-10-22: the gîte's three non-Booking ranges exported by
    GuestFlow are absent from Booking's feed).
    **Ownership stays current.** A takeover (rule 1) changes who owns a range; the sync refreshes the
    snapshot right after it, so a stay cancelled before the export is next served still leaves its
    tombstone under its new owner. Merging duplicate sources (`utils/platformMerge.js`) moves the
    owners of ranges and tombstones to the surviving source, as it already does for reservations.
    **Accepted residual risk:** if Booking ever re-exported the block of its own cancelled stay
    within 72 hours, that block would now be created as a Booking reservation « Booking » instead of
    being skipped. That error blocks nights rather than freeing them and is visible on the calendar;
    once Booking drops the block it raises a cancellation alert for the operator, like any stay
    leaving a feed. It rests on the assumption rule 6 already makes for every **live** Booking stay —
    which GuestFlow exports to Booking and does not count as cover — that Booking does not re-export
    what it imports: the residual risk is not new, rule 14 only extends it by 72 hours.

15. **A stay re-claimed under a new UID drops its pending cancellation alert** _(amendment
    2026-10-22, from the review of rule 14)_. When a stay leaves a feed, its mapping is dropped and a
    cancellation alert waits for the operator (specs/ical-cancellation-approval.md). If the feed then
    carries the same stay under a **new** UID and the sync re-claims the fiche (rule 4bis, or the
    date + original-summary fallback, which on a Booking feed matches every « CLOSED » stay), the
    alert left by the old UID is resolved in the same sync — exactly as an alert is resolved when the
    old UID itself comes back. Without it, the operator approving that alert would delete a live
    stay and free its nights until the next sync re-created it, without its notes or payments.

---

## 4. Architecture

> Fat backend, thin frontend: every rule above lives in the sync engine. The client only shows the
> three new counters in the text it already renders.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `propertyIcalModel.js` | T | `syncSource`: Booking keeps its `CLOSED` events, superseded-UID skip, takeover step, Booking UID re-claim, echo filter, conflict flag, new counters and message; conflict notification post-commit. Rule 14: asks for the active tombstones **excluding its own source**, refreshes the snapshot after a takeover. Rule 15: a re-claim under a new UID resolves the stay's pending alert |
| `models/` | `icalExportRangesModel.js` | C | Export snapshot diff → tombstones; active tombstones (72 h); purge (7 days). Rule 14: the snapshot and the tombstone carry the range's owner source, `listActiveTombstones(propertyId, hours, { excludeSourceId })` |
| `models/` | `icalCancellationModel.js` | T | Rule 15: `resolveForReservation(reservationId, sourceId)` drops the pending alert of a re-claimed stay |
| `utils/` | `platformMerge.js` | T | Rule 14: merging sources also moves the owners in `ical_export_ranges` / `ical_export_tombstones` |
| `models/` | `icalModel.js` | T | `exportProperty` refreshes the snapshot each time a feed is served (never allowed to break the feed) |
| `utils/` | `icalBookingEcho.js` | C | Pure function: event range + covering ranges → `echo` / `partial` / `free`, night by night |
| `utils/` | `icalParser.js` | T | `parseIcsEvents(ics, { keepUnavailable })` — the caller decides from `platformKey` |
| `utils/` | `notificationService.js` | T | `notifyBookingConflict(id, { origin: 'ical' })` — conflict copy for the Booking feed |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Purge tombstones older than 7 days in the existing iCal task |
| `database.js` + `schema.sql` | both | T | Create `ical_export_ranges`, `ical_export_tombstones`, `ical_superseded_events` (idempotent). Rule 14: `ADD COLUMN sourceIcalSourceId` on the first two |
| `controllers/` / `routes/` | — | — | None: sources, toggles and sync endpoints already exist |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` / `components/` | — | — | None: the sync message is server-built text; the conflict badge already exists |

**Component reuse declaration:** consumed — the existing iCal sources screen and conflict badge;
created — none; specific — none.

### 4.3 API contract

No new endpoint. The sync endpoints return three more fields (`takenOverCount`, `echoSkippedCount`,
`conflictReservationIds`), and `ical_sources.lastSyncCounts` gains `takenOver`, `echoSkipped`,
`conflicts`. Backward compatible (additive); the client only renders `lastSyncMessage`.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS ical_export_ranges (      -- what each property's feed last published
  propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL,
  PRIMARY KEY (propertyId, startDate, endDate)
);
CREATE TABLE IF NOT EXISTS ical_export_tombstones (  -- ranges that left the feed (rule 7)
  id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, removedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ical_export_tombstones_property ON ical_export_tombstones(propertyId, removedAt);
CREATE TABLE IF NOT EXISTS ical_superseded_events (  -- relayed UIDs taken over (rule 2bis)
  sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL, reservationId INTEGER NOT NULL,
  supersededBySourceId INTEGER NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (sourceId, eventUid)
);
```

The snapshot starts empty: the first time a feed is served after the upgrade it is filled, and no
tombstone is written for anything removed before that.

**Rule 14 (2026-10-22):** both `ical_export_ranges` and `ical_export_tombstones` gain a nullable
`sourceIcalSourceId INTEGER` (idempotent `ADD COLUMN`). The snapshot keeps its primary key
(`propertyId, startDate, endDate`): a range held by several stays stores the owner only when they
all share it, `NULL` otherwise. Existing rows start `NULL`, which behaves exactly as today; the
snapshot is rewritten in full at its next refresh, so every range has its owner from the first feed
served after the upgrade. Tombstones written before the upgrade keep `NULL` and expire within 72 h.
No data is lost or rewritten.

**Data impact:** additive table, empty at start. Takeover rewrites `sourceIcalSourceId`,
`sourceIcalEventUid` and the mapping rows of reservations it claims — logged in
`reservation_history`, and a production DB backup is taken before the switch (§10 step 1).

## 6. UI / UX

No screen changes. The sync message under each iCal source reads, for example:
« 0 créé(s), 0 mis à jour, **3 reprise(s)**, **2 écho(s) ignoré(s)**, 0 annulation(s) à valider, 5 inchangé(s) ».
A conflicting Booking reservation shows the existing conflict badge on the fiche and the calendar.
Mobile behaviour unchanged (text wraps as today).

## 7. Test plan

### Server unit tests — `tests/lodgify-decommission-native-feeds.unit.test.js` (19 tests)
- [x] `classifyBookingEvent`: echo / partial / free, back-to-back departure day, merged adjacent ranges (2).
- [x] Booking `CLOSED` event on free dates creates a Booking reservation (rules 5, 9).
- [x] Booking echo of a GreenGo stay is skipped and counted (rule 6).
- [x] Echo merging a GreenGo stay and a hand-entered stay is skipped (rule 6).
- [x] Partly covered → created with `bookingConflictAt` (rule 8).
- [x] Airbnb keeps dropping `Airbnb (Not available)` (rule 5, non-regression).
- [x] Booking UID re-issue re-claims its own stay, no alert (rule 4bis).
- [x] A cancelled Booking stay never hands its fiche to a new one in the same sync (rule 4bis).
- [x] Tombstone covers the echo < 72 h, not after (rule 7); refresh / purge (rule 7).
- [x] Takeover by Booking and by Airbnb, history written (rules 1-2).
- [x] Still-active Lodgify neither re-imports nor cancels a taken-over stay (rule 2bis).
- [x] No takeover when still labelled `Lodgify`, when the platform differs, or with two candidates (rules 1, 4).
- [x] Conflict e-mail copy names the Booking feed (rule 8).
- [x] Recorded sync message and counts name the Booking echoes; zero counters stay silent (rule 13).

### Server unit tests — `tests/booking-tombstone-owner.unit.test.js` (rules 14-15, 9 tests)
- [x] Refresh records the owner on the snapshot and on the tombstone; shared range → `NULL`.
- [x] The incident, replayed: Booking stay → leaves the feed → alert approved → same UID back on the
  same dates → **created** as a Booking reservation, not counted as an echo.
- [x] Same, with a **new** UID → created.
- [x] Non-regression: a GreenGo stay cancelled < 72 h ago → the Booking event on its dates is still
  an echo (owner is another source).
- [x] Non-regression: a hand-entered stay deleted < 72 h ago (`NULL` owner) → still an echo.
- [x] A tombstone written before the upgrade (`NULL`) keeps covering, as today.
- [x] Takeover by Booking, then cancellation before the export is served → tombstone owned by Booking.
- [x] Merging two sources moves the export owners to the survivor.
- [x] Rule 15: cancelled then re-booked under a new UID before the alert is handled → same fiche, alert gone.

`tests/property-ical-dedup.unit.test.js` — its schema gains `kind`, `bookingConflictAt` and the three
tables, because its Booking source now goes through the Booking path.

### Manual verification
- [ ] On a prod copy (`DB_PATH`), point the Booking source at a recorded native feed fixture and run a sync: no duplicate, echoes counted.
- [ ] Mobile: the longer sync message wraps without horizontal scroll on the sources screen.
- [ ] E2E suite and client Vitest suite still green.
- [x] **Rule 14 — replay of the 2026-10-22 incident on real data**, run twice — once on `master`,
  once on the fix branch — so the difference is the fix and nothing else. On a copy of the production
  database (`DB_PATH`), Booking source #12 pointed at a local fixture feed: (1) feed carries
  `7ab42760…@booking.com` 6 → 8 Nov → sync creates the stay; (2) feed without it → sync raises the
  cancellation alert; (3) approve it → fiche deleted, tombstone written; (4) feed carries the same
  UID again → sync. Expected: `master` reports « 1 écho(s) ignoré(s) » and no fiche; the branch
  creates the fiche, reports 0 écho, and the export serves 6 → 8 Nov again. Then the GreenGo
  non-regression on the same copy. The output of both runs goes in the PR.
- [ ] The live case cannot serve as the check: tombstone #3 was written without an owner and
  expires on 2026-10-25 around 07:55 (Paris), before any release can be installed. After that time,
  confirm in production that Booking 6669322709 did appear on its own, and complete its fiche.

## 8. Out of scope

- Any price, promotion, minimum-stay or content push to a channel. GuestFlow stays iCal-only.
- Guest names on Booking reservations (the Booking iCal has none; they arrive by the confirmation e-mail).
- Replacing Lodgify with another channel manager.
- Renaming or merging the historical `Lodgify` platform.

## 9. Open questions

- Q1: Should a partly covered Booking event (rule 8) be created with a conflict flag, or only raise an alert without creating anything?
  - A: **Resolved 2026-09-21** — create the reservation and flag it (`bookingConflictAt`); an overlap is never silently dropped.
- Q2: Tombstone window — 72 h?
  - A: **Resolved 2026-09-21** — 72 hours.
- Q3: Does Booking's native export really carry reservations as `CLOSED - Not available` for these two properties? It cannot be read before the connectivity provider is removed.
  - A: **Resolved 2026-10-15** — yes. Once the provider is removed, « Synchroniser le calendrier »
    appears in the extranet (it is hidden while an XML provider holds the property) and publishes a
    feed at `https://ical.booking.com/v1/export?t=<uuid>`. Every reservation comes through as one
    `VEVENT` with `SUMMARY:CLOSED - Not available`, dates only, an opaque `@booking.com` UID and no
    guest identity — so the takeover has nothing but the date range to match on, which is exactly
    what rule 4 assumes. The feed is not instantaneous: the gîte's was empty for the first few
    minutes and then carried its four stays. Booking's sync settings offer « Les dates réservées et
    fermées » or « Uniquement les dates réservées »; the second is what we want, because GuestFlow's
    own calendar is imported *into* Booking and re-exporting those blocks would echo them straight
    back. **The default is not the same on both properties** — L'Estiva was already on « réservées
    seulement », the gîte was on « réservées et fermées » and had to be changed.
- Q4: Can a per-night tiered extra-guest supplement be expressed on a channel?
  - A: **Resolved 2026-10-15** — no, not on Airbnb: it takes a single flat per-night fee, and it does
    **not** apply length-of-stay discounts to it (measured: a 45 % weekly discount of 841,05 € on a
    7-night stay equals 45 % of the accommodation alone, 1 869 €, not of the 2 107 € that includes
    the supplement). Lodgify did discount it, so the cut makes long stays with extra guests dearer.
    Decision: keep the flat fee at the recipe's **first-night** gross (17 € for L'Estiva, net 14 €) —
    it never falls under the net target, and L'Estiva's stays are overwhelmingly 1 to 2 nights.
- Q5: Booking's prices are Lodgify's marked up a flat +10 %, which clears the recipe's net target by
  about 10 € a night. Re-enter the recipe, or reproduce today's displayed prices?
  - A: **Resolved 2026-10-15** — re-enter the recipe. One pricing policy has to govern every channel,
    or the decommission just moves Lodgify's private rules into three extranets. The gross grid
    becomes 339 / 356 / 402 / 486 / 992 / 1069 € for the gîte and 189 / 230 / 265 € for L'Estiva,
    a cut of roughly 3 % (−11.90 € a night in Très basse, −0.20 € at Christmas, where a flat 10 %
    markup and a 15 % regross nearly coincide). The net then lands exactly on target instead of
    above it, and the cut goes the right way on a channel whose click-through is already the
    weak point.
- Q7: Is `platforms.commissionPercent` the rate a channel actually takes?
  - A: **Resolved 2026-10-15 — no, not for Booking.** The recipes hold net targets only; the rate
    lives in the `platforms` table and `propertiesModel.js:693` regrosses with it. Booking was
    recorded at 15 %, its contractual rate, but what it withholds is a single « Commission et
    frais » line measured at **16,44 %** on three settled reservations — the extra point and a half
    being the « Paiements par Booking.com » facilitation fee. The stored rate must be the *measured*
    one, not the contractual one, or every price derived from it misses its net. Corrected to 16.44
    and both grids re-entered. The same measurement is owed on Airbnb (recorded 15.5 %) and on
    Abritel (recorded 15 %, measured 9.7 % at some point — unresolved).
  - A: **Measured on Abritel 2026-10-16 — the stored 15 % is right for today's formula.** The stay
    whose payment Lodgify processed (gîte, 30/01 → 02/02/2026, Lodgify total 861,84 €) was billed
    129,28 € by Abritel's commission statement of 10/03/2026: 15,00 % of the whole total. The
    9,67 % came from the two 2025 stays (165,72 € on 1 714 €), booked before the Lodgify connection
    and paid through Abritel's own payment under the older terms. Still open: whether payment fees
    come on top of the 15 % once Abritel collects again after the cut — asked of Vrbo support.
  - A: **Abritel after the cut, 2026-10-26 — 8 % today, 12 % from « early November ».** Vrbo moved
    both listings to the « Formule à la commission ». Its own pages disagree with each other (the
    support e-mail says 12 %, the pre-publication screen 16,25 %, the listing table 8 %); the
    formula page `p/cyp` is the authoritative one: **5 % commission + 3 % payment processing**. The
    `lodging-supply/commission-update` page announces a flat **12 %, payment processing included**,
    « début novembre », date to be e-mailed; a reservation keeps the rate of the day it is booked,
    and Abritel never reprices the listing itself. `Abritel` is therefore stored at **8**, and must
    go to **12** — with the grid re-entered — the day the change takes effect. No settled payout
    exists yet under this formula: the first one confirms the rate (method of §9 Q7).
  - A: **Measured on Airbnb 2026-10-15 — the stored 15.5 % is exact.** Two settled
    reservations: the gîte's HMEZ45YASB (725 € of nights + 80 € cleaning, « Frais de service
    hôte (15.5 %) » −124,78 €, 124,78 ÷ 805,00 = 15,50 %) and L'Estiva's HM9JRBCT4S (297 € of
    nights, −46,04 €, = 15,50 %). Airbnb's host-only fee model shows « Frais de service
    voyageur 0,00 € » on both, so nothing is hidden on the guest side, and the tourist tax
    travels outside the commissionable base. No correction, and no grid to re-enter — the
    opposite of Booking. Note the base: Airbnb commissions the **cleaning fee** too, which is
    why the gîte's 80 € fee nets 67,60 € and not 80 €.
- Q6: L'Estiva's Booking degressivity stops at −15 % for 7 nights where the recipe asks for
  24/33/38/41/43/45 %. Build the missing plans or leave it?
  - A: **Resolved 2026-10-15** — build them. Five derived rate plans (2 to 6 nights) are created and
    the weekly plan goes from −15 % to −45 %. Leaving it would have kept a high-season week at about
    1 598 € on Booking against 1 020 € on Airbnb for the same tent, which is not a price difference
    but a channel that cannot be booked.
- Q8: The gîte's Airbnb listing bills 80 € of cleaning per stay. GuestFlow has no cleaning-fee
  concept, and neither Booking nor the direct channel charges one, so an Airbnb guest pays 80 €
  above the recipe. Keep it, drop it, or carry it to every channel?
  - A: **Resolved 2026-10-16 — remove it from the Airbnb price and sell the cleaning on site.**
    A first answer the evening before was to keep the fee and disclose it; the operator's call is
    better. Airbnb has no optional-extra mechanism — a cleaning fee is a flat per-stay charge or
    nothing — so the fee is set to **0 €** and the listing's « Autres informations à noter » offers
    the cleaning as an option paid on arrival, in French and in English. Three things fall out of it:
    the Airbnb price is back on the recipe exactly, like every other channel (§9 Q5); the 80 € no
    longer passes through the 15,5 % commission, so it nets 80 € instead of 67,60 € when a guest
    takes it; and it follows the pattern already used for the meals on Booking — an optional service
    priced on site, announced in the listing, never a surcharge discovered at checkout.

---

## 10. Switch-over runbook (operations, after the code is released and installed)

Order matters: a channel is never left without a sync path, and Lodgify is cancelled last.

1. **Backup** the production database; screenshot each channel's calendar for the next 12 months.
2. **Check Abritel first.** In the Abritel partner space, find out whether listing AB 2622643
   (property 123465737) is owned by the Lodgify integration. If disconnecting would deactivate it or
   drop its reviews, stop and ask Vrbo support for a transfer to a direct owner account before going
   further on this channel.

   **Checked 2026-10-16 — stop condition met.** Abritel carries **two** listings, not one: the gîte
   (AB 2577203, property 118194015, 3 reviews) as well as the tent (AB 2622643, property
   123465737). Both sit on the owner account and are mapped in Lodgify on full sync. Lodgify cannot
   disconnect Vrbo itself: the account is decommissioned **by Vrbo** on request, in a time Vrbo
   decides, which elsewhere has left listings unlisted for days. A written request to Abritel
   support asks first for written guarantees (listings stay online, reviews kept, owner-space
   editing and iCal afterwards, cut-over date, commission). Nothing else on this channel moves
   before the answer.
3. **Relabel in GuestFlow** every future reservation filed under `Lodgify` that actually came from
   Booking, Airbnb or Abritel (rule 4). Create the `Abritel` platform at 15 % (rule 12).

   **Done / void, measured 2026-10-16.** The `Abritel` platform exists at 15 %. Of the 14 future
   reservations, the five labelled `Lodgify` are the duplicates of the 15/10 incident, to **delete**
   rather than relabel (§11); none of the others came from a channel under another name. Nothing is
   left to relabel.
4. **Record every channel's current settings** (standard price, derived plans, promotions, minimum
   stays, booking window) — Booking may reset the standard plan when the provider is removed.

   **Booking — record taken 2026-10-15, before the cut.** Two hotels under one group account
   (`hotel_account_id=22925006`): the gîte is `14407976`, L'Estiva is `15343212`. Lodgify is
   `provider_id=689`, connected since 2025-12-04; the connection is managed per hotel at
   `extranet_ng/manage/channel-manager/connections.html?hotel_id=…`, and the red « Déconnecter »
   control is a link to `…/channel-manager/deactivate.html?…&provider_id=689` — **reaching that page
   triggers an SMS second factor**, so the operator has to be at hand for the cut itself.

   What Booking holds today, and what it means for the re-entry:

   - **Only the base rate plan is fed by XML.** Every other plan is marked « Non XML » and is
     *derived* — Booking recomputes it from the base plan as a percentage. The derived plans
     therefore survive the disconnection untouched, and re-entering the grid means re-entering the
     base plan alone. This is the opposite of Airbnb, where the length-of-stay curve is a channel
     setting that the cut wipes.
   - **The gîte's degressivity already matches the recipe** and is already derived: « Gite 3 nuits et
     plus 20 pct » (`68725154`), 4 → 30 % (`68725190`), 5 → 36 % (`68725222`), 6 → 40 %
     (`68725254`), 7 → 42 % (`68725290`, weekly). `gite-2027` asks for 20/30/36/40/42.857, so only
     the weekly plan is off, by 0.86 pt in the house's favour. Base plan: « Peu flexible »
     (`57972851`), flexible 14 days.
   - **L'Estiva's degressivity does not exist.** Its only long-stay plan is « Tarif semaine -15 % à 7
     nuits » (`65366034`) where `aventura-lodge-2026` asks for 24/33/38/41/43/45 % from 2 to 7
     nights. Its base plan is « Lodgify sans annulation » (`60363389`, non-refundable) and a third
     plan « Lodgify avec annulation 3 jours » (`65028316`) sits at +15 %.
   - **Occupancy pricing.** The gîte has none (base occupancy 10 = maximum 10, every per-occupancy
     row disabled): one flat price whatever the party size, which is what the property record asks
     for. L'Estiva charges +17.39 € per guest above 2 (`price-60363389-3/4/5` = 17.39 / 34.81 /
     52.21, cumulative) — within a cent of the 17 € the recipe regrosses from its 15 € net. But that
     configuration is **absent from the weekly plan**, whose per-occupancy rows are all off: a
     seven-night stay on Booking currently collects no extra-guest supplement at all.
   - **No active promotion** on either hotel, so nothing dormant of the kind L'Estiva hid on Airbnb.
   - **Lodgify marks Booking up by a flat +10 %**, not by regrossing from a net target: the gîte's
     334 € becomes 367.40 € and its 319 € becomes 350.90 €, exactly ×1.1. That lands roughly 10 €
     per night *above* the recipe's net target, so applying the recipe is a price cut of about 3 %
     (see §9 Q5).
   - Two future reservations carried the grid faithfully and can be used to check the re-entry:
     `6392081711` (6–8 Nov 2026, 2 nights, 701.80 € = 2 × 350.90) and `5449776734` (25 Jul–1 Aug
     2027, 7 nights, 2 014.18 € = 7 × 496.10 × 0.58).
   - Unrelated but blocking in time: the extranet shows a « Connaître son partenaire » compliance
     banner on both hotels.
5. **Per channel, one at a time — Airbnb, then Booking, then Abritel** (reordered 2026-10-15:
   Airbnb is the cheapest rehearsal — its disconnection is reversible from Lodgify and costs nothing
   but re-entering a price grid, whereas Booking's requires removing the connectivity provider,
   which is irreversible):
   1. Disconnect it in Lodgify (`channels/manager/<canal>`), and on Booking remove the connectivity
      provider in the extranet.
   2. Re-enter prices in the extranet. **Measured on Airbnb, 2026-10-15, for both properties:**
      availability is *preserved* (closures and bookings all survive the cut), but every per-date
      price is wiped — the whole calendar falls back to the single base price — along with the
      extra-guest fee (reset to 0), every length-of-stay discount and every per-date **min-nights**
      window. Budget for a full re-entry of the grid, not a spot check. The re-entry starts at the
      **current date** — the block running from today to the next season boundary is the one that
      gets forgotten — and walks every range of the recipe, including the ranges that cover a single
      day (2026-12-30 on the gîte was missed exactly this way).
   2bis. **Hunt for dormant rules.** A channel-level rule that a channel manager's per-date pushes
      were masking becomes live the moment those pushes stop. L'Estiva carried a +35,75 % Airbnb
      weekend premium that was inert under Lodgify (a Friday quoted at the plain base price) and
      started inflating every Friday and Saturday after the cut. Read the channel's own price rules
      — weekend, seasonal, smart pricing — before declaring a grid posted.
   3. In the extranet, import GuestFlow's export feed for the property (Réglages → iCal export link).
   4. Copy the channel's own export URL into the matching GuestFlow source (Booking #11/#12, a new
      Abritel source, Airbnb for the Lodge), sync it, and read the result: takeovers expected, no
      creation on a date already held.
6. **Set a channel's Lodgify source inactive in the same minute you disconnect that channel**
   (rule 10) — *rewritten 2026-10-15 after it went wrong in production, see §11.* The original
   wording («  once the three native feeds are synced », « not urgent to the minute ») is **false
   and dangerous**. Disconnecting a channel from Lodgify changes what Lodgify's own iCal feed says
   about that channel's stays: it keeps exporting them, but **under fresh UIDs**, anonymised and
   with the guest count flattened to one adult. GuestFlow has never seen those UIDs, so rule 2bis
   does not recognise them and the ordinary create path runs: five duplicate reservations were
   created within five minutes of the Booking cut, on dates already held, worth 5 023,24 € of
   phantom revenue. The Lodgify source must go inactive *before* `performAutoSync` next runs.
   Corollary: the last channel still on Lodgify loses its path into GuestFlow the moment the others
   are cut, so either wire its own feed first or accept a gap and say so.
7. **Test by quote** on each channel: a date held by another channel must be unavailable; a free date
   must price as recorded in step 3.
8. Watch the dashboard for 72 h (new iCal reservations, cancellation alerts, conflict badges).
9. **Only then** cancel the Lodgify subscription.

After the switch, `.claude/skills/platform-tariff-rollout/references/platforms.md` must be updated:
Airbnb, Booking and Abritel become consoles of their own, no longer « nourris par Lodgify ».

---

## 11. Implementation progress

- 2026-09-21 — server implementation, 19 unit tests, rehearsed on a production copy, spec synced (Implemented). No client code: the
  sync message is server-built text.
- 2026-10-22 — **Incident: a re-booked Booking stay hidden as an echo** → rule 14 (Approved 2026-10-22). Measured
  in production (read-only): cancellation alert #15 (fiche 22309, source #12, UID
  `7ab42760238d8b7d27067025d1bb7933@booking.com`) detected 21/10 22:00 UTC and approved 22/10
  06:54 UTC; tombstone #3 (gîte, 2026-11-06 → 2026-11-08) written 06:55 UTC; the same UID back in
  Booking's feed afterwards, skipped by every hourly sync (« 1 écho(s) ignoré(s) » on source #12).
  Production left untouched on purpose so the fix is checked by replay, not by a hand repair.
  Implemented the same day: owner column on the snapshot and the tombstones, Booking cover excludes
  its own tombstones, 6 tests (3 of them fail on `master`, all pass on the branch; full suite 4824/4824).
  Replay on a fresh production copy (`VACUUM INTO`, notifications neutralised, tombstone #3 removed in
  the copy only), same four steps on both codes — step 4, same UID back: `master` creates 0, skips
  1 echo, no fiche, 6 → 8 Nov absent from the export; the branch creates the fiche (source #12),
  0 echo, 6 → 8 Nov exported again. GreenGo non-regression: the echo is skipped on both.
  Review by two agents (correctness, adversarial on the anti-overbooking contract): nothing blocking.
  Fixed from it: owner left stale by a takeover until the next export, source merge not moving the
  owners, a stay re-claimed under a new UID keeping a pending alert able to delete it (rule 15), and
  the residual-risk wording. Shadow run (the app on a production copy, branch code, Booking source
  pointed at a local feed): sync → alert approved from the Dashboard → same UID back → sync from the
  property's « Plateformes & iCal » tab → « 1 créé(s) », fiche on 6 → 8 Nov, tombstone owned by #12,
  dates back in the served export.
- 2026-10-15 — **Booking switched over, both properties, with one production incident.**
  - *The cut itself is benign on Booking and the opposite of Airbnb.* Removing the connectivity
    provider (`.../channel-manager/deactivate.html?...&provider_id=689`, behind an SMS second
    factor, reason « Je change de fournisseur ») **preserves everything**: per-date prices,
    availability, restrictions and every derived rate plan. It only unlocks the extranet — the
    calendar's « XML (non modifiable) » badge becomes « Faire des modifications multiples », and the
    iCal menu appears. Nothing had to be rebuilt; the grid was re-entered only because we chose to
    move it onto the recipe (Q5).
  - *Grids re-entered from the recipes*, derived from `pricing_rules.dateRanges` and the repo's own
    `grossFromNet` at 15 %: 36 bulk ranges on the gîte, 13 on L'Estiva. Verified by public quote on
    the gîte: 682 € for two nights in Très basse (339 × 2 + 4 € of tourist tax), 716 € in Moyenne,
    808 € in Haute, 1 369 € for four nights in Très haute — the −30 % four-night plan applying
    exactly as the recipe asks. Christmas 2027 could not be quoted: at fourteen months it is beyond
    Booking's booking window.
  - *iCal wired both ways.* GuestFlow's export is imported into each hotel, and Booking's own feed
    (`ical.booking.com/v1/export?t=…`) into sources #12 and #11. First sync: **4 takeovers on the
    gîte and 1 on L'Estiva, zero creations** — rule 4 behaving exactly as specified, the five stays
    now carrying their Booking references (6392081711, 6646665983, 5449776734 and the two others).
  - *The incident.* See the rewritten step 6 above. Five duplicates (22310–22314) were created by
    the **Lodgify** source, not by the Booking one, in the minutes following the cut. GuestFlow
    flagged each of them itself with « Ce logement est déjà réservé pour ces dates ». Both Lodgify
    sources were set inactive, the five were deleted after the operator confirmed, and both
    properties' exports returned to their pre-cut counts (32 and 27 events, no duplicate range).
  - *A second thing this spec had wrong about L'Estiva.* Its length-of-stay degressivity was never
    missing (§10 step 4 above says it was): it exists as **six catalogue promotions** created on
    2026-08-14 and running to 2027-12-31 — 2 nights −24 %, 3 −33 %, 4 −38 %, 5 −41 %, 6 −43 %,
    7 −45 %, i.e. `aventura-lodge-2026` exactly. They were missed because only the gîte's promotions
    page had been read. Five redundant rate plans were created and then deleted, and the weekly plan
    put back to its original −15 %, so the listing's discount structure is byte-for-byte what it was
    before the evening. **That structure double-discounted**: the « Tarif semaine -15 % à 7
    nuits » plan and the −45 % promotion stacked, so a seven-night high-season week quoted 954 €
    where the recipe asks 1 020 € (265 × 0.55 × 7). This predated the decommission — before the cut
    the same stacking gave about 700 €. **Fixed the same evening**: the promotions are configured
    for « Tous les plans tarifaires », so the −15 % weekly plan was redundant and was deleted, and
    the promotions alone now carry the curve. Verified by public quote: a seven-night high-season
    stay returns 1 122 € and a three-night 586 €, which are the recipe's 1 020,25 € and 532,65 €
    plus the ~10 % of "taxes et frais" that L'Estiva's quotes carry and the gîte's do not.
    **Rule: one channel, one layer of degressivity** — promotions and derived rate plans multiply.
  - *The commission rate in `platforms` was wrong, and the whole grid with it.* Asked to check the
    net against the commission season by season, the arithmetic held — but only against the 15 %
    stored for Booking. Three live reservations say otherwise: 115,38 / 701,80 = 16,44 %,
    330,72 / 2 014,18 = 16,42 %, 157,97 / 960,96 = 16,44 %. The extra ~1,44 point is the
    « Paiements par Booking.com » facilitation fee, which the extranet bundles into a single
    « Commission et frais » line. At 15 % the grid undershot its net target on **every** season, by
    2,07 € a night on L'Estiva's low season up to 14,74 € at Christmas. `platforms.commissionPercent`
    for Booking was set to 16.44 and both grids re-entered: gîte 345 / 362 / 409 / 495 / 1009 /
    1087 €, L'Estiva 192 / 234 / 270 €.
  - *Verified day by day, not by sample.* The extranet calendar accepts `&from=&until=` in the URL,
    which makes a full sweep possible: fifteen 31-day windows per property, the base plan's price
    read for each date and compared with `grossFromNet(netTarget, 16.44)`. **442 days per property,
    zero discrepancies.**
  - *Lesson for the next channel:* read **every** per-channel rule page (promotions, weekend
    premiums, derived plans, occupancy pricing) on **each** property before concluding anything —
    the two properties of one account are configured differently more often than not. And never
    trust `platforms.commissionPercent`: measure the real take on a settled reservation first,
    because a channel's « commission » line can bundle payment fees the contractual rate ignores.

- 2026-10-15 — **Airbnb switched over, both properties.** Correction to §1: L'Estiva *is* listed on
  Airbnb (listing `1576845044615216441`; the gîte is `1398287456607254737`), so this channel covers
  both properties, not La Granja alone. GuestFlow had no Airbnb source for property 2 — source #14
  created. Both listings disconnected from Lodgify, grids re-entered from the recipes via the repo's
  own `grossFromNet`, and verified by public quote. Booking and Abritel still to do.

- 2026-10-15 — **Airbnb verified season by season, 808 days per listing.** Asked for after Booking:
  the same commission measurement and the same day-by-day read-back on this channel.
  - *The commission is what GuestFlow stores* — 15,50 % measured twice (see §9 Q7). Airbnb is the
    channel where the contractual rate and the withheld rate coincide, because the host fee is a
    single line and the guest fee is zero.
  - *Read without clicking.* The host calendar answers over its own GraphQL:
    `getDLSHostCalendar` with `listingId = base64("StayListing:<id>")`, a start/end date, `lensTypes:
    ["PRICE"]` and `hostCalendarSectionTypes: ["MAIN_VIEW"]` returns one object per day carrying
    `priceData.nativePrice`, `available` and `reservationData`. Three-month windows, 808 days per
    listing from 2026-10-16 to 2028-12-31, compared with `grossFromNet(netTarget, 15.5)`.
  - *Two gaps on the gîte, none on L'Estiva.* 16 → 30 October 2026 was left at the base price 341 €
    where Moyenne asks 358 € (15 nights, −17 € a night), and 30 December 2026 at 341 € where Haute
    asks 404 €. Both are dates the re-entry skipped: the first block starts *today*, and a single
    day wedged between two other seasons (Noël on the 24-25th, Nouvel An on the 31st) is the easiest
    one to miss. **A grid re-entry starts at the current date and must cover every range of the
    recipe, including one-day ranges.**
  - *Everything else matches.* Length-of-stay curve as a per-night-count discount: gîte 20/30/36/40 %
    for 3-6 nights plus 42 % weekly (recipe 42,86 % — Airbnb takes integers, rounding down keeps the
    net above target), L'Estiva 24/33/38/41/43 % for 2-6 nights plus 45 % weekly. Extra guest 30 €
    beyond 10 on the gîte and 17 € beyond 2 on L'Estiva, both the recipe's figures. Weekend
    adjustment back to +0 % on both, smart pricing off, no active promotion, no last-minute or
    early-bird rule.
  - *Min-nights left behind.* Only one custom window survives (gîte, 2027-07-10 → 08-20, 4 nights).
    The recipe's short windows are missing: gîte 2027-05-06 → 05-08 and 2027-11-11 → 11-13 at 3
    nights, L'Estiva 2027-05-06 → 05-08 at 3 and 2027-05-15 → 05-16 at 2. The listing defaults (2
    and 1) apply instead, so those dates accept stays shorter than the recipe allows.
  - *An 80 € cleaning fee only Airbnb charges.* The gîte's Airbnb listing bills 80 € per stay for
    cleaning; GuestFlow has no cleaning-fee concept at all (`cleaningHours` is a housekeeping
    duration, not a price) and neither Booking nor the direct channel charges one. So an Airbnb
    guest pays 80 € above the recipe for the same stay. Open: keep it as extra margin or drop it to
    hold one pricing policy across channels (§9 Q5).
  - *Do not unlink Lodgify from the Airbnb listings yet.* L'Estiva still imports AbracadaRoom,
    Lodgify, GreenGO and GuestFlow. With both Lodgify sources inactive in GuestFlow, that Lodgify
    import is the **only** thing standing between an Abritel booking and an Airbnb double-booking.
    It goes after Abritel is switched over, not before.
  - *Corrected the same evening.* The two price gaps were re-entered (16-30 October 2026 at 358 €,
    30 December 2026 at 404 €) and the four missing min-nights windows created. Read back
    afterwards: **808 days per listing, zero discrepancies**, and the custom min-nights windows now
    read exactly the recipe's — gîte 2027-05-06→08 at 3, 2027-07-10→08-20 at 4, 2027-11-11→13 at 3;
    L'Estiva 2027-05-06→08 at 3, 2027-05-15→16 at 2. The 80 € cleaning fee stays and is now
    disclosed in the listing (Q8).
  - *Unrelated, found while editing:* the gîte's « Autres informations à noter » block says
    different things in French and in English — the English version carries the hot-tub pricing and
    the children's activities, the French one does not. Airbnb does not translate these fields, it
    stores one text per language, so they drift. Worth a pass of its own on both listings.

- 2026-10-16 — **The gîte's Airbnb cleaning fee is removed, the cleaning becomes an option paid on
  arrival** (Q8 re-decided). `pricing-settings/fees/cleaning` set from 80 € to 0 €, and the
  « Autres informations à noter » block rewritten in both languages: « Le ménage de fin de séjour
  est en option : 80 €, à régler sur place le jour de l'arrivée. » / « Cleaning: 80 EUR, optional,
  on arrival. » Verified on a two-night quote: 694 € for 9-10 November 2026 (2 × 341 € plus the
  tourist tax) where the same dates cost 774 € an hour earlier. The English block had to be
  reworded in two places to fit — these fields hold **one text per language, 500 characters each**,
  and the gîte's two versions had drifted apart (the English one carries the hot-tub pricing and the
  children's activities, the French one does not); worth a pass of its own on both listings.

- 2026-10-16 — **The FR/EN description blocks are realigned on both Airbnb listings, and three
  things measured on the way turn out to contradict what is written above.**
  - *The descriptions.* Airbnb stores one text per language per field and never translates, so the
    five fields of each listing had drifted independently. On the **gîte**, four of the five English
    texts were rewritten from the French: the listing summary (it was missing the 3-star rating, the
    beds made on arrival and the sliding rates), « Mon logement » (250 characters about insulation
    and the wood stove, against 770 in French describing the four bedrooms, the terrace, the
    playroom), « Accès des voyageurs » — which still sold **an abandoned pricing model**: « for
    bookings with fewer than 8 people … the "attic" space will not be accessible … an additional
    charge will apply » — and « Autres informations à noter », which was missing the pets and
    reduced-mobility lines the French carries. « Échanges avec les voyageurs » was left as it was,
    the English being richer than the French there.
  - *On the **tent**, three fields held their French text in the **English** slot with the French
    slot empty* (« Mon logement » 1 778 characters, « Accès des voyageurs » 1 154, « Échanges »).
    Each was moved to the French slot and given a real English translation; one broken French
    sentence was repaired in passing (« et les lors de votre départ » → « et nous les reprenons lors
    de votre départ »). The tent's summary and « Autres informations » were already in sync and were
    left alone. Field limits are not uniform: 500 characters for the short blocks, at least 1 778
    for « Mon logement ».
  - *A claim no catalogue backs.* Both listings announce « bain privatisé après 20 h et champagne au
    bord du bain, 50 € ». GuestFlow has no such package: the bath is 30 €/h with
    `hourlyEveningStart 20:00` and `hourlyEveningRate 50`, and champagne is a separate option (40 €
    the bottle, 25 € the half). The listing therefore sells a 40 € bottle plus a 50 € hour for 50 €
    in total. Removed from the gîte's English block (it was English-only there); left on the tent,
    where both languages say it, as an arbitration for the operator. Same question for « Kit
    Aventurier », « plaque de cuisson » and « Option Portage de Bagages », announced on the tent and
    absent from the catalogue.
  - ⚠️ **The Lodgify sources are not stopped.** Both show « Désactivé » in GuestFlow, which writes
    `ical_sources.disabled = 1` — a **display filter**: it hides that platform's bookings from the
    property views (`propertyIcalModel.disabledPlatformLabels`), greys the card and blocks the
    *manual* sync button (`PropertyPlatformsTab.jsx:214`). The hourly job selects
    `WHERE isActive = 1` (`scheduledTasks.js:59-63`) and never looks at `disabled`. Both sources
    still carry `isActive = 1`; source #10 last synced **2026-10-16 05:31:27, success, « 7
    inchangé(s) »**, and both feeds still answer with anonymised stays (15 events on Granja, 7 of
    them future; 26 on L'Estiva, 4 future). Two consequences: Abritel **still reaches GuestFlow**
    through Lodgify, so the warning above about « plus aucun flux » and an urgent overbooking gap is
    wrong as long as Abritel stays connected on the Lodgify side; and **rule 10 has no control in
    the interface** — « Désactiver » cannot write `isActive = 0`. Either the UI gains that control,
    or the hourly job honours `disabled`, or rule 10 is rewritten to match what the screen can do.
    Left as an arbitration, because the right answer changes behaviour for every platform, not just
    Lodgify.
  - ⚠️ **The five duplicate reservations of 15/10 are still in production.** #22316, #22317, #22318,
    #22319 and #22315 (numbers 202610003 to 202610007), all created `2026-10-15 18:41`, all at 0 €
    with one guest and the anonymous client #144, each shadowing a real Booking reservation on the
    same dates and property (#22309 / 6392081711, #22282 / 6396936881, #22301 / 6617083884, #22304 /
    5449776734, #22270 / 6646665983). They carry no money but they occupy the calendar twice on five
    future stays. Deleting a production reservation is irreversible, so it waits for the operator.
  - *Runbook step 3 is smaller than it reads.* Production holds 14 future reservations (2026-10-16 →
    2028-12-31): 5 `Booking`, 5 `Lodgify`, 2 `direct`, 1 `Greengo`, 1 `GitesDeFrance` — **no
    `Abritel`, no `Airbnb`**. So « relabel every future `Lodgify` reservation » has no real subject
    (the five are the duplicates above, to delete, not to relabel), the `Abritel` platform already
    exists at 15 %, and no future Abritel stay exists at all — which makes this the cheapest
    possible moment to cut that channel.
  - *Handover.* The state of the world and the ordered remainder of the Abritel job are written in
    [`docs/rapports/2026-10-16-abritel-handover.md`](../docs/rapports/2026-10-16-abritel-handover.md),
    for a session that picks the channel up from here.

- 2026-10-16 (later the same morning) — **the three findings above are closed, and one of them bit
  back first.**
  - *Deleting a duplicate is futile while its source is active.* The five reservations were deleted
    one at a time through the UI, each identified before the click; the **05:46:27 sync re-created
    three of them** (#22320, #22321, #22322 / 202610008-010, « 3 créé(s) … 4 inchangé(s) »). An
    operator deletion leaves no tombstone the import honours, so the feed's event looks new again at
    the next pass. **This is the lesson to keep**: the order is always *stop the source, then clean*,
    never the reverse — which is runbook step 6 read in the other direction.
  - *Rule 10 applied for real.* On the operator's call, both Lodgify sources were set
    `isActive = 0` — URL, platform key, colour and tax flags preserved, every other source
    untouched. The UI cannot write that column, so it took a
    `PUT /api/properties/<id>/ical-sources/<sourceId>` with `isActive: false` from the authenticated
    session. A forced `sync-all` on both properties then created nothing, and the three late
    duplicates were deleted. Production now holds **9 future reservations** — 5 `Booking`,
    2 `direct`, 1 `Greengo`, 1 `GitesDeFrance`, **zero `Lodgify`** — every real one intact.
  - ⚠️ *The gap is now real.* Lodgify was the last path an Abritel booking had into GuestFlow. From
    today until the switch-over, **a new Abritel reservation does not reach GuestFlow** and blocks
    no dates anywhere else. Bounded — no future Abritel stay exists — but it grows with every day of
    delay, and the Airbnb listings' own Lodgify import is the only remaining guard on that side
    (runbook step 5, do not unlink it).
  - *The champagne evening package is kept, and finally exists.* §9's new question — both listings
    sell « bain privatisé après 20 h et champagne au bord du bain, 50 € » while the catalogue has no
    such package — is resolved by the operator: **keep the offer as announced** and record it, so
    the accounting sees it. Option **#34** « Formule soirée : bain nordique privatisé + champagne »,
    50 € par séjour, catégorie *Animations*, les deux logements, visible côté client. The bottle is
    therefore a deliberate gesture on the evening slot. One thing to watch on the first booking: the
    bath is *also* an hourly resource at 50 €/h after 20:00 and the option does not book that slot,
    so a guest who has already used the free hour in the daytime could be billed 50 € twice.
  - *Side finding.* Option #34's description came back as « … réservé aux adultes. » where
    « Réservé » was typed — the capital is lost on free text, which the existing
    `fix/free-text-keeps-case` branch addresses. The field is guest-facing.

- 2026-10-16 (afternoon) — **Abritel step A: stopped, as the runbook asks.**
  - *Two listings.* The partner space lists the **gîte** (AB 2577203, property 118194015, unit
    326936714, 3 reviews) and the **tent** (AB 2622643, property 123465737, no review), both
    « Performance - 2 (15 % pour chaque réservation) », online on Abritel and Expedia. Every earlier
    note knew the tent only. Lodgify's Vrbo page maps both, full sync, « Synchronisé ».
  - *No self-service cut.* Lodgify's help centre: a Vrbo account is disconnected by asking Vrbo for a
    decommissioning (FR: aide.abritel.fr/contact), one listing by asking Lodgify to drop the mapping,
    and Lodgify's connectivity team finalises. Vendors report listings unlisted for days or
    archived along the way, which is the loss step 2 guards against. A written request is sent
    before anything is touched.
  - *Interim.* Lodgify still imports GuestFlow's export of both properties every two hours, so
    Abritel cannot sell a date held elsewhere. The reverse is open: an Abritel booking does not
    reach GuestFlow, and is entered by hand from its notification e-mail (operator's call).
  - *Commission.* 15 % confirmed for the current formula (§9 Q7).
  - *Recorded for step 4 (Lodgify → Vrbo settings).* Gîte: markup 4 %, cleaning fee **80 €**, room
    tax 1,20 €, promotions 3 → 7 nights 20/30/36/40/42,85 %. Tent: markup 7,5 %, room tax 5,51 %, VAT
    10 % included, promotions 2 → 7 nights 24/33/38/41/43/45 %. Both « Modérée », instant booking,
    booking window 550 days. The gîte's Vrbo cleaning fee is the same question as Q8 on Airbnb.

- 2026-10-26 — **Abritel switch-over, gîte: disconnected by Vrbo, re-entered, wired, back online.**
  - *The cut.* Vrbo support disconnected the account from Lodgify on request (§10 step 2) and left
    both listings **hidden**, on the « Formule à la commission ». The gîte kept its 3 reviews (10/10).
  - *What the cut left behind.* Every per-date price at **9 999 €** on both listings, the base rate
    included; a mandatory **80 €** cleaning fee and **« Enfants non acceptés »** on the gîte; the
    « Modérée – 30 jours » cancellation policy intact. No length-of-stay discount, no promotion.
  - *Commission.* Measured on the formula page, not taken from the e-mail: 8 % until early November,
    then 12 % (§9 Q7). Stored at 8.
  - *Grid.* `gite-2027` regrossed at 8 % by `/platform-prices`: 314 / 329 / 371 / 449 / 917 / 987 €,
    36 date ranges from today to 2027-12-31, per-date minimum stays (2, 3 on the May bridge and on
    11-13 Nov 2027, 4 in Très haute), extra guest **28 €/night above 10**. Abritel offers only a
    7-night and a 28-night discount: the weekly one is set to **42,85 %** (the recipe's 42,857 %
    rounded down so it never undershoots the net), 2 to 6 nights sell at the full nightly price
    (operator's call). Cleaning fee to **0 €**, sold on site as on Airbnb and Booking (§9 Q8);
    children accepted, all ages. Written through the calendar's own `ratesAndDiscountsOverride` and
    `minStayOverride` mutations and read back through `getRatesAndAvailability`: **432 days, zero
    discrepancy** on price, weekly discount and minimum stay.
  - *Feeds.* GuestFlow's export of La Granja imported on Abritel as « GuestFlow ». Abritel's own
    export (`abritel.fr/icalendar/<hash>.ics?nonTentative`) carries only Abritel's native stays —
    no echo of imported dates — and is wired as GuestFlow source **#15** (`Abritel`, La Granja). Its
    first sync created two **past** reservations at 0 €: #22328 (24→26/10/2025, « Reserved -
    Adrien ») and #22329 (31/12/2025→03/01/2026, « Reserved - Carole », the twin of #22201, a
    hand-corrected Lodgify fiche with its own accounting). The takeover does not fire (different
    platform label, one night apart), and relabelling #22201 to `Abritel` to force it would switch
    its tourist-tax mode and move its totals (1 222 € → 1 246 €) on a past stay — not done.
    Operator's calls: #22328 priced at the 2025 « Standard » rate (2 × 100 €) and marked paid on
    26/10/2025; #22329 **left as it is** next to #22201 (0 €, no money is misstated, 2025 counts one
    stay too many).
  - *Back online* through `p/listing-status` → « Réactiver l'annonce » (« Publier l'annonce » alone
    only leaves it « Masquée »). Cancellation still « Modérée – 30 jours » after publication.
  - *Quotes, public page, 2 adults unless stated* — each one is the recipe at 8 % plus 1,20 € of
    tourist tax per adult and night: Moyenne 2 nights 663 € (2 × 329), Haute 747 € (2 × 371), Très
    haute 4 nights 1 806 € (4 × 449), Noël 1 979 € (2 × 987), Très basse 2 nights 633 € (2 × 314),
    a week 2 215 € − 942 € (−42,85 %), 12 guests 769 € (+ 2 × 28 € × 2). 6→8 Nov 2026 (held on
    Booking) is unavailable; 2 nights in Très haute are refused (minimum 4). Nouvel An could not be
    quoted (31/12/2026 is booked, 31/12/2027 is beyond the 12-month window); its 917 € is among the
    432 days read back. The public page took about twenty minutes to stop answering « pas
    disponible » after the reactivation.
  - ⚠️ *Deadline.* The owner dashboard dates the 12 % formula « à compter du 29 octobre ». On that
    day: `Abritel` → 12 in Paramètres → Plateformes, then re-enter the grid (gîte 328 / 344 / 388 /
    470 / 958 / 1032 €, extra guest 29 €), or every Abritel night booked afterwards nets ~4 % under
    the recipe.
  - *Left on the gîte's Abritel calendar:* three older imports (Gîtes de France, Airbnb, GreenGo)
    that GuestFlow's feed now covers; they double every stay as a « Conflit » badge (dates stay
    closed either way). Removal is the operator's, the session's attempt being refused.
  - *Tent.* Blocked by Abritel itself: « Nous avons besoin de plus d'informations sur votre
    annonce. Veuillez nous contacter » over its calendar, and « Expirée – aucun abonnement actif ».
    Nothing done on it; prices still at 9 999 €; support to be written to.

- 2026-10-26 (afternoon and evening) — **Lodgify cut entirely, subscription cancelled.** The
  operator asked that nothing go through Lodgify any more, ahead of §10 step 8's 72-hour watch:
  every channel already had its own sync path, and Abritel's dynamic pricing was the last open item.
  - *Abritel dynamic pricing.* Switched on by Abritel on the gîte after its reactivation, without
    being asked. The operator turned it off from MarketMaker once support had answered. Read back
    afterwards: 432 days, 0 difference from the grid. Support also confirmed the rates: **8 % + VAT
    until 2026-10-28, 12 % VAT included from 2026-10-29** (the deadline above stands). The tent was
    unblocked by support; reactivating it is left to the operator.
  - *Export first.* Every Lodgify booking was exported to CSV and archived outside the repository:
    41 bookings (December 2025 → 15/10/2026) and 24 more in the bin. The export URL
    (`/oh/PropertyOwner/QuoteReport?filter=<base64 JSON>`) only answers a real browser download;
    a scripted request gets a Cloudflare 403. The last Lodgify booking (15/10) is Booking #22324,
    already in GuestFlow: nothing was missing.
  - *Cut, channel by channel.* The Airbnb tent listing's « Lodgify » calendar import was removed
    (AbracadaRoom, GreenGO and GuestFlow remain; the gîte imports GuestFlow only). Google Vacation
    Rentals: both properties « Non publié ». The Lodgify website was taken offline (« Site web
    introuvable »). Both GuestFlow Lodgify sources had been inactive since 2026-10-15. Vrbo still
    shows « Synchronisé » in Lodgify, but Vrbo had already cut it on its side; the cancellation
    ends it.
  - *Subscription.* Cancellation requested from Paramètres → Facturation. The plan was two years,
    already paid until 2027-11-26. Billing still read « Actif » that evening: check it again before
    considering the step done.
  - *Consequence: Google.* The Solio properties no longer appear in Google's « Locations de
    vacances » results. A lodging Business Profile has no booking-link field, so the only way back
    is a direct Google Vacation Rentals connection. The interest form was sent on 2026-10-26, and
    GuestFlow's feed is the `google-vacation-rentals` plugin (`specs/google-vacation-rentals-feed.md`,
    §11 holds the steps to resume when Google answers).

- 2026-10-27 — **Abritel: the tent found online with no calendar import, then switched over.**
  - *Found.* The operator had reactivated the tent (AB 2622643, « Formule à la commission », « En
    ligne »). Its calendar had **no iCal import and no event**: every night up to 2028-12-31 was
    bookable, the winter closure and the stays sold on the other channels included, at a flat
    250 €, minimum 1 night, no discount. Abritel's own export was empty: nothing had been booked
    in the meantime.
  - *Calendar, both ways.* GuestFlow's L'Estiva export imported into the tent's Abritel calendar
    (« GuestFlow », status SUCCESS; the two winter closures and every L'Estiva stay read back as
    blocked). GuestFlow source **#16** « Abritel » on L'Estiva, the listing's export
    (`abritel.fr/icalendar/<hash>.ics?nonTentative`), same tourist-tax settings as the gîte's #15;
    first sync 0 events.
  - *Grid, straight at 12 %* (operator's choice, two days ahead of the switch): 182 / 222 / 256 €
    (net 160 / 195 / 225), the recipe's minimum stays, **−45 % from 7 nights** — Abritel offers no
    2-to-6-night discount, so the tent's degressivity does not exist there and shorter stays cost
    more than on the other channels (operator's choice). Written with `ratesAndDiscountsOverride` +
    `minStayOverride`, read back: 431 days to 2027-12-31, 0 difference. 2028 keeps the flat 250 €:
    GuestFlow has no tent price beyond 2027, and its first months are closed anyway.
  - *Extra guest:* **16 € per guest and night above 2** (the recipe's first-night tier at 12 %;
    Abritel cannot express the 8 € from the second night, the operator chose never to undershoot).
    There was no extra-guest fee at all before.
  - *Public quotes, 2 adults unless stated:* 2 nights in Haute 2027 = 512 € of rent (531 € with
    taxes), 4 guests 608 € (+ 2 × 16 € × 2), a week in May 1 394 € − 627 € (−45 %), November 2026
    unavailable.
  - *Gîte, re-checked the same day:* 431 days, 0 difference from the 8 % grid (no dynamic-pricing
    drift), extra guest 28 € above 10, no cleaning fee; GuestFlow's `Abritel` platform still at 8 %.
  - ⚠️ *Still due on 2026-10-29:* `Abritel` → 12 in Paramètres → Plateformes, and the gîte's grid
    at 12 % (328 / 344 / 388 / 470 / 958 / 1032 €, extra guest 29 €). The tent is already there.
