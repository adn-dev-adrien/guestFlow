# Calendar parity — one source, one scroller, readable bars

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/calendar-property-parity` _(user-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Amends** | `cumulative-month-calendar.md` (rules 2, 6, 7), `ui-review-2026-10-19-operations.md` (rules 13, 14 superseded), `platforms-and-ical-rework.md` (rule 10 superseded for every reservation view), `calendar-mobile-view.md` (rules 1, 2 superseded), `calendar-page-decomposition.md` (the month grid becomes a month block) |

---

## 1. Context

Owner feedback on the `inte/plugins` shadow, 2026-10-28 (prod copy of 2026-10-22). Five complaints about
the two calendars — the all-logements calendar (Dashboard + « Calendrier » → « Tous ») and the calendar
of one logement (« Calendrier » → a logement). Each one was reproduced on a copy of the shadow and
traced to its cause.

**1. The logement calendar misses stays the general calendar shows.** On the shadow, for La Granja and
the range 2026-01-01 → 2027-12-31, `GET /api/reservations?from&to` returns **33** Granja stays and
`GET /api/reservations?propertyId=1&from&to` returns **4**. Cause:
[reservationsModel.js:727-736](../server/src/models/reservationsModel.js#L727) — when `propertyId` is
given, `list()` adds a display filter that drops every stay whose platform has an `ical_sources` row
with `disabled = 1` for that logement (`platforms-and-ical-rework.md` rule 10). The general calendar
passes no `propertyId`, so it never applies it: the two calendars read two different sets.
- On the **shadow**, all 12 iCal sources are `isActive = 0, disabled = 1` (the shadow was neutralised so
  it would not sync), so every platform stay disappears from the logement calendar — only `direct` and
  `Abritel` survive. That is why « il en manque beaucoup ».
- In **production** (snapshot of 2026-10-22 17:04), only the two `Lodgify` sources are `disabled = 1`
  (the Lodgify decommission, 2026-10-16). The bug is real there too: the 10 `Lodgify` stays (old direct
  bookings, 2025-12-31 → 2026-08-16) are missing from both logement calendars, while their dates stay
  blocked. Any future « Désactiver » would do the same to a live platform.
- Side effect found on the way: [ReservationPage.jsx:791, 821, 969, 1114, 2012](../client/src/pages/ReservationPage.jsx#L791)
  loads `getReservations({ propertyId })` to flag date conflicts in the fiche. A hidden stay is not
  flagged there (the server's availability check still refuses the save, so no double booking).

**2. The general calendar's colours are too faded.** Since `ui-review-2026-10-19-operations.md` rule 14,
a stay bar is a **14 %** tint of its platform colour with a 3 px stripe
([CumulativeMonthCalendar.jsx `barTint`](../client/src/components/CumulativeMonthCalendar.jsx#L35)).
At 14 % the eight platform colours collapse into near-identical pastels. The palette itself has two
collisions that a stronger fill would expose: `direct #c9a227` vs `GitesDeFrance #e6c832` (two golds),
`booking #003580` vs `abritel #1565c0` (two blues). And the pre-10-19 solid bars printed white text on
colours where white reaches only 1.7:1 (Gîtes de France), 2.3:1 (Abracadaroom), 2.4:1 (direct) — that
is why the tint was introduced. [server/src/constants/platformColors.js](../server/src/constants/platformColors.js),
mirrored in [client/src/constants/platforms.js](../client/src/constants/platforms.js#L20). A custom colour
(`platforms.color`, Paramètres → Plateformes) is stored without any validation
([platformsModel.js `setColor`](../server/src/models/platformsModel.js#L236)) — prod has one: Lodgify `#fec700`.

**3. The logement calendar does not scroll like the general one.** Both use `useInfiniteMonthScroll`,
and the wheel does extend the logement grid both ways (measured: 4 → 31 months loaded). What differs:
- The logement view is a **continuous** week grid with no month title; the general view is stacked
  month blocks with a sticky « Octobre 2026 » title.
- The logement view's bar carries **‹ Mois précédent / Mois suivant ›**
  ([CalendarPage.jsx:410-416](../client/src/pages/CalendarPage.jsx#L410)). They call
  `prependMonth` / `appendMonth`, which add a month above or below **while keeping the view still**
  (`cumulative-month-calendar.md` rule 11). Clicking them visibly does nothing: « il n'affiche pas les
  mois passés ou futurs ».
- Every month added refetches the **whole** loaded range (6 requests, the property itself included)
  with no sequence guard ([CalendarPage.jsx:85-121](../client/src/pages/CalendarPage.jsx#L85)): fast
  scrolling can let an older, narrower response overwrite a newer one. The general view caches per month.
- On a phone the logement view is a **week pager** (swipe left/right, `CalendarWeekView`); the general
  view is a vertical month agenda.

**4. A closure sits below its logement's stays, full-day.** Since `ui-review-2026-10-19-operations.md`
rule 13 a closure is a texture: a hatched band along the bottom of the week row, below every lane
([CumulativeMonthCalendar.jsx `buildMonthLayout`](../client/src/components/CumulativeMonthCalendar.jsx#L120)),
on whole days. On `master`, a closure was a bar **in its logement's lane group**, half-day at both ends
(`git show origin/master:client/src/components/CumulativeMonthCalendar.jsx`, lines 79-160) — the owner's
reference. The shadow's case: La Granja, stay 9 → 11 Oct, closure `startDate 2026-10-11`,
`endDate 2026-10-13` (`endDate` = reopening day, exclusive — `establishment-closures.md` §6).
- `master`'s geometry ran from the middle of `startDate` to the middle of `endDate − 1`: 11 → 12 here,
  which is what the owner describes. The same rule draws a **one-night** closure (`endDate = startDate + 1`)
  with zero width — invisible — and shows the last closed night (12 → 13) as free.

**5. A guest name is unreadable on the logement calendar.** Not the length. The 16-character name of the
29 Dec → 2 Jan Granja stay measures 110 px in a 149 px cell — it fits. Measured in the browser, its
`<p>` is **3.9 px tall** (`scrollHeight` 16). Cause: the 2026-10-27 fix F13 put
`overflow: hidden` on the name ([CalendarDayCell.jsx:15 `FIT`](../client/src/components/CalendarDayCell.jsx#L15));
the mid-stay cell is a fixed-height (64 px) flex column with 24 px of vertical padding, so 16 px of
content height for two lines (15.4 + 12.1 px). `overflow: hidden` turns the name's `min-height: auto`
into 0 and flex-shrink crushes it to 4 px — the platform line, without overflow, keeps its height.
**Every** mid-stay name on the logement calendar is clipped this way, short ones included; a long one
would also be cut to one cell (the label lives on a single « middle day » cell, ~1/7 of the row). Two
aggravating factors on the same stay: white text on `direct #c9a227` (2.4:1), and on 25 Dec / 1 Jan the
« férié » marker drawn over the top of the cell.

**The stays the filter hides in prod are not duplicates (measured 2026-10-28 on `prod-snap.db`,
2026-10-22 17:04).** The 10 `Lodgify` stays hidden from the logement calendars were checked one by one
against every other `kind = 'reservation'` stay of the same logement:
- **1 overlaps another stay** — reservation **22279** (Granja, 2026-04-13 → 04-17, iCal import of
  2026-08-25, 0 €, no payment, never edited) sits on direct reservation **14** (2026-04-13 → 04-16).
  A real duplicate.
- **9 overlap nothing** — 22201, 22224, 22226, 22227, 22229, 22242, 22269, 22271, 22272: past stays
  (2025-12-31 → 2026-08-16), balance paid, fiches edited (2 to 15 history events each). They are real
  stays that Lodgify relayed: no other row exists on their dates, so they cannot exist again under
  another platform. The Lodgify decommission re-attributed the live stays in place
  (`ical_superseded_events`: 5 UIDs, same reservation ids) rather than duplicating them. These 9 are
  already shown by « Tous », the finance pages and the accounting export; only the logement calendar
  and the fiche's conflict hints hide them.

**Data freshness.** The shadow is a prod copy of 2026-10-22: the latest real reservation was created
`2026-10-22 12:32:39` (reservation 22324). Reservation 22326, created `2026-10-28 07:09`, was entered on
the shadow during the test. The two stays the owner looked for are not in the copy at all (no client
with either surname) — they were booked after the copy, nothing is lost.

## 2. Goal

The two calendars show the same stays, scroll the same way, and stay readable: each stay is a distinct,
solid, legible bar; a closure sits on its logement's row with the same half-day edges as a stay; a guest
name is always readable or truncated cleanly with the full name on hover.

## 3. Functional rules

### One source of truth

1. **Both calendars read one endpoint.** The general calendar and the logement calendar both read
   `GET /api/calendar?from&to[&propertyId]`, served by one model function. `propertyId` only restricts
   the logement: for any range and any logement P, the logement calendar's stays and closures are exactly
   the general calendar's ones whose `propertyId` is P (closures: P's own and the global ones).
2. **A calendar never hides a stay that occupies dates.** The set is every `kind = 'reservation'` row
   (a cancelled stay has `kind = 'cancelled'` and stays out), whatever its platform and whatever the
   state of that platform's iCal source. The display filter of `platforms-and-ical-rework.md` rule 10 is
   removed from `reservationsModel.list()` too, so the fiche's date-conflict hints see the same stays.
   « Désactiver » on a platform row keeps its other effects: no import, greyed row, « Désactivé » chip.
3. **The server shapes every bar.** Each stay arrives with `label` (« Prénom Nom », else the iCal
   summary, else « Réservation #id »), `platformDisplay`, `color`, `textColor` and `past`
   (`endDate ≤ today`, the server's calendar day). Each closure arrives with `global`, `propertyName`
   and `label`. The client never derives a colour, a text colour, a label or a past flag.

### Colours

4. **A current or future stay is a solid bar.** Fill = the platform colour, text = `textColor`. Same
   colour in both calendars, the phone agenda chip and the legend swatch.
5. **`textColor` is the more readable of white and ink.** The server picks `#FFFFFF` or the theme ink
   `#27251F`, whichever has the higher WCAG contrast ratio on the fill.
6. **Default palette: one hue per platform.** Built-in colours become:
   `direct #2F5D46` (sapin, white text 7.6:1), `Airbnb #C93848` (white 5.1:1),
   `Booking #1B3F8B` (white 9.9:1), `Abritel #4FA3E0` (ink 5.6:1), `Abracadaroom #8A55B2` (white 5.2:1),
   `GreenGo #8BC34A` (ink 7.3:1), `GitesDeFrance #F2CC3D` (ink 9.8:1), `Pitchup #EF7D22` (ink 5.6:1),
   unknown platform `#6E6A5E` (white 5.4:1). A platform with a custom colour keeps it.
7. **A platform colour must be readable on the calendar.** `PUT` of a platform colour is refused (400)
   when it is not `#RRGGBB` (« Couleur invalide. »), when neither white nor ink reaches 4.5:1 on it
   (« Couleur peu lisible : choisir plus clair ou plus foncé. »), or when it is under 1.4:1 against
   white (« Couleur trop claire pour le calendrier. »). The previous colour stays. A stored colour that
   fails these checks (none in prod) is still served, with its `textColor`.
8. **A past stay fades to a tint.** A stay with `past = true` keeps the current soft look — 14 % tint,
   3 px stripe of the colour, ink text, no opacity — so the eye goes to what is ahead.

### Closures on the general calendar

9. **A logement's closure sits on that logement's row.** It is a lane item of its logement's group,
   packed with its stays: a stay ending the day the closure starts shares its lane (the half-day edges
   meet). A global closure is unchanged: it hatches whole day columns with one « Tout fermé » label.
10. **A closure has a stay's half-day edges.** Its bar starts at the middle of `startDate` and ends at
    the middle of `endDate` (the reopening day), exactly as a stay with the same dates would. A one-night
    closure is half of `startDate` + half of the next day.
11. **A closure bar reads « Fermé ».** Hatched ink texture on paper, label « Fermé » then the closure's
    label, truncated; tooltip and accessible name: « {logement} fermé — {label}, {dates} ». Focusable,
    never opens a fiche.
12. **The logement calendar draws a closure the same way.** The `startDate` cell is hatched on its
    second half (diagonal, like an arrival), the `endDate` cell on its first half (like a departure), the
    days between in full. The free half of the reopening day can still start a selection.

### One scroller

13. **Same scroller, same months.** Both calendars are stacked month blocks in one bounded scroll
    container, each with its sticky month title, extended infinitely in both directions
    (`cumulative-month-calendar.md` rules 6, 7, 11 apply to both). Both open on the current month, or
    on the month a link asks for.
14. **« Aujourd'hui » is the only navigation.** The logement calendar loses ‹ Mois précédent / Mois
    suivant ›. Both calendars have the same « Aujourd'hui » button, which scrolls the current month to
    the top.
15. **Each month is loaded once.** A month's data is fetched when its block first renders and kept
    while the page is open; adding a month never refetches the others. A response for a logement or a
    month that is no longer shown is dropped. Switching logement empties the cache and keeps the month
    that was in view.
16. **Edge days of a block belong to the block.** In the logement calendar, the greyed days of the
    previous/next month at the start and end of a block are real days: same content, interactive, so a
    selection can cross the end of a month.
17. **On a phone, the logement calendar is a day agenda.** Below `sm`, the week pager is replaced by
    the same vertical scroller: month blocks with a sticky title, one row per day with today's per-day
    content (arrival, departure, ongoing stay, devis, closure, note, « + Nouvelle réservation » on a free
    future day, the note button). Opens with today at the top.

### Names on the logement calendar

18. **A name is drawn once per week, across the stay.** On the logement calendar the guest's name and
    platform are one ribbon laid over each week segment of a stay — from the middle of the arrival
    day (or the row start) to the middle of the departure day (or the row end) — not inside a single
    day cell. The ribbon is filled with the stay's `color` (so the diagonal halves under it never
    lower the contrast) and its text uses `textColor`. The day cells keep their diagonals.
19. **Never clipped, truncated only by width.** The label is one line of name and one line of
    platform, never shrunk vertically. Too wide for its segment, the name ends with « … »; the full
    name, platform and dates are in its tooltip on hover and keyboard focus and in its accessible name.
    A tap opens the fiche, as today.
20. **Nothing is drawn over a name.** The day number, the « férié » marker and the zone dots sit in a
    top band of the cell; the name label sits below it and is never covered.

### Phone agenda, as visual as the desktop (decided 2026-10-28)

21. **The phone day agenda carries the stays' colours.** In each day row, a stay is a solid ribbon in
    its `color` with its name and platform in `textColor`: a full-width ribbon on a day inside the stay,
    a ribbon on the right half with « ↓ 16:00 » on the arrival day and on the left half with « ↑ 10:00 »
    on the departure day, the name and « Arrivée / Départ · {plateforme} » written in ink in the free
    half beside it; on a turnover day both halves are ribbons, each carrying its name then its time (the
    time never truncated, the name ends with « … »; tooltip and accessible name complete) — the desktop's half-day geometry, turned into a row. A past stay uses the tint of
    rule 8; a closure is a hatched ribbon « Fermé · {label} », halved the same way on its start and
    reopening days; a devis is a dashed grey ribbon. A free future day keeps « + Nouvelle réservation ».
    Same palette and contrast as the desktop (rules 4-8): no colour is computed on the phone.

### Duplicates the old filter hid (decided 2026-10-28)

22. **A stay can be set aside as a duplicate.** `kind = 'superseded'` with `supersededAt`,
    `supersededByReservationId` and `supersededReason`. Every read that keeps `kind = 'reservation'` drops
    it — both calendars, availability and date conflicts, Planning, lists, finance — and the accounting
    export, which reads `kind IN ('reservation', 'cancelled')`, drops it too. The search still finds it,
    flagged « Doublon écarté ». Its fiche is read-only, with a banner « Doublon de la réservation
    {numéro} » (link) and an admin « Rétablir » that sets `kind` back to `'reservation'` after the usual
    availability check (409 « Ces dates sont déjà prises. » otherwise). The iCal sync never updates,
    re-imports nor resurrects a superseded stay: its UID counts as known and unchanged.
23. **One automatic, idempotent migration keeps today's prod calendars, minus the bug.** At boot, once
    (`migrations` row `calendar_parity_superseded_v1`), before rule 2 takes effect: every
    `kind = 'reservation'` stay that the removed filter hides today — its platform matches an
    `ical_sources` row of its logement with `disabled = 1`, by label or key, case-insensitive, exactly the
    old SQL — **and** that overlaps at least one stay of the same logement that the filter does not hide,
    becomes `superseded`, `supersededByReservationId` = the earliest such overlapping stay,
    `supersededReason = 'disabled-source-duplicate'`. A candidate carrying money (deposit, balance or
    complement paid, or a paid payment link) is left untouched. Hidden stays that overlap no visible
    stay are left as they are and become visible in the logement calendar, as they already are in
    « Tous » and in finance. The boot log prints the counts and the ids. No platform name, logement or
    id is written in the code: any install runs the same rule on its own data.
24. **Every set-aside and every restore is audited.** The migration and « Rétablir » each write a
    `reservation_history` event — `superseded` (`changedFields`: `kind`, `supersededByReservationId`,
    `supersededReason`, actor « migration ») and `unsuperseded` (actor = the admin) — shown in the
    fiche's history like any other event.

25. **A duplicate set aside takes no write.** Every route that writes to a stay answers `409
    { code: 'RESERVATION_SUPERSEDED' }` and writes nothing: the fiche save, the payment marks, the SAS commit and
    its previews, the arrival payment, refunds, installments, payment links and requests (and the payment service itself, whoever calls it: the dashboard
    reminder included), e-mail send / queue / mark-sent / acknowledge, the dashboard snooze and reminder, the
    cancellation. One shared guard (`utils/reservationReadOnly.js`). A **cancelled** stay keeps
    its existing behaviour (`specs/payment-schedule-and-cancellation.md` rule 25) and the guard now also closes
    what was clearly a bug: SAS commit and previews, arrival payment, payment links and requests answer
    `409 RESERVATION_CANCELLED`; refunds, the plan it was cancelled with and the cancellation e-mails stay possible.
26. **Only a clear copy is set aside (amends 23).** A hidden stay becomes `superseded` only when it sits within
    its keeper's nights — fully inside, no slack (a copy one night longer would free that night for sale; amended
    2026-10-28 after the database audit, which had found a copy set aside with a night of slack). Every other
    case — a candidate carrying money, a longer one, two hidden stays on the same nights — is left as it is and
    both stays are stamped `bookingConflictAt`, which the existing conflict alert shows, with a `reservation_history`
    entry; the boot log lists the ids. The migration runs after the baseline replay.
27. **An old built-in colour is not a custom colour.** A per-source colour equal to a built-in default — the current
    one or the one before rule 6 — is never read as an operator's choice: the boot backfill of `platforms.color`
    and the colour listing ignore it, so the new palette reaches an install whose sources were created under the old
    one. Only a colour that is neither (prod: Lodgify `#fec700`) stays custom.
28. **Overlapping stays stack on the logement calendar.** Their name ribbons take lanes, one below the other, with
    the lane packing of « Tous » (`buildMonthLayout`); the week row grows by one lane per extra stay. A stay that
    is over is drawn as on « Tous » and the phone — tint, stripe, ink, no opacity (rule 8).
29. **A closed fiche is shown, not edited.** The fiche of a cancelled stay or of a duplicate has no Enregistrer,
    no extra action (nouvelle note, devis, e-mail, demande de solde, annulation), its fields are disabled (a
    disabled fieldset, no opacity: keyboard included) and it shows no date-conflict hint. The one write a
    cancelled fiche keeps is « + Nouveau remboursement » (rule 25), placed outside the fieldset; a duplicate
    has none.

30. **A closure is never hidden by a stay on the logement calendar.** A closure of the logement on days a stay
    also holds (a conflict the day cells cannot show both of) gets a hatched ribbon « Fermé · label » of its own,
    in a lane with the lane packing of « Tous »; a closure on free days keeps the cell hatching alone.

**Edge cases:**
- Stay with a disabled iCal source → shown in both calendars (rule 2).
- Cancelled stay → in neither.
- Closure of one logement adjoining a stay of that logement on both sides → one lane:
  stay ½ | closure | ½ stay.
- Closure overlapping a stay (allowed for a stay created before the closure? — refused by
  `CLOSURE_COVERS_DATE` / `RESERVATION_OVERLAP`) → if it ever exists, it takes a second lane of its group.
- Two closures of one logement in the same week → packed like two stays.
- Global closure + logement closure the same day → column hatch + the logement's bar.
- One-night stay on the logement calendar: its segment is one cell wide (½ + ½); the name ends with
  « … » after a few letters and the tooltip carries it.
- A stay crossing a month end: its label is drawn in each block where it has a segment.
- Custom colour `#fec700` (Lodgify, prod) → valid, ink text 9.8:1.
- A turnover day on the phone agenda → one row, departure ribbon on the left half, arrival ribbon on
  the right half (rule 21).
- A hidden stay that overlaps only other hidden stays → not superseded: nothing visible proves it is
  the copy (rule 23).
- A hidden duplicate carrying a payment → not superseded, listed in the boot log (rule 23).
- « Rétablir » on a superseded stay whose dates were booked since → 409, the stay stays superseded
  (rule 22).
- `GET /api/calendar` with `from > to`, malformed dates, a range over 400 days, or an unknown
  `propertyId` → 400 with a French message; reception-only role → the same field shaping as
  `GET /reservations` for that role.

---

## 4. Architecture

> **Fat backend, thin frontend.** The set of stays and closures, their labels, colours, text colours
> and past flag are decided on the server (rules 1-8). What stays on the client is geometry: splitting a
> stay into week segments and packing lanes (`utils/calendarLayout.js`, pure and unit-tested) — a pixel
> layout, not a business rule, and already client-side today.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `calendar.js` | C | `GET /api/calendar` → `calendarController.range`. Auth as `/reservations`. |
| — | `index.js` | T | Mounts `/api/calendar` next to `/api/reservations`. |
| `controllers/` | `calendarController.js` | C | Validates `from`, `to`, `propertyId` (rule edge cases), calls the model, applies the reception-only shaping of `GET /reservations`. |
| `models/` | `calendarModel.js` | C | `listRange({ from, to, propertyId })` → `{ stays, closures }`: one SQL for stays (`kind = 'reservation'`, no platform filter), closures via `establishmentClosuresModel.list`; shapes `label`, `platformDisplay`, `color`, `textColor`, `past` (rules 1-3). |
| `models/` | `reservationsModel.js` | T | `list()` loses the `ical_sources.disabled` NOT EXISTS clause (rule 2). `restoreSuperseded` (rules 22, 24); `getByIdWithDetails` opens a superseded stay with its keeper's number; `search` flags `superseded` like `cancelled`. The set-aside itself lives only in `utils/supersededDuplicates.js`: it runs at boot, before `database.js` finishes loading, where a model cannot be required. |
| `models/` | `propertyIcalModel.js` | T | The UID lookup of `syncSource` skips a `superseded` row: no update, no insert, counted unchanged (rule 22). |
| `controllers/` | `reservationsController.js` | T | `restoreSuperseded` (admin): availability check, 409 on taken dates, history event (rules 22, 24); `getById` returns the superseded fields for the banner. |
| `routes/` | `reservations.js` | T | `POST /api/reservations/:id/restore` (admin). |
| `utils/` | `supersededDuplicates.js` | C | Pure-SQL helper of the migration: finds the candidates of rule 23 (hidden ∧ overlapping a visible stay ∧ no money), returns `{ superseded: [ids], skippedPaid: [ids], keptVisible: [ids] }`. Unit-tested on its own. |
| `models/` | `platformsModel.js` | T | `resolveColor` unchanged; `colorMap` / the platform-colour listing add `textColors` (rule 5). |
| `controllers/` | `platformsController.js` | T | Both colour writers — `setColor` (`PUT /api/platforms/:key/color`) and the bulk `planRow` of `PUT /api/platforms/settings` (today: `HEX_COLOR` only) — call `validateCalendarColor`; a refusal is `400 { error }` / `errors.color` and writes nothing (rule 7). |
| `utils/` | `reservationReadOnly.js` | C | The one 409 guard of a read-only stay (`RESERVATION_SUPERSEDED` / `RESERVATION_CANCELLED`): `readOnlyRefusal`, route middleware `guardReadOnly`; applied in `routes/reservations.js`; the SAS plugin applies the same answer in its own controller, `routes/payments.js` and `emailsController` (rule 25). |
| `utils/` | `platformColorBackfill.js` | C | The boot backfill of `platforms.color`, extracted from `database.js`; an old built-in colour is not custom (rule 27). |
| `utils/` | `colorContrast.js` | C | Pure: `contrastRatio(a, b)`, `textColorFor(hex)`, `validateCalendarColor(hex)` (rules 5, 7). |
| `constants/` | `platformColors.js` | T | New built-in palette (rule 6). |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` + `schema.sql` | T | `ADD COLUMN supersededAt`, `supersededByReservationId`, `supersededReason` (guarded); the one-shot migration of rule 23 run through `supersededDuplicates.js`, guarded by the `migrations` table, **before** any read uses the new `list()` (rule 23). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `InfiniteMonthScroller.jsx` | C | Generic: bounded scroll container, stacked month blocks with sticky title and a loading line, « Aujourd'hui », « keep the month in view » on a scope change and when a block above grows (rules 13-15). Takes a `cache` (below) and a render prop `renderMonth({ year, month, data, status })`; the page that owns the cache can read every loaded month (drag guards, conflict hints). |
| `hooks/` | `useMonthDataCache.js` | C | The cache the scroller reads, owned by the page: `useMonthDataCache(scopeKey, loadMonth(year, month, signal))` → `{ entries, ensure, retry }`, one fetch per month, aborts and drops what belongs to another scope (rule 15). |
| `hooks/` | `useInfiniteMonthScroll.js` | T | Unchanged contract; `focusOnMonth` used for « keep the month in view » on logement switch. |
| `utils/` | `calendarLayout.js` | C | Extracted from `CumulativeMonthCalendar`: `normalizeItems`, `buildMonthLayout` (closures as lane items with stay half-day edges — rules 9, 10), `weekSegments` (shared by the logement label overlay — rule 18). |
| `components/` | `CumulativeMonthCalendar.jsx` | T | Uses the scroller + `api.getCalendar`; solid bars with `color`/`textColor`, past tint (rules 4, 8); closure bars (rule 11). Same component on the Dashboard. |
| `components/` | `CalendarMonthGrid.jsx` | T | Becomes one month block of `CalendarDayCell`s + a per-week label overlay (rules 16, 18-20); the continuous grid and its vertical month labels go. |
| `components/` | `CalendarDayCell.jsx` | T | Loses the in-cell name labels (moved to the overlay) and the `FIT` clip; closure half-day diagonals (rule 12); day number / férié / dots in a top band (rule 20); fills from `color`. |
| `components/` | `CalendarDayAgenda.jsx` | C | Phone logement calendar: day rows per month block inside the scroller (rule 17), reusing `utils/calendarDaySummary.js`; solid / half / tinted ribbons from the payload's `color` and `textColor` (rule 21). |
| `components/` | `CalendarWeekView.jsx` | removed | Replaced by `CalendarDayAgenda` (rule 17). |
| `components/` | `PlatformColorPicker.jsx` | T | Presets = the new palette; shows the server's refusal under the swatch (rule 7). |
| `pages/` | `CalendarPage.jsx` | T | Drops the range loader, the month arrows and the week-range extension; per-month loader = `getCalendar` + notes + devis + occupied dates + closures for the logement; keeps drag-select, notes dialog, deep links. |
| `pages/` | `settings/PlatformsSettingsPage.jsx` | T | Keeps the previous colour and shows the message on a 400. |
| `pages/` | `ReservationPage.jsx` | T | Read-only fiche + banner « Doublon de la réservation {numéro} » + admin « Rétablir » for a superseded stay (rule 22). |
| `components/` | `ReservationSearch` (header search) | T | « Doublon écarté » chip, as « Annulée » (rule 22). |
| `pages/` | `Dashboard.jsx` | — | (none — same component) |
| `constants/` | `platforms.js` | T | Mirror of the palette; `PLATFORM_TEXT_COLORS` filled from the platform-colour listing (no client contrast math). |
| `api.js` | `api.js` | T | `getCalendar({ from, to, propertyId })`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `SegmentedSelect`, `ErrorAlert`, `CalendarNoteDialog`, `PlatformColorPicker` | Unchanged contracts. |
| **Created (new generic)** | `InfiniteMonthScroller` | Any month-by-month view: the two calendars now, the Planning page next (its own 2026-10-28 feedback asks for « le même scroll que le calendrier général »), Ressources later. |
| **Specific (kept feature-local)** | `CalendarDayAgenda`, the week label overlay inside `CalendarMonthGrid` | Logement-calendar content (arrivals, cleaning, notes); generic parts live in the scroller and `calendarLayout`. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/restore` | — | the reservation | Admin. 409 `{ error: 'Ces dates sont déjà prises.' }`; 400 if not superseded (rules 22, 24). |
| GET | `/api/calendar` | query `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, optional `propertyId` | `{ from, to, today, stays: [...], closures: [...] }` | 400 `{ error }` on bad dates, `from > to`, range > 400 days, unknown logement. |
| PUT | `/api/platforms/:key/color` | `{ color: '#RRGGBB' }` | `{ name, color, textColor }` | 400 `{ error }` per rule 7. |
| PUT | `/api/platforms/settings` | `{ platforms: [{ …, color }] }` | unchanged | a refused colour → 400 with `errors[<platform>].color` = the rule 7 message, nothing written. |
| GET | `/api/properties/platform-colors` | — | adds `textColors: { slug: '#FFFFFF' \| '#27251F' }` | Backward-compatible addition. |

```json
{
  "from": "2026-10-01", "to": "2026-11-08", "today": "2026-10-28",
  "stays": [{
    "id": 22301, "propertyId": 1, "propertyName": "Granja",
    "startDate": "2026-10-09", "endDate": "2026-10-11", "checkInTime": "16:00", "checkOutTime": "10:00",
    "firstName": "Camille", "lastName": "Martin", "label": "Camille Martin",
    "platform": "Airbnb", "platformDisplay": "Airbnb", "color": "#C93848", "textColor": "#FFFFFF",
    "past": true, "bookingConflictAt": null
  }],
  "closures": [{
    "id": 4, "propertyId": 1, "propertyName": "Granja", "global": false,
    "label": "Fermeture établissement", "startDate": "2026-10-11", "endDate": "2026-10-13"
  }]
}
```

`GET /api/reservations` keeps its contract; only its set changes (rule 2).

---

## 5. Data model

Three nullable columns on `reservations`: `supersededAt TEXT`, `supersededByReservationId INTEGER`,
`supersededReason TEXT` (PRAGMA-guarded `ADD COLUMN`, mirrored in `schema.sql`); a new value
`'superseded'` of the existing `kind` column (TEXT, no CHECK constraint). One-shot data migration
`calendar_parity_superseded_v1` (rule 23), recorded in `migrations`; it only changes rows that no longer
match `kind = 'reservation'` afterwards, so a second run finds nothing even without the guard.

**Effect on the prod copy of 2026-10-22** (same SQL as rule 23, run read-only on `prod-snap.db`):

| Logement | « Tous » today | Logement calendar today | Set aside | Both calendars after |
|---|---|---|---|---|
| Granja (1) | 32 | 30 | 22279 | 31 — the 30 of today + 22201 |
| Estiva (2) | 25 | 17 | — | 25 — the 17 of today + 8 |

Every logement calendar shows exactly today's stays, plus the 9 real past stays the filter hid by
mistake (22201, 22224, 22226, 22227, 22229, 22242, 22269, 22271, 22272); « Tous » loses only the
duplicate 22279. Nothing is asked of the operator. On the neutralised shadow (every source disabled)
the same rule sets aside only 22279 too and makes 51 stays visible again.

The new built-in colours apply to every platform without a custom
colour (`platforms.color` NULL — `setColor` stores NULL when the chosen colour equals the built-in one).
Custom colours are kept as stored. `ical_sources.disabled` keeps its column and its other effects.

**Data impact:** the migration rewrites `kind` (and the three new columns) of duplicates only — 1 row in
prod, 0 € and no payment — and audits it; « Rétablir » undoes it. Nothing is deleted.

## 6. UI / UX

Interactive summary: [docs/specs/2026-10-28-calendar-property-parity.html](../docs/specs/2026-10-28-calendar-property-parity.html).

**General calendar (Dashboard + Calendrier → Tous)**
- Bars: 18 px, solid fill, 11 px semibold label in `textColor`, radius 6 on true ends only, square on a
  week split. Past stays: tint + stripe + ink (rule 8). Hover: fill darkens 8 %.
- A logement's group: its stays and closures packed together; closure = hatched bar « Fermé ·
  Fermeture établissement ». Global closures: unchanged column hatch.
- Legend « Légende » (folded) shows solid swatches + « Fermeture » hatched swatch.

**Logement calendar**
- Desktop / tablet (`sm+`): the same scroller as « Tous »: sticky title « Octobre 2026 », weekday header
  per block, day cells with today's diagonals (arrival / departure / cleaning / blocked night). The name
  label spans each week segment of a stay. The bar keeps the logement picker and loses the arrows;
  « Aujourd'hui » sits in the calendar's toolbar row, as on « Tous ».
- Phone (`xs`): infinite day agenda (rule 17). Rows 56 px min, the day (« Mer 28 ») left, content right,
  note button 44 × 44. Each stay is a 32 px ribbon in its colour (rule 21): full width inside the stay,
  right half on arrival, left half on departure, both halves on a turnover day; closures hatched,
  devis dashed, past stays tinted.
- Superseded stay (rule 22): fiche read-only, banner on `warning` soft background « Doublon de la
  réservation {numéro} » with the link, admin button « Rétablir ».
- Closures: half-day hatched diagonals (rule 12).

**Paramètres → Plateformes, colour**: the picker previews a bar with the chosen colour and its text
colour; a refused colour shows the server's message under the swatch, and the swatch returns to the
previous colour.

**Copy (French):** « Aujourd'hui », « Fermé », « Tout fermé », « {logement} fermé », « Couleur invalide. »,
« Couleur peu lisible : choisir plus clair ou plus foncé. », « Couleur trop claire pour le calendrier. ».
The hint « Faites défiler pour changer de mois » is removed (the scroll is self-evident and the owner
finds the UI too wordy).

**States:** loading = a 2 px progress line under the sticky title of the month being fetched; a failed
month shows `ErrorAlert` « Ce mois n'a pas pu être chargé. » with « Réessayer », the other months stay.

**Responsive:** `xs` — « Tous » = month agenda of stays (unchanged), logement = day agenda; `md` — both
grids, minimum width 560 px inside a horizontal scroller (unchanged); `lg` — full grid.

**PageActionBar:** title « Calendrier », `center` = logement picker (unchanged). No `actionsBefore`
any more (the arrows and « Aujourd'hui » move to the calendar's own toolbar, identical in both views).

**Motion:** « Aujourd'hui » scrolls smoothly (`scroll-behavior: smooth`), instant under
`prefers-reduced-motion`. No other animation.

## 7. Test plan

### Lots

| Lot | Content | Rules | Ships alone |
|---|---|---|---|
| 1 | Server endpoint + parity, **duplicate migration, then** filter removed, superseded state + « Rétablir », name clip fix (`flexShrink: 0` + top band) | 1-3, 20, 22-24 | yes — fixes the missing stays and the unreadable names; the migration ships in the same release as the filter removal, never after |
| 2 | Palette, `textColor`, colour validation, solid bars, past tint, closure lane + half-day on « Tous » | 4-11 | yes |
| 3 | `InfiniteMonthScroller`, logement month blocks, per-month cache, no arrows, week label overlay, closure diagonals, phone day agenda with ribbons | 12-19, 21 | yes |

### Server unit tests
- [x] `tests/calendar-property-parity.unit.test.js` — 10 cases: logement range = general range filtered (rule 1); the disabled platform's stay is in both and in `list({ propertyId })` (rule 2); the cancelled stay in neither; `label` (3 fallbacks), `color`, `textColor`, `past` on the server day (rule 3); closures with `global` / `propertyName` / `label`; 400 on `from > to`, malformed date, > 400 days, unknown logement; reception-only whitelist.
- [x] `tests/calendar-colors.unit.test.js` — 10 cases: `contrastRatio` pairs, `textColorFor` (rule 5); every built-in at 4.5:1 and one hue per platform (rule 6); `validateCalendarColor` with its three messages, the previous colour kept on a refused PUT and a refused bulk save (rule 7); `textColors` in the listing; the boot backfill keeps only Lodgify `#fec700` as custom on the prod-shaped fixture and the listing ignores an old built-in per-source colour (rule 27).
- [x] `tests/calendar-parity-superseded.unit.test.js` — 13 cases: the set-aside with keeper, reason text and `superseded` history event (rules 23, 24); the prod-shaped fixture (1 duplicate + 9 isolated); idempotent second boot; money, longer-than-keeper and hidden-overlap cases left as they are and both stays flagged (rule 26); keeper = earliest overlap, a copy one night longer flagged instead; a superseded stay absent from the calendar, lists, availability and the books but found by search (rule 22); the fiche payload; « Rétablir » with its audit event and 409 (rules 22, 24); the iCal sync never touches it.
- [x] `tests/calendar-parity-read-only.unit.test.js` — 5 cases (rule 25; the dashboard, acknowledge and payment-service paths included): every write path of rule 25 answers 409 `RESERVATION_SUPERSEDED` and writes nothing (an express harness over the real routes and the SAS controller); a live stay is not refused; a cancelled stay stays refused where listed, keeps refunds and the cancellation e-mails.
- [x] `tests/platforms-and-ical-rework.unit.test.js` — the « list excludes a disabled-platform reservation » case is inverted (rule 2).

### Client tests (Vitest)
- [x] `utils/__tests__/calendarLayout.closure-lane.test.js` — 10 cases (rules 9, 10, 18).
- [x] `components/__tests__/CumulativeMonthCalendar.solid-bars.test.jsx` — 7 cases: solid future bar, past tint, closure bar and lane, legend, « Aujourd'hui », keyboard (rules 4, 8, 9, 11, 14).
- [x] `components/__tests__/InfiniteMonthScroller.month-cache.test.jsx` — 5 cases (rules 13-15).
- [x] `components/__tests__/CalendarMonthGrid.stay-label.test.jsx` — 8 cases: one ribbon per week segment, never clipped, top band, edge days, past tint, lanes for overlapping stays (rules 8, 16, 18-20, 28, 30).
- [x] `components/__tests__/CalendarDayCell.closure-half-day.test.jsx` — 6 cases (rule 12).
- [x] `components/__tests__/CalendarDayAgenda.test.jsx` — 5 cases (rule 17); `CalendarDayAgenda.ribbons.test.jsx` — 6 cases (rule 21).
- [x] `pages/__tests__/ReservationPage.cancelled-refund.test.jsx` — 2 cases: a cancelled fiche keeps the refund button usable (its dialog opens), no opacity, a duplicate's stays blocked (rules 25, 29).
- [x] `pages/__tests__/ReservationPage.superseded.test.jsx` — 3 cases: banner, no Save / extra action, disabled fieldset, no conflict hint, « Rétablir » for an admin only with the 409 message (rules 22, 29).
- [x] `pages/__tests__/CalendarPage.property-scroll.test.jsx` — 3 cases (rules 14, 15).
- [x] `components/__tests__/PlatformColorPicker.refusal.test.jsx` — 3 cases (rule 7).
- [x] Removed with the component: the three `CalendarWeekView` suites and the old `CumulativeMonthCalendar` ones; updated: `CalendarPage.property-filter`, `CumulativeMonthCalendar.mobile`, `calendar-platform-colors`.

### E2E (Playwright)
- [x] `e2e/specs/calendar/calendar-property-parity.spec.js` — 3 cases (rules 1, 2, 13, 17).

### Manual UI verification (shadow copy, 390 / 900 / 1280 px)
- [x] Boot on a fresh copy of `prod-snap.db`: the log names 22279 set aside, Granja 31 / Estiva 25 in both calendars, only Lodgify `#fec700` custom.
- [x] 390 px, Granja, 29 Dec → 2 Jan: ribbons right half / full / left half; turnover day.
- [x] Granja: same stays in « Tous » and « Granja »; the name readable.
- [x] « Tous »: the closure on its logement's row, half-day edges.
- [x] 900 px: Sunday visible on both grids.

## 8. Out of scope

- The Planning page scroll (its own spec from the same feedback) — it should consume
  `InfiniteMonthScroller`, not reimplement it.
- Colour by logement instead of platform (open question 2).
- Drag-to-create on « Tous »; devis and notes on « Tous ».
- A UI for `ical_sources.isActive` (open arbitration of `lodgify-decommission.md`).
- Moving lane packing to the server.

## 9. Open questions

- Q1: Closure geometry — end at the middle of the reopening day (rule 10, consistent with stays) or at
  the middle of the last closed day (`master`'s look, what the owner described)?
  - A (2026-10-28): middle of the reopening day — rule 10 as written.
- Q2: Colour bars by platform (rule 6) or by logement?
  - A (2026-10-28): by platform, with the new palette — rule 6 as written.
- Q3: « Désactiver » a platform — stop hiding its stays everywhere (rule 2) or hide them in both
  calendars alike?
  - A (2026-10-28): never hide — rule 2. The duplicates the filter hid are set aside once, explicitly (rules 22-24).
- Q4: Phone logement calendar — day agenda (rule 17) or the « Tous » stay agenda filtered to the logement?
  - A (2026-10-28): day agenda, as visual as the desktop — rules 17 and 21.

## 10. Implementation progress

All three lots shipped together on `feature/calendar-property-parity` (the migration and the filter removal are in the same lot, the migration first).

| Lot | State | Notes |
|---|---|---|
| 1 | Done | `GET /api/calendar` (reception allowlisted, same whitelist as `/reservations`); filter removed from `list()`; `superseded` kind, `POST /reservations/:id/restore`, read-only guard, iCal skip, search flag, history titles; `calendar_parity_superseded_v1`. Proved on a copy of `prod-snap.db`: Granja 31 / Estiva 25 in both calendars, `22279` the only stay set aside (by `14`), the 9 isolated stays visible; on the shadow copy the same single stay, 51 hidden stays visible again. |
| 2 | Done | New palette + `textColors`; `colorContrast.js`; refusals of rule 7 on both colour writers; solid bars, past tint, closure lane items with half-day edges, hatched closure bar. |
| 3 | Done | `InfiniteMonthScroller` + `useMonthDataCache`; logement month blocks, per-week name ribbons, closure diagonals, `CalendarDayAgenda` with ribbons; `CalendarWeekView` removed. |

**Tests:** server 4 new files (10 + 10 + 13 + 4 cases) and 3 updated suites; client 10 new files / 3 updated; E2E `e2e/specs/calendar/calendar-property-parity.spec.js` (3 cases); `check-spec-coverage` 24/24.

**Deviations from the draft, and why**
- The month cache is a hook owned by the page and passed to the scroller (not a `loadMonth` prop of the scroller): the logement page needs every loaded month for its drag guards and date-conflict checks.
- `reservationsModel.markSuperseded` was not written: the only caller is the boot migration, which cannot require a model (circular load of `database.js`).
- Paramètres → Plateformes: the picker shows the server's message under the swatch and returns to the previous colour after a refused save; it does not preview the text colour of a draft colour, because that would need contrast math on the client (rule 5). The text colour of a saved colour comes with the listing.
- The header search shows « Annulée » as well as « Doublon écarté » (it showed neither before).
- A note of the day on the logement calendar is printed in the cell's top band (cut by width, full text on hover) now that the ribbon takes the lower part of the cell.

**Review fixes (2026-10-28, rules 25-29)** — the boot colour backfill no longer freezes the old palette as custom colours (rule 27); every write path refuses a duplicate (rule 25); the migration only sets aside a clear copy and flags the rest (rule 26); overlapping stays stack and a past ribbon is a tint (rule 28); a closed fiche is read-only (rule 29); the logement grid keeps `CALENDAR_MIN_WIDTH` (560 px), so Sunday is visible at 900 px.
