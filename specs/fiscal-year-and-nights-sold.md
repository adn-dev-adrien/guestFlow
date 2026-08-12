# Fiscal year & nights sold per property

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/fiscal-year-and-nights-sold` _(user-managed)_ |
| **Created** | 2026-08-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The « Suivi financier » page (`/finance`) is built around two implicit assumptions that no longer
match how the business is actually run:

1. **The year is the calendar year.** `financeModel.getSummary()` and `getBreakdown()` hard-code
   `new Date().getFullYear()` → `YYYY-01-01` … `YYYY-12-31`
   ([financeModel.js:151-153](../server/src/models/financeModel.js#L151-L153),
   [financeModel.js:306-310](../server/src/models/financeModel.js#L306-L310)). The company closes its
   books at the **end of September**, so the two annual KPI cards, the annual tab of the
   « Revenu par logement » chart and their breakdown dialogs all report a period that has no
   accounting meaning.
2. **A stay belongs to the period of its departure.** Every finance window filters on
   `reservations.endDate`. The books, however, are kept on a **cash basis**: what matters is when the
   money was collected, not when the guest left. A stay departing on 3 October but settled on
   28 September belongs to the closing exercise, and today the page says the opposite.

On top of that, the page reports **money only**. There is no way to answer « combien de nuits ai-je
vendues au gîte cette année ? » — a figure needed both to steer pricing and to sanity-check the
turnover at closing time. The nights already computed in `getOperational()`
([financeModel.js:431](../server/src/models/financeModel.js#L431)) never reach the overview cards.

The rest of the financial area is unaffected by the year question: `/comptabilite` and
`/finance/tourist-tax` both work month by month.

## 2. Goal

The operator can declare their **accounting closing month** once in the settings, then read the whole
« Suivi financier » through that fiscal year — including a **past exercise**, selectable from the page
— and see, on every turnover card, **how many nights each property sold** over the matching window.

---

## 3. Functional rules

### 3.1 Fiscal year definition

1. A new global setting « Exercice comptable » holds a **closing month** (`fiscalYearEndMonth`,
   integer 1–12). Default `12` = calendar year, which reproduces today's behaviour exactly.
2. The exercise **ends on the last day of the closing month** and **starts on the first day of the
   following month**. Setting September ⇒ exercise from **1 October** to **30 September of the next
   year**. Setting December ⇒ 1 January → 31 December.
3. An exercise is **keyed by its END year** and labelled:
   - closing month ≠ December → `« Exercice 2025-2026 »` (start year – end year), key `2026`;
   - closing month = December → `« Exercice 2026 »`, key `2026`.
4. The exercise containing a date `D`: if `month(D) ≤ closingMonth` then `endYear = year(D)`, else
   `endYear = year(D) + 1`. The start year is `endYear − 1`, except when the closing month is
   December where it is `endYear`.
5. The closing month is **authoritative on the server**. The client never derives an exercise from a
   date; it renders the bounds and labels the server sends.

### 3.2 Accounting attribution date — the new window key

6. Every amount and every night in the « Suivi financier » is attributed to a **date de rattachement
   comptable** (`attributionDate`), defined per reservation as:
   - the **date the solde was collected** (`balancePaidDate`) when the solde is marked paid
     (`balancePaid = 1`) and that date is non-empty;
   - otherwise the **departure date** (`endDate`).
7. Rule 6 applies to **every stay**, whether or not it straddles a boundary — there is one attribution
   date per reservation and it never splits a reservation across two windows. The acompte, the
   compléments and the notes en séjour of a stay follow its solde, they are never attributed
   separately.
8. The attribution date replaces `endDate` in **all** the money windows of the page:
   `getSummary()` period + annual windows, `getBreakdown()` for the three window kinds, and
   `getProjection()`. Consequence, to be stated in the PR: **the amounts displayed today will move**
   — a July stay settled in May now counts in May.
9. The « Suivi opérationnel » section (`getOperational()`: retards, paiements en attente,
   réservations à venir) keeps working on the **real dates of the stay and of the échéances**.
   Attributing « réservations à venir » to a payment date would empty the table of every prepaid stay,
   which is the opposite of what it is for.
10. « En attente de règlement » stays **global and period-free**
    (specs/finance-pending-global-remaining.md): every finished, non-settled stay. Since a non-settled
    stay has no solde payment date, rule 6 makes its attribution date its departure date, so the
    predicate is unchanged in practice.

### 3.3 Nights sold

11. The nights of a stay = `endDate − startDate` in days, floor 0 — the gross nights sold, whatever
    the payment status.
12. A tourist-tax refund does **not** reduce the nights sold. Deducting a refunded night is a
    *declaration* rule (specs/reservation-refunds.md §3.5) about what is owed to the commune; the
    nights sold measure commercial occupancy.
13. Nights are attributed to a window by rule 6, exactly like the money, so « X € » and « N nuits » on
    a card always describe the same set of reservations.
14. Nights are aggregated **per property**, zero-seeded from the `properties` table so a logement with
    no stay in the window is present with `nights: 0`, and sorted like the existing per-property
    revenue arrays (revenue desc, then name).

### 3.4 Where the figures are shown

15. The two annual cards become exercise cards:
    « **Revenus** depuis le début de l'exercice » (start → today) and
    « **Revenu total** sur l'exercice » (the whole exercise).
16. On a **closed** exercise, « depuis le début de l'exercice » covers the whole exercise, so the two
    cards carry the same amount. That is correct and no warning is shown.
17. On a **future** exercise (selectable only if reservations already point into it),
    « depuis le début de l'exercice » is 0.
18. Two cards carry a per-property nights line under their value: « Revenus depuis le début de
    l'exercice » and « Revenu total sur l'exercice ». The **period**'s nights are read off the
    « Revenu par logement » chart instead (rule 21), so « Revenu total sur la période » stays a single
    figure — decision 2026-08-12: the chart already splits the period per logement, repeating the
    split on the card next to it was redundant.
19. « Encaissé » and « En attente de règlement » get **no** nights line: their amount is a subset of
    échéances, not a set of stays, so a nights figure would be ambiguous.
20. A property with 0 night in the window is omitted from the card line. If no property has any night,
    the line is not rendered at all.
21. The « Revenu par logement » chart shows the **nights sold inside each bar, under the HT amount**,
    on **both** windows (period and exercise) — this is where the period's nights are read. A bar too
    short to hold the three lines does **not** drop the nights: they move just above the bar, in the
    secondary text color. A low-revenue logement is exactly where nights-vs-revenue is worth reading,
    so that line must survive a short bar. The chart's annual tab follows the selected exercise
    (label + caption + data), and the tooltip carries the nights too.
22. The breakdown dialog of a card gains a **« Nuits » column** and its footer total, for the three
    metrics of rule 18. For « Encaissé » and « En attente », no nights column (rule 19).

### 3.5 Exercise selector

23. `/finance` shows an « Exercice » selector listing every exercise between the earliest and the
    latest attribution date found in `reservations`, plus the current one, newest first. The current
    exercise is the default.
24. The selection is persisted in the URL (`/finance?exercice=2026`) so the back button restores it
    after opening a reservation. An unknown/invalid value falls back to the current exercise.
25. The selector drives the two exercise cards, the annual tab of the chart and the breakdown dialogs
    of the annual metrics. It does **not** touch the du/au period, the period cards, the operational
    tables or the projection.

**Edge cases:**
- Solde marked paid with an empty `balancePaidDate` (legacy rows) → attribution falls back to the
  departure date (rule 6).
- Stay with **no solde at all** (`balanceAmount = 0`, fully prepaid on the acompte or a platform
  net-payout) → nothing was ever collected *on the solde*, so attribution falls back to the departure
  date. Deliberate: attributing it to the acompte could push the nights of an August stay into the
  previous exercise.
- Closing month = February → the exercise ends 28 or 29 February depending on the year; the bound is
  computed as « day 0 of the following month », never a hard-coded 28.
- A reservation whose solde was collected years before the stay lands in the exercise of the payment,
  including its nights (rule 7, consequence accepted).
- Empty database → the selector still offers the current exercise; the cards show 0 € and no nights
  line.
- A stay of 0 night (same start/end date, degenerate data) contributes 0 nights and its amount.

---

## 4. Architecture

> **Fat backend, thin frontend.** The fiscal-year arithmetic, the attribution rule, the nights
> aggregation and the selector's option list are all computed server-side. The client receives
> ready-to-render arrays and labels, and owns only the selected-exercise UI state (mirrored in the
> URL).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none — `finance.js` already forwards the whole query string; the new param needed no route change) |
| `controllers/` | `financeController.js` | T | Reads `fiscalYear` from the query, forwards to the model, keeps error shaping |
| `controllers/` | `settingsController.js` | T | New `accounting` group (`fiscalYearEndMonth`) in the per-field upsert map |
| `models/` | `financeModel.js` | T | Attribution-date SQL + JS, fiscal windows, per-property nights, exercise list in the payload |
| `models/` | `settingsModel.js` | T | `fiscalYearEndMonth` added to `COLUMNS` (plain integer, not encrypted) |
| `utils/` | `fiscalYear.js` | **C** | Pure fiscal-year arithmetic: bounds, key, label, « which exercise contains this date », option list |
| `utils/` | `reservationSettlement.js` | T | New pure `attributionDate(r)` — the shared authority for rule 6 (JS side) |
| `utils/` | `settingsValidation.js` | T | `validateFiscalYearEndMonth` (integer 1–12) |
| `utils/` | `settingsResponse.js` | T | New `accounting: { fiscalYearEndMonth }` block in the GET payload |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE app_settings ADD COLUMN fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12` |

**Notes:**
- `utils/fiscalYear.js` is pure (no DB, no `Date.now()` inside the computations — the reference date
  is always a parameter) so it is fully unit-testable.
- The attribution rule exists twice, on purpose and side by side: a `ATTRIBUTION_DATE_SQL` constant in
  `financeModel` (so the windows stay a SQL `WHERE`, no full-table scan in JS) and
  `attributionDate(r)` in `reservationSettlement.js` for the row-level code. Same pattern as the
  existing `TAX_ON_ARRIVAL_SQL`. A unit test pins that both agree on the same fixture rows.
- No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `FinancePage.jsx` | T | Exercise selector + `?exercice=` URL state, exercise wording, nights line on 3 cards, chart caption from the payload |
| `pages/` | `SettingsPage.jsx` | T | Mounts the new settings card, wires the `accounting` group into the existing draft/dirty form |
| `components/` | `SettingsFiscalYearSection.jsx` | **C** | « Exercice comptable » settings card: closing-month select + live « du 01/10 au 30/09 » hint |
| `components/` | `FinanceBreakdownDialog.jsx` | T | « Nuits » column + footer total; renders the exercise label sent by the server |
| `components/` | `MonthYearPicker.jsx` | T | Its inline month labels move to the shared constant below (no behaviour change) |
| `hooks/` | — | — | (none) |
| `services/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | `months.js` | **C** | French month labels + options, shared by `MonthYearPicker` and the new settings card |
| `styles/` | — | — | (none) |
| `api.js` | `api.js` | T | `getFinanceSummary(from, to, fiscalYear)` and `getFinanceBreakdown(metric, from, to, fiscalYear)` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `LoadingState`, `EmptyState`, `ErrorAlert`, `StatusBadge`, `PlatformChip` | Unchanged usage. |
| **Created (new generic)** | `constants/months.js` | Not a component but a shared constant, extracted on its **second** consumer: the month labels were inlined in `MonthYearPicker`, and the new settings card needed the same list. No component was extracted: the nights line is one `<Typography>` inside FinancePage's existing card renderer, and the exercise selector is a plain MUI `TextField select` — wrapping either would create a component with no second caller. |
| **Specific (kept feature-local)** | `SettingsFiscalYearSection` | Follows the established one-card-per-topic convention of the Settings page (`SettingsVatSection`, `SettingsQuoteSection`, …); it is a form fragment bound to the settings draft, not a generic. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/finance/summary?from=&to=&fiscalYear=` | — | `{ …existing, fiscalYear, fiscalYears, revenueTotalNights, yearToDateNights, yearTotalNights, revenueByProperty[], yearToDateByProperty[], yearTotalByProperty[] }` | `fiscalYear` optional → current exercise. Invalid → current exercise (no 400). |
| GET | `/api/finance/breakdown?metric=&from=&to=&fiscalYear=` | — | `{ …existing, totalNights, rows[].nights, window }` | `window.kind = 'fiscalYear'` for the two annual metrics, carrying `{ key, label, from, to }`. |
| GET | `/api/finance/projection?date=` | — | unchanged shape | Window key switched to the attribution date (rule 8). |
| GET | `/api/settings` | — | `{ …, accounting: { fiscalYearEndMonth } }` | New block. |
| PUT | `/api/settings` | `{ accounting: { fiscalYearEndMonth } }` | full settings payload | Admin only, like every other group. Out of 1–12 → 400 with a French message. Absent → preserved. |

Per-property arrays (`revenueByProperty`, `yearToDateByProperty`, `yearTotalByProperty`) share one
shape: `{ propertyId, propertyName, revenue, revenueHt, nights }`.

`fiscalYear` / each entry of `fiscalYears`: `{ key, label, from, to, isCurrent }`.

Auth: unchanged — `/api/finance/*` is admin-only, `/api/settings` PUT is admin-only.

---

## 5. Data model

One new column on the `app_settings` singleton:

```sql
ALTER TABLE app_settings ADD COLUMN fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12;
```

Added through the existing idempotent `tryAddAppSettingsCol(...)` helper in
[database.js:257-320](../server/src/database.js#L257-L320).

- **Default for existing rows:** `12` → calendar year → the annual windows behave exactly as before
  the change until the operator sets September. No backfill.
- **No reservation column is added.** The attribution date is derived at query time from
  `balancePaid` / `balancePaidDate` / `endDate`, which all already exist. Nothing is frozen, so
  correcting a payment date immediately re-attributes the stay.

**Data impact:** none — no existing record is read differently at rest, no value is rewritten. What
changes is the *reporting* window, and only once the operator sets a non-December closing month.

**Migration note for the changelog:** `changelog.d/migration--fiscal-year-end-month.md`.

## 6. UI / UX

### 6.1 Settings — « Exercice comptable » card

Placed right after « Taux de TVA » in the masonry of `/parametres` (accounting topics grouped
together).

```
┌─ Exercice comptable ─────────────────────────────┐
│ Sur quel mois l'exercice comptable est-il clos ? │
│                                                  │
│ Mois de clôture  [ Septembre            ▾ ]      │
│ L'exercice ira du 1er octobre au 30 septembre.   │
└──────────────────────────────────────────────────┘
```

- Select of the 12 months (French names, `Décembre` = default = année calendaire).
- The helper line recomputes live from the selected month — pure presentational formatting of the
  selected value, no business rule client-side.
- Saved through the page's existing Save/Cancel `PageActionBar` (dirty-guard included).

### 6.2 `/finance` — exercise selector + cards

```
 Suivi financier                                        [⟳]
 ─────────────────────────────────────────────────────────
 Exercice : [ 2025-2026 ▾ ]   du 01/10/2025 au 30/09/2026

 ┌─ Revenus  depuis le début de l'exercice ─┐ ┌─ Revenu total  sur l'exercice ───────────┐
 │  48 320 €                                │ │  61 940 €                               │
 │  Gîte 187 nuits · Lodge 142 nuits        │ │  Gîte 224 nuits · Lodge 173 nuits       │
 │                             43 927 € HT  │ │                            56 309 € HT  │
 └──────────────────────────────────────────┘ └─────────────────────────────────────────┘

 [ Du 01/08/2026 ]  [ Au 31/08/2026 ]

 ┌─ Revenu total  sur la période ─┐ ┌─ Encaissé ──────┐ ┌─ En attente de règlement ─┐
 │  9 480 €                       │ │  8 100 €        │ │  1 380 €                  │
 │                    8 618 € HT  │ │     7 363 € HT  │ │  séjours terminés         │
 │                                │ │                 │ │              1 254 € HT   │
 └────────────────────────────────┘ └─────────────────┘ └───────────────────────────┘

 Revenu par logement
 [ Sur la période ] [ Depuis le début de l'exercice ]
 Période du 01/08/2026 au 31/08/2026 · montants TTC
        ┌──────────┐
        │ 6 027 €  │            ← TTC (bold)
        │ 5 479 €HT│            ← its HT (discreet)
        │ 26 nuits │            ← nights sold over the SAME window
        └──────────┘  10 nuits  ← …pushed above the bar when it is too short for three lines
                     ┌────────┐
                     │1 250 € │
                     │1 102 €HT│
                     └────────┘
           Gîte         Lodge
```

- The nights line sits **between** the value and the HT line, `variant="caption"`,
  `color="text.secondary"`, left-aligned (the HT line stays right-aligned) — same discretion as the
  existing HT sub-line, so the card keeps one dominant figure.
- Copy: `Gîte 187 nuits · Lodge 142 nuits`, singular `1 nuit`.
- Chart tab renamed « Depuis le début de l'exercice »; its caption becomes
  `Du 01/10/2025 à aujourd'hui · montants TTC`, both driven by the payload.
- Breakdown dialog title uses the exercise label: `Revenu total sur l'exercice — 2025-2026`.

### 6.3 Responsive

- **xs (≤600px):** the exercise selector is a full-width `TextField select` on its own line above the
  cards (deliberately *not* in `PageActionBar.center`, which is hidden on `xs`); the bounds caption
  moves under it. Cards stay `xs: 12`, and the nights line wraps naturally — it is plain text, no
  horizontal scroll. The breakdown dialog is already `fullScreen` on `xs`; the new « Nuits » column is
  narrow and fits inside the existing `minWidth` scroll container.
- **md (~900px):** selector inline with its caption; exercise cards 2-up, period cards 3-up
  (unchanged grid).
- **lg (≥1200px):** unchanged layout; the settings card sits in the 2-column masonry like its
  neighbours.

### 6.4 Sticky action bar

`/finance` keeps its current `PageActionBar title="Suivi financier"` with the single « Actualiser »
action. The exercise selector is **not** put in the bar (hidden on `xs`, and it is a filter, not an
action). `/parametres` keeps its Save/Cancel bar untouched.

## 7. Test plan

### Server unit tests — `cd server && npm test` → **2748 pass / 0 fail** (+49)

- [x] `tests/fiscal-year.unit.test.js` **(new, 15)** — pure `utils/fiscalYear.js`: bounds for closing
      month 9 (01/10 → 30/09), 12 (calendar year), 1, and 2 (leap/non-leap end day); the exercise
      containing 30/09 vs 01/10; key + label for both label shapes; invalid months degrading to
      December; option list from a min/max range, current flag, descending order, current exercise
      always present on an empty range.
- [x] `tests/finance-attribution-date.unit.test.js` **(new, 6)** — `attributionDate(r)`: solde paid
      with a date; paid with a NULL/empty/blank date → endDate; unpaid → endDate; `balanceAmount = 0`
      → endDate; datetime normalised to a day; **and the SQL twin agreeing with the JS helper row for
      row** on a fixture set.
- [x] `tests/finance-fiscal-year-summary.unit.test.js` **(new, 13)** — a stay departing after the
      closing but settled before it counts in the closing exercise (money **and** nights); an unpaid
      stay counts on its departure; the du/au period follows the attribution too; `yearToDate` vs
      `yearTotal`; a closed exercise makes both equal; a future exercise gives `yearToDate = 0`;
      `fiscalYears` content; default/invalid param = current exercise; « réservations à venir »
      **not** re-attributed.
- [x] `tests/finance-nights-per-property.unit.test.js` **(new, 5)** — nights per property zero-seeded
      and sorted; nights ignore a tourist-tax refund while the euros come off; a 0-night stay; the
      three windows each carrying their own nights with Σ per-property = the global figure; a devis
      contributing nothing.
- [x] `tests/settings-fiscal-year.unit.test.js` **(new, 5)** — default December, upsert round-trip,
      stored as a plain (non-encrypted) integer, untouched upsert preserves it, pre-migration DB
      degrades to December.
- [x] `tests/financeBreakdown.unit.test.js` _(extended, +2)_ — `rows[].nights` + `totalNights` for the
      set-of-stays metrics, footer equal to Σ of the column; no nights at all on « Encaissé » /
      « En attente »; `window.kind = 'fiscalYear'` with its label and bounds.
- [x] `tests/settings-validation.unit.test.js` _(extended, +2)_ — `validateFiscalYearEndMonth`.
- [x] `tests/settings-response.unit.test.js` _(extended, +1)_ — `accounting.fiscalYearEndMonth`.
- [x] Existing `finance-model.unit.test.js`, `finance-per-property-revenue.unit.test.js`,
      `financeBreakdown.unit.test.js` updated: their fixtures assumed calendar-year + departure-date
      windows. Each moved expectation was re-derived from the rules above, not loosened.

### Client tests — `cd client && npx vitest run` → **879 pass / 0 fail** (+7)

- [x] `pages/__tests__/FinancePage.test.jsx` _(extended)_ — exercise wording on the two annual cards;
      nights line on those two and **absent from the period card** (rule 18) and from « Encaissé » /
      « En attente »; the selector refetches with the `fiscalYear` key; the chart caption is built
      from the payload bounds.
- [x] `components/__tests__/SettingsFiscalYearSection.test.jsx` **(new, 6)** — month select, the live
      hint for September / December / February (29, computed), default when `values` is empty,
      `onChange` contract (a NUMBER), server error surfaced.

### E2E — `npm run test:e2e` → **59 passed / 1 skipped**

- [x] `e2e/specs/settings/fiscal-year-roundtrip.spec.js` **(new)** — set the closing month, save,
      reload, value persisted, then `/finance` bounds its exercise on it (01/10 → 30/09).

### Manual UI verification (dev server, 2026-08-12)

- [x] Happy path: Septembre set in the settings → `/finance` reads « 2025-2026 (en cours) · du
      01/10/2025 au 30/09/2026 », cards « Gite 53 nuits · Aventura lodge 20 nuits » (à date) and
      « Gite 82 nuits · Aventura lodge 26 nuits » (exercice).
- [x] Cross-check: the breakdown of « Revenus depuis le début de l'exercice » foots at **73 nuits /
      14 078,34 €** = 53 + 20 nights and the card amount.
- [x] Attribution verified against the DB: the two stays that made the August « Encaissé » (497 €)
      have their soldes collected in May and June, so they legitimately left August — « Encaissé »
      now reads 0 € on that period. Rule 8 in action, not a regression.
- [x] Chart: nights under the HT amount inside the bar, pushed above the bar when it is too short
      (Aventura lodge, 10 nuits), on both tabs.
- [x] Regression: « Suivi opérationnel » unchanged; `/comptabilite` and `/finance/tourist-tax`
      untouched by the closing month (both are monthly).
- [x] Mobile 390 px: selector full width, cards stacked, `scrollWidth === clientWidth` (no
      horizontal scroll).
- [x] **Before/after screenshots** attached to the PR.

## 8. Out of scope

- Splitting a reservation's turnover across two exercises (per-échéance cash accounting). One stay =
  one attribution date, by decision.
- Any change to `/comptabilite` (monthly journal export) or `/finance/tourist-tax` (monthly
  declaration) — both are month-driven and unaffected by the closing month.
- Freezing/locking a closed exercise (no « exercice clôturé » read-only state).
- Comparing two exercises side by side, or a year-over-year chart.
- Occupancy **rate** (nights sold ÷ nights available, closures deducted) — this spec ships nights sold
  only.
- Exposing nights in the accounting CSV export.

## 9. Open questions

- Q: Should the closing month be changeable once the exercise is under way, given every historical
  figure re-attributes instantly?
  - A: Yes, and without a confirmation dialog — nothing is stored per exercise, so the setting is a
    pure reporting lens and a mistake is undone by putting the previous month back.
- Q: What does « Revenus depuis le début de l'exercice » mean on a closed exercise?
  - A: The whole exercise (rule 16). Both annual cards then carry the same amount, which is the
    accurate answer, not a bug.

**Resolved during implementation:**

- Q (2026-08-12): where do the PERIOD's nights belong — on the « Revenu total sur la période » card,
  like the exercise ones?
  - A: In the **chart**. The « Revenu par logement » chart already splits the period per logement, so
    repeating the split on the card beside it was redundant. Rule 18 shrank to two cards, rule 21
    took the nights.
- Q (2026-08-12): inside the bar or on the X axis?
  - A: **Inside the bar, under the HT amount** (rule 21). A first pass put them on the axis to survive
    short bars; the in-bar reading was preferred, so the short-bar case now pushes the line just above
    the bar instead of dropping it — the information never disappears either way.
