# Accounting synthesis — « Synthèse » tab of « Comptabilité »

| Field | Value |
|---|---|
| **Status** | Approved — server, API and client API function implemented (round 1, 2026-11-05); the UI (round 2) waits for the shared chart and tile components of lot 0 |
| **Branch** | `feature/hc-l2` (merged into `feature/finance-reporting-hippocamp`) |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Decisions this spec carries out (finance reporting inspired by HIPPOCAMP, 2026-11-05): **D-HC2** the synthesis is
the first tab of « Comptabilité » (accounting-export plugin), the per-entry view becomes the « Écritures » tab;
**D-HC3** VAT to declare is computed on the money collected, by rate, from the same entries the CSV export writes;
under the franchise the tile says so instead of a figure; **D-HC6** every tile: label + definition, value, a
secondary line, a year-over-year pill, « — vs N-1 » with ONE notice when last year is not comparable; **D-HC7** the
comparison with last year is the dashboard's (pace ledger, first comparable date), never a second rule; **D-HC8**
every figure panel states its source — the stays' amounts or the collections — never mixed in one panel.

---

## 1. Context

The « Comptabilité » page (`client/src/plugins/accounting-export/AccountingPage.jsx`) shows the month's journal
entry by entry, which is what the accountant imports. Nothing answers, for a month, a quarter or the exercise, the
two questions the operator asks before a VAT return: how much VAT to declare, and do the figures hold together.
The data is all there — the journal (`accountingModel` + `accountingExport`), the Suivi financier's figures
(`financeModel.getSummary`), the tourist-tax extraction (`financeModel.getTouristTaxExtraction`), the comparison
with last year (`financeDashboardModel`) — but scattered over three screens and one CSV.

## 2. Goal

For a chosen period, one screen tells the VAT to declare by rate and by revenue account, the money collected and
how it came, the tourist tax to remit, the revenue of the stays, each against last year, and flags what does not
add up — before the CSV goes to the accountant.

## 3. Functional rules

1. **Four periods.** `period=month` (`month=YYYY-MM`, the server's month when absent), `period=quarter`
   (`quarter=YYYY-Qn`, a CALENDAR quarter — the VAT return's —, the server's quarter when absent), `period=fy`
   (`fiscalYear=<end year>`, the app's exercise from its closing month; an unusable key reads the current exercise,
   as the Suivi financier does — fiscal-year-and-nights-sold rule 24), `period=custom` (`from`, `to`, judged by the
   Suivi financier's own `financeWindow.resolveWindow`: same messages, ≤ 750 days, impossible day = « Deux dates à
   choisir. »). No `period` = the month. An unknown period, a malformed month or quarter, or a key that is not text
   (a repeated query parameter) is 400 « Période inconnue. », never guessed.
2. **The entered-date window.** A month or a quarter whose first or last day lies outside [today − 5 years,
   today + 5 years] (server day) is refused with the window's own message (`stayDates.dateWindowMessage`), never
   clamped; a custom window is judged the same way by `resolveWindow`. The exercise keeps the dashboard's reading.
3. **One source.** Every figure read from the journal comes from the very rows the CSV export writes:
   `accountingExport.entryVentilation(entry, plan)` returns the rows of `entryToRows` — the plan's accounts, the
   same cents, the same residue on the last line — each with its role (`client`, `revenue`, `vat`, `touristTax`,
   `commission`, `commissionVat`, `penalty`) and, on revenue and VAT lines, the VAT rate it was booked at. The role
   rides beside the row, never in its cells: the CSV stays byte-identical (pinned on a fixture against the export as
   it stood before this change, default plan and renamed plan).
4. **The window's entries.** The entries of the window are the months' streams of the export (`monthEntries`:
   sales, refunds, cancellation compensations, platform penalties) for every month the window touches, kept when
   their `paidDate` lies in [from, to]. Everything the export leaves out stays out, for the same reasons: the caisse
   interne (D8), devis, cash complements. Each entry keeps a stable reference
   (`direction:reservationId:kind:paidDate:refund/compensation/installment`, `#n` for a twin) that the checks name.
5. **VAT to declare.** The VAT tile is the sum of the VAT lines (credit − debit: an avoir or a rebate gives VAT
   back) of the window's entries, by rate — on the money collected (D-HC3). When the regime in force is « Sans TVA »
   (`vatRegimeModel.inForceBlock`, `not_subject`) and the window collected no VAT, the tile carries
   `notSubject: { regime, mention, label }` (« Franchise en base de TVA » for art. 293 B, « Exonération de TVA » for
   art. 261 D 4°) and no amount; VAT collected in the window before a switch is still due, so it is then shown.
6. **VAT by revenue account.** The VAT return lists, by rate, the base (revenue lines, credit − debit) and the VAT,
   and, by revenue account of the plan (`70xxx`, the indemnity account, the rebate account, the tip account at 0 %),
   the base and the VAT: the VAT of one entry at one rate is shared over that entry's revenue lines at that rate in
   proportion to their base, largest remainder, to the cent — so both tables add up to the same total exactly.
   Account labels are the plan's (`accountLabel` of the default role). The deductible VAT on platform commissions
   (`44566000`) is reported apart (`deductibleOnCommissions`), never netted from the VAT to declare.
7. **Revenue of the stays.** CA HT (and TTC as the secondary line, `showHt` as the Suivi financier decides) is
   `financeModel.getSummary` of the window — the stays attributed by the existing rule —, the number of stays its
   reservation count. Never re-derived.
8. **Tourist tax to remit.** The tile is the sum, over the months of the window up to the server's month, of the
   « Taxe de séjour » extraction's `totals.taxAmount` (and `reservationsCount`): only the tax WE remit — a platform
   that remits it to the commune itself is out, one that reverses it to us is in, read from the platform's mode
   (never its name). The extraction is monthly, so a window that is not made of whole months has no figure: `amount`
   null and the reason « La taxe de séjour se déclare par mois entiers. ».
9. **Last year.** The comparison is `financeDashboardModel.lastYearRange` — the dashboard's coverage (the month of
   the earliest stay) and pace tracking start (pace ledger of cancelled iCal stays included), the months already
   over only while last year's snapshot is unknown (D-HC7). Every pill compares the comparable part of the window,
   on both sides, and is `{ current, previous, change }`, `change` in percent with one decimal, null when last year
   is 0 or less (never « +∞ % »). The revenue of last year is read `knownAt` a year ago when that snapshot is known,
   as the dashboard does. Without a comparable range every pill is null and `comparison.reason` holds ONE sentence:
   « Aucun séjour en base : pas de comparaison avec l’an dernier. », « Pas d’exercice <label> en base : la
   comparaison avec l’an dernier n’est pas affichée. » (exercise), « Pas de données un an plus tôt : la comparaison
   avec l’an dernier n’est pas affichée. » (otherwise). A partial range adds the note « Comparaison sur N mois sur
   M. ».
10. **Collected.** The money collected is the net movement of the client accounts of the window's collections:
    sales (acompte, solde, installment, arrival complement, end-of-stay complement, mid-stay note), compensations,
    tips, minus the rebates granted at the door and the platform penalties. A platform payout counts its net (the
    bank movement, commission off). Payments are counted one per payment: the entries of one arrival payment
    (`paymentGroup`) are one payment, a rebate or a tip rides its payment, a penalty is no payment. Refunds (avoirs)
    are not collections; they are reported apart (`refunds: { count, amount }`).
11. **Entries balanced.** Every entry's debits equal its credits, and the window's totals too; an unbalanced entry is
    named with its gap. `status: 'ok' | 'gap'`.
12. **VAT coherent — tolerance rule.** For each entry and each rate above 0 %, the VAT booked is compared with the
    base booked × the rate, rounded to the cent half away from zero (a refund's negative base the same way). Any
    difference of 0,01 € or more is reported, with the entry, its rate, base, VAT, expected VAT and gap; the strip
    shows the sum of the absolute gaps. The comparison is entry by entry, so rounding never accumulates across
    entries — the cumulated-rounding drift HIPPOCAMP warns about on prorated collections cannot appear as a gap. A
    gap of a cent remains possible and is reported: an entry booked before the TTC split (export rule 33), or a
    residue the export absorbed on the VAT line. There is no tolerance beyond the cent: a cent is shown, the operator
    judges.
13. **Payment means, as the data records them.** `platform` « Versements plateforme »: the acompte or solde of an
    OTA sale (`isDirectChannel` false — read from the platform's « Compté comme vente directe », never a name), a
    platform penalty, an indemnity a platform wired; `paymentLink` « Lien de paiement »: an entry a paid link of the
    stay settled (`payment_links` status `paid` of the matching type — `deposit`/`full` for an acompte,
    `balance`/`full` for a solde, `complement`, `installment` by its installment —, devis converted into the stay
    included); `recorded` « Marqué perçu »: everything else, marked on the fiche or at the door. An arrival payment
    whose entries came by different means reads `recorded`.
14. **Settlement types and shares.** Types: `deposit` « Acomptes », `balance` « Soldes », `installment`
    « Échéances », `arrivalComplement` « Compléments à l’arrivée », `endOfStayComplement` « Compléments de fin de
    séjour », `midStayComplement` « Notes en séjour », `arrivalPayment` « Paiements à l’arrivée » (one grouped
    payment), `platformPayout` « Versements plateforme » (an OTA sale's acompte or solde, penalties off),
    `compensation` « Indemnités d’annulation », `tip` « Pourboires ». Each row of both breakdowns carries
    `count`, `amount` and `share` — percent with one decimal, largest remainder on tenths, so the shares add up to
    exactly 100 —, sorted by amount. No share at all (`null` on every row) while the total is not positive or a row is
    negative: a part of a whole cannot be read there.
15. **Collected series.** Buckets: a day for a month, an ISO week (« S27 », clipped to the window) for a quarter, a
    month for an exercise; a custom window by its width (≤ 62 days: days, ≤ 186: weeks, beyond: months). Each bucket
    carries `amount`, `cumulative` (read up to the bucket's end, null for a bucket that starts after the server's
    day) and, when the WHOLE window is comparable with last year, `previousAmount` and `previousCumulative` on the same
    buckets a year earlier (29 February reads the 28th: running totals are read directly, never by adding buckets, so
    nothing is counted twice). `previousAvailable` says whether last year is drawn.
16. **Last CSV export.** Each successful download of the month's CSV stamps `{ at: 'YYYY-MM-DDTHH:MM' (server local
    time), month: 'YYYY-MM' }` in the plugin's settings store (key `lastCsvExport`, never declared: no settings page
    shows or writes it, it is erased with the plugin's configuration); the checks strip reads it, null before the
    first download or when unreadable. A refused download stamps nothing.
17. **Finished stays settled.** The stays of the window (rule 7) whose end date is before the server's day and that
    are not settled (`isSettled`) are listed with their `remainingToPay` (`reservationSettlement`), `status`
    `'ok' | 'gap'` and their count.
18. **Tab badges.** `counts.payments` (rule 10) and `counts.entries` (the window's journal entries) feed the
    « Encaissements » and « Écritures » badges.
19. **Each panel names its source (D-HC8).** Every tile, panel and check carries `source: 'stays' | 'collections'`:
    stays for the revenue, the tourist tax and the settled check; collections for collected, VAT, the VAT return,
    the means, the types, the series, the balanced and VAT-coherent checks. No panel mixes the two.
20. **Access.** Admins, and the accountant role in read (`GET` only), through the plugin's own role entry.
21. **Money.** Every amount is summed in integer cents and leaves as euros rounded to the cent; no figure is
    computed by the client.

**Edge cases:**
- A window with no entry → zeros, empty breakdowns (no share), a flat series, checks `ok`.
- A cut month (custom window) → every figure but the tourist tax; the tax tile says why.
- An exercise still running → future buckets have no current value; last year is drawn in full when comparable.
- Two notes of the same stay the same day → two references, `…#2` for the second.
- A penalty with no payout in the window → the platform row may be negative: no shares, amounts still shown.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/accounting-export/` | `index.js` | T | Route `GET /api/accounting/synthesis`, accountant `GET` entry, stamps the CSV download |
| `plugins/accounting-export/` | `synthesisController.js` | C | Orchestrates period → reads → shaping; the payload, each panel's source, the not-subject marker, the N-1 pills and reason |
| `plugins/accounting-export/` | `synthesisModel.js` | C | Reads: the window's entries from the export's month stream, payment means (links, channel), stays' summary, tourist-tax extraction sum, the dashboard's last-year range, last export, regime in force |
| `plugins/accounting-export/` | `synthesis.js` | C | Pure engine: ventilation items, VAT return by rate and account, balanced and VAT-coherent checks, payments, means and types with shares, series |
| `plugins/accounting-export/` | `synthesisPeriod.js` | C | Pure: the four periods, their refusals, granularity and buckets |
| `plugins/accounting-export/` | `accountingExport.js` | T | Each row tagged with its role and rate beside the cells; `entryVentilation` — CSV unchanged |
| `plugins/accounting-export/` | `controller.js` | T | `onCsvExported(month)` after a built CSV; exports `monthEntries` |
| `plugins/accounting-export/` | `settings.js` | T | `readLastCsvExport` / `storeLastCsvExport` (`lastCsvExport` key) |
| `plugins/accounting-export/` | `manifest.json` | T | 1.0.28, `sdk ^2.22.0`, French changelog |
| `models/` | `financeDashboardModel.js` | T | `lastYearRange({ window, today, propertyId })` extracted from `figures()`, which now calls it — dashboard payload unchanged |
| `plugins/sdk/` | `index.js`, `coreModules.json`, `coreModuleHistory.json`, `version.js` | T | SDK 2.22.0: `financeModel`, `financeDashboardModel`, `financeWindow`, `fiscalYear`, `yearOverYear` exposed |
| `tests/` | `plugin-core-hardening-floor.unit.test.js`, `plugins-sdk-core-module-floor.unit.test.js` | T | The 2.22.0 floor row; accounting-export joins the `stayDates` consumers |
| `database.js` | — | — | No schema change: the stamp is a row of the existing `plugin_settings` |

### 4.2 Client side (`client/src/`)

Round 1 touches `api.js` only. Round 2 (after lot 0's shared components are merged):

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T (round 1) | `getAccountingSynthesis(params)` — sends only the keys given |
| `plugins/accounting-export/` | `AccountingPage.jsx` | T (round 2) | Tabs « Synthèse » (first) · « Encaissements » (badge `counts.payments`) · « Écritures » (badge `counts.entries`, today's journal view unchanged); period selector in the `PageActionBar` |
| `plugins/accounting-export/` | `AccountingSynthesisTab.jsx` | C (round 2) | KPI row, comparison notice, checks strip, VAT return (Par taux / Par compte), cumulative chart |
| `plugins/accounting-export/` | `AccountingCollectionsTab.jsx` | C (round 2) | Means and types (segmented bar + table), daily/weekly/monthly series with cumulative and N-1 |
| `hooks/` | `useServerToday` | consumed | Client date hints of the custom window judged from the server's day |

**Component reuse declaration:** consumed — `PageActionBar`, `PeriodSelector` (custom window), lot 0's KPI tile
(label + « i », value, secondary line, N-1 pill), trend chart (dashed N-1, series named at the line end, legend
toggles, « ⋯ » menu « Voir en tableau » / « Copier les données »), share bar + table, `EmptyState`, `ErrorAlert`,
`LoadingState`; created — the two tabs, feature-local (they only arrange generic components on this payload).

### 4.3 API contract

| Method | Endpoint | Query | Response | Notes |
|---|---|---|---|---|
| GET | `/api/accounting/synthesis` | `period`, `month`, `quarter`, `fiscalYear`, `from`, `to` | 200 payload below; 400 `{ error: '<French refusal>' }` | Admin + accountant (read). Read-only. |
| GET | `/api/accounting/sales.csv` | unchanged | unchanged bytes | Now stamps the last export (rule 16) |

Example — `GET /api/accounting/synthesis?period=quarter&quarter=2026-Q3` (amounts illustrative):

```json
{
  "window": { "kind": "quarter", "from": "2026-07-01", "to": "2026-09-30", "label": "T3 2026", "quarter": "2026-Q3", "granularity": "week" },
  "today": "2026-11-05",
  "fiscalYear": { "key": 2026, "label": "2025-2026", "from": "2025-10-01", "to": "2026-09-30" },
  "fiscalYears": [{ "key": 2027, "label": "2026-2027", "isCurrent": true }, { "key": 2026, "label": "2025-2026", "isCurrent": false }],
  "counts": { "payments": 96, "entries": 131 },
  "comparison": {
    "comparable": true, "complete": true, "months": 3, "totalMonths": 3,
    "current": { "from": "2026-07-01", "to": "2026-09-30" }, "previous": { "from": "2025-07-01", "to": "2025-09-30" },
    "reason": null, "note": null
  },
  "kpis": {
    "revenue": { "source": "stays", "ht": 18450.3, "ttc": 20295, "showHt": true, "stays": 41, "yoy": { "current": 18450.3, "previous": 15210.8, "change": 21.3 } },
    "collected": { "source": "collections", "amount": 21980.6, "payments": 96, "refunds": { "count": 1, "amount": 120 }, "yoy": { "current": 21980.6, "previous": 17430.2, "change": 26.1 } },
    "touristTax": { "source": "stays", "amount": 286.4, "stays": 41, "reason": null, "yoy": { "current": 286.4, "previous": 241.9, "change": 18.4 } },
    "vat": { "source": "collections", "amount": 1882.7, "byRate": [{ "ratePercent": 20, "vat": 141.67 }, { "ratePercent": 10, "vat": 1741.03 }], "notSubject": null, "yoy": { "current": 1882.7, "previous": 1490.4, "change": 26.3 } }
  },
  "vatReturn": {
    "source": "collections",
    "byRate": [
      { "ratePercent": 20, "base": 708.33, "vat": 141.67 },
      { "ratePercent": 10, "base": 17410.3, "vat": 1741.03 },
      { "ratePercent": 0, "base": 331.67, "vat": 0 }
    ],
    "byAccount": [
      { "account": "70601000", "label": "Activité diverse", "ratePercent": 20, "base": 708.33, "vat": 141.67 },
      { "account": "70600000", "label": "Location gîte", "ratePercent": 10, "base": 16190.1, "vat": 1619.01 },
      { "account": "70600010", "label": "Prestation complémentaire", "ratePercent": 10, "base": 1220.2, "vat": 122.02 },
      { "account": "75880000", "label": "Indemnité d'annulation", "ratePercent": 0, "base": 331.67, "vat": 0 }
    ],
    "totals": { "base": 18450.3, "vat": 1882.7 },
    "deductibleOnCommissions": 212.4
  },
  "checks": {
    "balanced": { "source": "collections", "status": "ok", "totalDebits": 24310.5, "totalCredits": 24310.5, "unbalanced": [] },
    "vatCoherence": {
      "source": "collections", "status": "gap", "gap": 0.01,
      "entries": [{
        "key": "sale:22281:deposit:2026-07-04:", "reservationId": 22281, "kind": "deposit", "direction": "sale", "paidDate": "2026-07-04", "libelle": "ANNA LIMA",
        "gap": -0.01, "rates": [{ "ratePercent": 10, "base": 117.28, "vat": 11.72, "expectedVat": 11.73, "gap": -0.01 }]
      }]
    },
    "settled": { "source": "stays", "status": "gap", "count": 1, "stays": [{ "reservationId": 22290, "name": "Paul Martin", "propertyName": "Gîte", "endDate": "2026-09-14", "remaining": 412.5 }] },
    "lastExport": { "at": "2026-10-02T09:14", "month": "2026-09" }
  },
  "collections": {
    "source": "collections", "total": 21980.6, "payments": 96,
    "byMeans": [
      { "key": "recorded", "label": "Marqué perçu", "count": 46, "amount": 9020, "share": 41 },
      { "key": "platform", "label": "Versements plateforme", "count": 29, "amount": 7650, "share": 34.8 },
      { "key": "paymentLink", "label": "Lien de paiement", "count": 21, "amount": 5310.6, "share": 24.2 }
    ],
    "byType": [
      { "key": "balance", "label": "Soldes", "count": 33, "amount": 8132.8, "share": 37 },
      { "key": "platformPayout", "label": "Versements plateforme", "count": 29, "amount": 7650, "share": 34.8 },
      { "key": "deposit", "label": "Acomptes", "count": 25, "amount": 4397.8, "share": 20 },
      { "key": "arrivalComplement", "label": "Compléments à l’arrivée", "count": 9, "amount": 1800, "share": 8.2 }
    ],
    "series": {
      "granularity": "week", "previousAvailable": true,
      "buckets": [
        { "key": "2026-07-01", "label": "S27", "from": "2026-07-01", "to": "2026-07-05", "amount": 1520, "cumulative": 1520, "previousAmount": 1210, "previousCumulative": 1210 },
        { "key": "2026-07-06", "label": "S28", "from": "2026-07-06", "to": "2026-07-12", "amount": 1830.4, "cumulative": 3350.4, "previousAmount": 1402, "previousCumulative": 2612 }
      ]
    }
  }
}
```

Refusals (400, `{ error }`): « Période inconnue. », the custom window's « Deux dates à choisir. », « La date de début
doit précéder la date de fin. », « Période trop longue : 750 jours au plus. », and the entered-date window's two
messages. The payload is additive only: no existing endpoint's payload changes.

---

## 5. Data model

No schema change, no migration. The last-export stamp is one row of the existing `plugin_settings` table
(`plugin_id = 'accounting-export'`, `key = 'lastCsvExport'`, JSON value), upserted at each download. Erasing the
plugin's data deletes it with the plugin's other settings.

**Data impact:** none on existing records.

## 6. UI / UX

Round 2, after lot 0 — the design reference `#synthese` (approved 2026-11-05), adapted to MUI and the « Maison »
theme:

- **Tabs** under the `PageActionBar` (title « Comptabilité », period selector — Mois · Trimestre · Exercice ·
  Dates — in the bar's centre on `md+`, below on `xs`): « Synthèse » (first, default), « Encaissements » + badge,
  « Écritures » + badge. « Écritures » is today's page body, unchanged (its own month selector).
- **Synthèse:** four tiles — « CA HT » (secondary « TTC : … », caption « Sur les montants des séjours »),
  « Encaissé » (« N paiements », « Sur les encaissements »), « Taxe de séjour » (« N séjours »; the reason instead
  of a figure on a cut month), « TVA à déclarer » (« dont 10 % : … »; the mention label under « Sans TVA ») — each
  with its N-1 pill or « — vs N-1 »; one notice under the row when `comparison.reason`; the checks strip
  (Acomptes soldés · TVA cohérente · Dernier export CSV), each gap opening the named entries or stays; the VAT
  return with « Par taux / Par compte »; the cumulative chart with N-1 dashed.
- **Encaissements:** means and types as a thin segmented bar + table (no pie, D-HC5), the series with its cumulative.
- **Responsive:** tiles 4 → 2 → 1 columns (`lg` / `md` / `xs`); tables become stacked rows on `xs`; charts full
  width; no horizontal scroll.
- **Never dead-ends:** a refused period keeps the selector and shows the refusal; the custom window's hints judge
  from `useServerToday`.

## 7. Test plan

### Server unit tests (round 1 — 43 tests in 6 new files, all in `server/src/plugins/accounting-export/tests/`)
- [x] `accounting-synthesis-period.unit.test.js` (9) — rules 1, 2, 8, 15: periods, refusals, granularity, buckets.
- [x] `accounting-synthesis-engine.unit.test.js` (10) — rules 4, 5, 6, 10–15, 21: VAT return, checks, payments, shares, series.
- [x] `accounting-synthesis-csv-one-source.unit.test.js` (4) — rules 3, 5, 6: CSV byte-identical (golden file, two plans), rows = ventilation lines, VAT = the CSV's VAT accounts.
- [x] `accounting-synthesis-books.unit.test.js` (9) — rules 1, 4, 5, 7, 8, 9, 10, 13, 16, 17, 18, 20 on the real schema through the plugin's routes: journal equality, `getSummary` equality, tourist-tax extraction equality, dashboard range equality, means from links and channel, stamp, accountant access.
- [x] `accounting-synthesis-payload.unit.test.js` (8) — rules 5, 8, 9, 19, 21 on a model double.
- [x] `accounting-synthesis-last-export.unit.test.js` (3) — rule 16.

### Client unit tests
- [x] `client/src/__tests__/api.accounting-synthesis.test.js` (1) — the query sent.
- [ ] Round 2: `AccountingPage.synthesis-tabs.test.jsx`, `AccountingSynthesisTab.*.test.jsx`, `AccountingCollectionsTab.*.test.jsx`.

### Manual UI verification (round 2)
- [ ] A quarter with a platform payout, a paid link and a door payment: tiles, VAT tables equal, shares 100.
- [ ] Mobile (≤ 600 px): tiles stacked, tables as rows, no horizontal scroll.
- [ ] A custom window cut mid-month: the tax tile's reason; a refused window keeps the selector.

## 8. Out of scope

- Filing the VAT return (CA3) or any export of the synthesis itself.
- A per-logement synthesis (the journal is not per logement).
- Reconciling with the bank statement (the online-payment plugin's « Rapprochement bancaire »).
- Netting the deductible VAT on commissions into the VAT to declare.

## 9. Open questions

**Resolved by default (round 1, 2026-11-05 — the safest and simplest option, brief rule 12):**
- Q: Quarters of the calendar or of the exercise? — A: calendar quarters, the VAT return's periods; the exercise
  is its own period.
- Q: Collected gross or net of platform commissions? — A: net, the bank movement (the client account's debit in the
  journal); the VAT stays on the gross, as the journal books it.
- Q: Refunds in « Encaissé »? — A: no; reported apart (`refunds`), so the shares can add up to 100.
- Q: Payment means beyond what is recorded (transfer, cheque, card)? — A: not recorded on a fiche today; three
  means only: platform, payment link, marked perçu. The bank reconciliation (another plugin) is not read.
- Q: Tourist tax on a custom window cut mid-month? — A: no figure, a reason; the extraction is monthly.
- Q: Last export per month or overall? — A: the last download overall, with its month.
- Q: The franchise marker when VAT was collected before a switch to « Sans TVA »? — A: the VAT is shown — it is due.
- Q: « Écritures » on a quarter? — A: the tab keeps today's month view unchanged (D-HC2); its badge counts the
  synthesis window's entries.

## 10. Implementation progress

- 2026-11-05 — round 1: server, API, `api.getAccountingSynthesis`, 43 server tests + 1 client test. Round 2 (UI)
  pending lot 0.
