# Finance — stay profile (« Profil des séjours »)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hc-l4` (integrated through `feature/finance-reporting-hippocamp`) |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Validation summary with the interactive mock-up: the HIPPOCAMP benchmark report of 2026-11-05 (not versioned: it holds third-party screenshots; archived outside the repository),
section « Profil des séjours » (lot 4), approved by Adrien on 2026-11-05. The mock-up's figures are fake.

---

## 1. Context

The Suivi financier (`specs/finance-dashboard-redesign.md`) answers « how much, when, compared with
last year ». Its « Canaux » tile splits the window's revenue by channel, nothing more. The HIPPOCAMP
benchmark of 2026-11-05 showed campsite software splitting stays by origin, type, price band and
number of nights, each in count and in amount, with an average basket per month over several years.

For two holiday rentals the useful questions are narrower: where do the profitable stays come from,
how long do guests stay, how far ahead do they book, and is the average stay worth more than last
year. GuestFlow holds every fact needed (channel, nights, fiche creation day, « total de séjour »);
nothing shows them.

## 2. Goal

Under « Suivi financier », a page « Profil des séjours » shows, for the dashboard's window and logement,
how the stays split by channel, length, booking lead time and price band — in count and in amount —
and the average basket per stay for each month of the exercise against last year.

## 3. Functional rules

### 3.1 Window and stays

1. **The dashboard's window and filters.** The page takes the dashboard's parameters — exercise,
   window kind (*Exercice*, *Mois*, *Personnalisée*), month, du / au, logement — and the server judges
   them with the dashboard's own code (`financeDashboardModel.context`): the same refusals with the same
   messages (« La date de début doit précéder la date de fin. », « Deux dates à choisir. » for a missing
   or impossible day, « Période trop longue : 750 jours au plus. », the date window of
   `reservations-backend-mvc` rule 13, « Période inconnue. », « Logement inconnu. »), each a 400, never
   clamped.
2. **The stays of the window are the dashboard's.** Those of `financeModel.getSummary` for the window:
   `kind = 'reservation'`, attributed to the window by their **attribution date**
   (`specs/fiscal-year-and-nights-sold.md` §3.2). A cancelled stay (manual, `kind = 'cancelled'`, or
   deleted by an approved iCal cancellation) and a devis never count. The count and the amount of
   every breakdown therefore equal the hero's « séjours » and revenue of the same window.
3. **Logement filter.** One logement narrows every breakdown and the basket; « Tous les logements » is
   the default.
4. **Amount = « total de séjour »** (`specs/finance-overview-rework.md` §3.1: TTC, net of the platform
   commission, caisse interne excluded), summed in cents so that each breakdown's rows add up to its
   total exactly. Each breakdown carries every stay of the window once. A window with no stay answers
   `empty: true`, totals 0, fixed buckets at 0 with no share, and no channel row.

### 3.2 Breakdowns

5. **Canal.** Every own channel is one row « Direct »: a stay entered by hand, a website request, and
   any platform marked « Compté comme vente directe » — decided by `isDirectChannel`, never by a
   platform name. Every other platform is one row with the « Canaux » tile's key and label
   (`bookingChannelOf` → `platformDisplayName`), so each platform row equals that tile's row (stays,
   net revenue) and « Direct » equals its website subtotal plus « Direct (saisie) ». Rows are ranked by
   amount, then count, descending, then label. A channel without a stay has no row.
6. **Durée** (nights, `endDate − startDate`): « 1–2 nuits » (≤ 2), « 3–4 nuits » (3–4), « 5–6 nuits »
   (5–6), « 7 nuits et + » (≥ 7).
7. **Délai** (days from the booking day to the arrival day): « Moins de 7 j » (0–6), « 7–30 j » (7–30),
   « 1–3 mois » (31–90), « Plus de 3 mois » (≥ 91). The booking day is the fiche's creation day
   (`specs/booking-pace.md` rule 1, `bookingDayOf(createdAt)`, the server's calendar day). It is
   **unknown** — row « Date de réservation inconnue » — when it is missing, when it is **before the
   tracking start** (`booking-pace.md` rule 8: the initial import, where every stay booked before
   GuestFlow landed at once), or when it is **after the arrival** (a fiche entered once the guest was
   there: its real booking day is not known). A fiche created on its arrival day is 0 days.
   > 2026-11-06 (review R4-3): the tracking start is the stay's own logement's — rule 23.
8. **Tranche de prix** (« total de séjour »): « Moins de 300 € » (< 300,00 €), « 300–800 € »
   (300,00 € to 800,00 €, both included), « Plus de 800 € » (> 800,00 €); a stay at exactly 0,00 € is
   « Sans montant » (the dashboard's rule 35 notion). A negative total (more refunded than earned)
   falls in the first band.
9. **Shares and bars.** Each row carries `count`, `amount`, `countPercent`, `amountPercent` — whole
   percents that **add up to exactly 100** within a breakdown (largest remainder: floors, then the
   largest fractions get the missing points, ties to the larger value then to the earlier row) — and
   `countBar` / `amountBar`, the row's length relative to the breakdown's largest (0 to 1). A share is
   `null` on every row when the breakdown's total is not positive or one of its values is negative.
10. **Order.** Length, lead time and price list **every** bucket in its natural order, zeros included,
    so the scale never moves; « Date de réservation inconnue » and « Sans montant » come last, and only
    when they hold a stay.

### 3.3 Average basket per stay

11. **One row per month of the selected exercise** (the exercise of the window; the window itself does
    not narrow it, as on « Revenu par mois »; the logement filter does). A month's stays are the
    non-cancelled stays attributed to it; its basket is `{ stays, revenue, average }`, `average =
    revenue ÷ stays` rounded to the cent, `null` without a stay. A month is listed only when it holds a
    stay this year or on its compared month last year.
12. **Last year follows the dashboard's comparability** (D-HC7): month *M* shows last year's basket only
    when *M − 1 year* is on or after the coverage start (`finance-dashboard-redesign.md` rule 18) and a
    reading of last year exists (rule 33, the booking pace's tracking start): « as it stood a year ago »
    (stays created on or before today − 1 year) when that snapshot is known, else the month's final
    figure once the month is over, else none. Both pages read it through
    `yearOverYear.lastYearReading`. Otherwise `previous: null`, never a 0.
13. **Delta.** `{ amount, change, trend }`: the difference of the two averages, its change in percent
    (one decimal, `yearOverYear.change`), and `up` / `down` / `stable`. `null` when either average is
    missing. When no month of the exercise is comparable, `comparable: false` and ONE notice: « Historique
    depuis <mois> : pas encore d'an dernier à comparer. » (none when the scope holds no stay at all).
    The column headers are the two exercises' labels.
    > 2026-11-06 (review R4-11): no notice for an exercise over before the history starts — rule 24.
14. **The basket excludes the tourist tax** (D-HC8): it is not revenue. A stay's basket amount is its
    « total de séjour » less the tourist tax's share of it, the element-by-element split of the page's
    HT (`financeModel.htAmount`, `finance-overview-rework.md` §3.7): `total × (1 − touristTaxTotal ÷
    (finalPrice + touristTaxTotal))`. A stay with no stored tax (none charged, or a platform that
    collects and remits it itself) is unchanged. The breakdowns of §3.2 keep the tax: they read the
    page's « total de séjour », like the dashboard.
    > **Superseded by rule 22** (review R4-2, 2026-11-06): the proportion was exact only when the tax
    > was spread over every counted bucket; the basket now removes the tax actually inside the total.
15. **Every panel names its source** (D-HC8). Each breakdown carries `source: 'stays'` and
    `sourceLabel` « Sur les montants des séjours »; the basket `source: 'stays'`, `excludesTouristTax:
    true` and « Sur les montants des séjours, hors taxe de séjour ». Nothing on this page reads the
    encaissements, so no panel mixes the two.

### 3.4 Shares for the share table, and the page (added 2026-11-05, round 2)

16. **0–1 shares.** Each breakdown row also carries `countShare` / `amountShare`: its whole percent ÷ 100
    (`null` with it), so the share table's segment widths are the server's and add up to 100 % like the
    percents. The client never divides.
17. **Menu and route.** « Profil des séjours » is the second entry of « Suivi financier », right after
    « Vue générale »; route `/finance/profil`, admin only (the dashboard's roles).
18. **The dashboard's URL and refusals.** Exercise, window and logement live in the URL with the
    dashboard's names (`?exercice=&periode=&mois=&du=&au=&logement=`). A custom window the client
    refuses (judged from the server's day, `useServerToday`) is not sent; any server refusal shows its
    message and keeps the period selector, plus « Tous les logements » when a logement is set — never a
    dead end.
19. **Breakdown panel.** Panel « Répartition des séjours »: a « Découpage » switch (Canal · Durée · Délai
    · Tranche de prix, default Canal) and a « Mesure » switch (Nombre · Montant, default Nombre), then a
    share table (`ShareTable`, D-HC5: thin segmented bar + table, no pie) whose rows are the server's in
    the server's order: label, stays, amount, share. « Mesure » chooses the share column and the bar
    (`countShare` or `amountShare`); both figures stay in the table. A row at 0 keeps its line and draws
    no segment.
20. **Caption and empty window.** Under the table: « N séjours · <window label>, séjours non annulés. »
    then the panel's `sourceLabel` (D-HC8). A window with no stay shows « Aucun séjour sur la période. »
    in place of the table; the switches, the selector and the basket stay.
21. **Basket panel.** Panel « Panier moyen par séjour »: a table Mois · <previousLabel> · <currentLabel> ·
    Écart, one row per month the server lists, named by its short month (« juil. », the full label as
    its title); « — » for a missing average; the Écart is the report
    pill of `YearOverYearBadge` from the server's `delta.change` (« ↑ +12,4 % »), « — vs N-1 » when the
    delta is null; the server's notice under the table (`NoComparisonNotice`) when no month is
    comparable; the basket's `sourceLabel` last (« …, hors taxe de séjour »). No month listed:
    « Aucun séjour sur l'exercice. »

### 3.5 Review of 2026-11-06 (R4-2, R4-3, R4-4 = R6-1, R4-9, R4-11, R6-4)

22. **The tax removed is the tax inside the total** (D-HC8, D-HC9: the tourist tax is never revenue). The
    basket subtracts, per stay, the tax its counted buckets hold (`utils/stayTouristTaxInTotal.js`),
    placed as the accounting export books it: never on the acompte; on the solde — its frozen contribs
    once paid — unless the tax is collected at arrival (forced to the complement, or the platform's mode,
    financeModel's `TAX_ON_ARRIVAL_SQL`), then on the arrival complement; on the installments for a
    plan stay; the added guests' share on the complement. A bucket collected in the caisse interne is out
    of the total, so is its tax; a commission is taken on the stay, never on the tax, so a netted solde
    still holds its whole tax; the tax given back by book refunds is no longer inside. Never below 0.
    *Why:* on the production copy the proportion removed 7,63 € from a total holding no tax (tax in a
    cash complement) and 20,17 € instead of 24 € from a reversing platform's netted solde.
23. **Lead time per logement.** A stay's booking day is trusted from the tracking start of **its own
    logement** (`trackingStart(propertyId)`), whatever the filter, so the logements' lead breakdowns add
    up to « Tous les logements ». *Why:* a logement imported weeks after the first one had its import-day
    stays read as genuine leads under « Tous ».
24. **No notice before the history.** The basket's notice (rule 13) only shows when the exercise ends on
    or after the coverage start; an exercise entirely before the history has none (and no row).
25. **A month that names none is refused.** The shared finance window (`utils/financeWindow.js`) reads a
    month as `YYYY-01` to `YYYY-12` only: « 2026-13 », « 2027-00 », « 2026-1 » are « Ce mois n'appartient
    pas à l'exercice choisi. » (400) on every endpoint reading a month window — the dashboard, its
    detail tables and this page — never a 200 on an impossible window nor a 500 (invariant « an
    impossible day is a refusal »). *Why:* on an exercise closing in September, « 2026-13-01 » sorted
    inside the exercise as text.
26. **A number never leaves its unit.** Every bucket label joins the number and its unit with a no-break
    space (« Moins de 300 € », « 7–30 j », « 1–3 mois », « 5–6 nuits »), so a narrow table never leaves
    « € » alone on a line.
27. **Default dates from the server's day.** The page's default month (« Mois ») and default custom dates
    (« Personnalisée ») are the server's month (`useServerToday`, invariant 33), never the device's.
28. **One reading of the tax inside a total.** Rule 22's placement is read through
    `financeModel.withTouristTaxInTotal`, which the Suivi financier's revenue of the nights reads too
    (`specs/finance-dashboard-redesign.md` rule 56): the basket and the dashboard never leave out two
    different taxes for one stay. Test: `tests/finance-tax-in-total-shared.unit.test.js`.

### 3.6 Verification of 2026-11-06 (V5-3, V5-11)

29. **At most five rows, then « Autres ».** A breakdown with more than five rows keeps the first four by
    rank and folds the rest into one row « Autres » (`key: 'other'`, `other: true`, `parts` = the folded
    labels in rank order), summed before the shares are computed so they still add up to 100; the page
    draws it grey (`ShareTable`'s « Autres » hue, never a recycled one) and its segment's hover names what
    it holds (« Autres : Abritel, GreenGo, Abracadaroom »). Only « Canal » can exceed five today; the fixed
    buckets (rules 6-8, at most five with « inconnue » / « sans montant ») never fold. As the accounting
    synthesis does (its rule 37). *Why:* with seven channels two platforms shared the grey of « Autres »
    and neither row said so.
30. **The exercise served is an option.** The payload's `fiscalYears` always holds the exercise it answers
    on (added in key order when it precedes the first exercise with data), so the « Exercice » select
    never goes blank. *Why:* `?exercice=2025` was served (200) while the options were 2027 and 2026.

31. **A refused exercise offers the current one** (D-HC16, 2026-11-06, review V3-6). When the server refuses the
    exercise with `code: 'UNKNOWN_EXERCISE'` (`specs/finance-dashboard-redesign.md` rule 57, the shared context),
    the page shows « Exercice inconnu. » with its period toolbar and an « Exercice en cours » button that clears
    the exercise from the URL, as the Suivi financier does; any other refusal does not offer it. Test:
    `pages/__tests__/StayProfilePage.exercise-refusal.test.jsx`.

**Edge cases:**
- A stay of the window booked on the import day → lead time unknown (rule 7), counted everywhere else.
- A fiche created after its arrival → lead time unknown.
- A stay attributed in the window but arriving after it (solde paid early) → counted (attribution date).
- 0 € stay → « Sans montant », 0 % of the amount, counted in the stays.
- iCal duplicate of a platform booking → counted as the dashboard counts it (two stays).
- A logement with no stay → empty page for that logement, the selector stays.

---

## 4. Architecture

> Fat backend: buckets, sums, shares, bar lengths, ranking, comparability, deltas and every label are
> computed on the server. The client draws bars and a table from ready values.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `finance.js` | T | `GET /api/finance/stay-profile` |
| `controllers/` | `stayProfileController.js` | C | Picks the dashboard's query parameters, calls the model, maps `{ ok:false, status, error }` |
| `models/` | `stayProfileModel.js` | C | Composes the dashboard's `context` (window, logement, refusals), `financeModel.getSummary` (stays, « total de séjour », attribution), the dashboard's coverage and tracking start; channel per stay; monthly basket against last year |
| `models/` | `financeDashboardModel.js` | T | Exposes `context`, `coverage`, `trackingStart`; its month N-1 reading calls `yearOverYear.lastYearReading` (same behaviour) |
| `utils/` | `stayProfile.js` | C | Pure: bucketing, whole-percent shares adding to 100, bar lengths, ranking, lead days, basket, delta, tourist tax removal |
| `utils/` | `stayTouristTaxInTotal.js` | C | Rule 22: the tourist tax inside a stay's « total de séjour », bucket by bucket |
| `utils/` | `financeWindow.js` | T | Rule 25: `ISO_MONTH` reads months 01-12 only |
| `utils/` | `yearOverYear.js` | T | `lastYearReading(ym, { today, snapshotKnown })`: rule 33's reading, shared with the dashboard |
| `constants/` | `stayProfileBuckets.js` | C | Every bucket boundary and label of rules 5-8, in one place |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `api.js` | `api.js` | T | `getFinanceStayProfile(params)` |
| `pages/` | `StayProfilePage.jsx` | C | Route `/finance/profil`: `PageActionBar` (« Actualiser »), exercise + period + logement selector in the URL, the breakdown panel (two switches + `ShareTable`) and the basket panel; never dead-ends on a refusal (rules 18-21) |
| `constants/` | `stayProfile.js` | C | The page's path and French strings, the « Mesure » options |
| `constants/` | `financeMenu.js` | T | Entry « Profil des séjours », order 15 (rule 17) |
| `constants/` | `roles.js` | T | `/finance/profil` → `[ADMIN]` |
| `App.jsx` | `App.jsx` | T | Lazy route `/finance/profil` and its chunk prefetch |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `PeriodSelector`, `SegmentedSelect`, `Panel`, `ShareTable`, `YearOverYearBadge` (report mode), `NoComparisonNotice`, `EmptyState`, `LoadingState`, `ErrorAlert` | Lot 0's report grammar (`specs/report-grammar.md`) and the dashboard's selector. |
| **Created (new generic)** | — | The mock-up's ranked bars are rendered by `ShareTable` (D-HC5's part-to-whole form), so no new bar component. |
| **Specific (kept feature-local)** | `BreakdownPanel`, `BasketPanel` (inside the page) | Tied to this payload's shape. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/finance/stay-profile` | query `fiscalYear`, `period` (`fy` \| `month` \| `custom`), `month`, `from`, `to`, `propertyId` | `200` payload below; `400 { error }` with the dashboard's message | Admin (not on the accountant's allowlist). Read-only. |

```json
{
  "window": { "kind": "fy", "from": "2026-01-01", "to": "2026-12-31", "label": "Exercice 2026", "asOf": "2026-11-05" },
  "fiscalYear": { "key": 2026, "label": "2026", "from": "2026-01-01", "to": "2026-12-31", "isCurrent": true, "previousLabel": "2025" },
  "fiscalYears": [{ "key": 2026, "label": "2026" }],
  "months": [{ "month": "2026-01", "label": "janvier 2026" }],
  "propertyId": null,
  "properties": [{ "id": 1, "name": "Gîte" }, { "id": 2, "name": "Tente" }],
  "empty": false,
  "totals": { "count": 42, "amount": 23550 },
  "dimensions": [
    {
      "key": "channel", "label": "Canal", "source": "stays", "sourceLabel": "Sur les montants des séjours",
      "rows": [
        { "key": "direct", "label": "Direct", "count": 14, "amount": 9310, "countPercent": 33, "amountPercent": 40, "countBar": 1, "amountBar": 1 },
        { "key": "platform:airbnb", "label": "Airbnb", "count": 7, "amount": 3920, "countPercent": 17, "amountPercent": 17, "countBar": 0.5, "amountBar": 0.4211 }
      ]
    },
    { "key": "length", "label": "Durée", "source": "stays", "sourceLabel": "Sur les montants des séjours", "rows": [{ "key": "n1-2", "label": "1–2 nuits", "count": 13, "amount": 2310, "countPercent": 31, "amountPercent": 10, "countBar": 1, "amountBar": 0.1826 }] },
    { "key": "lead", "label": "Délai", "source": "stays", "sourceLabel": "Sur les montants des séjours", "rows": [{ "key": "unknown", "label": "Date de réservation inconnue", "count": 3, "amount": 1100, "countPercent": 7, "amountPercent": 5, "countBar": 0.2143, "amountBar": 0.0885 }] },
    { "key": "price", "label": "Tranche de prix", "source": "stays", "sourceLabel": "Sur les montants des séjours", "rows": [{ "key": "p0-299", "label": "Moins de 300 €", "count": 15, "amount": 2780, "countPercent": 36, "amountPercent": 12, "countBar": 0.9375, "amountBar": 0.2137 }] }
  ],
  "basket": {
    "source": "stays", "sourceLabel": "Sur les montants des séjours, hors taxe de séjour", "excludesTouristTax": true,
    "currentLabel": "2026", "previousLabel": "2025", "comparable": true, "notice": null,
    "rows": [
      {
        "month": "2026-07", "label": "juillet 2026", "short": "juil.",
        "current": { "stays": 9, "revenue": 6192, "average": 688 },
        "previous": { "stays": 8, "revenue": 4896, "average": 612 },
        "delta": { "amount": 76, "change": 12.4, "trend": "up" }
      }
    ]
  }
}
```

(Rows shortened; every fixed bucket is present in a real answer. Each row also carries `countShare` and
`amountShare`, its percents ÷ 100 — rule 16.)

---

## 5. Data model

No schema change. Reads `reservations` (dates, `createdAt`, platform, origin, amounts, `finalPrice`,
`touristTaxTotal`), `booking_pace_cancellations` through `getPaceStays` (tracking start), `properties`.

**Data impact:** none, read-only.

## 6. UI / UX

Per the mock-up (`#profil`), in the « Maison » theme and lot 0's report grammar:

- `PageActionBar` « Profil des séjours », one action « Actualiser » (info), no Save / Cancel.
- Toolbar: « Exercice » select, the dashboard's `PeriodSelector` (Exercice · Mois · Personnalisée), and
  a « Logement » select (« Tous les logements » first).
- Two panels side by side from `lg` (equal columns), stacked below: « Répartition des séjours » and
  « Panier moyen par séjour » (rules 19-21). At `md` the sidebar leaves ~600 px: two columns cut the
  switches and the tables, so they stack.
- **Mobile (`xs`)**: the toolbar's selects take the full width, one per line; each switch is a full-width
  segmented control (`SegmentedSelect`; a long label wraps); the share table tightens its padding and
  scrolls inside its own box if needed; the basket table's pill may wrap. No horizontal page scroll.
- **Tablet (`md`, ~900 px)**: panels stacked, full width; switches on one line when they fit.
- Loading: « Chargement du profil des séjours… »; a load failure: `ErrorAlert` with « Réessayer » and
  the selector (rule 18).

## 7. Test plan

### Server unit tests
- [x] `server/src/tests/stay-profile.unit.test.js` — 15 tests, rules 1-16: bucket edges (2/3, 6/7,
  30/31, 90/91 days, 299,99 / 300,00 / 800,00 / 800,01 €), shares to 100 and their null cases, the 0–1
  shares, lead time on the arrival day / after it / on the import, cancelled stays and devis excluded,
  totals equal to the dashboard hero, channel rows equal to the « Canaux » tile, logement filter, empty
  window, the dashboard's refusals, basket with tourist tax excluded and its N-1, no-history notice,
  delta edges, the dashboard's own N-1 reading unchanged.

- [x] `server/src/tests/stay-profile.review-fixes.unit.test.js` — 7 tests, rules 22, 23, 24, 26.
- [x] `server/src/tests/stay-profile.other-fold.unit.test.js` — 3 tests, rules 29, 30.
- [x] `server/src/tests/finance-window-impossible-month.unit.test.js` — 2 tests, rule 25 (resolveWindow,
  dashboard, its detail tables, stay profile).
- [x] `server/src/tests/finance-tax-in-total-shared.unit.test.js` — 3 tests, rule 28 (and dashboard rule 56), the read in chunks.

### Client unit tests (Vitest) — 8 files, 19 tests
- [x] `client/src/__tests__/api.stay-profile.test.js` — 1 test, rule 1.
- [x] `client/src/pages/__tests__/StayProfilePage.breakdown.test.jsx` — 6 tests, rules 16, 19, 20.
- [x] `client/src/pages/__tests__/StayProfilePage.basket.test.jsx` — 3 tests, rules 13, 15, 21.
- [x] `client/src/pages/__tests__/StayProfilePage.refused-load.test.jsx` — 3 tests, rules 1, 18.
- [x] `client/src/constants/__tests__/financeMenu.stay-profile.test.js` — 1 test, rule 17.
- [x] `client/src/pages/__tests__/StayProfilePage.server-month.test.jsx` — 2 tests, rule 27.
- [x] `client/src/pages/__tests__/StayProfilePage.other-row.test.jsx` — 1 test, rule 29.
- [x] `client/src/pages/__tests__/StayProfilePage.exercise-refusal.test.jsx` — 2 tests, rule 31 (2026-11-06).
- Fixture: `client/src/pages/__tests__/stayProfileFixtures.js`.

### Manual UI verification (throwaway seeded DB, ports 47140/47141)
- [x] 1280 px: both panels side by side, switches, share table, basket pills and captions; a month
      window with one stay.
- [x] 900 px: panels stacked, nothing cut.
- [x] 390 px: toolbar stacked, switches full width, short months, no horizontal page scroll.
- [x] Regression: the Suivi financier still loads.

## 8. Out of scope

- **Provenance by country.** The client record holds no country: `clients` has `postalCode`, `city`
  and a free-text `address`, written by hand or left empty; contact parsing assumes a French-only
  address book (`utils/contactParsing.js` drops a trailing « France »); iCal stays carry no address at
  all; the booking intake reads a country code from the platform page but stores it nowhere. Any
  country figure would be a guess on a minority of stays. Revisit if a country field is ever captured.
- Room types, campsite pitches, the four-year basket of HIPPOCAMP (two exercises are shown).
- Breakdowns by collected money (« encaissements »).
- The INSEE survey figures.

## 9. Open questions

### Resolved by default (2026-11-05, brief rule 12)
- Route `/finance/profil`, endpoint `/api/finance/stay-profile`, menu « Profil des séjours » after
  « Vue générale ».
- One « Direct » row (own channels merged, as the hero's « part en direct ») rather than the website
  split by source.
- Lead time unknown for a fiche created after arrival or on the import day, rather than clamped to 0.
- « Sans montant » band for 0 € stays, so they do not swell « Moins de 300 € ».
- The basket follows the selected exercise, not the window, and lists only months holding a stay.
- Round 2: the mock-up's ranked bars are drawn by lot 0's `ShareTable` (D-HC5's part-to-whole form,
  and one grammar across the lots) rather than a new bar component; the « Mesure » switch picks its
  share and bar. The logement filter is a select, not the dashboard's figure strip (this page carries
  no per-logement figure to show in it).
- ~~Tourist tax removed by the HT split's proportion~~ — wrong, corrected by rule 22 (2026-11-06): a tax
  collected in the caisse interne was removed from money that never held it.