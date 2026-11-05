# Reservations backend — MVC extraction

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservations-backend-mvc` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar, slice **3a** (of 3a/3b/3c). See `specs/ROADMAP.md`. |

---

## 1. Context

`server/src/routes/reservations.js` is a 1317-LOC monolith: the Express routes, all DB access, the
pricing-snapshot logic, occupancy/conflict rules, audit-history tracking and bed-distribution all live
inline in one file. This is the recognized tech debt the MVC policy targets (`CLAUDE.md` §6.1): routes
should be thin and delegate to controllers/models, with reusable, unit-tested helpers in `utils/`.

The file currently holds, inline:
- **Endpoints:** `POST /suggest-beds`, `GET /`, `GET /occupied-dates/:propertyId`, `GET /:id`,
  `GET /:id/history`, `POST /calculate-price`, `POST /`, `PUT /:id`, `PATCH /:id/payment`, `DELETE /:id`.
- **Occupancy/conflict rules:** `timeToHour`, `addIsoDays`, `getNightBlocksFromTimes`,
  `buildOccupiedDatesFromReservations`, `validateReservation` (the authoritative availability check).
- **Audit/history:** `normalizeHistoryValue`, `getOptionsSignature`, `getResourcesSignature`,
  `getReservationAuditSnapshotFromDb`, `getReservationAuditSnapshotFromPayload`, `computeAuditChanges`,
  `addReservationHistoryEntry`.
- **Pricing glue:** `getReservationPricingSnapshot` (locked snapshot), `inferCustomAccommodationPrice`,
  `suggestBedDistribution`, plus calls into `utils/pricing.js`.
- **Misc:** `parseJsonArray`, `roundMoney`, `getTodayIsoDate`, `computeNextIcalSyncLocked`,
  `getArchivedReservationError`.

## 2. Goal

Refactor the reservations backend into thin routes → controller → model with unit-tested utils, **with
no change to API behavior or the client**. Same endpoints, same request/response shapes, same business
rules — just a clean, testable structure that future slices (and Bloc 5) build on.

## 3. Functional rules

1. **Behavior-preserving.** Every endpoint keeps its exact path, request body, response shape, status
   codes, validation messages, and side effects (history entries, night rows, iCal lock, pricing
   snapshots). This is a structural refactor, not a feature change.
2. **Thin routes.** `routes/reservations.js` only wires HTTP verbs/paths to controller methods (parse
   params/body → call controller → send result). No business logic, no direct DB calls.
3. **Controller orchestrates.** `reservationsController.js` holds the per-endpoint flow: input parsing,
   calling the pricing engine, the occupancy validator, the model, and shaping the HTTP response.
4. **Model owns DB.** `reservationsModel.js` is the only place with SQL for the reservations domain
   (reservation rows + `reservation_options` / `reservation_custom_options` / `reservation_resources` /
   `reservation_nights` / `reservation_history`), exposed as prepared-statement-backed methods.
5. **Occupancy rules in a pure util.** The night-block + availability logic moves to `utils/occupancy.js`
   as pure, unit-testable functions; the server stays the single authority for conflict rejection.
6. **Audit logic in a pure util.** Snapshot/diff/history helpers move to `utils/reservationAudit.js`.
   - **Human-readable history (2026-06-11).** The options/resources diff is stored as a compact
     signature (`6:1:8.00:c0|…`). `getHistory` (both `reservationsModel` and `devisModel`) resolves
     option/resource ids → names and money via the pure `enrichHistoryChanges` helper, attaching
     ready-to-render `fromText`/`toText` to each option/resource change (e.g.
     `Petit-déjeuner : 0 € (compl.) • Linge de lit : 14 € (compl.)`). Server-owned per the
     fat-backend rule; the client just renders one line per change (`label : from → to`). Custom
     options (synthetic id ≥ 1 000 000) read as `Option personnalisée`; an unknown id as `Option #N`.
7. **No client change.** The 3 client consumers (`CalendarPage`, `ReservationPage`, `MiniPlanningStrip`)
   and their UX helper `utils/reservationConflicts.js` are untouched here (see Out of scope).
8. **Tests.** The extracted occupancy + audit utils and the model get unit tests; the existing suite
   stays green.
9. **Fixed at the 2026-10-27 spec review — default times on create.** A `POST /reservations` without
   `checkInTime` / `checkOutTime` stored 15:00 / 10:00, not the property's `defaultCheckIn` /
   `defaultCheckOut`; on a 16:00 tent the first re-save then billed an « Arrivée anticipée ». The
   controller fills the missing times from the property before pricing (`getPropertyDefaultTimes`).
10. **Fixed at the 2026-10-27 spec review — a stay needs a client.** A `POST /reservations` with no
   `clientId` (and no `newClient`) reached the INSERT and failed on the NOT NULL constraint with a 500.
   It is now refused first: 400 `{ error: 'Un client est requis pour créer la réservation.', code:
   'CLIENT_REQUIRED' }`, nothing written. Pinned by `tests/create-requires-client.unit.test.js`.
11. **Added 2026-11-02 (audit R18-1) — a stay's dates are sound before anything else.** No internal path
   checked them: a reversed stay (`20/11 → 18/11`), a zero-night one, `2027-02-30` or `2027-2-3` was
   created at 0 €, freed its nights for a second booking (the overlap SQL matches nothing against a
   reversed row, and compares a non-padded date as text), and reached the iCal export as an invalid
   event. One guard, `utils/stayDates.stayDatesRefusal(startDate, endDate)`, now requires each date to
   match `YYYY-MM-DD` and to be a real calendar day (UTC round-trip), and the departure to follow the
   arrival. Otherwise 400 `{ error, code: 'INVALID_STAY_DATES', field }`, with `error` « Date de séjour
   invalide. » (shape or day) or « La date de départ doit suivre la date d'arrivée. » (order), before
   pricing, availability or any write. It runs on: `POST /reservations` (`createStay`, with or without a
   draft client), `PUT /reservations/:id` and every server caller of `performUpdate` (plugins, intakes),
   `POST /reservations/calculate-price`, `POST /reservations/:id/restore` (on the stored dates),
   `POST /dashboard/ical-date-drift/:id/approve` (on the proposed dates; the alert stays pending, so
   « Rejeter » still clears it), and in `devisModel` on create, update (the dates the save would store),
   extension preview and extension (stored dates), and conversion into a reservation (stored dates).
   The payment `PATCH` carries no dates and is not checked. The iCal **import** needs no guard and is
   unchanged: the parser already drops an event whose date is not a real day and turns a reversed or
   zero-night event into one night (`specs/ical-import-hardening.md` rule 17, F9), so a sync is never
   refused for a feed's odd dates. A check of the prod snapshot of 2026-10-22 found no stored row with
   such dates, so there is no data migration.
   *Reading of 2026-11-02 (audit R19-L1) — a stay lasts at most 366 nights.* The guard also refuses a
   departure more than `MAX_STAY_NIGHTS` (366) nights after the arrival: 400 `INVALID_STAY_DATES`, `field`
   `endDate`, `error` « Séjour trop long. », on every path listed above and before any pricing. Pricing walks
   the stay night by night, synchronously, before the availability check: a departure typed as `9999-12-31`
   on `POST /reservations/calculate-price` took ~100 s and blocked every other request of the server
   meanwhile (the fiche quotes on every date change, so a year typed digit by digit reached it). 366 is the
   iCal parser's length cap (`specs/ical-import-hardening.md` rule 17), and the two share the one constant
   `utils/stayDates.MAX_STAY_NIGHTS`, so an imported event and an internal write obey the same bound. The
   public booking path keeps its own, tighter caps. The prod snapshot of 2026-10-22 (read on a copy) stores
   no stay longer than 14 nights, so no stored row or legitimate flow is refused.
12. **Added 2026-11-02 (audit R18-1) — the fiche says it before the save.** The fiche (reservation and
   devis, both `ReservationPage`) shows « La date de départ doit suivre la date d'arrivée. » in red under
   the dates, the departure field in error, as soon as the departure is on or before the arrival; and
   « Enregistrer » refuses with that message in the usual error dialog, sending nothing. A refusal of
   the server (rule 11) reaches the same dialog with its own message. The `min` of the departure field
   only styled a typed value: it never stopped the save. Switching the logement asks for a quote only
   when the stay is complete and ordered: a « Nouveau devis » switched before its dates are typed has
   no quote yet, as on opening (it used to price an empty range at 0 €, which rule 11 now refuses).
   *Reading of 2026-11-02 (audit R19-L1).* A departure more than 366 nights after the arrival shows
   « Séjour trop long. » in the same place, the departure field in error, and « Enregistrer » refuses with
   it. Such a range is never quoted: not by the live quote on a date change, not by the logement switch,
   not on opening from URL dates. `utils/stayDates.stayDatesMessage` gives the one hint (order, then
   length) and `isQuotableStay` the quote gate; the message and the 366 live in `constants/stayDates.js`,
   mirroring the server.
   *Reading of 2026-11-03 (audit R20-C2).* A date that is not a real `YYYY-MM-DD` day — a 5- or 6-digit year
   (Chromium's year segment takes up to six digits), 30 February — shows the server's own « Date de séjour
   invalide. » in the same place, before the order check, and « Enregistrer » refuses with it
   (`utils/isoDay.isRealIsoDay`, the UTC round-trip of the server's `isRealIsoDay`). `isQuotableStay` is
   then false, so no quote, occupied dates or resources' availability is asked for it: they used to answer
   400. `hooks/useWelcomePack` skips only a *present* date that is not a real day or lies outside the window;
   missing, reversed or too-long dates are still asked, so the pack's per-stay lines apply before the dates
   are sound (specs/welcome-pack-auto-options.md edge cases; review of PR #940, REG-1). A year still being typed, padded
   to four digits (rule 14), is a real day and keeps the order / length / window messages; a stored date is
   always a real day, so the stored-row exemption of rule 13 is unchanged. Tests: client
   `utils/stayDates.real-day`, `pages/ReservationPage.real-day`, `hooks/useWelcomePack.real-day`.
13. **Added 2026-11-02 (Adrien's decision) — no date is entered past the horizon.** No date may be entered
   more than `MAX_HORIZON_YEARS` = 5 years ahead: the last allowed day is today (the Europe/Paris day,
   `utils/localDate.todayIso`) plus 5 years, a 29 February landing on the 28th
   (`utils/stayDates.horizonEnd`, `dateBeyondHorizon`). One day past it is refused with « Date trop
   lointaine : 5 ans au plus. ». It is checked inside `stayDatesRefusal`, after rule 11's shape, order and
   length checks, so it runs on every path rule 11 lists: 400 `INVALID_STAY_DATES`, `field` naming the
   first date past it. The same message refuses a closure (`specs/establishment-closures.md` rule 18,
   reading of 2026-11-02) and the end of a finance custom window (`specs/finance-dashboard-redesign.md`
   rule 51, reading of 2026-11-02). The past is not limited: history stays. The duration caps stay as
   they are: a stay 366 nights, a closure 731, a finance window 750 days.
   **Only an entered or edited date is held to it.** `stayDatesRefusal(start, end, { stored })` skips a
   date equal to the stored row's: a row written before this rule, past the horizon, still saves while its
   dates are not edited (`PUT /reservations/:id` and `performUpdate` compare with the stored row,
   `calculate-price` with the row of its `reservationId` or `devisId`, a devis update with the stored
   devis). The paths that enter no date never refuse on it: a restore of a duplicate set aside, a devis
   extension and its preview, a devis converted into a reservation (stored dates). An iCal date drift
   approved is held to it on the dates it changes. Read paths never refuse a stored row: the occupied
   dates and the planning reads keep only their 750-day span cap (`specs/establishment-closures.md` rule
   20), since the calendar and the planning are navigated, not typed, and must still show a stored row
   past the horizon. The iCal **import** keeps its own 730-day horizon (`specs/ical-import-hardening.md`),
   inside this one. The tariff recipes write their closures and seasons through their own model, not
   through these validators (`horizonYears` ≤ 5 counted from the current year), so a recipe never
   breaks; a recipe closure ending past the horizon stays editable as long as its dates are kept.
   A copy of the prod snapshot of 2026-10-22 (read 2026-11-02 against a horizon of 2031-11-02) stores no
   stay, devis or closure ending past it — the latest are a reservation ending 2027-08-13, a devis 2027-04-16
   and a closure 2028-03-31 — so nothing is migrated. The GreenGo block of 2028-03-01 → 2028-08-29, which
   reaches GuestFlow through the iCal import, is inside the horizon and the import is not held to it anyway.
   The fiche and the devis (`ReservationPage`) show the message under the dates, the field in error, ask
   neither a quote, the occupied dates nor the resources' availability for such a range, and « Enregistrer » refuses with it before any
   request; a date the record was loaded with is not held to it (`utils/stayDates.stayDatesMessage(start,
   end, { stored })`). The horizon and its message live in `constants/dateHorizon.js` and
   `utils/dateHorizon.js`, mirroring the server. *Why:* a year typed one digit off (2062 for 2026) used to
   be accepted, and nothing the operator manages is booked or closed five years ahead. Tests:
   `tests/date-horizon.unit.test.js`, client `ReservationPage.date-horizon.test.jsx`.
   *Reading of 2026-11-02, second (Adrien's decision, amending the « past is not limited » above) — the window
   runs both ways, and the backend enforces it on every entered date.* Every date an operator enters lies in
   `[today − 5 years, today + 5 years]`, the Europe/Paris day (`utils/stayDates.horizonStart`, a 29 February
   landing on the 28th as `horizonEnd` does). One day before it is refused with « Date trop ancienne : 5 ans
   au plus. » (`PAST_HORIZON_MESSAGE`), one day after it with « Date trop lointaine : 5 ans au plus. »; an
   unreadable or impossible day (`2027-02-30`) is refused too. The server is the guard: the client hints
   only spare a refused request. `dateWindowMessage(iso)` judges one real day, `entryDateMessage(value,
   { stored })` a value the operator typed (shape, real day, window), `rangesWindowMessage(ranges,
   { stored })` a list of ranges; all three skip a value the row already stores, the « stored » rule above,
   so a row written before this reading saves while its dates are kept, and no read path refuses a stored
   row. A new stay in the past was already refused (« Impossible de réserver dans le passé. »); the window
   answers first. Plugins reach the helpers through `coreModule('stayDates')` (SDK 2.20.0). The swept
   write paths, each refused with a 400 before any write:

   | Path | Dates | Before this reading | Now |
   |---|---|---|---|
   | `POST /reservations`, `PUT /reservations/:id`, `performUpdate`, `POST /reservations/calculate-price`, iCal drift approval | `startDate`, `endDate` | rule 11 + future side | + past side (`INVALID_STAY_DATES`) |
   | `POST /devis`, `PUT /devis/:id` | `startDate`, `endDate`; the API-only `validUntil` override | stays: rule 11 + future side; `validUntil` unchecked | stays + past side; `validUntil` a real day in the window unless kept (`field: 'validUntil'`) |
   | `POST/PUT /establishment-closures`, `GET …/conflicts` | `startDate`, `endDate` | real day, order, 731 days, future side | + past side (`specs/establishment-closures.md` rule 18) |
   | `GET /finance/dashboard?period=custom` | `from`, `to` | real day, order, 750 days, `to` future side | `from` and `to` both in the window (`specs/finance-dashboard-redesign.md` rule 51) |
   | `PATCH /reservations/:id/payment` (acompte, solde, compléments, caution) and `POST /reservations/:id/arrival-payment` | `*PaidDate`, `cautionReceivedDate`, `cautionReturnedDate`, the arrival `date` | real day, not in the future | + not before the window (`utils/arrivalPaymentDate.validateCollectionDate`, `INVALID_PAYMENT_DATE`); a mark sent back with the date its row already stores is not re-judged (it meets « already perceived », rule 38 of `specs/reservation-payment-ledger.md`); a non-string date is refused and the day written is the judged one, never the raw text (rule 66 of `specs/reservation-payment-ledger.md`, 2026-11-03) |
   | `PATCH /reservations/:id/payment` `adjustMidStayNote.paidDate` | a settled note's date | **unchecked** | real day, not in the future, in the window, unless kept |
   | `POST /reservations/:id/installments/:iid/payment` | `paidDate` | real day, not in the future | + not before the window |
   | `PUT /reservations/:id/installments` `dates` | `dueDate` | regex (`2027-02-30` passed), ≥ today, ≤ arrival | real day, ≤ today + 5 years (a stay stored past it) |
   | `POST /reservations/:id/refunds` | `refundDate` | regex only, not in the future | real day, not in the future, in the window |
   | `POST /reservations/:id/platform-penalties` (and `/preview`) | `date` | real day, not in the future | + not before the window (422 `INVALID_PENALTY`, the endpoint's convention); a penalty sent without a date takes the stored solde date, which is not re-judged |
   | `POST/PUT /accounting/cancellation-compensations`, `…/:id/receive`, the compensation of an iCal cancellation approval | `startDate`, `endDate`, `expectedDate`; `receivedDate` | real day; `receivedDate` not in the future, ≥ today − 5 years (by string, 29 Feb unhandled) | the three in the window unless kept (the French message as `error`); `receivedDate` on `horizonStart`, its three refusals (invalid, future, too old) as the French message in `error` and `INVALID_DATE` / `RECEIVED_DATE_IN_FUTURE` / `RECEIVED_DATE_TOO_OLD` in `code` |
   | `PUT /calendar-notes/:propertyId/:date` | `date` | **unchecked** (`abc` stored) | real day in the window, unless a note is stored on it (edit and clear) |
   | `POST /properties/:id/pricing`, `PUT …/pricing/:ruleId`, `POST …/pricing/assign-dates` | each `dateRanges` start / end | **unchecked** (assign: regex) | real day in the window, unless one of the stored rule's dates |
   | `POST /tariff-recipes/journal` (manual entry) | `occurredAt` | real day | + in the window |
   | `GET /email-sequence/simulation`, `GET /emails/pending?today=` | `from`, `to`; `today` | regex + `Date.parse` (`02-30` passed), 400 days; `today` unchecked | real days in the window (`INVALID_RANGE` with `message`; `today` 400) |
   | linen 1.2.2: `POST /laundry/skips`, `PUT /laundry/manual-additions/:date`, `PUT /laundry/extra-trips/:date` | `date` | real day | + in the window unless stored (`DATE_OUTSIDE_WINDOW`) |
   | school-holidays 1.0.5: `POST /school-holidays`, `PUT /school-holidays/:id` | the six zone dates | **unchecked** (only order) | real days in the window unless kept |
   | hourly-resources 1.3.4: `POST /resource-bookings`, `PUT …/:id`, `POST …/preview` | `date` | **unchecked** | real day in the window unless the booking's stored day |
   | online-payment 1.5.2: `PUT /plugins/online-payment/settings` *(added 2026-11-03, audit R20-P1)* | `reconciliationStartDate` | regex (`2027-02-30`, `0002-10-31`, `9999-12-31` passed) | empty, or a real day in the window unless the stored value (`specs/qonto-bank-reconciliation.md` rule 48) |
   | `POST /reservations/calculate-price`, `POST /reservations`, `PUT /reservations/:id` (`performUpdate`), `POST /devis`, `PUT /devis/:id` | each option line's `cardOccurrences[].date`, each resource line's `sessions[].date` | regex only (`normalizeCardOccurrences`, `isValidSession`): `1900-01-01`, `9999-12-31`, `2099-02-30` billed and stored | a real day of the stay, arrival to departure morning inclusive (the fiche's grid), else « Date hors du séjour. » (`stayItemDatesRefusal`, `INVALID_STAY_DATES`, `field: 'cardOccurrences'` / `'sessions'`), unless the same line already stores it (`bookingLinesModel.getStoredItemDates`); the stay lies in the window, so they do too |
   | `POST /email-mentions/preview` (read only) | `startDate` | regex | a real day in the window, today otherwise: the preview never fails (`emailMentionsController.previewStartDate`) |

   Already inside the window by their own, stricter rules, unchanged: the VAT regime switch
   (`effectiveFrom` ± 366 days), « Marquer préparé » on a planning card (a stored occurrence). *Corrected
   2026-11-02 (review of PR #938, F1, F11):* this paragraph first listed the installment due dates and the
   option occurrences and hourly sessions as unchanged; the due dates changed (table above), and the
   occurrences and sessions were only checked by a regex — both are now rows of the table. No user date: the cancellation (today), the tourist-tax declaration (now), the dashboard
   snoozes (days), the support access (hours), the payment links (provider dates). Platform-provided dates
   keep their own rules and are not held to the window: the iCal import (its 730-day horizon,
   `specs/ical-import-hardening.md`), the Booking / Airbnb / Gîtes de France intakes (they match an existing
   fiche and refuse a started stay), the bank reconciliation (Qonto's `settledAt`), the school-holidays sync
   (education.gouv.fr), the public website booking (not in the past, 730 days ahead at most). Read paths are
   not limited: the planning, the calendar, the occupied dates and the accounting exports of a month read
   stored rows. The tariff recipes write seasons through `addPricingRule` / `updatePricingRule`, now
   guarded, but always inside the window (`horizonYears` ≤ 5 from 1 January of the current year).
   A `.backup` copy of the prod snapshot of 2026-10-22, read 2026-11-02 against a window starting 2021-11-02:
   the only stored dates before it are 12 `payment_links.expiresAt` rows (ids 1, 2, 3, 6, 7, 10, 11, 13, 14,
   15, 16, 17), Qonto's `0001-01-01T00:00:00Z` « no expiry », written by the provider and edited by no flow;
   the earliest stay starts 2025-12-31, no JSON-embedded date (season ranges, settled notes) is older. No
   legitimate edit flow is refused, nothing is migrated. Tests: `tests/date-window-past.unit.test.js`,
   linen `laundry-date-window`, school-holidays `school-holidays-date-window`, hourly-resources
   `resource-bookings-date-window`; client `ReservationPage.date-window-past`,
   `EstablishmentClosuresPage.date-window-past`, `PeriodSelector.date-window-past`. Occurrences and sessions:
   `tests/stay-item-dates.unit.test.js`. The client hints judge the window from the server's Europe/Paris day
   (`GET /api/today`, `useServerToday`) once the page knows it, the device's until then: a device ahead of or
   behind Paris no longer disagrees with the server on the boundary day. Tests: client
   `utils/dateHorizon.server-today`, `hooks/useWelcomePack.server-today`,
   `pages/EstablishmentClosuresPage.server-today`, `pages/ReservationPage.server-today`,
   `pages/FinancePage.server-today`, `components/PeriodSelector.server-today`.
   *Reading of 2026-11-03 (audit R20-C3).* The fiche's reads follow that day as well as the dates: the
   resources' availability, the occupied dates and the live quote re-run when `windowToday` changes, so a
   date the device's day held back is asked as soon as the server's day accepts it (the availability and
   the quote stay de-duplicated by their key and signature). Test: client `pages/ReservationPage.server-day-arrives`.
14. **Added 2026-11-02 (merge of PR #936 with #937) — a year typed digit by digit never freezes the fiche.**
   Since a date can be typed on the keyboard again (`specs/datepicker-close-on-select.md`, reading of
   2026-11-02), Chromium hands the fiche each digit of a year typed over a complete date: 0002, 0020, 0203,
   then the year. Rules 12 and 13 keep such a range from any request, and the fiche's own occupancy check
   (`utils/reservationConflicts.findFirstOccupiedDateInRange`) reads it like any other: it scans the
   occupied days, not the nights of the range, and pads a year under 1000 to four digits. *Why:* the check
   walked the range night by night and wrote year 2 as « 2-10-31 », which no date parses: an arrival typed
   over a stored fiche (first digit, 0002) looped forever and froze the tab. Within those rules, a stay
   typed six years ahead keeps the focus, says « Date trop lointaine : 5 ans au plus. » and sends nothing.
   Tests: client `utils/reservationConflicts.half-typed-year.test.js`,
   `pages/__tests__/ReservationPage.date-horizon-keyboard.test.jsx`.
15. **Added 2026-11-03 (audit R21) — the numbers of a line and of the party are judged at the boundary.** On
   the price preview, the create, the update and the devis create and update, before anything reads them
   (`utils/lineInputBounds.js`, same code everywhere):
   `options` / `selectedOptions` / `customOptions` / `resources` / `selectedResources` present and not an array
   of objects, or `offeredOptionIds` not an array → 400 `INVALID_LINES`; a line `quantity` or a party number
   (`adults`, `children`, `teens`, `babies`, `babyBeds`, `singleBeds`, `doubleBeds`) that is not a finite number →
   400 `INVALID_QUANTITY`; a custom `amount` or a line's `acompteContribTtc` / `soldeContribTtc` likewise → 400
   `INVALID_AMOUNT`. Refused, never clamped. A boolean, an array, `1,5` or `0x10` is not a number; absent, null and
   empty still mean « not sent »; a `quantity` of 0 or less still switches the line off, and a fraction stays
   allowed. Past `Number.MAX_SAFE_INTEGER` a number counts as unusable: it is finite, but overflows to Infinity
   once priced and summed. That is a technical limit: no business ceiling on `quantity` is decided. *Why:*
   `1e999` parses to Infinity; it reached `finalPrice` and `balanceAmount`, which JSON then reads as `null` and no
   save can repair, while `quantity: 1e308` stored a line at 0 €, and lines that were not an array answered 500.
   Tests: `tests/line-input-bounds.unit.test.js`.
16. **Added 2026-11-04 (audit R22-C4) — only the latest question's answer reaches the fiche.** The occupied dates, the
   client search and the resources' availability drop an answer a newer question has overtaken (`useLatestRequest`).
   Coming back to the range already shown overtakes the answer on its way too. *Why:* the old answer wiped a conflict
   hint, emptied the client list under the text typed, and left « déjà réservée » on the range just left. The server
   still decides at save. Tests: client `pages/__tests__/ReservationPage.latest-answer.test.jsx`.
17. **Added 2026-11-04 (audit R22-C6) — the cots left follow the dates.** They are asked when the logement, the dates or
   the excluded stay change, once per range, latest answer only, like the resources. While the range is one the server
   would refuse, the hint reads « Dispo restante: ... » and availability sets no ceiling. An answer alone never rewrites
   the fiche's cots: only a change of party clamps them. On a range with no cot left the number stays and the save
   answers « Lits bébé indisponibles », rather than a cot silently dropped. The update judges the cots whenever the
   logement or the dates move, even with the party unchanged (a fiche with one cot moved onto a full range was saved and
   oversold the stock); with the range and the party unchanged it does not judge them, so an already oversold fiche still
   saves. Tests: server `tests/cots-follow-the-dates-at-save.unit.test.js`, client
   `pages/__tests__/ReservationPage.baby-bed-dates.test.jsx`.

**Edge cases:** all current ones are preserved verbatim — min-nights rejection, archived-reservation
error, iCal-locked pricing snapshot reuse, night-block conflict on adjacent reservations, payment
patch. No new edge behavior is introduced.

---

## 4. Architecture

> Pure backend restructure. Fat backend stays fat; the client is not touched.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `reservations.js` | T | Thin wiring only: verb/path → controller method. Multer/JSON middleware stays. Target: ~60–90 LOC. |
| `controllers/` | `reservationsController.js` | C | One handler per endpoint: parse → finance validation → pricing (`utils/pricing`) → occupancy (`utils/occupancy`) → model → response. Holds the orchestration currently inline in the routes. |
| `models/` | `reservationsModel.js` | C | Factory `create(db)` (+ default bound to `../database`), mirroring `settingsModel`. Methods: `list({propertyId,clientId,from,to})`, `getById(id)` (with options/resources/nights), `getHistory(id)`, `create(payload)`, `update(id,payload)`, `updatePayment(id,payload)`, `remove(id)`, `getPricingSnapshot(id)`, `listForOccupancy(propertyId,from,to,excludeId)`, history insert. All SQL lives here. |
| `utils/` | `occupancy.js` | C | Pure: `timeToHour`, `addIsoDays`, `getNightBlocksFromTimes`, `buildOccupiedDatesFromReservations`, `validateAvailability({...})` (the current `validateReservation` rule, DB-free — takes the candidate + existing reservations/closures). Unit-tested. |
| `utils/` | `reservationAudit.js` | C | Pure: `normalizeHistoryValue`, `getOptionsSignature`, `getResourcesSignature`, `buildAuditSnapshotFromPayload`, `computeAuditChanges`. Snapshot-from-DB stays a model read that feeds these pure fns. Unit-tested. |
| `utils/` | `pricing.js` | — | Unchanged; controller calls `calculateReservationQuote` as today. |
| `utils/` | `financeValidation.js` | — | Unchanged; controller keeps the PR-S validation on writes. |
| `utils/` | `stayDates.js` | C | *(2026-11-02, rule 11)* `isRealIsoDay`, `stayDatesRefusal`, `stayDatesRefusalBody`: the one stay-dates guard, called by `reservationsController`, `devisModel` and `icalDateDriftModel`. `isRealIsoDay` is also the core's one real-day check: `planningDateRange.isIsoDate` and `cancellationCompensations.isValidIsoDate` are it. *(R19-L1)* `MAX_STAY_NIGHTS` (366), the length cap, also read by `icalParser`'s horizon check. *(rule 13)* `MAX_HORIZON_YEARS`, `HORIZON_MESSAGE`, `horizonEnd`, `dateBeyondHorizon` and the `stored` option of `stayDatesRefusal`: the date horizon, also read by `establishmentClosuresValidation` and `financeWindow`. *(rule 13, second reading)* `PAST_HORIZON_MESSAGE`, `horizonStart`, `dateBeforeHorizon`, `dateWindowMessage`, `entryDateMessage`, `rangesWindowMessage`: the window both ways, read by every swept write path, and by plugins as `coreModule('stayDates')` (SDK 2.20.0). `ITEM_OUTSIDE_STAY_MESSAGE`, `stayItemDatesRefusal`: the option occurrences and hourly sessions on the stay's days, read by `reservationsController` and `devisModel`; the stored dates come from `models/bookingLinesModel.getStoredItemDates`. |
| `database.js` | — | — | No schema change. |

**Notes:**
- `validateReservation` currently queries the DB inside itself; split it into a **pure** rule
  (`utils/occupancy.validateAvailability`, fed data) + a **model** read (`listForOccupancy`) so the rule
  is unit-testable. Establishment-closure overlap (already consulted via `establishmentClosuresModel`)
  stays wired in the controller/model exactly as now.
- Keep `calculate-price` and `suggest-beds` behavior identical (move their inline bodies into controller
  methods; bed-distribution math → a pure helper, optionally in `occupancy.js` or its own util).
- Model uses better-sqlite3 prepared statements (created once in the factory), like `settingsModel`.

### 4.2 Client side

None at first: `utils/reservationConflicts.js` and its consumers were unchanged (until rule 14, below).

*2026-11-02 (rule 12):* `pages/ReservationPage.jsx` refuses the save and exposes `stayDatesHint`;
`components/reservation/StaySection.jsx` renders it under the dates; the messages and `MAX_STAY_NIGHTS`
live in `constants/stayDates.js`, and `utils/stayDates.js` holds `stayDatesMessage` / `isQuotableStay`
(R19-L1, the length cap).

*2026-11-02 (rule 13):* `constants/dateHorizon.js` (`MAX_HORIZON_YEARS`, `HORIZON_MESSAGE`) and
`utils/dateHorizon.js` (`horizonEnd`, `dateBeyondHorizon`, generic: the fiche, the closures dialog and
`PeriodSelector` read them); `stayDatesMessage` / `isQuotableStay` take the loaded record as `stored`, and
the fiche's occupied-dates read is gated by `isQuotableStay` too.

*2026-11-02 (rule 13, second reading):* `constants/dateHorizon.js` gains `PAST_HORIZON_MESSAGE`, `utils/dateHorizon.js`
`horizonStart` and `dateWindowMessage` (the past or the future message, or ''); `stayDatesMessage`, the closures
dialog and `PeriodSelector` (« du » too) read `dateWindowMessage`, so none of them sends a date outside the window.
A new fiche opened from URL dates the fiche refuses asks neither the resources' nor the baby beds' availability for
them, and `hooks/useWelcomePack` sends no date outside the window. `EmailSequenceSimulation` shows the server's
window message. The fiche, the closures dialog and `FinancePage` read `hooks/useServerToday` and hand that day to
`stayDatesMessage` / `isQuotableStay` (`today`), `dateWindowMessage`, `useWelcomePack` (`today`) and
`PeriodSelector` (`today` prop, `customWindowError(from, to, today)`).

*2026-11-02 (rule 14):* `utils/reservationConflicts.js` — `findFirstOccupiedDateInRange` scans the occupied
days instead of the range's nights; its date formatting pads the year to four digits.

*2026-11-03 (audit R20):* `utils/isoDay.js` gains `isRealIsoDay` (generic: `stayDatesMessage` and
`PeriodSelector.customWindowError` read it), `constants/stayDates.js` `STAY_DATE_INVALID_MESSAGE`;
`hooks/useWelcomePack` skips a present date that is not a real day or is outside the window (not `isQuotableStay`: missing, reversed and too-long dates are still asked); the three `ReservationPage` read effects list `windowToday`.

### 4.3 API contract

**Unchanged.** Same endpoints, bodies, responses, and status codes as today. This slice must be a no-op
from any API client's perspective (verified by the existing behavior + manual checks).

*2026-11-02 (rule 11):* the stay endpoints listed in rule 11 answer 400 `INVALID_STAY_DATES` (`error`,
`code`, `field`) for unsound dates, the devis endpoints and the iCal drift approval included (both
now forward `code` and `field` with their `error`).

*2026-11-02 (rule 13):* the same 400 `INVALID_STAY_DATES`, `error` « Date trop lointaine : 5 ans au plus. »,
for an entered or edited date past today + 5 years. No new field: `calculate-price` already carried
`reservationId` / `devisId`.

*2026-11-02 (rule 13, second reading):* « Date trop ancienne : 5 ans au plus. » for a date before today − 5 years,
on the same codes; the other swept endpoints answer 400 with their own code and the French message (table of rule 13).
The stay endpoints and the devis endpoints answer the same 400 `INVALID_STAY_DATES` with `error` « Date hors du
séjour. » and `field` `cardOccurrences` or `sessions` for an option occurrence or an hourly session off the stay's
days. `POST /accounting/cancellation-compensations/:id/receive` now carries `code` beside the French `error`.

---

## 5. Data model

No schema changes. No migration.

**Data impact:** none — pure code restructure.

## 6. UI / UX

No UI changes. (Manual verification still exercises the reservation flows through the existing client to
prove behavior is preserved.)

## 7. Test plan

### Client tests (2026-11-04)
- [x] `pages/__tests__/ReservationPage.latest-answer.test.jsx` (6) — rule 16: occupied dates and their failure, client search, resources, back on the range shown, onto a refused range
- [x] `pages/__tests__/ReservationPage.baby-bed-dates.test.jsx` (8) — rule 17: dates, one question per range, blank fiche, refused range, older answer, no cot left, back on the range shown, party change on no cot left

### Server unit tests
- [x] `tests/cots-follow-the-dates-at-save.unit.test.js` (8, 2026-11-05) — rule 17: dates onto a full range refused,
      party changed too, one date alone, free range, no cot held, logement moved, oversold and unchanged, one more cot unchanged range
- [x] `tests/date-horizon.unit.test.js` (12, 2026-11-02) — rule 13: today + 5 years accepted, one day more
      refused on calculate-price, create, update, drift approval, devis create / update, closures and the
      finance window; stored dates past the horizon saved, restored, extended and converted untouched.
- [x] `tests/date-window-past.unit.test.js` (21, 2026-11-02) — rule 13, second reading: today − 5 years accepted,
      one day earlier refused (and today + 5 years / one day later where the path had no future side) on every
      core path of the table, nothing written, stored dates kept (a penalty's past side and its stored solde
      default, a stored devis `validUntil`, a payment mark sent back with its stored date, the compensation
      receipt's French message and code, the mentions preview's fallback); plugin suites `laundry-date-window` (3),
      `school-holidays-date-window` (2), `resource-bookings-date-window` (2), `reconciliation-start-date-window` (3,
      2026-11-03); client
      `ReservationPage.date-window-past` (3), `EstablishmentClosuresPage.date-window-past` (2),
      `PeriodSelector.date-window-past` (2).
- [x] `tests/stay-item-dates.unit.test.js` (10, 2026-11-02, review of PR #938) — rule 13, second reading: an option
      occurrence or an hourly session off the stay's days or not a real day refused on calculate-price, create,
      update, devis create / update, nothing written; the departure morning accepted; a date the line stores kept.
      Added after the second review (V1): an impossible day between arrival and departure (stay over the end of
      February) refused, an occurrence `<day>T09:00` judged on its day, a stored out-of-stay session kept on a
      reservation re-save, a stored out-of-stay occurrence kept on a devis re-save and refused on another line.
- [x] Client `utils/dateHorizon.server-today` (2), `hooks/useWelcomePack.server-today` (2),
      `pages/EstablishmentClosuresPage.server-today` (1) (2026-11-02) — the hints read the server's day.
      Added after the second review (V2): `pages/ReservationPage.server-today` (1),
      `pages/FinancePage.server-today` (1), `components/PeriodSelector.server-today` (1) — the fiche, a finance
      link and the period selector's `today` prop refuse a date the device would accept but the server would not.
- [x] Client `utils/stayDates.real-day` (7), `pages/ReservationPage.real-day` (2), `hooks/useWelcomePack.real-day` (8)
      (2026-11-03, audit R20-C2) — rule 12: a date not a real day says « Date de séjour invalide. » and is asked
      nothing (the welcome pack still asks missing, reversed and too-long dates, REG-1); a padded half-typed year and a stored row keep their behaviour. `pages/ReservationPage.server-day-arrives`
      (1) (R20-C3) — rule 13: the server's day lifting a refusal asks the fiche's reads.
- [ ] `tests/occupancy.unit.test.js` — `getNightBlocksFromTimes` thresholds (checkout ≥17h blocks next
      night, checkin ≤10h blocks previous night); `buildOccupiedDatesFromReservations`;
      `validateAvailability` accepts a free range and rejects overlaps incl. night-block adjacency.
- [ ] `tests/reservation-audit.unit.test.js` — option/resource signatures; `computeAuditChanges`
      detects changed fields and ignores unchanged ones; value normalization.
- [ ] Model (`reservationsModel`) is verbatim SQL extraction; verified end-to-end via the manual
      round-trip below (create / conflict / history / delete) rather than a duplicate in-memory schema
      test. The existing suite stays green (no behavior change).

### Manual verification (behavior preserved)
- [ ] Create a reservation (happy path) → saved with options/resources/nights + a `create` history entry.
- [ ] Edit it → updated + an `update` history entry with the right diff; pricing snapshot honored on edit.
- [ ] Conflict: try to create overlapping/adjacent (night-block) reservation → rejected with the same message.
- [ ] Min-nights breach → same rejection.
- [ ] `PATCH payment` → flags/amounts update; `DELETE` → removed; archived-reservation error unchanged.
- [ ] `GET /occupied-dates` and `GET /:id/history` return the same shapes as before.
- Audit R18-1 (rules 11-12, 2026-11-02): `server/src/tests/stay-dates-guard.unit.test.js` (30 cases: the four
  shapes on reservation create / update / `performUpdate` / calculate-price / devis create / update, stored
  dates on devis extend / preview / convert, restore and drift approval, each asserting `code` and `field`; the
  parser contract) and
  `client/src/pages/__tests__/ReservationPage.stay-dates-order.test.jsx` (5 cases: reservation, zero night,
  devis, server refusal, logement switch before the dates).
- Audit R19-L1 (rules 11-12, 2026-11-02): `server/src/tests/stay-length-cap.unit.test.js` (12 cases: the cap
  itself; a `9999-12-31` departure and a 367-night stay refused in under 500 ms on calculate-price, reservation
  create and update, devis create and update, nothing written; 366 nights quoted and saved) and
  `client/src/pages/__tests__/ReservationPage.stay-length.test.jsx` (5 cases: the pure hint, 367 nights and
  `9999-12-31` on the fiche with no quote and no save, 366 nights quoted, the devis).
- Merge of PR #936 with #937 (rule 14, 2026-11-02): `client/src/utils/reservationConflicts.half-typed-year.test.js`
  (3 cases: a range in year 0002, a range from 0002 to 2031 in under 200 ms — it never ended before —, the
  bounds) and `client/src/pages/__tests__/ReservationPage.date-horizon-keyboard.test.jsx` (2 cases: the fiche
  and the devis, a stay typed year digit by digit six years ahead: focus kept, the message, no quote, occupied
  dates or availability asked for the far or half-typed dates, no save).
- [x] 2026-11-02 (rule 14), headless Chromium (fr-FR) on a copy of the shadow, 1280 and 390 px: on a stored
  fiche and on a stored devis, both dates typed over with the year + 6 keep the focus, show « Date trop
  lointaine : 5 ans au plus. », send no quote, occupied-dates or availability request for the far or
  half-typed dates, and « Enregistrer » refuses with the message before any write.
- Spec review 2026-10-27 (rule 9): `server/src/tests/create-without-times-and-linen.unit.test.js` — default times stored, no early-arrival fee on the re-save.

## 8. Out of scope

- **Moving `reservationConflicts.js` rules server-side / returning `conflictType` flags** → deferred to
  the client slices **3b (CalendarPage)** / **3c (ReservationPage)**, where those consumers are
  refactored; changing the conflict-info source is a client+UX concern best done there. The server is
  already authoritative for rejection today, so deferring is safe.
- **CalendarPage dead-dialog removal** → slice **3b**.
- **ReservationPage component split + PageActionBar** → slice **3c**.
- **Devis MVC refactor / table fusion** → Bloc 4. (`devis.js` shares the pricing engine but is not
  touched here beyond what PR-S already did.)
- Any change to pricing math, payment schedule, or tourist tax (owned by `utils/pricing.js`).

## 9. Open questions

**Resolved at approval (2026-05-27):**
- `suggestBedDistribution` → its own `utils/bedDistribution.js` (distinct concern, unit-testable). ✅
