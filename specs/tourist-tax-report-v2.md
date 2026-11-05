# Tourist tax report v2 — any period, exempt persons, platform share, « Par nuit » register, CSV

| Field | Value |
|---|---|
| **Status** | Implemented (server and API, 2026-11-05) — approved by Adrien on 2026-11-05; the page (§4.2 round 2, §6) follows on the lot-0 components |
| **Branch** | `feature/hc-l1` → integrated on `feature/finance-reporting-hippocamp` _(user-managed)_ |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Design reference** | « Finance reporting, inspired by HIPPOCAMP », section `#taxe` (validated by Adrien on 2026-11-05, D-HC1, D-HC4) |

---

## 1. Context

The « Extraction taxe de séjour » page (`/finance/tourist-tax`, `TouristTaxPage.jsx`) reads one month at a time
(`GET /api/finance/tourist-tax?month=YYYY-MM`, `financeModel.getTouristTaxExtraction`). It shows three tiles at the
top and one table per logement. In real use:

- a commune that collects the declaration per quarter, or the end-of-year statement, makes the operator add three
  or twelve months by hand;
- the totals leave the screen as soon as the table scrolls;
- the minors, who are exempt, appear nowhere: the commune's form asks for taxed **and** exempt persons and
  person-nights;
- the stays whose tax a platform remits to the commune itself (`specs/per-platform-tourist-tax-three-way.md`, case
  2) vanish from the page, so the operator cannot tell « nothing to declare » from « declared by the platform »;
- there is no per-night register, which is what a commune asks for on an inspection;
- nothing can be exported.

The rules already in force stay untouched: the attribution of a stay to a month
(`specs/tourist-tax-declaration-month-stay-end.md`), the freeze of past stays
(`specs/tourist-tax-freeze-past-with-refresh.md`, `specs/tourist-tax-matches-the-office-calculation.md`), the
three-way platform mode read from the platform, never its name (`specs/per-platform-tourist-tax-three-way.md`), the
« Déclarée » tick per row and its added-guests variant (`specs/tourist-tax-declared-checkbox.md`,
`specs/platform-added-guests-tourist-tax.md`).

## 2. Goal

The operator picks a month, a quarter, a year or any du / au, narrows it to a logement and to « à déclarer » or
« déclarées », and reads — as a list of stays or as a night-by-night register — exactly what to tell the commune:
stays, persons taxed and exempt, nights, person-nights taxed and exempt, the amount to remit, what is already
declared and what remains, and, apart, what the platforms remit themselves. The same selection downloads as a CSV.

## 3. Functional rules

1. **One source of rows.** The report's rows of ours are the rows of the monthly extraction, read by the same
   function (`financeModel.getTouristTaxRows({ start, endExclusive })`, which `getTouristTaxExtraction` now calls
   for its month). A stay's amount, nights, taxed adults, refunded nights and tick are never computed a second
   time. The `GET /api/finance/tourist-tax?month=` payload is unchanged, key for key and value for value.
2. **A month is the extraction's month.** `period=month&month=YYYY-MM` reads `[YYYY-MM-01, first of next month)`,
   the window of the monthly page. `period` defaults to `month`.
3. **A quarter or a year is the union of its months.** `period=quarter&quarter=YYYY-Qn` (n = 1..4) and
   `period=year&year=YYYY` read the attribution days of their whole months, under the same attribution rule
   (`max(last night, payment day of the tax-carrying échéance)`, a plan at its last night). A stay therefore
   appears in a quarter exactly when it appears in one of its three months, and the quarter's totals are the sum
   of its months'.
4. **A custom window is read by attribution day, both ends included.** `period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
   is validated by the finance window's own `resolveWindow` (invariant D7): a missing date or one naming no day →
   « Deux dates à choisir. »; `from > to` → « La date de début doit précéder la date de fin. »; more than 750 days
   → « Période trop longue : 750 jours au plus. »; an end outside [today − 5 y, today + 5 y] → the date window's
   message (D6).
5. **Refused, never clamped; the months to come are not read.** Every unreadable input is a 400 with its French
   reason: an unknown period « Période inconnue. », a month « Mois invalide. Format attendu: YYYY-MM. » (the
   extraction's own message), a quarter « Trimestre invalide. Format attendu: YYYY-Qn. », a year « Année invalide.
   Format attendu: YYYY. », a logement « Logement inconnu. », a declaration status « Statut de déclaration
   inconnu. », a CSV view « Vue inconnue. ». A query key sent twice reads as not sent. A window starting after the
   current month is refused « Les mois futurs ne sont pas autorisés. », as the monthly page refuses a future month;
   a window that starts before and runs past the current month is read up to the last day of the current month,
   and says so (`window.coveredTo`, `window.futureExcluded`). « Current month » is the server's local day
   (`utils/localDate`).
6. **The stays a platform remits itself are shown apart.** A stay whose platform's mode is « collecte et reverse à
   la commune » — the negation of the extraction's « we remit » predicate (`WE_REMIT_SQL`), read from the
   platform's mode, never its name — is listed with `remittedBy: 'platform'` when the declaration status is « all »,
   and counted in `totals.platformRemittedStaysCount` / `platformRemittedAmount`. It is attributed to the day of its
   last night: no payment of ours gates a tax we never collect. Its amount is the figure its fiche shows struck
   through: what the platform says it withheld (`platformTouristTaxWithheld`), else the engine's estimate
   (`touristTaxOriginalTotal`). It is never in the amount we remit, the declared or remaining amounts, the
   register or the CSV's total line, and it carries no tick (`declarable: false`).
7. **Taxed and exempt persons.** Only adults are taxed (`computeTouristTaxBreakdown`): a row's taxed persons are
   the adults it declares (`adults`), its taxed person-nights the extraction's `adultNights`. Its exempt persons
   are the minors of the stay — children and teens (the row's `children`) and babies; a row of added guests adds
   adults only and exempts nobody. Exempt person-nights = exempt persons × the row's declared nights. Persons =
   taxed + exempt. No other exemption cause exists in the data model; none is invented.
8. **Declaration filter.** `declaration=all|todo|done` (default `all`) keeps the rows of ours whose tick is unset
   (`todo`) or set (`done`). The main row and the added guests' own row are judged each on its own tick. Ticking
   stays the existing `PATCH /finance/tourist-tax/:reservationId/declared`, unchanged (rule 8 of
   `tourist-tax-declared-checkbox.md` included).
9. **The « Par nuit » register.** `nights` holds one entry per occupied night of the rows of ours listed: the first
   `nightsCount` nights of each stay from its arrival (the refunded nights are its last), sorted by date. An entry
   carries `staysCount` (distinct stays that night), `persons`, `taxedPersons`, `exemptPersons` and `taxAmount`. A
   night may lie before the window's start: the stay is attributed by its end, and its nights come with it.
10. **The register adds up to the list.** Each row's amount is spread over its nights in whole cents, its taxed and
    exempt person-nights in whole persons, the remainder on the first nights. So, for any selection,
    Σ `staysCount` = `totals.nights`, Σ `taxedPersons` = `totals.taxedPersonNights`, Σ `exemptPersons` =
    `totals.exemptPersonNights`, Σ `taxAmount` = `totals.amount` to the cent.
11. **The totals of the sticky bar** are computed on the server, in cents, over the rows of ours listed:
    `staysCount` (distinct stays), `rowsCount`, `declaredRowsCount`, `toDeclareRowsCount`, `persons`,
    `taxedPersons`, `exemptPersons`, `nights` (each stay once, a row of added guests adding none), `taxedPersonNights`,
    `exemptPersonNights`, `amount` (what we remit), `declaredAmount`, `remainingAmount` = amount − declared,
    `allDeclared` (at least one row and none left to declare), and over the platforms' stays of the same period and
    logement `platformRemittedStaysCount` and `platformRemittedAmount`.
12. **Logement filter.** `propertyId` (empty = every logement) narrows the rows, the platforms' stays, the register
    and the totals. The payload lists every logement (`properties`) for the picker.
13. **CSV of the selection.** `GET /api/finance/tourist-tax/report.csv` takes the same query plus
    `view=list|night` (default `list`) and returns the selection on screen in the French Excel format of
    `utils/csv.js` (`;`, UTF-8 BOM, comma decimals, formula cells neutralised), then a « Total à reverser » line read
    from `totals`. List columns: Statut (« Déclarée le JJ/MM/AAAA », « À déclarer », « Reversée par la
    plateforme »), Séjour, Logement, Canal, Arrivée, Départ, Nuits, Personnes, Taxées, Exonérées, Nuitées taxées,
    Nuitées exonérées, Montant. Register columns: Nuit du, Séjours, Personnes, Taxées, Exonérées, Montant. File name
    `taxe-de-sejour-<from>_<to>[-par-nuit].csv`. A refusal is the JSON 400 of rule 5.
14. **Read only.** Reading the report writes nothing, and reading it twice gives the same payload.
15. **What the period pickers offer.** `choices` lists, newest first and labelled, every month, quarter and year
    from the month of the first stay's last night to the current month, never before the date window's start
    (today − 5 years); `choices.defaultMonth` is the month before the current one, the month a declaration is
    usually made for. An older month stays readable by its query, it is just not offered.

**Edge cases:**
- No stay in the selection → `stays: []`, `nights: []`, every total 0, `allDeclared: false`.
- A stay ticked on its main row with an added guests' row still to declare → « todo » lists the own row alone; the
  stay and its nights still count once (rule 11).
- A stay whose tax was fully refunded leaves the extraction (rule 31 of `reservation-refunds.md`), hence the report.
- A platform stay with an ad-hoc platform that has no `platforms` row → « the platform remits » (the three-way
  spec's default), so it is counted apart.
- A cancelled stay (`kind ≠ 'reservation'`) is in neither list.

---

## 4. Architecture

> **Fat backend, thin frontend.** Window resolution, attribution, platform split, exemptions, filters, register,
> totals, labels and CSV are server-side. The client renders the payload and keeps only local UI state (period
> kind, selected values, list / night toggle, the bar folded or open on a phone).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `financeModel.js` | T | Rule 1: the rows' body of `getTouristTaxExtraction` moves, unchanged, into `getTouristTaxRows({ start, endExclusive })`, which the monthly extraction calls for its month; the « we remit » predicate becomes the module constant `WE_REMIT_SQL` (same SQL), exported in `helpers`. |
| `models/` | `touristTaxReportModel.js` | C | `getReport(params)`: validates logement and status, resolves the window, reads our rows through `getTouristTaxRows`, the babies and channel of each, the platforms' stays (`NOT WE_REMIT_SQL`, priced by `quoteStoredReservation`), and hands them to the pure builder. |
| `controllers/` | `touristTaxReportController.js` | C | Thin: `scalarQuery` → model → JSON, or CSV with its headers. |
| `routes/` | `finance.js` | T | `GET /finance/tourist-tax/report`, `GET /finance/tourist-tax/report.csv`. |
| `utils/` | `touristTaxPeriod.js` | C | Pure: `resolveTaxPeriod` (rules 2-5), `periodChoices` (rule 15). Reuses `financeWindow.resolveWindow`, `financeCalcs.getMonthBounds`, `stayDates.horizonStart`. |
| `utils/` | `touristTaxReport.js` | C | Pure: `ourStayRow`, `platformStayRow`, the declaration filter, `nightRegister`, `reportTotals`, `distribute` (rules 6-11). |
| `utils/` | `touristTaxReportCsv.js` | C | Pure: the list and register CSV through `utils/csv.js`, the file name (rule 13). |
| `middleware/` | — | — | (none — `/api/finance/**` keeps its admin guard) |
| `database.js` | — | — | (no schema change) |

### 4.2 Client side (`client/src/`)

Round 1 (this branch) ships the API functions only; round 2 builds the page on the lot-0 components.

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T | Round 1: `getTouristTaxReport(params)`, `downloadTouristTaxReportCsv(params, view)` (saves the server-named file, throws the server's French refusal). `getTouristTaxExtraction` and `setTouristTaxDeclared` unchanged. |
| `pages/` | `TouristTaxPage.jsx` | T | Round 2: reads `getTouristTaxReport`; period, logement and status pickers fed by `choices` / `properties`; list or « Par nuit » table; the « Déclarée » tick as today (re-reading the report after a tick); export through `downloadTouristTaxReportCsv`. Renders `totals` as given. |
| `components/` | `StickyTotalsBar.jsx` | C | Round 2: generic sticky bar of labelled figures, folding to two figures on a phone (D-HC1 plan; reused by the accounting synthesis and the payment register). Distinct from `StickyTotalBar` (one figure + sheet), which it may compose. |
| `components/` | `PeriodSelector.jsx` | T | Round 2: gains the « Trimestre » and « Année » kinds, options from the server, the server's day (`useServerToday`). |
| `constants/` | `touristTaxReport.js` | C | Round 2: the page's French strings. |
| `hooks/` | `useServerToday.js` | — | Round 2: consumed for the custom window's hints. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `PeriodSelector`, `SegmentedSelect`, `ResponsiveTable`, `EmptyState`, `ErrorAlert`, `LoadingState`, lot-0 `Panel` | Pre-existing or from lot 0. |
| **Created (new generic)** | `StickyTotalsBar` | Several labelled totals pinned at the bottom: the tax page, the accounting synthesis, the payment register. |
| **Specific (kept feature-local)** | — | The tables are compositions of `ResponsiveTable`. |

### 4.3 API contract

| Method | Endpoint | Query | Response | Notes |
|---|---|---|---|---|
| GET | `/api/finance/tourist-tax/report` | `period=month\|quarter\|year\|custom` (default `month`), `month=YYYY-MM` \| `quarter=YYYY-Qn` \| `year=YYYY` \| `from=YYYY-MM-DD&to=YYYY-MM-DD`, `propertyId?`, `declaration=all\|todo\|done?` | the report below | 400 `{ error }` (rule 5). Admin only, like every `/finance` route. |
| GET | `/api/finance/tourist-tax/report.csv` | the same + `view=list\|night?` | `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="taxe-de-sejour-<from>_<to>[-par-nuit].csv"` | 400 `{ error }`. |
| GET | `/api/finance/tourist-tax?month=YYYY-MM` | unchanged | unchanged | Rule 1. |
| PATCH | `/api/finance/tourist-tax/:reservationId/declared` | unchanged | unchanged | Rule 8. |

Response of `GET /api/finance/tourist-tax/report?period=quarter&quarter=2026-Q3` (on 2026-11-05):

```json
{
  "window": {
    "kind": "quarter", "from": "2026-07-01", "to": "2026-09-30", "toExclusive": "2026-10-01",
    "label": "T3 2026 (juil.–sept.)", "quarter": "2026-Q3",
    "coveredTo": "2026-09-30", "coveredToExclusive": "2026-10-01", "futureExcluded": false
  },
  "filters": { "propertyId": null, "declaration": "all" },
  "today": "2026-11-05",
  "currentMonth": "2026-11",
  "properties": [{ "id": 1, "name": "Granja" }, { "id": 2, "name": "Estiva" }],
  "choices": {
    "months": [{ "value": "2026-11", "label": "novembre 2026" }, { "value": "2026-10", "label": "octobre 2026" }],
    "quarters": [{ "value": "2026-Q4", "label": "T4 2026 (oct.–déc.)" }, { "value": "2026-Q3", "label": "T3 2026 (juil.–sept.)" }],
    "years": [{ "value": "2026", "label": "2026" }],
    "defaultMonth": "2026-10"
  },
  "stays": [
    {
      "key": "41", "reservationId": 41, "propertyId": 1, "propertyName": "Granja",
      "reservationName": "Camille Registre", "platformLabel": "Direct",
      "startDate": "2026-07-04", "endDate": "2026-07-07", "remittedBy": "us",
      "addedGuestsRow": false, "noGuestAdded": false,
      "nightsCount": 3, "persons": 5, "taxedPersons": 2, "exemptPersons": 3,
      "taxedPersonNights": 6, "exemptPersonNights": 9,
      "taxAmount": 9.9, "refundedTaxNights": 0, "refundedTaxAmount": 0,
      "touristTaxDeclaredAt": "2026-08-02 09:14:00", "declared": true, "declarable": true
    },
    {
      "key": "44-platform", "reservationId": 44, "propertyId": 2, "propertyName": "Estiva",
      "reservationName": "Sam Martin", "platformLabel": "Airbnb",
      "startDate": "2026-07-06", "endDate": "2026-07-09", "remittedBy": "platform",
      "addedGuestsRow": false, "noGuestAdded": false,
      "nightsCount": 3, "persons": 3, "taxedPersons": 2, "exemptPersons": 1,
      "taxedPersonNights": 6, "exemptPersonNights": 3,
      "taxAmount": 5.28, "refundedTaxNights": 0, "refundedTaxAmount": 0,
      "touristTaxDeclaredAt": null, "declared": false, "declarable": false
    },
    {
      "key": "47", "reservationId": 47, "propertyId": 2, "propertyName": "Estiva",
      "reservationName": "Lou Bernard", "platformLabel": "Booking.com",
      "startDate": "2026-08-10", "endDate": "2026-08-12", "remittedBy": "us",
      "addedGuestsRow": false, "noGuestAdded": false,
      "nightsCount": 2, "persons": 2, "taxedPersons": 2, "exemptPersons": 0,
      "taxedPersonNights": 4, "exemptPersonNights": 0,
      "taxAmount": 3.52, "refundedTaxNights": 0, "refundedTaxAmount": 0,
      "touristTaxDeclaredAt": null, "declared": false, "declarable": true
    },
    {
      "key": "47-added", "reservationId": 47, "propertyId": 2, "propertyName": "Estiva",
      "reservationName": "Lou Bernard", "platformLabel": "Booking.com",
      "startDate": "2026-08-10", "endDate": "2026-08-12", "remittedBy": "us",
      "addedGuestsRow": true, "noGuestAdded": false,
      "nightsCount": 2, "persons": 1, "taxedPersons": 1, "exemptPersons": 0,
      "taxedPersonNights": 2, "exemptPersonNights": 0,
      "taxAmount": 1.76, "refundedTaxNights": 0, "refundedTaxAmount": 0,
      "touristTaxDeclaredAt": null, "declared": false, "declarable": true
    }
  ],
  "nights": [
    { "date": "2026-07-04", "staysCount": 1, "persons": 5, "taxedPersons": 2, "exemptPersons": 3, "taxAmount": 3.3 },
    { "date": "2026-07-05", "staysCount": 1, "persons": 5, "taxedPersons": 2, "exemptPersons": 3, "taxAmount": 3.3 },
    { "date": "2026-07-06", "staysCount": 1, "persons": 5, "taxedPersons": 2, "exemptPersons": 3, "taxAmount": 3.3 },
    { "date": "2026-08-10", "staysCount": 1, "persons": 3, "taxedPersons": 3, "exemptPersons": 0, "taxAmount": 2.64 },
    { "date": "2026-08-11", "staysCount": 1, "persons": 3, "taxedPersons": 3, "exemptPersons": 0, "taxAmount": 2.64 }
  ],
  "totals": {
    "staysCount": 2, "rowsCount": 3, "declaredRowsCount": 1, "toDeclareRowsCount": 2,
    "persons": 8, "taxedPersons": 5, "exemptPersons": 3,
    "nights": 5, "taxedPersonNights": 12, "exemptPersonNights": 9,
    "amount": 15.18, "declaredAmount": 9.9, "remainingAmount": 5.28, "allDeclared": false,
    "platformRemittedStaysCount": 1, "platformRemittedAmount": 5.28
  }
}
```

`stays` is sorted by arrival, then logement, guest, reservation, the main row before its added guests' row.
`window.label` is ready to show (« août 2026 », « T3 2026 (juil.–sept.) », « Année 2026 », « du 01/07/2026 au
31/08/2026 »).

---

## 5. Data model

None. Reads `reservations`, `properties`, `clients`, `platforms`, `ical_sources`, `reservation_installments`,
`reservation_refunds` / `reservation_refund_lines` as the extraction does. **Data impact:** none (rule 14).

## 6. UI / UX

Target: the `#taxe` mock-up of the design reference, in MUI + the « Maison » theme. Built in round 2.

- **`PageActionBar`**: title « Taxe de séjour »; `center` = the « Liste » / « Par nuit » segmented toggle (`md+`);
  `actionsBefore` = « Exporter en CSV » (download icon, `info`), exporting the current view and selection.
- **Pickers** (one row on `md+`, stacked full width on `xs`): Période (Mois · Trimestre · Année · Personnalisée,
  `PeriodSelector`), then the month / quarter / year select fed by `choices`, or Du / Au; Logement (« Tous » +
  `properties`); Déclaration (« Toutes », « À déclarer », « Déclarées »). A custom window refused by the server
  shows its message under the dates and the table keeps the last valid result (pages never dead-end).
  `window.futureExcluded` shows one line: « Les mois à venir ne sont pas comptés. »
- **List**: columns Déclarée · Séjour (guest, then « logement · canal ») · Dates · Nuits · Pers. · Taxées ·
  Exonérées · Nuitées taxées · Nuitées exonérées · Montant. A platform's row is muted, its tick replaced by a tag
  « reversée par <platformLabel> ». A row of added guests reads « voyageurs ajoutés ». On `xs` each row is a card.
- **Par nuit**: Nuit du (« ven. 04/07 ») · Séjours · Personnes · Taxées · Exonérées · Montant.
- **Sticky totals bar** (`StickyTotalsBar`): Séjours (+ « N reversés par plateforme »), Personnes, Taxées ·
  exonérées, Nuits, Nuitées taxées (« N exonérées »), Déjà déclaré (« X reversés par les plateformes »), and the main
  figure « À reverser » with « reste X » or « tout est déclaré » (`allDeclared`). On `xs` it folds to « À reverser »
  and « reste » and opens on a tap; it never covers the last row.
- Empty: « Aucun séjour sur cette période. » / « Aucune nuit à déclarer sur cette période. »

## 7. Test plan

### Server unit tests
- [x] `tests/tourist-tax-report-v2.unit.test.js` (12) — rules 1-15 through the real controllers: monthly payload
      unchanged and equal rows, quarter and year = union of months, custom days, future and refusals, platform
      stays apart, exempt minors, declaration filter and totals, logement filter, register = list (refunded and
      added rows), CSV, read only, pickers.
- [x] `tests/tourist-tax-period.unit.test.js` (5) — rules 2-5, pure.
- [x] `tests/tourist-tax-period-choices.unit.test.js` (3) — rule 15, pure.
- [x] `tests/tourist-tax-report-shape.unit.test.js` (8) — rules 6-11, pure (cents distribution, register sums).
- [x] `tests/tourist-tax-report-csv.unit.test.js` (3) — rule 13, pure.
- [x] Existing tourist-tax suites unchanged and green (rule 1).

### Client unit tests
- [x] `src/__tests__/api.tourist-tax-report.test.js` (3) — §4.3: query string, CSV file name and view, refusal.
- [ ] Round 2: `TouristTaxPage.<subject>.test.jsx` per subject, `StickyTotalsBar.test.jsx`.

### Manual UI verification (round 2)
- [ ] Month, quarter, year and custom on a copy of the production data, 1280 / 900 / 390 px.
- [ ] Register totals equal list totals on screen; CSV opens in a spreadsheet with French decimals.

## 8. Out of scope

- Printing (the CSV and the browser's print cover it for now).
- A bulk « tout déclarer » action; per-commune grouping; the commune's official form.
- New exemption causes (seasonal workers, emergency housing…): none exists in the data model.
- Changing the attribution rule, the freeze, the platform modes or the tick.

## 9. Open questions

**Resolved by default (2026-11-05, brief rule 12 — safest for money and simplest):**
- Custom window cap: 750 days, the finance window's (D7), not the mock-up's 366: one rule for every window.
- A window running past the current month is read up to its end instead of refused, since the current quarter and
  year hold the month being declared; one starting after it is refused like a future month (rule 5).
- Platform-remitted stays are attributed to their last night without a payment gate (the gate exists so that we
  never remit a tax we never collected; they carry no tax of ours). Their amount is the fiche's struck-through figure.
- Babies count as exempt persons (they are minors, only adults are taxed); a row of added guests exempts nobody.
- The refunded nights are a stay's last nights in the register (a refund does not say which night; a stay cut short
  is the common case). The amount and person-nights are those of the extraction either way.
- The register is one entry per night across the selection's logements (filter by logement for one register per
  logement); its nights may precede the window's start (rule 9).
- `staysCount` counts distinct stays, so a stay listed only through its added guests' row still counts once.
- Platform rows are listed only under « Toutes »: they have no tick to filter on; the bar keeps their count.
