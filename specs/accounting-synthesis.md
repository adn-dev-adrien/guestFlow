# Accounting synthesis — « Synthèse » tab of « Comptabilité »

| Field | Value |
|---|---|
| **Status** | Implemented — server, API and UI (rounds 1 and 2, 2026-11-05) |
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
   *Reading of 2026-11-06 (D-HC13): « the regime in force » is the one in force DURING the window — rule 35.*
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
   as the dashboard does. The sentence is the dashboard's own: `lastYearRange` returns the shared status of
   `utils/financeComparison.comparisonWindow` (specs/finance-revpar-year-over-year.md rules 4-7), and
   `comparison.notice` is its `notice` (`reasonCode` its `reason`, `comparableFrom` its date): without a comparable
   range every pill is null and the notice says why (no history, or « Comparaison avec l'an dernier à partir
   du … »); a partial range keeps its pills and the notice « Comparaison sur N mois sur M : … ». For the same window
   the dashboard and the synthesis say the same sentence (reading of 2026-11-05, integration of lots 2 and 3).
10. **Collected.** The money collected is the net movement of the client accounts of the window's collections:
    sales (acompte, solde, installment, arrival complement, end-of-stay complement, mid-stay note), compensations,
    tips, minus the rebates granted at the door and the platform penalties. A platform payout counts its net (the
    bank movement, commission off). Payments are counted one per payment: the entries of one arrival payment
    (`paymentGroup`) are one payment, a rebate or a tip rides its payment, a penalty is no payment. Refunds (avoirs)
    are not collections; they are reported apart (`refunds: { count, amount }`). A cancellation that requalifies money
    already collected (an acompte, installments or a commission a cancelled stay keeps: an avoir `retained` and a
    compensation `retained_deposit` on the same day) moves no money: it is no collection, no payment and no refund —
    both entries stay in the VAT return and the checks (review R2-1, 2026-11-06).
11. **Entries balanced.** Every entry's debits equal its credits, and the window's totals too; an unbalanced entry is
    named with its gap. `status: 'ok' | 'gap'`.
12. **VAT coherent — tolerance rule.** For each entry and each rate above 0 %, the VAT booked is compared with the
    base booked × the rate, rounded to the cent half away from zero (a refund's negative base the same way). Any
    difference of 0,01 € or more is reported, with the entry, its rate, base, VAT, expected VAT and gap; the strip
    shows the sum of the absolute gaps. The comparison is entry by entry, so rounding never accumulates across
    entries — the cumulated-rounding drift HIPPOCAMP warns about on prorated collections cannot appear as a gap. A
    gap of a cent remains possible and is reported: an entry booked before the TTC split (export rule 33), or a
    residue the export absorbed on the VAT line. There is no tolerance beyond the cent: a cent is shown, the operator
    judges. *Status and colour: rule 38 (D-HC12).*
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
    negative: a part of a whole cannot be read there. Each row also carries `ratio`, the same share as a fraction of 1 (tenths of a percent,
    exact), which the share bar draws.
15. **Collected series.** Buckets: a day for a month, an ISO week (« S27 », clipped to the window) for a quarter, a
    month for an exercise; a custom window by its width (≤ 62 days: days, ≤ 186: weeks, beyond: months). Each bucket
    carries `amount`, `cumulative` (read up to the bucket's end, null for a bucket that starts after the server's
    day) and, when the WHOLE window is comparable with last year, `previousAmount` and `previousCumulative` on the same
    buckets a year earlier (29 February reads the 28th: running totals are read directly, never by adding buckets, so
    nothing is counted twice). `previousAvailable` says whether last year is drawn. A month bucket is labelled short,
    « oct. », or « oct. 25 » when the window spans two years, so labels never overlap on a half-width chart (R5-04).
16. **Last CSV export.** Each successful download of the month's CSV stamps `{ at: 'YYYY-MM-DDTHH:MM' (server local
    time), month: 'YYYY-MM' }` in the plugin's settings store (key `lastCsvExport`, never declared: no settings page
    shows or writes it, it is erased with the plugin's configuration); the checks strip reads it, null before the
    first download or when unreadable. A refused download stamps nothing. *Only a same-origin download: rule 40.*
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

22. **Periods offered.** The payload lists what the period selector offers (`periodOptions`): every month and calendar
    quarter from the first day of the oldest exercise (never before the entered-date window) to the server's month —
    or to a window chosen ahead —, newest first and labelled (« novembre 2026 », « T4 2026 »), and the exercises
    (`fiscalYears`). The client never builds a period itself. *Reading of 2026-11-06 (D-HC13, R2-2): only what the
    server accepts is offered — a month or quarter whose first day is before the entered-date window, or whose last
    day is after it, is left out; the exercise of the window is always listed (R2-12); an exercise key far ahead keeps
    the dashboard's reading and answers at once (months are counted on numbers, so December 9999 ends).*
23. **Three tabs (D-HC2).** « Comptabilité » opens on « Synthèse », then « Encaissements » and « Écritures », each of
    the last two with the server's count (`counts.payments`, `counts.entries`). « Écritures » is the journal view as it
    was, with its own month and its CSV download — the CSV action is offered on that tab only, where its month is
    chosen. One URL holds the three: `tab`, the journal's `month`/`year`, the synthesis's `p`/`sm`/`sq`/`sfy`/`sfrom`/
    `sto`; a change keeps the others. A link with `month` and `year` and no `tab` (the way back from a fiche, every
    journal link before this spec) opens « Écritures ». *The « Écritures » count: rule 43.*
24. **The period bar.** Mois · Trimestre · Exercice · Personnalisée, then the month, quarter or exercise among the
    server's options; the shown choice is the payload's `window`. A custom du / au is judged as the server judges it
    (`customWindowError`, from the server's day): refused here with the same message, nothing sent. A period the
    server refuses keeps the bar and the last figures shown, with the server's message above them: the page never
    dead-ends.
25. **The four tiles (D-HC6).** CA HT (secondary « TTC : … »), Encaissé (« N paiements »), Taxe de séjour (« N
    séjours »), TVA à déclarer (« dont 10 % : … », the rate the server names `kpis.vat.mainRate`, the one carrying the
    most VAT). Each: label, « i » definition, value, secondary line, its source (rule 30) and the pill « ↑ +21,3 %
    (N-1 : 15 210 €) », or « — vs N-1 » when the server sends no comparison. Outside the VAT the VAT tile shows the
    regime's mention (« Franchise en base de TVA ») instead of a figure, and no pill; on a cut month the tourist-tax
    tile shows « — » and the server's reason, and no pill.
26. **One notice.** Under the tiles, `NoComparisonNotice` shows `comparison.notice` once — the reason there is no
    comparison, or the part compared — and nothing when the server sends none.
27. **The checks strip.** Four checks in a row (two on a tablet, stacked on a phone): « Écritures équilibrées »
    (« Débits = crédits : … » or the unbalanced count), « TVA cohérente » (« Aucun écart avec les écritures » or
    « Écart de 0,01 € · voir l'écriture »), « Séjours terminés soldés » (all, or the count · voir), « Dernier export
    CSV » (« 02/11/2026 à 09:14 · octobre 2026 », or « Aucun export »). « voir » opens, under the strip, what the check
    names: the entries with their rate, VAT, expected VAT and gap, each with « Écritures du mois » that opens
    « Écritures » on that entry's month; the stays with their logement, departure and what they still owe, linked to
    their fiche for an admin only.
28. **VAT to declare panel.** « Récapitulatif TVA à déclarer » with a « Par taux / Par compte » switch: the server's
    rows and its total row, the deductible VAT on commissions on a line of its own (« non déduite ici »), and, outside
    the VAT, « <mention> : aucune TVA à déclarer. » instead of the explanation.
29. **Collected running total.** « Encaissements cumulés »: the server's running total per bucket with its light area,
    last year's dashed beside it only when the server sends it (`previousAvailable`), a « ⋯ » menu to read it as a
    table or copy it.
30. **Sources shown (D-HC8).** Each tile and panel ends with « Sur les montants des séjours » or « Sur les
    encaissements », from its `source`.
31. **« Encaissements » shares.** Two panels, « Encaissements par moyen de paiement » and « Répartition par type de
    règlement »: a segmented bar (the server's `ratio`) above the table — label, count, amount, share printed to one
    decimal as the server rounded it —, and the server's total row (payments, collected). The refunds of the window
    show on one line apart when there are any.
32. **« Encaissements » series.** The amount per bucket and its running total on one time axis, with last year's
    running total when sent, named after the granularity: « Encaissements journaliers / hebdomadaires / mensuels et
    cumul », « Encaissé du jour / de la semaine / du mois ».
33. **Responsive.** Tiles two per row below 1200 px, four from 1200 px; the panels side by side from 1200 px, stacked
    below; the period selects full width on a phone; tables scroll inside their own box; no horizontal scroll of the
    page at 390 px.
    > **Sans test** — layout only, checked in a browser at 1280, 900 and 390 px (§7); the components it arranges are
    > covered by their own tests.
34. **The accountant.** Everything above is shown to the accountant role, read-only: the only difference is that a
    stay is not a link (the fiche is not theirs).

35. **The VAT mention follows the regimes of the window (D-HC13, R2-3).** `vatRegimeModel.regimesDuring(from, to)` lists
    the regimes in force during the window (the one of `from`, then each period taking effect inside it). The tile
    carries `notSubject` only when every one of them is « Sans TVA » and no VAT was collected; a window that was
    subject, even partly, shows its amount — 0,00 € is a nil return, still filed. A database without periods is
    subject.
36. **An account shared by two uses (R2-9).** In the VAT return by account, an account is named as its entries name it
    (a tip line « Pourboire »); when entries of the window give it two names (tips and indemnities on one account), it
    reads « Produits divers ».
37. **Five rows at most (R2-7).** A breakdown (means, types) keeps its four largest rows and folds the rest into
    « Autres » (`key: 'other'`, its count and amount, `parts`: the labels folded) as soon as it would have more than
    five; shares are computed on the rows sent and add up to 100. The chart draws « Autres » in the palette's
    neutral, so no two segments share a colour.
38. **Rounding gap (D-HC12).** An entry whose VAT gaps add up to one cent at most is a rounding gap: it goes to
    `roundingEntries`, and the check reads « Écart d'arrondi : N ct » in grey (`status: 'rounding'`,
    `roundingCents`). `status: 'gap'` and red only when an entry goes beyond: `gap` is then the sum of those gaps and
    `entries` lists them, each opening « Écritures » on its month.
39. **Tourist tax, ahead and straddling (R2-4, R6-11).** A window that starts after the server's month has nothing to
    declare yet: `amount` and `stays` null, reason « Rien à déclarer avant le mois en cours. », no pill. A window
    that goes past the server's month is summed up to it and says so (`until`: « novembre 2026 », the tile « N
    séjours · jusqu'à novembre 2026 »). The sum reads the shared extraction rows (`financeModel.getTouristTaxRows`,
    the very rows each monthly extraction sums) once per span — the window, its comparable part, last year — never
    month by month; whatever the extraction leaves out (D-HC10: a stay whose tax is frozen at 0 €) is left out here.
40. **Only the app's own download stamps (R6-5).** The CSV stamps « Dernier export CSV » only when the browser says the
    request comes from the app's own page (`Sec-Fetch-Site: same-origin`); a link opened from another site, a typed
    address, a preview or a probe gets the file and writes nothing.
41. **A refused first load is never a dead end (R2-5).** When the period of the URL is refused before any figure is
    shown, « Revenir au mois en cours » clears it; pressing the kind already shown (« Mois ») loads that kind's
    default instead of doing nothing.
42. **Unreadable share, empty breakdown (R2-6).** A share the server sends as null prints « — »; a breakdown with no
    row says « Aucun encaissement sur la période. » instead of a lone total.
43. **The « Écritures » count (D-HC13, R2-8, R5-06).** The « Écritures » badge counts the entries of the month that tab
    shows (the journal's own count, `GET /api/accounting/sales` `totals.entriesCount`); « Encaissements » keeps the
    synthesis window's payments. Supersedes rule 23 for the « Écritures » count.
44. **Copy (R2-10).** « Encaissé » is defined as « Paiements reçus sur la période, quel que soit le mois du séjour, nets
    des commissions plateformes, hors caisse interne. »; outside the VAT the revenue tile reads « CA » (its figure is
    TTC); the refunds line names its unit (« 1 remboursement · 28,22 € »).

45. **Charts loaded on first use (R5-01).** The client SDK, which the host imports whole in the initial bundle, hands
    plugins `TrendChart` and `AlignedDailyCumulativeCharts` as lazy wrappers (`plugins/sdk/reportCharts.jsx`, same
    props, a box of the chart's height while it loads): exporting them directly put Recharts in every page's first
    load (412,8 kB gzip against a 313,3 kB budget; 298,1 kB after).
    > **Sans test** — a bundle-size property: `scripts/check-bundle-budget.mjs` is the gate; the chart tests of this
    > spec wait for the chart to arrive.

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
| `models/` | `vatRegimeModel.js` | T | `regimesDuring(db, from, to)` — the regimes in force during a window (rule 35) |
| `models/` | `financeDashboardModel.js` | T | `lastYearRange({ window, today, propertyId })` extracted from `figures()`, which now calls it — dashboard payload unchanged |
| `plugins/sdk/` | `index.js`, `coreModules.json`, `coreModuleHistory.json`, `version.js` | T | SDK 2.22.0: `financeModel`, `financeDashboardModel`, `financeWindow`, `fiscalYear`, `yearOverYear` exposed |
| `tests/` | `plugin-core-hardening-floor.unit.test.js`, `plugins-sdk-core-module-floor.unit.test.js` | T | The 2.22.0 floor row; accounting-export joins the `stayDates` consumers |
| `database.js` | — | — | No schema change: the stamp is a row of the existing `plugin_settings` |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T | `getAccountingSynthesis(params)` — sends only the keys given |
| `plugins/sdk/` | `reportCharts.jsx` | C | The two report charts, loaded on first use (rule 45) |
| `plugins/sdk/` | `index.js` | T | Exposes the report grammar to plugins (SDK 2.22.0): `SelectableTile`, `NoComparisonNotice`, `Panel`, `TrendChart`, `AlignedDailyCumulativeCharts`, `ShareTable`, `useServerToday`, `customWindowError`, `formatCurrencyRounded` |
| `plugins/accounting-export/` | `AccountingPage.jsx` | T | The three tabs in the `PageActionBar` (rule 23), the URL, the synthesis load and its refusal (rule 24); « Écritures » renders the journal view unchanged |
| `plugins/accounting-export/` | `SynthesisPeriodBar.jsx` | C | Mois · Trimestre · Exercice · Personnalisée and the server's options (rules 22, 24) |
| `plugins/accounting-export/` | `AccountingSynthesisTab.jsx` | C | Tiles, notice, checks strip, VAT panel, cumulative chart (rules 25–30) |
| `plugins/accounting-export/` | `AccountingCollectionsTab.jsx` | C | Means and types share tables, aligned series (rules 31, 32) |
| `plugins/accounting-export/` | `synthesisCopy.js` | C | French copy of the two tabs |

**Component reuse declaration:** consumed — `PageActionBar`, `PageTabs` (`count`), `SelectableTile` (static, `info`,
`comparison`), `NoComparisonNotice`, `Panel`, `TrendChart`, `AlignedDailyCumulativeCharts`, `ShareTable`, `DateField`,
`ErrorAlert`, `LoadingState`, `customWindowError` (from `PeriodSelector`, whose three-kind control could not take a
quarter); created — the two tabs and the period bar, feature-local (they arrange generic components on this payload).

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
    "reasonCode": null, "comparableFrom": null, "notice": null
  },
  "periodOptions": {
    "months": [{ "value": "2026-11", "label": "novembre 2026" }, { "value": "2026-10", "label": "octobre 2026" }],
    "quarters": [{ "value": "2026-Q4", "label": "T4 2026" }, { "value": "2026-Q3", "label": "T3 2026" }]
  },
  "kpis": {
    "revenue": { "source": "stays", "ht": 18450.3, "ttc": 20295, "showHt": true, "stays": 41, "yoy": { "current": 18450.3, "previous": 15210.8, "change": 21.3 } },
    "collected": { "source": "collections", "amount": 21980.6, "payments": 96, "refunds": { "count": 1, "amount": 120 }, "yoy": { "current": 21980.6, "previous": 17430.2, "change": 26.1 } },
    "touristTax": { "source": "stays", "amount": 286.4, "stays": 41, "reason": null, "yoy": { "current": 286.4, "previous": 241.9, "change": 18.4 } },
    "vat": { "source": "collections", "amount": 1882.7, "byRate": [{ "ratePercent": 20, "vat": 141.67 }, { "ratePercent": 10, "vat": 1741.03 }], "mainRate": { "ratePercent": 10, "vat": 1741.03 }, "notSubject": null, "yoy": { "current": 1882.7, "previous": 1490.4, "change": 26.3 } }
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
    "lastExport": { "at": "2026-10-02T09:14", "month": "2026-09", "monthLabel": "septembre 2026" }
  },
  "collections": {
    "source": "collections", "total": 21980.6, "payments": 96,
    "byMeans": [
      { "key": "recorded", "label": "Marqué perçu", "count": 46, "amount": 9020, "share": 41, "ratio": 0.41 },
      { "key": "platform", "label": "Versements plateforme", "count": 29, "amount": 7650, "share": 34.8, "ratio": 0.348 },
      { "key": "paymentLink", "label": "Lien de paiement", "count": 21, "amount": 5310.6, "share": 24.2, "ratio": 0.242 }
    ],
    "byType": [
      { "key": "balance", "label": "Soldes", "count": 33, "amount": 8132.8, "share": 37, "ratio": 0.37 },
      { "key": "platformPayout", "label": "Versements plateforme", "count": 29, "amount": 7650, "share": 34.8, "ratio": 0.348 },
      { "key": "deposit", "label": "Acomptes", "count": 25, "amount": 4397.8, "share": 20, "ratio": 0.2 },
      { "key": "arrivalComplement", "label": "Compléments à l’arrivée", "count": 9, "amount": 1800, "share": 8.2, "ratio": 0.082 }
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

The design reference `#synthese` (approved 2026-11-05), in MUI and the « Maison » theme, with lot 0's report grammar.

- **Bar:** `PageActionBar` « Comptabilité », the tabs in its `tabs` slot (centred on `sm+`, second row on `xs`):
  « Synthèse » · « Encaissements 96 » · « Écritures 131 ». The CSV action (« Télécharger le CSV des ventes ») only on
  « Écritures ».
- **Period bar** (Synthèse and Encaissements): toggle Mois · Trimestre · Exercice · Personnalisée, then the select
  (Mois / Trimestre / Exercice) or Du / Au. Refusal text in red under the dates; a server refusal in an `ErrorAlert`
  with « Réessayer » above the last figures.
- **Synthèse:** the four tiles (« i », value, secondary line, source, pill), one notice, the checks strip (dot +
  title + state; « voir » opens the named entries or stays under the strip), « Récapitulatif TVA à déclarer » with
  « Par taux / Par compte », « Encaissements cumulés » (current with area, N-1 dashed, « ⋯ »).
- **Encaissements:** « Encaissements par moyen de paiement » and « Répartition par type de règlement » (segmented bar
  + table + total), « Encaissements journaliers / hebdomadaires / mensuels et cumul » (bars over the running total).
- **Copy** (impersonal): « Sur les montants des séjours », « Sur les encaissements », « Écritures équilibrées »,
  « TVA cohérente », « Séjours terminés soldés », « Dernier export CSV », « Aucun export », « Écritures du mois »,
  « TVA déductible sur les commissions, non déduite ici », « Remboursements sur la période, hors encaissements ».
- **Responsive:** rule 33 — tiles 2 per row below 1200 px (the sidebar leaves ~600 px at 900), 4 from 1200 px; panels
  side by side from 1200 px; the period select full width on a phone; checks strip 4 → 2 → 1 columns; tables scroll
  in their own box; the tabs scroll on a phone (PageTabs). Checked at 1280, 900 and 390 px.
- **Accountant:** everything shown, nothing editable (there is nothing to edit); stays are not links.

## 7. Test plan

### Server unit tests (59 tests in 8 new files, all in `server/src/plugins/accounting-export/tests/`)
- [x] `accounting-synthesis-period.unit.test.js` (9) — rules 1, 2, 8, 15: periods, refusals, granularity, buckets.
- [x] `accounting-synthesis-engine.unit.test.js` (10) — rules 4, 5, 6, 10–15, 21: VAT return, checks, payments, shares, series.
- [x] `accounting-synthesis-csv-one-source.unit.test.js` (4) — rules 3, 5, 6: CSV byte-identical (golden file, two plans), rows = ventilation lines, VAT = the CSV's VAT accounts.
- [x] `accounting-synthesis-books.unit.test.js` (9) — rules 1, 4, 5, 7, 8, 9, 10, 13, 16, 17, 18, 20 on the real schema through the plugin's routes: journal equality, `getSummary` equality, tourist-tax extraction equality, dashboard range equality, means from links and channel, stamp, accountant access.
- [x] `accounting-synthesis-payload.unit.test.js` (8) — rules 5, 8, 9, 19, 21 on a model double.
- [x] `accounting-synthesis-last-export.unit.test.js` (3) — rule 16.
- [x] `accounting-synthesis-ui-payload.unit.test.js` (6) — rules 14, 16, 22, 25: periods offered (only accepted ones, an exercise far ahead bounded), main VAT rate, export month in words, share ratio.
- [x] `accounting-synthesis-review-fixes.unit.test.js` (10) — rules 3, 10, 22, 35–40: requalified money is no collection (direct, real schema; platform pair), CSV unchanged by the compensation's origin, same-origin stamp, fy 9999 at once, tax ahead / straddling = monthly extractions, regimes during the window, shared-account label, « Autres », rounding vs gap.
- The books suite also proves the dashboard and the synthesis say the same comparison sentence for the same window (rule 9).

### Client unit tests (Vitest — 35 tests in 10 new files)
- [x] `client/src/__tests__/api.accounting-synthesis.test.js` (1) — the query sent.
- [x] `plugins/accounting-export/__tests__/AccountingPage.synthesis-tabs.test.jsx` (5) — rules 23, 24, 34.
- [x] `plugins/accounting-export/__tests__/AccountingSynthesisTab.kpis.test.jsx` (6) — rules 25, 26, 30.
- [x] `plugins/accounting-export/__tests__/AccountingSynthesisTab.checks.test.jsx` (4) — rules 27, 34.
- [x] `plugins/accounting-export/__tests__/AccountingSynthesisTab.vat-panel.test.jsx` (3) — rules 28, 29, 30.
- [x] `plugins/accounting-export/__tests__/AccountingCollectionsTab.shares.test.jsx` (2) — rules 31, 32.
- [x] `plugins/accounting-export/__tests__/SynthesisPeriodBar.periods.test.jsx` (3) — rules 22, 24.
- [x] `plugins/accounting-export/__tests__/AccountingPage.review-fixes.test.jsx` (3) — rules 41, 43.
- [x] `plugins/accounting-export/__tests__/AccountingSynthesisTab.review-fixes.test.jsx` (4) — rules 38, 39, 44.
- [x] `plugins/accounting-export/__tests__/AccountingCollectionsTab.review-fixes.test.jsx` (4) — rules 37, 42, 44.
- The journal suites (`AccountingPage.regression`, `.platforms`, `.tax-only-entries`, …) are unchanged and green: a
  `month`+`year` link still opens the journal (rule 23).

### Manual UI verification (throwaway seeded DB, ports 47120/47121)
- [x] 1280 px: Synthèse on a quarter (tiles, pills, checks, VAT, cumulative with N-1), Encaissements (share tables, aligned series).
- [x] 900 px: exercise, tiles two per row, checks two per row, « voir » on an unsettled stay.
- [x] 390 px: tiles two per row, period select full width, no page-level horizontal scroll.

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

**Resolved by default (round 2, 2026-11-05):**
- Q: Reuse `PeriodSelector`? — A: it has three kinds (exercise, month, custom) and no quarter; the period bar is
  feature-local, the same look, and reuses its `customWindowError` so the refusals stay one.
- Q: Where is the CSV download? — A: on « Écritures » only: the CSV is one month's journal, chosen there.
- Q: Old links `?month=&year=` (the way back from a fiche)? — A: they open « Écritures », as they did.
- Q: Four tiles per row at 900 px? — A: two: with the sidebar the content is about 600 px wide and the amounts
  overflowed; four from 1200 px.
- Q: Where does each tile state its source (D-HC8)? — A: on its secondary line, under the figure's own line.

## 10. Implementation progress

- 2026-11-05 — round 1: server, API, `api.getAccountingSynthesis`, 43 server tests + 1 client test.
- 2026-11-05 — round 2: the comparison sentence shared with the dashboard, `periodOptions`, `mainRate`, export month,
  share `ratio`; the UI (rules 22–34); 48 server tests, 24 client tests.
- 2026-11-06 — review fixes (R2-1…R2-12, R5-04, R5-06, R6-2, R6-5, R6-11, D-HC10/12/13): rules 35–44; 59 server
  tests, 35 client tests.
