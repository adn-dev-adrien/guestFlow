# Lodgify decommission — Booking, Airbnb and Abritel back on native iCal

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/lodgify-decommission` _(Claude-managed)_ |
| **Created** | 2026-09-21 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Decision page** | [docs/specs/2026-09-21-lodgify-decommission.html](../docs/specs/2026-09-21-lodgify-decommission.html) |

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

---

## 4. Architecture

> Fat backend, thin frontend: every rule above lives in the sync engine. The client only shows the
> three new counters in the text it already renders.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `propertyIcalModel.js` | T | `syncSource`: Booking keeps its `CLOSED` events, superseded-UID skip, takeover step, Booking UID re-claim, echo filter, conflict flag, new counters and message; conflict notification post-commit |
| `models/` | `icalExportRangesModel.js` | C | Export snapshot diff → tombstones; active tombstones (72 h); purge (7 days) |
| `models/` | `icalModel.js` | T | `exportProperty` refreshes the snapshot each time a feed is served (never allowed to break the feed) |
| `utils/` | `icalBookingEcho.js` | C | Pure function: event range + covering ranges → `echo` / `partial` / `free`, night by night |
| `utils/` | `icalParser.js` | T | `parseIcsEvents(ics, { keepUnavailable })` — the caller decides from `platformKey` |
| `utils/` | `notificationService.js` | T | `notifyBookingConflict(id, { origin: 'ical' })` — conflict copy for the Booking feed |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Purge tombstones older than 7 days in the existing iCal task |
| `database.js` + `schema.sql` | both | T | Create `ical_export_ranges`, `ical_export_tombstones`, `ical_superseded_events` (idempotent) |
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

`tests/property-ical-dedup.unit.test.js` — its schema gains `kind`, `bookingConflictAt` and the three
tables, because its Booking source now goes through the Booking path.

### Manual verification
- [ ] On a prod copy (`DB_PATH`), point the Booking source at a recorded native feed fixture and run a sync: no duplicate, echoes counted.
- [ ] Mobile: the longer sync message wraps without horizontal scroll on the sources screen.
- [ ] E2E suite and client Vitest suite still green.

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
- Q6: L'Estiva's Booking degressivity stops at −15 % for 7 nights where the recipe asks for
  24/33/38/41/43/45 %. Build the missing plans or leave it?
  - A: **Resolved 2026-10-15** — build them. Five derived rate plans (2 to 6 nights) are created and
    the weekly plan goes from −15 % to −45 %. Leaving it would have kept a high-season week at about
    1 598 € on Booking against 1 020 € on Airbnb for the same tent, which is not a price difference
    but a channel that cannot be booked.

---

## 10. Switch-over runbook (operations, after the code is released and installed)

Order matters: a channel is never left without a sync path, and Lodgify is cancelled last.

1. **Backup** the production database; screenshot each channel's calendar for the next 12 months.
2. **Check Abritel first.** In the Abritel partner space, find out whether listing AB 2622643
   (property 123465737) is owned by the Lodgify integration. If disconnecting would deactivate it or
   drop its reviews, stop and ask Vrbo support for a transfer to a direct owner account before going
   further on this channel.
3. **Relabel in GuestFlow** every future reservation filed under `Lodgify` that actually came from
   Booking, Airbnb or Abritel (rule 4). Create the `Abritel` platform at 15 % (rule 12).
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
      extra-guest fee (reset to 0) and every length-of-stay discount. Budget for a full re-entry of
      the grid, not a spot check.
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
