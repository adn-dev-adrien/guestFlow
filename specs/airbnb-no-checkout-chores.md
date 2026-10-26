# Airbnb — no checkout chores reminder

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/airbnb-no-checkout-chores` |
| **Created** | 2026-10-26 |
| **Author** | Adrien |
| **Related PR** | [#786](https://github.com/adn-dev-adrien/guestFlow/pull/786) |

---

## 1. Context

Airbnb announced on 2026-10-21 a house-rules policy that applies to every booking **made on or after
2026-11-20**: a host may no longer require a guest to wash and put away the dishes, strip the beds,
start a laundry or take the trash off-site, may not fine a guest for a chore left undone, and may not
add a request after the booking — by message, by a sign in the accommodation or orally at arrival.
What stays allowed: leaving used dishes in the sink, gathering the towels, sorting the trash into the
indoor bins, locking up.

Done outside the code on 2026-10-26, in the Airbnb host console:
- **Cleaning fee** — Gîte 0 € → **122 €** ((80 € ménage + 22.92 € for the dishes, trash and beds the
  guest no longer does, 55 min at 25 €/h) ÷ 0.845, Airbnb's 15.5 % host fee being taken on the cleaning
  fee too — a first 108 € forgot that); L'Estiva 0 € → **13 €** (its ménage is already in the nightly
  price). Proved on public quotes. The recipe carries these from
  [tariff-recipe-platform-cleaning-fee.md](tariff-recipe-platform-cleaning-fee.md).
- **« Avant le départ » requests** reworded the same day to mention neither the dishes nor the trash
  (Adrien: guests who know do it anyway, the others stay free).
- The Gîte's « départ après 10 h facturé une demi-nuit » (a penalty) removed from its requests.

What is left in GuestFlow: when the cleaning is included, the **arrival SAS** tells the operator to
« Rappeler au client : la vaisselle doit être faite et rangée, et les poubelles vidées » — on the hidden
ménage page and on the recap (`specs/sas-hide-settled-steps.md` §3 rule 4). Said to an Airbnb guest,
that is exactly the oral request at arrival the policy forbids.

The Airbnb mail intake (`server/src/plugins/airbnb-intake/intakeService.js`) already turns the Airbnb
cleaning fee into a cleaning line on the fiche — the catalogue option when the amount matches its price,
a custom « Frais de ménage (Airbnb) » line otherwise (the 122 € case). The SAS recognises both
(`isCleaningSoldForReservation`); the e-mails only read catalogue options and told that guest the ménage
was « à votre charge » — fixed by rule 6, found in review. The departure SAS could also bill an Airbnb
guest a ménage left undone — rule 7.

## 2. Goal

The arrival SAS never asks the operator to give an Airbnb guest a checkout chore.

## 3. Functional rules

1. The SAS read (`GET /api/reservations/:id/sas`) serves `cleaning.guestReminder`: `true` when the
   cleaning is included **and** the reservation's channel is not Airbnb; `false` otherwise.
2. The channel test is `isAirbnbChannel(platform)` — case-insensitive, trimmed, on the recorded
   `platform` value. It applies to **every** Airbnb reservation, whatever its booking date (arbitrated by
   Adrien on 2026-10-26: the listings were rewritten the same day, a date cut would only keep a reminder
   the listing no longer announces).
3. The client shows the « vaisselle faite et rangée, poubelles vidées » reminder (ménage page and recap)
   only when `cleaning.guestReminder` is `true`. It no longer derives it from `cleaning.included`.
4. Every other channel (direct, Lodgify, Booking, Gîtes de France, GreenGo, Abracadaroom…) keeps the
   reminder exactly as today.
5. Nothing else in the SAS changes: an Airbnb stay with the cleaning included still hides the ménage
   page; an Airbnb stay without it still gets the ménage offer page.

### Added after review (2026-10-26)

6. **No written chore request to an Airbnb guest.** The e-mail context counts a free cleaning line
   (« Frais de ménage (Airbnb) », matched by `isCleaningOption` as the SAS does) as a booked ménage, so
   the J-2 says « le ménage est pour nous » / « vous avez choisi l'option ménage ». On an Airbnb stay
   without any cleaning line, the J-2 cleaning paragraph is empty and the J-1 `hasCleaningOption` flag is
   true, so neither mail says the ménage is « à votre charge ».
7. **No ménage billed at an Airbnb departure.** The SAS read serves `cleaning.billableAtDeparture`
   (`false` on Airbnb, or when the cleaning is included); the departure SAS drops its « Le ménage a-t-il
   été fait correctement ? » page and its « Ménage de fin de séjour » line then. The departure commit
   drops that line server-side on an Airbnb stay whatever the client sends — Airbnb forbids fining a
   guest for a chore.

**Edge cases:**
- Airbnb stay, cleaning not included (booking made before the fee existed) → ménage offer page as
  today; no reminder anywhere (there was none in that branch already).
- `platform` null or empty → treated as direct (same rule as `isDirectChannel`) → reminder kept.
- `isAirbnbChannel` slugs and matches the prefix, like the e-mail sequence: an iCal source labelled
  « Airbnb Tente » (stored `AirbnbTente`) is Airbnb too.
- An Airbnb stay still recorded as `Lodgify` (booked through Lodgify before 2026-10-15 and never
  relabelled, `specs/lodgify-decommission.md`) keeps the reminder: those bookings predate the policy.
- The « ✅ Le ménage est inclus » variant of the arrival ménage page is unreachable today (the step is
  dropped when the cleaning is included); its reminder is gated anyway, so it cannot come back unguarded.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `platformNameFormat.js` | T | Adds `isAirbnbChannel(platform)` next to `isDirectChannel`. |
| `controllers/` | `sasController.js` | T | `getSas` serves `cleaning.guestReminder` (rule 1) and `cleaning.billableAtDeparture` (rule 7). |
| `models/` | `reservationsModel.js` | T | Departure commit drops the « Ménage de fin de séjour » line on an Airbnb stay (rule 7). |
| `utils/` | `emailContextBuilder.js`, `stayContentContext.js` | T | A free cleaning line counts as booked; no « à votre charge » to an Airbnb guest (rule 6). |
| `tests/` | `airbnb-no-checkout-chores.unit.test.js` | C | Rules 1, 2, 4 and the null-platform edge case. |

No route, model, middleware, task or migration change.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.jsx` | T | Reminder gated on `data.cleaning.guestReminder` (rule 3); departure ménage page and line gated on `billableAtDeparture` (rule 7). |
| `components/sas/__tests__/` | `ReservationSasDialog.airbnb-chores.test.jsx` | C | Airbnb recap without reminder, other channel with it. |
| `components/sas/__tests__/` | `ReservationSasDialog.arrival.test.jsx` | T | The reopen case that expects the reminder now serves `guestReminder: true`. |

**Component reuse declaration:** no component created or consumed beyond the existing SAS dialog.

### 4.3 API contract

| Method | Endpoint | Response change |
|---|---|---|
| GET | `/api/reservations/:id/sas` | `cleaning` gains `guestReminder` and `billableAtDeparture` (booleans). Additive. |

---

## 5. Data model

None.

## 6. UI / UX

Arrival SAS, recap page, cleaning included:
- **Airbnb** → the line « Ménage inclus — rappeler au client : la vaisselle doit être faite et rangée, et
  les poubelles vidées. » is gone. Nothing replaces it.
- **Any other channel** → unchanged.

Same rule on the ménage page's « ✅ Le ménage est inclus. » variant. Text removal only: identical on
`xs`, `md` and `lg`. No `PageActionBar` (the SAS is a dialog).

## 7. Test plan

### Server unit tests
- [x] `airbnb-no-checkout-chores.unit.test.js` (7 tests) — e-mails (rule 6), departure flag and commit guard (rule 7), plus — Airbnb + included → `guestReminder: false`; Booking +
  included → `true`; Airbnb + not included → `false`; null platform + included → `true`;
  `isAirbnbChannel` case/whitespace.

### Client unit tests
- [x] `ReservationSasDialog.airbnb-chores.test.jsx` (3 tests) — Airbnb departure skips the ménage page (rule 7), plus — recap with `guestReminder: false` shows no
  reminder; with `true` shows it.
- [x] Existing `ReservationSasDialog.arrival.test.jsx` stays green.

Full suites on 2026-10-26 after review: server 4 983/4 983, client 1 481/1 481.

### Manual UI verification
- [x] Arrival SAS on an Airbnb Gîte stay with « Frais de ménage (Airbnb) » 108 € → `guestReminder: false`,
  recap without the reminder (dev copy, 2026-10-26; the live fee is now 122 €, same custom-line path).
- [x] Arrival SAS on a Booking stay with the ménage → recap with the reminder.
- [x] Mobile width (390px): recap without the reminder, no horizontal scroll.

## 8. Out of scope

- The **sign inside the Gîte** (« petite affiche » the J-2 e-mail mentions for stays without the
  ménage): physical, Adrien's to rewrite.
- Prices: the Airbnb cleaning fees are set in the Airbnb console, not by GuestFlow.

## 9. Open questions

- Q: For an Airbnb stay with the cleaning included, which reminder at the SAS — the allowed list, or
  none?
  - A (2026-10-26, Adrien): **none** for Airbnb; the other channels keep today's reminder.
