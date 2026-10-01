# Finance — booking pace (« réservations à date » vs last year)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/booking-pace` |
| **Created** | 2026-09-30 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Validation summary with the interactive mock-up: `docs/specs/2026-09-30-booking-pace.html`.

---

## 1. Context

The Suivi financier (`specs/finance-dashboard-redesign.md`) looks at the past and the present: revenue
of a window, occupancy per month, comparison with last year on the months that are over or running.
It says nothing about the months **ahead** in the way an operator steers them: *on this date, am I
ahead or behind last year for the coming months?*

Hotel and campsite tools answer that with a **booking pace** view (« réservations à date », « on the
books vs same time last year »): for each coming stay month, what is already booked today, next to
what was booked **on the same date one year earlier** for the same month last year, and next to what
that month finally made. Adrien asked for it on 2026-09-30, pointing at Septeo.

What the market does (research of 2026-09-30): PriceLabs, Beyond and AirDNA draw three series per
stay month — this year on the books, same time last year, final last year — with a metric switch
(nights / occupancy, revenue, ADR). Septeo's public material (eSeason « Baromètre HPA ») compares the
bookings *taken* over a window of booking dates with the same window a year earlier, in % change;
its product screens are not public. Access Group and PriceLabs add a per-month booking curve and a
« % of last year's final already reached » gauge.

GuestFlow knows when each reservation entered the system (`reservations.createdAt`), but three facts
of the data shape the feature:

- **`createdAt` is the insertion date, not the guest's booking date.** For a stay created by an
  iCal sync it is the sync time (hourly — close enough). For every stay **imported** when GuestFlow
  started (April 2026, per `finance-dashboard-redesign.md` rule 21) it is the import day, although
  the guest booked weeks or months earlier.
- **A cancellation approved from the iCal flow deletes the row** (`icalCancellationModel.approve`),
  and its `reservation_history` rows go with it (`ON DELETE CASCADE`). A stay cancelled that way
  disappears from the past as well: last year's « à date » figure would be understated, and this
  year would look better than it is. A manual cancellation keeps the row (`kind = 'cancelled'`, `cancelledAt` set).
- **The page's revenue basis is cash-based** (attribution date = solde collected, or departure). For
  a stay paid in full at booking — Solio's rule since 2026-09 — the attribution date *is* the
  booking date. Pace must look at **stay nights**, not at the attribution date.

## 2. Goal

On the Suivi financier, the operator sees for each of the next twelve stay months what is booked
today against what was booked on the same date last year, and how far last year's month finally
went — in reservations, nights or revenue — and can tell at a glance whether they are ahead or
behind.

## 3. Functional rules

### 3.1 What is counted

1. **Booking date** of a reservation = the day its fiche was created, `DATE(reservations.createdAt)`
   (decided 2026-09-30: no separate booking-date column, no import of platform exports). For a stay
   created by an iCal sync this is the sync day; for a stay imported when GuestFlow started it is the
   import day.
2. A stay is **on the books at date D** when its booking date is on or before D and it was not
   cancelled on or before D. Three sources:
   - a live reservation (`kind = 'reservation'`);
   - a manually cancelled one (`kind = 'cancelled'`, `markCancelled`), until its `cancelledAt`;
   - a stay deleted by an approved iCal cancellation, recorded in `booking_pace_cancellations` (§5),
     until its `cancelledAt`.
   Devis never count; nor does a row deleted for any other reason (iCal duplicate, operator delete).
3. Stays are read **by stay night**, never by attribution date:
   - **Réservations** — a stay counts once, in the month of its **arrival**.
   - **Nuits** — each night counts in the month it falls in (a 29 Sept → 3 Oct stay gives 2 nights to
     September and 2 to October), as for the occupancy of `finance-dashboard-redesign.md` rule 24.
   - **Chiffre d'affaires** — the stay's « total de séjour » (same basis as the page: TTC, net of
     platform commission, caisse interne excluded) **spread evenly over its nights**, so a month
     gets its share of each stay. This figure is labelled « CA des nuits » and **is not** the page's
     « Revenu par mois » (cash basis); the chart's caption says so.
4. The logement filter of the page applies (`finance-dashboard-redesign.md` rule 3). The exercise and
   period window **do not**: pace always looks forward from today.

### 3.2 The three figures per month

5. The chart covers the **current month and the eleven following** (rolling, independent of the
   exercise). For each stay month *M*:
   - **Cette année, à date** (`current`) — on the books for *M* today.
   - **L'an dernier à la même date** (`sameTimeLastYear`) — on the books for *M − 1 year* on
     *today − 1 year* (29 Feb → 28 Feb).
   - **L'an dernier, au final** (`lastYearFinal`) — on the books for *M − 1 year* as it stands now
     (for a month over: what it made; for the current month last year: over too).
6. **Écart** per month = `current − sameTimeLastYear`, in the unit and in % of `sameTimeLastYear`
   (no % when it is 0).
7. **Reste à prendre** per month = `lastYearFinal − current` when positive: « l'an dernier, N nuits
   de plus ont été prises après cette date ». **Part du final atteinte** = `current ÷ lastYearFinal`
   (« Déjà 72 % du final de l'an dernier »), absent when `lastYearFinal` is 0 or unknown.

### 3.3 When last year is not comparable

8. **Tracking start** (`paceStart`) = the day after the earliest `createdAt` of a reservation in the
   filtered scope. The earliest day is the initial import, where every stay booked before GuestFlow
   landed at once; it cannot be read as « booked that day ».
9. `sameTimeLastYear` of month *M* is shown only when *today − 1 year* ≥ `paceStart` **and** *M − 1
   year* is on or after the coverage start (`finance-dashboard-redesign.md` rule 17). Otherwise the
   month shows only `current` and, if its month is covered, `lastYearFinal` — never a 0 that would
   read as « l'an dernier, rien n'était réservé ».
10. When no month is comparable, the summary line says: « La comparaison à date s'affichera à partir
    du <today − 1 year ≥ paceStart date> : il faut un an de dates de réservation. » and the chart still
    draws this year and last year's final where known.

### 3.4 Summary and pickup

11. **Summary line** above the chart, over the twelve months, on comparable months only: « Au 30 sept.,
    142 nuits réservées pour les 12 prochains mois, contre 118 l'an dernier à la même date :
    **+24 (+20 %)** » — green when ahead, red when behind, neutral within ±5 %.
12. **Prise des 7 / 30 derniers jours** — reservations (and nights, revenue) whose booking date falls in
    the last 7 / 30 days, for any coming stay, next to the same span last year. Cancellations in the
    span are subtracted (net pickup).

### 3.5 Pickup curve of a month

13. Clicking a month opens its **montée en charge**: the cumulative value on the books for that month
    by **days before the first of the month** (from 365 down to 0), this year solid up to today, last
    year dashed over the whole span, with a vertical « aujourd'hui » marker. It shows whether the gap
    comes from early bookings or from the last weeks.

### 3.6 Edge cases

- A stay booked and cancelled the same day never counts.
- A fiche created after its arrival (a stay entered late) counts from its creation date.
- A devis (`kind = 'devis'`) never counts; the reservation it converts into counts from its own
  booking date (the acceptance).
- A closed month (establishment closure) is shown with its values, not hidden: pace is about demand,
  not capacity.
- A logement created this year has no last year: its months are not comparable (rule 9).

---

## 4. Architecture

> Fat backend: every figure, the comparability, the summary sentence and the pickup curve are
> computed on the server. The client draws bars and lines from ready values.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `finance.js` | T | `GET /api/finance/pace` and `GET /api/finance/pace/:month` |
| `controllers/` | `financeController.js` | T | Pass `propertyId`, `metric` through; map `{ ok:false, status, error }` |
| `models/` | `bookingPaceModel.js` | C | Reads the stays (live rows + pace ledger), their « total de séjour » through `financeModel`'s helper, calls the pure utils, returns the payload |
| `models/` | `financeModel.js` | T | `getPaceStays({ propertyId })`: live + manually cancelled stays with their « total de séjour » (same refund / commission columns as `getSummary`), so pace never re-derives a stay's amount |
| `models/` | `icalCancellationModel.js` | T | Before the `DELETE`, write the stay to the pace ledger (§5) |
| `utils/` | `bookingPace.js` | C | Pure: on-the-books at a date, night split per month, revenue spread, comparability, écart, reste à prendre, pickup windows, pickup curve |
| `database.js` | `database.js` | T | Table `booking_pace_cancellations` + index on `reservations(createdAt)` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.jsx` | T | Places the card full width under « Revenu par mois » / « Taux d'occupation », passes the logement filter and bumps its `refreshKey` on « Actualiser » |
| `components/` | `BookingPaceCard.jsx` | C | Finance-specific: loads `/finance/pace` (and the curve) itself, since its metric is local to the card; summary line + badge, metric toggle, pickup chips, month chart, the month's curve below it |
| `components/` | `PaceMonthChart.jsx` | C | Finance-specific: Recharts bars per month — last year final as a dashed ghost on a hidden second axis, last year same date, this year; the month tick carries the écart coloured by the server's `tone`; `PaceTooltip` and `deltaText` as named exports |
| `components/` | `PickupCurveChart.jsx` | C | Finance-specific: cumulative curve by days before the month, today marker; `CurvePointTooltip` as a named export |
| `api.js` | `api.js` | T | `getFinancePace(params)`, `getFinancePaceMonth(month, params)` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `YearOverYearBadge`, `LoadingState`, `ErrorAlert` | |
| **Created (new generic)** | — | The metric toggle is MUI's `ToggleButtonGroup`, styled as in `PeriodSelector`. |
| **Specific (kept feature-local)** | `BookingPaceCard`, `PaceMonthChart`, `PickupCurveChart` | Tied to the pace payload; a second user would be the dashboard, which can embed the card as is. |

### 4.3 API contract

| Method | Endpoint | Query | Response |
|---|---|---|---|
| GET | `/api/finance/pace` | `propertyId?`, `metric=reservations\|nights\|revenue` (default `reservations`) | see below |
| GET | `/api/finance/pace/:month` | `propertyId?`, `metric` | `{ month, label, lastYearLabel, metric, todayDaysBefore, points: [{ daysBefore, current, lastYear }] }` (a point every 5 days, 365 → 0) |

```json
{
  "asOf": "2026-09-30", "asOfLastYear": "2025-09-30", "metric": "reservations",
  "paceStart": "2026-04-13", "comparableFrom": "2027-04-13",
  "summary": { "current": 142, "sameTimeLastYear": 118, "delta": 24, "deltaPct": 0.2034, "change": 20.3,
               "comparableMonths": 12, "tone": "success", "text": "…", "notice": null },
  "pickup": { "last7": { "current": 3, "lastYear": 1 }, "last30": { "current": 11, "lastYear": 9 } },
  "months": [ { "month": "2026-10", "label": "octobre 2026", "lastYearLabel": "octobre 2025", "tick": "oct.",
                "tone": "success", "current": 18, "sameTimeLastYear": 14, "lastYearFinal": 21,
                "comparable": true, "delta": 4, "deltaPct": 0.2857, "remaining": 3,
                "reachedPct": 0.8571 } ]
}
```

Auth: session, as the rest of `/api/finance`. `400` on an unknown `metric` or a malformed month.

---

## 5. Data model

- No new column on `reservations`: the booking date is `createdAt` (rule 1).
- Index `idx_reservations_createdAt` on `reservations(createdAt)` (`CREATE INDEX IF NOT EXISTS`).
- `booking_pace_cancellations (id, reservationId, propertyId, startDate, endDate, totalSejour,
  reservationCreatedAt, cancelledAt, createdAt)` — written in the same transaction as the iCal
  cancellation's `DELETE` (decided 2026-09-30), so a stay cancelled that way keeps counting on the
  dates it was on the books. Stays already deleted before this change are lost; the bias is
  documented.

**Data impact:** additive table and index; no existing value changes. Idempotent blocks in
`database.js`.

## 6. UI / UX

See the interactive mock-up. One card, full width, under « Revenu par mois » / « Taux d'occupation »:
« Réservations à venir — à date ».

- Header: title, metric toggle (Réservations · Nuits · CA des nuits — **Réservations** by default),
  summary line with its badge.
- Chart: 12 months; per month, this year (sapin, solid), last year same date (sable), last year final
  (outline around the sable bar, dashed). Under each month, the écart (▲ +4 / ▼ −2), coloured.
- Two chips: « Pris ces 7 jours » / « ces 30 jours », with last year.
- Tooltip: « Octobre 2026 · À date : 18 nuits · Octobre 2025 à la même date : 14 nuits · Octobre 2025
  au final : 21 nuits · Déjà 86 % du final de l'an dernier · reste 3 nuits ».
- Click a month → its pickup curve below the chart, full width, on every breakpoint (2026-09-30:
  `FormDialog` always carries an « Enregistrer » action, meaningless on a read-only curve; the card
  is already full width on a phone). Clicking the same month closes it.
- Not comparable: last year's same-date bar is absent, the month label carries « — », rule 10 line.
- **xs**: the metric toggle goes under the title, the chart scrolls horizontally inside its card
  (12 months × 56 px) with the écart kept under each month, chips stacked, curve below.
  **md / lg**: full width, chips side by side, curve below the chart.

## 7. Test plan

### Server unit tests — `server/src/tests/booking-pace.unit.test.js` (12 tests)

- On the books at D: booked before / on / after D; cancelled before / on / after D; devis ignored.
- Night split across a month boundary; revenue spread over nights, rounding sums back to the total.
- Reservations counted in the arrival month only.
- Same date last year on 29 Feb.
- Comparability: before `paceStart + 1 year` → no `sameTimeLastYear`, `lastYearFinal` still present.
- Écart and % (0 → no %), reste à prendre never negative.
- Pickup 7/30 days net of cancellations; pickup curve monotonic except cancellations.
- Ledger: an approved iCal cancellation writes its row and keeps counting before its `cancelledAt`.
- Endpoint: `400` on a bad metric / month; logement filter.

### Client tests — `client/src/components/__tests__/BookingPaceCard.test.jsx` (6 tests)

The server's sentence, badge and pickup; the notice replacing the badge; the metric toggle calling the
API again; the error; the tooltip lines; a non-comparable month reading « inconnu » / « — ».

Suites on 2026-09-30: server 4 599 / 4 599, client 1 413 / 1 413, E2E 84 passed (1 skipped).

### Manual UI verification (2026-09-30)

Isolated instance (API :4100, client :3101) on a copy of the dev database whose `createdAt` were
spread 10-290 days before arrival, at 1300 / 900 / 390 px:

- Réservations: « 5 réservations sur les 8 mois comparables, contre 6 … (−1) » with its badge; months
  before the data start show « — » and no sand bar; the hover tooltip gives the four lines.
- Click on May 2027 → its curve, this year up to J-213 and last year dashed; CA des nuits switches
  the axis to « k » and every figure to euros.
- 390 px: the twelve months scroll inside the card, the page itself never scrolls sideways; no
  console error.

Found and fixed during the check: the hidden ghost axis reserved its height and pushed the month
labels out of the chart (`height={0}`); Recharts 3's `activeLabel` did not carry the month, the click
now reads `activeTooltipIndex`.

## 8. Out of scope

- Choosing another « à date » than today (reading the pace as it stood on a past date).
- Forecast / expected final (« projection de fin de mois »).
- Pace by channel.
- A separate booking-date column, editing it, or importing booking dates from platform exports
  (decided 2026-09-30: the fiche's creation date is enough).

## 9. Open questions

All resolved on 2026-09-30, on `docs/specs/2026-09-30-booking-pace.html`:

- Q (A1): Default metric of the card?
  - A: **Réservations**; nuits and CA des nuits stay in the toggle.
- Q (A2): Booking dates of the stays that existed before GuestFlow — import them from platform exports,
  or wait?
  - A: **Neither: read the fiche's creation date** (`createdAt`). The comparison at date therefore
    appears one year after the initial import (rules 8-10); until then the card shows this year and
    last year's final.
- Q (A3): Keep a trace of stays deleted by an iCal cancellation?
  - A: **Yes**, table `booking_pace_cancellations` (§5).
- Q (A4): Pickup curve per month in this delivery?
  - A: **Yes** (rule 13).
