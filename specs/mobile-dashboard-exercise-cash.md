# Phone fiche total, clickable home subjects, exercise cash tiles and projection

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mobile-dashboard-exercise-cash` |
| **Created** | 2026-11-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Mock-up** | [mobile-dashboard-exercise-cash-maquette.html](mobile-dashboard-exercise-cash-maquette.html) |

---

## 1. Context

Three irritants found while using GuestFlow on an iPhone and planning the next investments:

- **A. The fiche's total is cut by the screen's rounded corner.** The reservation fiche pins its
  headline figure to the bottom of the screen below `lg` (`StickyTotalBar`,
  [ui-review-2026-10-19-operations.md](ui-review-2026-10-19-operations.md) rule 11). The bar pads its
  bottom with `env(safe-area-inset-bottom)`, but `client/index.html` declares
  `width=device-width, initial-scale=1` **without `viewport-fit=cover`**: iOS then reports every
  safe-area inset as `0`. In the home-screen app (manifest `display: standalone`, the way Adrien
  uses it), the viewport still runs under the home indicator, so the figure sits ~10 px above the
  physical bottom edge, 12 px from the side, inside the curve of the corner.
- **B. Home subjects about a reservation do not always open it.** In « À traiter », the iCal drift,
  iCal cancellation, new reservations and repaired numbers subjects already navigate to the fiche;
  **payment deadlines** (the most frequent subject) do not (only the « Vérifier » bank button does),
  nor do **cancellation compensations**. Some subjects that are not about one reservation (« Mise à
  jour disponible ») have no way to their page.
- **C. The Suivi financier cannot answer « how much is in, how much is still to come this
  exercise ».** « Déjà payé » counts the window's stays, but « À encaisser » counts only the
  **finished** stays, **all exercises**: the money of the exercise's stays still ahead is shown
  nowhere, and nothing dates it. Adrien wants to project his investments: what is in the bank,
  what will land, and when.

## 2. Goal

- On a phone, the fiche's total is fully readable, clear of the rounded corners and the home
  indicator.
- From the home, every subject about a reservation opens its fiche, and every other subject opens
  the page where it is handled.
- On the Suivi financier, for the selected exercise: one tile « Encaissé », one tile « Reste à
  encaisser » (together = the exercise's revenue), each opening its list, the remaining money listed
  payment by payment **in the order it will come in**, and a cash projection chart answering
  « how much will I have collected by date X ».

## 3. Functional rules

### 3.A Fiche total on a phone

1. `client/index.html` declares `viewport-fit=cover`, so `env(safe-area-inset-*)` carries the real
   insets on iOS (home-screen app and Safari).
2. `StickyTotalBar` keeps its figures clear of the screen's edges: bottom padding
   `10px + env(safe-area-inset-bottom)` (already the rule, now effective), side padding
   `max(<page padding>, env(safe-area-inset-left|right))` and never less than 16 px on `xs`.
3. Turning on `viewport-fit=cover` must not put anything else under the notch, the status bar or the
   home indicator: the app bar (top + sides), the main area's side padding, and every element
   already fixed to the bottom (`SupportSessionBar`, `TouristTaxDock`, `StepperPage`, `SidePanel`,
   full-screen dialogs, bottom drawers) are audited and pad with the matching inset. Landscape on a
   notched iPhone keeps content out of the notch.
4. Desktop / Android without insets: pixel-identical to today (every `env()` falls back to 0 and the
   `max()` to the current padding).

### 3.B Clickable home subjects

5. Inside every attention subject, a row about **one reservation** shows its identity line
   (client · logement · platform) as a **link to the fiche**, `withFrom('/reservations/:id', '/')`,
   with a trailing chevron `›`, a 44 px touch target, and an accessible name « Ouvrir la fiche de
   {client} ». The row's action buttons (Relancer, Reporter, Annuler le séjour, Confirmer…) stay
   separate: tapping a button never navigates.
6. Rule 5 applies to the core subjects `payment-deadlines`, `cancellation-compensations` (row →
   fiche of the cancelled stay), and to those already linking (`ical-date-drift`,
   `ical-cancellation`, `new-reservations`, `repaired-reservation-numbers`), which are aligned on
   the same identity-link pattern instead of their own button where they differ.
7. A subject **not about one reservation** offers one action « Ouvrir » (or its existing explicit
   label) to the page where it is handled. Mapping: `update-available` → Réglages › Système et mises
   à jour; `cancellation-compensations` (subject level) → page Compensations; the existing ones keep
   their target (`email-readiness`, `email-pending`, `vat-franchise`, `plugins-switched-off`,
   `payment-deactivations`, `two-factor`, `dates-taken`).
8. Plugin subjects (`dashboard.alerts` / `dashboard.alerts.urgent` contributions: booking, Gîtes de
   France and Airbnb intakes, gate access, online payment reconciliation, tariff recipes, website
   booking, linen…) follow rules 5 and 7 too. The shared link is exposed to plugins through the SDK
   so they do not re-implement it.
9. « Retour » from a fiche opened from the home goes back to the home (the `from` parameter), with
   the inbox row that was open folded as before (no state restoration required).

### 3.C Exercise cash tiles and projection (Suivi financier)

**Scope.** The stays counted are the stays of the page's window (the exercise by default,
`periode=fy`), attributed as everywhere else on the page
([fiscal-year-and-nights-sold.md](fiscal-year-and-nights-sold.md) §3.2 rule 8), filtered by the
selected logement. All amounts are the « total perçu » basis of the page: net of platform
commissions, caisse interne excluded ([finance-overview-rework.md](finance-overview-rework.md) §3.1).

10. The tile **« Déjà payé » is renamed « Encaissé »** (key `collected`, same figure:
    Σ `comptaCollected` of the window's stays). Caption: « {n} % de {revenue} ».
11. The tile **« À encaisser » becomes « Reste à encaisser »** (key `toCollect`): Σ
    `remainingToPay` of the **window's stays**, past and future (it no longer reads the finished
    stays of all exercises). Caption: « {n} paiements · prochain le {date} », or « tout est
    encaissé » at 0.
12. **Invariant:** Encaissé + Reste à encaisser = the window's revenue (`totalRevenue`), to the
    cent, per stay and in total (`comptaCollected + remainingToPay === totalSejour`). A server test
    pins it.
13. « En retard » (all exercises), « Réservations », « Logements », « Canaux » are unchanged.
14. **Expected payments.** The server breaks each stay's `remainingToPay` into **dated expected
    payments**, one per unpaid bucket, with the date the money is expected:

    | Payment | Expected date |
    |---|---|
    | Acompte | `depositDueDate` (booking day when none) |
    | Solde (direct) | `balanceDueDate` |
    | Versement plateforme (net of commission) | departure + the platform's `payoutDueDays` |
    | Échéance n/N of a plan | the installment's `dueDate` |
    | Complément d'arrivée | arrival day |
    | Complément fin de séjour, note en séjour | departure day |
    | Reste of a payment split over several methods | departure day |

    Σ of a stay's expected payments = its `remainingToPay`, always: any difference the buckets do
    not explain is listed as one line « Reste à régler » on the departure day (never dropped).
15. **Late means what « En retard » means.** An expected payment is **late** only when the existing overdue
    logic would call it so: an acompte or solde (direct) past its due date, a platform payout past departure +
    `payoutDueDays`, an installment three days past its due date (or on a stay that has begun). An acompte with
    no due date is **not** late. A payment whose expected date is past but that is not late (no due date, a
    complément, the reste of a split payment) is **due now**. Late payments form the « En retard » group at the
    top of the list; due-now ones the « À recevoir maintenant » group right after it; both are counted on today in
    the projection — on the exercise's last day once the exercise is over, so a past exercise still owed keeps
    its money inside the plot.
16. **« Reste à encaisser » detail** (opens under the tiles like every tile): one line per expected
    payment — date, client, logement, kind (Acompte / Solde / Versement {plateforme} / Échéance n/N
    / Complément…), amount — **sorted by expected date ascending**, grouped by month with the
    month's subtotal, « En retard » then « À recevoir maintenant » first. A line opens the fiche. Footer: the total, equal to
    the tile.
17. **« Encaissé » detail**: the existing payments ledger, grouped by month (most recent first) with
    the month's subtotal; footer total equal to the tile.
18. **Cash projection chart « Trésorerie de l'exercice »** — a card placed directly under the tile
    row, full width, always visible once the exercise is loaded:
    - x axis: the exercise's months, plus one « après » column when expected payments of the
      exercise's stays fall after its end (platform payouts of the last month);
    - one cumulative line, one y axis: **solid** (sapin) = money actually received, by payment date,
      up to today; **dashed** (miel) = received + expected, by expected date, from today to the end;
      the end point equals the window's revenue;
    - monthly bars underneath on their own axis (separate small chart, never a second y scale):
      received (sapin) for past months, expected (miel) for future months, the current month split;
    - lines are **steps** (across, then up on the payment day), never diagonals; the dashed line leaves the solid one
      where it ends and steps up by what is late or due now; the y axis covers the highest cumulative value;
    - a « Aujourd'hui » marker, only while today is inside the exercise;
    - a **date cursor** (tap / drag on the chart, or a date field) reading « D'ici le {date} :
      {cumulative} € encaissés, dont {expected} € encore attendus »; default cursor: the last payment (the exercise's end, « après » included, so the answer equals the revenue);
    - hover / tap on a month: tooltip with that month's received and expected amounts;
    - the months outside a narrower window (a month selected) are dimmed, like « Revenu par mois ».
19. The whole series, the cursor's answer for every month end, and all labels come from the server;
    the client only draws (fat backend). The cursor's date between month ends is answered by the
    server's daily cumulative series (one point per day with movement).
20. A logement filter applies to tiles, details and chart alike.

**Edge cases:**
- Exercise with no stay → tiles at 0 €, chart replaced by « Aucun séjour sur cet exercice ».
- Past exercise fully collected → « Reste à encaisser » 0 €, « tout est encaissé », chart all solid.
- Late payments only → the dashed line jumps on today, the « En retard » group alone in the list.
- Platform stay whose amount was never entered (0 € on the books) → no expected payment (nothing to
  date), listed by the existing « Montant à saisir » insight.
- Refund booked after collection → Encaissé lowered on the refund date (existing ledger rule); the
  invariant still holds.
- A stay attributed to the exercise whose payout lands after it ends → in the « après » column.

---

## 4. Architecture

### 4.1 Server (`server/src/`)

| Layer | File | Responsibility |
|---|---|---|
| utils | `utils/expectedPayments.js` (**new**) | Pure: one stay row → its dated expected payments (rule 14), Σ = `remainingToPay(r)` guaranteed by a residual line. |
| utils | `utils/cashProjection.js` (**new**) | Pure: ledger rows + expected payments + exercise months + today → monthly received/expected, daily cumulative series, « après » column, late total. |
| models | `models/financeDashboardModel.js` | Tiles `collected` / `toCollect` on the window's stays (rules 10–12); detail `toCollect` → expected payments grouped by month (rule 16); detail `collected` grouped by month (rule 17); `dashboard.cashProjection` payload (rule 18). |
| models | `models/financeModel.js` | Unchanged: the expected payments read the unpaid installment rows themselves (`expectedOf` in `financeDashboardModel`, like `paymentsLedger` does for the paid ones). No rule moved. |
| routes / controllers | unchanged | `/api/finance/dashboard` and `/detail/:tile` keep their shape, with the new fields. |

### 4.2 Client (`client/src/`)

| Layer | File | Responsibility |
|---|---|---|
| — | `index.html` | `viewport-fit=cover` (rule 1). |
| components | `StickyTotalBar.jsx` | Side + bottom safe-area padding (rule 2). |
| app shell | `App.jsx`, `SupportSessionBar.jsx`, `TouristTaxDock.jsx`, `StepperPage.jsx`, `SidePanel.jsx` | Inset audit (rule 3) — only where an inset is missing. |
| components | `ReservationLinkLine.jsx` (**new, generic**) | The identity line as a router link + chevron, 44 px target, accessible name (rule 5). Reused by every subject and exposed to plugins. |
| components | `PaymentDeadlinesAlert.jsx`, `CancellationCompensationsPendingAlert.jsx`, `UpdateAvailableAlert.jsx`, iCal / new reservations / repaired numbers alerts | Use `ReservationLinkLine` / add the page action (rules 6–7). |
| plugins | `plugins/sdk` + each plugin alert | Re-export `ReservationLinkLine` via the SDK; plugin alerts use it (rule 8). |
| pages | `FinancePage.jsx` | Tile labels / captions (rules 10–11), the projection card (rule 18). |
| components | `CashProjectionChart.jsx` (**new, generic**) | Recharts cumulative line (solid / dashed) + monthly bars small chart + today marker + date cursor; renders the server series only. |
| components | `FinanceDetailPanel.jsx` | Month-grouped tables for `collected` and `toCollect` (rules 16–17). |
| constants | `constants/financeDefinitions.js` | New « i » definitions of the two tiles and the chart. |

### 4.3 API contract

`GET /api/finance/dashboard` — additions:

```jsonc
"tiles": {
  "collected": { "amount": 41250.4, "shareOfRevenue": 0.78 },
  "toCollect": { "amount": 11630.0, "payments": 23, "nextDate": "2026-11-28", "late": { "amount": 480, "payments": 1 } }
},
"cashProjection": {
  "today": "2026-11-22", "total": 52880.4,
  "todayMonth": "2026-11", "todayX": 325, "from": "2026-01-01", "to": "2026-12-31", "end": "2027-01-08", "endCaption": "toutes les échéances", "xMax": 396, "empty": false,
  "months": [ { "key": "2026-01", "label": "janv.", "title": "janvier 2026", "x": 0, "end": "2026-01-31", "received": 3120.0,
                 "late": 0, "upcoming": 0, "expected": 0, "cumulative": 3120.0, "inWindow": true }, … ,
              { "key": "after", "label": "après", … "received": 0, "expected": 640.0, "inWindow": true } ],
  "daily": [ { "date": "2026-01-04", "label": "4 janv. 2026", "x": 3, "received": 300.0, "expected": 0, "cumulative": 300.0,
                 "receivedCumulative": 300.0, "expectedCumulative": 0, "solid": 300.0, "dashed": null }, … ],
  "lateAmount": 480.0
}
```

`GET /api/finance/dashboard/detail/toCollect` — replaced payload:

```jsonc
{ "groups": [ { "key": "late", "label": "En retard", "total": 480, "rows": [ … ] },
              { "key": "2026-12", "label": "Décembre 2026", "total": 3210, "rows": [ … ] } ],
  "rows": [ { "reservationId": 12, "date": "2026-12-05", "dateLabel": "5 déc. 2026", "kind": "balance", "label": "Solde",
              "clientName": "…", "propertyName": "…", "platform": "…", "amount": 480, "late": false } ],
  "totals": { "amount": 11630.0, "payments": 23 } }
```

`detail/collected` keeps `rows` and `totals` and adds `groups` (same shape, months descending) and a `dateLabel` per row. The old `projection` (« Encaissable d'ici le », `until` parameter) of `detail/toCollect` is removed with the table it fed.

The daily series holds one point per day with movement plus three anchors (exercise start, today, exercise end); `x` is the day offset from the exercise start (the « après » column spans 31 more days); `solid` / `dashed` are the two line series (null outside their range); the cursor answers from the last point not after its date. A payment received before the exercise starts counts on its first day; one dated after today counts today.

## 5. Data model

No schema change. Everything is read from existing columns.

## 6. UI / UX

See the interactive mock-up. Mobile specifics:

- Fiche: the bar stays full width; figures 16 px+ from the sides, above the home indicator.
- Home: the identity line wraps on two lines rather than truncating; the chevron stays at the end
  of the first line.
- Finance: tiles 2 per row on `xs` as today; the projection card takes the full width, chart 220 px
  high, the monthly bars 90 px; the cursor answer sits above the chart (never under the finger);
  tap selects a month; a mouse moves the cursor at once, a finger on a tap or a clearly horizontal drag (a vertical scroll never moves it); the detail lists become stacked cards
  (date · amount on line 1, client · logement · kind on line 2) under their month header.
- `prefers-reduced-motion`: no line drawing animation, cursor moves without transition.

## 7. Test plan

### Server unit tests
- `server/src/tests/expected-payments.unit.test.js` — each bucket's date (rule 14), late flag,
  installment plans, platform payout net of commission, split reste, residual line,
  Σ = `remainingToPay` on randomised fixtures.
- `server/src/tests/cash-projection.unit.test.js` — monthly split, today split, « après » column,
  cumulative end = revenue, late counted on today, empty exercise.
- `server/src/tests/finance-dashboard.unit.test.js` (existing file of the feature) — tiles on the
  window's stays, invariant Encaissé + Reste = revenue, logement filter; payload pin updated.

### Client (vitest)
- `components/__tests__/StickyTotalBar.safe-area.test.jsx` — padding uses the insets.
- `components/__tests__/safeAreaInsets.audit.test.jsx` — `viewport-fit=cover`, the inset audit of rule 3 and the 0
  fallbacks of rule 4.
- `components/__tests__/ReservationLinkLine.test.jsx` — link target, `from`, accessible name.
- `components/__tests__/PaymentDeadlinesAlert.fiche-link.test.jsx` — identity link, buttons don't
  navigate.
- `components/__tests__/CashProjectionChart.test.jsx` — renders server series, cursor answer.
- `components/__tests__/FinanceDetailPanel.exercise-cash.test.jsx` — month groups, order, totals.

### Manual / Playwright
- iPhone viewport 390×844 with simulated insets: fiche total fully visible; landscape 844×390.
- Home: tap a payment deadline row → fiche → back → home.
- Finance at 390 / 900 / 1280: tiles, detail lists, chart cursor; exercise switch; logement filter.

## 8. Out of scope

- Forecasting bookings not yet made (occupancy-based revenue forecast).
- Bank balance, expenses, loans: this is the stays' cash only.
- Changing the attribution rule of a stay to an exercise.

## 9. Open questions

None open.

**Resolved (2026-11-23):**
1. Chart form → cumulative curve with the date cursor **and** the monthly bars underneath (rule 18).
2. Card placement → directly under the tile row (and the open detail), above « Revenu par mois ».
3. The two old tiles are **replaced** (rules 10–11), not doubled by a separate block.
4. Remaining money listed **one line per payment**, not per reservation (rule 16).
5. Home links: the identity line is the link, buttons stay apart (rule 5) — not the whole card.

## 10. Implementation notes

- **Server**: `utils/expectedPayments.js`, `utils/cashProjection.js` (pure), wired in `financeDashboardModel` (`expectedOf`, `toCollectTile`, `cashProjectionOf`, `groupByMonth`). New tests: `expected-payments` (13), `cash-projection` (16), `finance-dashboard-exercise-cash` (12); `finance-dashboard-detail`, `finance-dashboard`, `finance-overdue-payout-net` updated to the new tile / detail; payload pin and VAT golden (12 finance captures) regenerated, diff checked: only `tiles.toCollect`, `cashProjection` and the `collected` / `toCollect` details moved.
- **Client**: `ReservationLinkLine`, `CashProjectionChart` (plain SVG, not Recharts: the cursor drag and the two stacked charts are simpler to keep exact), month-grouped lines in `FinanceDetailPanel` (with a « Plateforme » column from md), `FinancePage` card under the tiles. 5 new suites + 8 existing suites updated; full vitest green (counts in the report), `npm run build` green.
- **Deviations**: expected payments read the unpaid installments in `financeDashboardModel` (not `financeModel`); months also carry `late`, `upcoming`, `end` (late segment of the bars, month tap); a typed cursor date is written with `Intl` on the client (presentational), the figures still come from the daily series; the fixed top inset is applied to the app bar, the main margin and the page bar's `top`, but `--gf-page-bar-bottom` (read as a number by the planning) stays inset-free (insets are 0 in default iOS standalone).
- **SDK**: `ReservationLinkLine` exported at SDK 2.34.0; manifests of airbnb-intake, booking-intake, gate-access, gites-de-france-intake, online-payment (sdk `^2.34.0`) and guest-app (builds in `theme` / `PageActionBar`) bumped with their French changelog lines.
- Review round (2026-11-23): rule 15 reworded (late = « En retard »), « À recevoir maintenant » group, past-exercise placement, step lines, axis, touch gestures, `--gf-page-bar-bottom` now published from the app bar's real bottom edge, full-screen dialog insets in `theme.js` only (top included; per-dialog duplicates removed), « Ouvrir » hidden for roles that cannot open its page, booking-intake link guarded.
- Rule 9 (« Retour » goes home) is verified by hand: fiche opened from the home with `?from=%2F`, back returns to `/`.
- Not done: a real-device check of the insets (checked only as CSS strings and the `viewport-fit=cover` meta in Chromium, where insets are 0).

**Bundle budget (2026-11-23).** The initial JavaScript grew by ~0.8 kB gzip (the SDK's `ReservationLinkLine`
on the home's attention rows, the app bar / page bar insets, and a shared chunk Vite split differently).
Its chevron is an inline SVG rather than the icon package (−0.3 kB); the rest is accepted: the budget in
`scripts/check-bundle-budget.mjs` is raised deliberately by 1 000 bytes, decided with Adrien.
