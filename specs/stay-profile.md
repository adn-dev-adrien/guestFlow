# Finance — stay profile (« Profil des séjours »)

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/hc-l4` (integrated through `feature/finance-reporting-hippocamp`) |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Validation summary with the interactive mock-up: `docs/rapports/2026-11-05-benchmark-hippocamp.html`,
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
14. **The basket excludes the tourist tax** (D-HC8): it is not revenue. A stay's basket amount is its
    « total de séjour » less the tourist tax's share of it, the element-by-element split of the page's
    HT (`financeModel.htAmount`, `finance-overview-rework.md` §3.7): `total × (1 − touristTaxTotal ÷
    (finalPrice + touristTaxTotal))`. A stay with no stored tax (none charged, or a platform that
    collects and remits it itself) is unchanged. The breakdowns of §3.2 keep the tax: they read the
    page's « total de séjour », like the dashboard.
15. **Every panel names its source** (D-HC8). Each breakdown carries `source: 'stays'` and
    `sourceLabel` « Sur les montants des séjours »; the basket `source: 'stays'`, `excludesTouristTax:
    true` and « Sur les montants des séjours, hors taxe de séjour ». Nothing on this page reads the
    encaissements, so no panel mixes the two.

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
| `utils/` | `yearOverYear.js` | T | `lastYearReading(ym, { today, snapshotKnown })`: rule 33's reading, shared with the dashboard |
| `constants/` | `stayProfileBuckets.js` | C | Every bucket boundary and label of rules 5-8, in one place |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`) — round 2, once lot 0's shared components are merged

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `api.js` | `api.js` | T | `getFinanceStayProfile(params)` (round 1) |
| `pages/` | `StayProfilePage.jsx` | C | Route `/finance/profil`: `PageActionBar`, the dashboard's period / logement selector (URL params as the dashboard, rule 4 there), « Découpage » toggle (Canal · Durée · Délai · Tranche de prix) and « Mesure » toggle (Nombre · Montant), the bar list, the basket table; never dead-ends on a refusal (keeps the selector) |
| `constants/` | `financeMenu.js` | T | Entry « Profil des séjours » → `/finance/profil` |
| `constants/` | `roles.js` | T | `/finance/profil` → `[ADMIN]`, as `/finance` |
| `App.jsx` | `App.jsx` | T | Route `/finance/profil` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `PeriodSelector`, `LoadingState`, `ErrorAlert`, `EmptyState`, lot 0's shared finance components (segmented toggle, delta pill, source caption, « ⋯ » menu) | Names fixed in round 2 against lot 0 as merged. |
| **Created (new generic)** | A horizontal share-bar list, unless lot 0 ships one | Label · bar · value · percent rows; the « Canaux » detail and future breakdowns can reuse it. |
| **Specific (kept feature-local)** | — | |

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

(Rows shortened; every fixed bucket is present in a real answer.)

---

## 5. Data model

No schema change. Reads `reservations` (dates, `createdAt`, platform, origin, amounts, `finalPrice`,
`touristTaxTotal`), `booking_pace_cancellations` through `getPaceStays` (tracking start), `properties`.

**Data impact:** none, read-only.

## 6. UI / UX

Per the mock-up (`#profil`), in the « Maison » theme:

- `PageActionBar` title « Profil des séjours », no Save / Cancel; the dashboard's period and logement
  selector below it.
- Two cards side by side from `md` (stacked on `xs`): the bars, and « Panier moyen par séjour ».
- Bars card: segmented « Découpage » (Canal · Durée · Délai · Tranche de prix) and « Mesure » (Nombre ·
  Montant); each row label · bar (`countBar` / `amountBar`) · « 14 séj. » or « 9 310 € » · « 33 % ».
  Caption: « 42 séjours · Exercice 2025-2026, séjours non annulés » then the source caption.
- Basket table: Mois · <previousLabel> · <currentLabel> · Écart (delta pill of D-HC6, « — » when
  `delta` is null); the notice under the table when `comparable` is false; source caption.
- Empty window: `EmptyState` « Aucun séjour sur la période. », the selector stays.
- A refusal: the server's message, the selector stays (the dashboard's FinancePage.refused-load rule).
- `xs`: the toggles wrap, bars keep one row per bucket with the value under the label when narrow; the
  table stays a table (four short columns) inside its card, no horizontal page scroll.

## 7. Test plan

### Server unit tests
- [x] `server/src/tests/stay-profile.unit.test.js` — 14 tests, rules 1-15: bucket edges (2/3, 6/7,
  30/31, 90/91 days, 299,99 / 300,00 / 800,00 / 800,01 €), shares to 100 and their null cases, lead time
  on the arrival day / after it / on the import, cancelled stays and devis excluded, totals equal to the
  dashboard hero, channel rows equal to the « Canaux » tile, logement filter, empty window, the
  dashboard's refusals, basket with tourist tax excluded and its N-1, no-history notice, delta edges,
  the dashboard's own N-1 reading unchanged.

### Client unit tests
- [x] `client/src/__tests__/api.stay-profile.test.js` — 1 test, rule 1 (query parameters).
- [ ] Round 2: `StayProfilePage.*.test.jsx` per subject.

### Manual UI verification (round 2)
- [ ] Happy path at 1440, 900 and 390 px on a copy of the database.
- [ ] Edge case: a custom window refused, a logement with no stay.
- [ ] Regression: the Suivi financier's « Revenu par mois » N-1 bars unchanged.

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
- Tourist tax removed by the HT split's proportion rather than by subtracting `touristTaxTotal`, so a
  tax collected in the caisse interne (already out of the total) is not removed twice.
