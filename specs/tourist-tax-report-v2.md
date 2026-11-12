# Tourist tax report v2 — any period, exempt persons, platform share, « Par nuit » register, CSV

| Field | Value |
|---|---|
| **Status** | Implemented |
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
   inconnu. », a CSV view « Vue inconnue. ». A query key sent twice is that key's 400 (rule 28, which replaced
   « reads as not sent »). A window starting after the
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
16. **The percentage form's base.** Each row of ours carries the extraction's `nightPricePerOccupantHt` and
    `accommodationAmount` (null on a platform's row), and `columns.percentageBase` says whether a row of ours listed
    is taxed on a percentage of its price — then the page shows « Nuit HT / occupant » and « Montant du séjour HT »,
    as the monthly page did (`tourist-tax-included-services-deduction.md` rule 15); otherwise they are left out.
17. **The page reads the report.** `TouristTaxPage` reads `GET /finance/tourist-tax/report` for the selection on
    screen and opens on the previous month. The period selector offers Mois · Trimestre · Année · Personnalisée, its
    options from `choices`; while a selection loads the pickers keep the options of the last report read. The
    monthly endpoint is no longer read by the page and stays as it is (rule 1). A `?month=YYYY-MM` in the URL (the
    « À vérifier » links, `finance-data-checks.md` rule 16) opens that month when it is a real one not still to come,
    the default month otherwise.
18. **`PeriodSelector` gains a quarter and a year.** Optional `kinds` (which segments, in order), `quarters`,
    `years`, `quarter`, `year`; switching to a quarter or a year hands the option already chosen, else the first
    (the newest). Without `kinds` it renders the exercise selector as before.
19. **A refused selection never dead-ends.** A custom window is judged on the page with the server's own messages
    (`customWindowError`) from the server's day (`useServerToday`), and an invalid one is not sent. A selection the
    server refuses (400) keeps the last report on screen and shows the server's reason; a first read that fails
    offers « Réessayer ».
20. **The sticky totals bar** (`StickyTotalsBar`) replaces the three tiles of the monthly page and shows `totals` as
    given: Séjours (« + N reversés par plateforme »), Personnes, Taxées · exonérées (« mineurs exonérés »), Nuits,
    Nuitées taxées (« N exonérées »), Déjà déclaré (« X reversés par les plateformes »), and the main figure
    « À reverser » with « reste X », or « tout est déclaré » when `allDeclared`. It is a polite live region; on a
    phone it shows Séjours and À reverser and a « Détail des totaux » toggle (`aria-expanded`) for the rest.
    The count and the amount keep the readings of `ui-review-2026-10-19-operations.md` rule 45 (every row of the
    selection, whatever its channel) and `ds-sweep-finance.md` rule 23 (to the cent).
21. **A tick re-reads the report.** « Déclarée » keeps its PATCH, its optimistic box, its added-guests variant and
    its refusal (`tourist-tax-declared-checkbox.md` rule 8); once no tick is on its way the report of the selection
    on screen is read again, without a loading state, so the rows and the bar take the server's figures — never a
    sum made on the page. A read older than a tick, or of a selection left behind, is dropped
    (`platform-added-guests-tourist-tax.md` rules 24, 26).
22. **A platform's stay is muted.** Its row has no box (« — ») and a tag « reversée par <canal> » under the guest's
    name (beside the name on a card), with the tooltip « La plateforme reverse elle-même cette taxe à la commune. »
    On a card the tag sits beside the name when both fit, else wraps under it whole; it is cut only when wider than
    the card (reading of 2026-11-06, review V1-4).
23. **« Par nuit »** shows `nights`: Nuit du (« sam. 04/07/2026 ») · Séjours · Personnes · Taxées · Exonérées ·
    Montant, its empty state « Aucune nuit à déclarer sur cette période. ». The view is local; switching it reads
    nothing.
24. **Export.** « Exporter en CSV » downloads `report.csv` for the selection last read and the view on screen; a
    refusal shows the server's reason.
25. **Filters.** « Logement » (« Tous » + `properties`) and « Déclaration » (Toutes · À déclarer · Déclarées) are
    sent to the server as they are; the page filters nothing itself.
26. **A tax frozen at 0 € is not ours to remit** (D-HC10, 2026-11-06). The report reads the rows of
    `getTouristTaxRows`, which drop such a stay (`tourist-tax-declaration-month-stay-end.md` rule 9): it is in no
    list, register, total or CSV.
27. **No period outside four-digit years** (review R1-01, R1-02, C-1). A month, quarter or year before 1000 is refused
    with its own message (`getMonthBounds` returns nothing for it, nor for 9999-12, so the monthly page refuses them
    too); a month, quarter or year starting after the current month is refused « Les mois futurs… » before any window
    is built (9999 included). Never a 500, never a window of 1 900 years.
28. **A key sent twice is its own 400** (D-HC13, reviews R1-08, R6-6). On both endpoints, a key sent twice answers
    that key's refusal (the controller also refuses a key that is not a plain string, as a defence; over HTTP the
    query parser keeps `key[x]=` as another, unknown key — reading of 2026-11-06, review V1-5): `period` « Période inconnue. », `month`, `quarter`,
    `year` their format messages, `from` / `to` « Deux dates à choisir. », `propertyId` « Logement inconnu. »,
    `declaration` « Statut de déclaration inconnu. », `view` « Vue inconnue. » — never a filter silently widened.
29. **The pickers always hold what is shown** (review R1-07). `choices.months` runs from the earlier of the first
    stay's month and `defaultMonth`, so the month the page opens on is offered even with no stay; the month, quarter
    or year being read is added to its list when older than the first stay (rule 15 otherwise unchanged).
30. **The CSV says what the page says** (reviews R1-09, R1-10, R1-12, R6-8). The file is named after the last day it
    covers (`coveredTo`); « Déclarée le » is the server's day of the tick (the stamp is UTC; each row carries
    `touristTaxDeclaredOn`, which the page's tooltip reads too); the added guests' row reads « · Complément de taxe de
    séjour » as on the page; « Montant » holds only what we remit, a platform's amount sits in « Reversé par la
    plateforme », so each column adds up to its total line.
31. **The selection lives in the URL** (reviews R5-10, R4-6). `period`, `month` / `quarter` / `year` / `from` +
    `to`, `propertyId`, `declaration` and `view=night` are written to the page's URL (replace, not push) and read
    from it on opening; what is not a period kind, a whole logement id, a status or `night` is ignored, the rest is
    judged by the server (a refusal falls back, rule 32). A fiche opens with the page's whole URL as its way back.
    The « À vérifier » month links carry the logement they were counted on.
32. **The opening month is the server's, and a first refusal is no dead end** (reviews R1-03, R1-04, R4-7, R6-4).
    A month selection waits for the server's day (`useServerToday`) before its first read: the month opened is the
    linked one when it is real and not to come for the server, else the month before the server's. A first read
    refused (400) shows the server's reason and opens that default month with its pickers; a failure that is not a
    refusal keeps « Réessayer ».
33. **A tick under a refusal reads what is on screen** (review R1-05). While a refused selection's reason is shown,
    the tick's optimistic patch and its re-read follow the selection last read, so the bar takes the server's figures.
34. **The register says when a night lies outside the window** (review R5 note). Each night carries `outsideWindow`
    (before the window's first day or after its last covered day: a stay attributed by its last night brings its
    earlier nights with it), `columns.nightsOutsideWindow` says whether any does; the page marks those nights « * »,
    greyed, with one note « * Nuit hors période d'un séjour rattaché à la période par sa dernière nuit. ». Nights at
    0,00 € with taxed persons came from stays whose tax is frozen at 0 €: rule 26 removes them.
35. **`direct` in any case, and an empty platform, are ours** (review R1 C-4). The « we remit » predicate reads
    `lower(COALESCE(NULLIF(TRIM(platform), ''), 'direct')) = 'direct'`, as the app treats an empty platform as direct
    (migration platform-empty-to-direct): such a stay is never « reversée par Direct » nor in neither list.
36. **The CSV refusals read as everywhere else** (review R1-06). `downloadTouristTaxReportCsv` answers a 401 with
    « Session expirée. » and the app's return to the login, a code-only refusal with its `message` or « Téléchargement
    impossible. », and keeps the server's French reason of a 400.

37. **The list CSV adds up per filter** (review V1-1). The platforms' total of the « Reversé par la plateforme »
    column is written only when the file lists their rows (« Toutes »); under « À déclarer » or « Déclarées » it is
    empty, so every column of the file adds up over its rows. The bar keeps its own figure (rule 11).
38. **A platform's stay frozen at 0 € is shown as the platform's** (D-HC15, 2026-11-06). A stay that rule 26 keeps
    out of ours (tax frozen at 0 €) and whose channel is a platform (not direct, read from the channel, never its
    name) is listed for information with `remittedBy: 'platform'`, the amount the platform stated
    (`platformTouristTaxAmount`, 0 when none), no tick, and counted in `platformRemittedStaysCount` / `Amount` —
    never in what we declare. *Superseded in part by rules 42 and 43*: such a stay is attached at its last night and
    listed only when its platform's mode collects the tax; `frozenAtZero` no longer exists.
39. **One size, one line** (D-HC17, 2026-11-06). In `StickyTotalsBar` every figure has the same size (`main` by colour
    only), with tabular figures; each label sits in a block two lines high aligned to its bottom, so the figures share
    one baseline whatever their labels; captions sit under the figures. When the bar is narrower than its figures need
    on one line (a phone, a tablet beside the drawer) it folds to its `compact` figures and « Détail des totaux »,
    the unfolded detail at the same size. Supersedes the « main figure » emphasis by size of rule 20. *The fold off a
    phone is superseded by rule 47.*
40. **The URL holds what is on screen** (review V1-3). While a refused selection's reason is shown, the page's URL holds
    the selection last read, so a fiche opened then, a reload or a shared link comes back to it.
41. **The common baseline, in pixels.** At 1280, 900 and 390 px the figures of the bar and of its unfolded detail sit
    on one line.
    > **Sans test** — a pixel position jsdom cannot measure; rule 39's test pins its means (same size, label blocks of
    > one height aligned to the bottom, no wrap), the baseline itself is checked by eye at the three widths.

42. **A platform's stay frozen at 0 € is attached at its last night** (review V2-1). Like every platform row (rule 6),
    it is read by the day of its last night in the window, never by the day we were paid; the report reads it with
    its own query (`frozenAtZeroPlatformRows`), not through `getTouristTaxRows`.
43. **Only when the platform's mode collects the tax** (D-HC18, 2026-11-06). Rule 38's list keeps a stay only when its
    platform's mode says the platform collects the tax from the guest (`collectsTouristTax = 1`, read from the mode,
    never the name). A stay frozen at 0 € on a platform that does not collect (« we collect at arrival »), on a
    property without tax, or direct, stays hidden.
44. **Every count column of the list CSV adds up** (review V2-6). A platform's row leaves its counts empty (nights,
    persons, taxed, exempt, person-nights: told for information) and a row of added guests leaves its « Nuits »
    empty (same stay, same nights), so under any filter each column adds up to the total line, which counts ours.
45. **A long label never breaks the baseline** (review V2-3). In `StickyTotalsBar` each label is clamped to two lines
    with an ellipsis, its full text in its `title`, inside a block of exactly two lines.
46. **Long windows read in chunks** (review V2-8). The stays of a window are read by id in chunks of 500, in
    `getTouristTaxRows` and in the report, as `withTouristTaxInTotal` does: SQLite caps the parameters of one statement.
47. **On a tablet, every figure shows, in rows** (D-HC19, 2026-11-06). From `sm` up the bar never folds: when the
    figures do not fit on one line they wrap onto two or more rows, each row on one baseline, every figure the same
    size (rule 39), each keeping at least its own content's width so none overlaps another (review V2-4). « Détail des
    totaux » is for the phone (`xs`) only.
48. **The table never scrolls inside its card** (review V2-5). `ResponsiveTable` with `cardsWhenOverflow` measures
    the table: wider than its container, the cards take over, at any container width (the fixed 860 / 700 thresholds
    stay as a floor).
49. **A platform's tag shows whole in the table** (review V2-7). The tag under the guest's name is not capped; it
    wraps inside its chip when the cell is narrower than its text.

50. **A tax we collected at arrival is never the platform's** (D-HC21, 2026-11-06). Rule 43's list leaves out a stay
    whose tax rides the complement — the fiche's own « Taxe de séjour en complément », or a platform whose mode is
    « we collect at arrival » — read by the tax page's at-arrival predicate (`TAX_ON_ARRIVAL_SQL`), one reading. Such
    a stay frozen at 0 € stays hidden, like a direct one, whatever the platform's mode.
51. **A channel reads as its platform's name** (review V3R-4). A stay stored with an iCal key (`booking`) is labelled
    with the platform's label the `ical_sources` bridge gives (`Booking`), then `platformDisplayName`, on every row.
52. **The stay's nights are counted once, on its first listed row** (review V3R-1). In the list CSV a row of added
    guests leaves « Nuits » empty only when its stay's main row is listed in the same file; listed alone (« À
    déclarer » after the main row was ticked), it carries the stay's nights, as `reportTotals` counts them. So every
    count column adds up to the total line under every filter (rules 37, 44).
53. **A reload keeps the cards and the focus** (review V3R-2). `ResponsiveTable` keeps its last measure of the table
    across new rows and measures afresh only when the column set changes (`minWidth`): in the overflow band a tick
    neither flips to the table for one pass nor remounts the cards, so keyboard focus stays on the box.
54. **The main figure keeps its divider beside it** (review V3R-3). In a row, `main` keeps its own width at the right
    end of its row, so when it wraps alone onto a row its divider stays next to its figure, not at the bar's left edge.
55. **The divider's place, in pixels** (review V3R-3).
    > **Sans test** — a pixel position jsdom cannot measure; rule 54's test pins its means (own width, pushed to the
    > row's end), the place is checked by eye at 1100 and 1280 px.

**Edge cases:**
- No stay in the selection → `stays: []`, `nights: []`, every total 0, `allDeclared: false`.
- A stay ticked on its main row with an added guests' row still to declare → « todo » lists the own row alone; the
  stay and its nights still count once (rule 11).
- A stay whose tax was fully refunded leaves the extraction (rule 31 of `reservation-refunds.md`), hence the report.
- A platform stay with an ad-hoc platform that has no `platforms` row → « the platform remits » (the three-way
  spec's default), so it is counted apart.
- A cancelled stay (`kind ≠ 'reservation'`) is in neither list.
56. **The tax is declared per logement: the report carries each logement's totals** (2026-11-12, manual trial of 4.0.0;
    approved mock: [`tourist-tax-by-property-maquette.html`](tourist-tax-by-property-maquette.html), its names fictitious).
    The payload gains `byProperty`: one entry per logement of the selection (ours and the platforms' stays), in logement
    order, each `{ propertyId, propertyName, …reportTotals }` — the very totals of rule 11 computed over that logement's rows
    (`amount`, `declaredAmount`, `remainingAmount`, `allDeclared`, `toDeclareRowsCount`, `staysCount`, `nights`, `persons`,
    `taxedPersons`, `exemptPersons`, `taxedPersonNights`, `exemptPersonNights`, `platformRemittedStaysCount`,
    `platformRemittedAmount`), so the cards and the bar can never disagree and the client sums nothing
    (`propertyTotals`, `utils/touristTaxReport.js`). The declaration filter and the « Logement » filter apply first.
57. **« Marquer {logement} déclaré » is ONE server call.** `POST /api/finance/tourist-tax/property/:propertyId/declared`
    with the window of the selection as query (`period`, `month` | `quarter` | `year` | `from` + `to`): the server reads the
    report of that logement still « à déclarer » and ticks, in one transaction, every row of ours that is `declarable` — each
    through the single tick of [tourist-tax-declared-checkbox.md](tourist-tax-declared-checkbox.md) (rules 8-10, the added
    guests' row with `addedGuests`), so the same refusals apply. A platform-remitted stay is never ticked; a row not
    declarable yet is skipped. Answers `{ ok, declaredCount, skippedCount }`; a refusal rolls everything back (400 « Logement
    inconnu. » for an unknown or missing logement, the report's own refusals for a bad window). Repeated: `declaredCount: 0`.
    Test: `tests/tourist-tax-by-property.unit.test.js`.
58. **« Liste » is a section per logement** (`TouristTaxPage`, `TouristTaxPropertyCard`). For each logement of `byProperty`:
    the card (coloured left edge, the total to declare in large type, « reste … à déclarer » or « ✓ tout est déclaré », a
    declared / remaining bar, tiles « nuitées taxées », « pers. taxées », « déjà déclaré », a note « N séjour(s) reversé(s) par
    la plateforme (… €) » for the stays the platform remits, the buttons « Marquer {logement} déclaré » — off when nothing
    declarable is left — and « Exporter {logement} », the existing CSV filtered by `propertyId`), then directly below it that
    logement's OWN table of stays (never one grouped table), ending with a « Total {logement} » row read from its `byProperty`
    entry. A platform-remitted stay stays listed, greyed, with no tick, and counts for nothing. The « Logement » filter keeps
    working: one section is shown. « Par nuit » keeps its register.
    **Mobile:** the sections stack; below `lg` (1200 px, the table not fitting next to the drawer) each table becomes a list of rows (tick, name, « dates · plateforme · nuits ·
    nuitées taxées », the amount on one line) ending with the « Total {logement} » line; the buttons stack full width; every
    target is ≥ 44 px; no sideways scroll.
59. **The bottom banner is redesigned** (`TouristTaxDock`, replacing `StickyTotalsBar` on this page): « À reverser · {période} »
    in large type = what remains (`remainingAmount`) with « sur … au total » (or « tout est déclaré »), « Déjà déclaré »,
    « Reversé par les plateformes » with its stays count, and the secondary counts (séjours, personnes, taxées · exonérées,
    nuitées taxées) as compact pills; sticky, translucent and frosted (solid under `prefers-reduced-transparency`); nothing
    animates in it, and the card's bar transition stops under `prefers-reduced-motion`. It reads `totals` as given.
    Tests: `TouristTaxPage.by-property.test.jsx`, `TouristTaxPage.totals-bar.test.jsx`.

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

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T | `getTouristTaxReport(params)`, `downloadTouristTaxReportCsv(params, view)` (saves the server-named file, throws the server's French refusal). `getTouristTaxExtraction` and `setTouristTaxDeclared` unchanged. |
| `pages/` | `TouristTaxPage.jsx` | T | Rules 17-25: reads the report; pickers fed by `choices` / `properties`; list or « Par nuit » table; the « Déclarée » tick, re-reading the report after it; export. Renders `totals` as given. |
| `components/` | `StickyTotalsBar.jsx` | C | Rule 20: generic translucent sticky bar of labelled figures, two figures and a toggle on a phone. Distinct from `StickyTotalBar` (one figure + a sheet). |
| `components/` | `PeriodSelector.jsx` | T | Rule 18: optional quarter and year kinds; default render unchanged. |
| `constants/` | `touristTaxReport.js` | C | The page's French strings. |
| `hooks/` | `useServerToday.js` | — | Consumed: the custom window's hints judged from the server's day (rule 19). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `PeriodSelector`, `SegmentedSelect`, `ResponsiveTable`, `ErrorAlert`, `LoadingState`, lot-0 `Panel`, `DialogProvider` toasts | Pre-existing or from lot 0. |
| **Created (new generic)** | `StickyTotalsBar` | Several labelled totals pinned at the bottom: the tax page, the accounting synthesis, the payment register. |
| **Specific (kept feature-local)** | — | The tables are compositions of `ResponsiveTable`. |

### 4.3 API contract

> **2026-11-12 (rules 56-59):** the report adds `byProperty`; `POST /api/finance/tourist-tax/property/:propertyId/declared?<window>` ticks one logement's declarable rows (rule 57). `GET .../report.csv` with `propertyId` is « Exporter {logement} ».

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

Target: the `#taxe` mock-up of the design reference, in MUI + the « Maison » theme.

- **`PageActionBar`**: title « Taxe de séjour »; `center` = the « Liste » / « Par nuit » segmented toggle (`md+`;
  below `md` the toggle sits full width under the pickers, so the bar passes `centerFrom="md"` and the toggle is drawn
  once at every width — audit R27-C1, 2026-11-06: between 600 and 899 px it was drawn twice); `actionsBefore` =
  « Exporter en CSV » (download icon, `info`).
- **Pickers** (wrapping row): Mois · Trimestre · Année · Personnalisée (`PeriodSelector`), then the month / quarter /
  year select or Du / Au (opening on the window shown); Logement; Déclaration. A custom window refused here shows
  the message beside the dates and nothing is read; a selection refused by the server shows its reason in a
  warning band and the last report stays. `window.futureExcluded` adds « Les mois à venir ne sont pas comptés. ».
- **Panel** « Séjours · <window label> » / « Registre par nuit · <window label> », with the D-HC8 source caption
  « Sur les montants des séjours, rattachés au mois de leur dernière nuit. » under its label.
- **List** (`md+`, a table while its container is wider than the table, else cards): Déclarée · Séjour (guest, then
  « JJ/MM/AAAA au JJ/MM/AAAA », then « logement · canal », the notes: not declarable yet, gap without a guest,
  refunded nights) · Nuits · PERSONNES (Total · Taxées · Exonérées) · NUITÉES (Taxées · Exonérées) · [Nuit HT /
  occupant · Montant du séjour HT, rule 16] · Montant. A platform's row is greyed, « — » for the box, its tag under
  the name. A row of added guests reads « · Complément de taxe de séjour ». Row click opens the fiche; the box
  never navigates.
- **Cards** (phone, tablet beside the drawer): name and box (or tag), « logement · canal », dates · nights · taxed ·
  exempt, the base when there is one, Montant.
- **Par nuit**: Nuit du (« sam. 04/07/2026 ») · Séjours · Personnes · Taxées · Exonérées · Montant; cards on a phone.
- **Sticky totals bar**: translucent (`backdrop-filter`, solid under `prefers-reduced-transparency`), pinned at the
  bottom, the main figure « À reverser » right-aligned in sapin with « reste X » / « tout est déclaré » under it; on
  `xs` Séjours and À reverser, « Détail des totaux » unfolds the rest above them. No motion of its own.
- Empty: « Aucun séjour sur cette période. » / « Aucune nuit à déclarer sur cette période. ».
- Loading: « Chargement de l'extraction… »; failure: « Impossible de charger l'extraction. » + Réessayer.

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

- [x] `tests/tourist-tax-report-base-columns.unit.test.js` (2) — rule 16.
- [x] `tests/tourist-tax-review-fixes-4.unit.test.js` (3, 2026-11-06, round 4) — rules 50, 51, 52.
- [x] `tests/tourist-tax-review-fixes-3.unit.test.js` (3, 2026-11-06, round 3) — rules 42, 43, 46; `tourist-tax-report-csv` (+1) — rule 44.
- [x] `tests/tourist-tax-review-fixes-2.unit.test.js` (4, 2026-11-06, round 2) — rules 37, 38 (+ declared-checkbox rules 9, 10).
- [x] `tests/tourist-tax-review-fixes.unit.test.js` (6, 2026-11-06) — rules 26-29, 34, 35 (+ declaration-month-stay-end rule 9, declared-checkbox rule 9).
- [x] `tests/tourist-tax-report-csv.unit.test.js` (+3) — rule 30; `tourist-tax-period-choices.unit.test.js` (+1) — rule 29.
- Server suites of this spec: 54 tests in 10 files.

### Client unit tests (Vitest)
- [x] `src/__tests__/api.tourist-tax-report.test.js` (3) — §4.3: query string, CSV file name and view, refusal.
- [x] `pages/__tests__/TouristTaxPage.period.test.jsx` (7) — rules 17, 19, 25.
- [x] `pages/__tests__/TouristTaxPage.totals-bar.test.jsx` (4) — rules 20, 21.
- [x] `pages/__tests__/TouristTaxPage.platform-rows.test.jsx` (2) — rule 22.
- [x] `pages/__tests__/TouristTaxPage.night-register.test.jsx` (2) — rule 23.
- [x] `pages/__tests__/TouristTaxPage.export.test.jsx` (2) — rule 24.
- [x] `pages/__tests__/TouristTaxPage.month-link.test.jsx` (4) — rule 17's `?month=` (lot 5's suite, moved onto the report).
- [x] `pages/__tests__/TouristTaxPage.server-today.test.jsx` (4) — rule 32.
- [x] `pages/__tests__/TouristTaxPage.refused-load.test.jsx` (2) — rule 32.
- [x] `pages/__tests__/TouristTaxPage.tick-after-refusal.test.jsx` (1) — rule 33.
- [x] `pages/__tests__/TouristTaxPage.url-state.test.jsx` (5) — rules 31, 40.
- [x] `pages/__tests__/TouristTaxPage.view-switch-once.test.jsx` (1) — §6 `PageActionBar` (audit R27-C1): `centerFrom="md"`.
- [x] `components/__tests__/StickyTotalsBar.test.jsx` (6) — rules 20, 39, 45, 47, 54.
- [x] `components/__tests__/ResponsiveTable.overflow.test.jsx` (5) — rules 48, 53; `TouristTaxPage.review-fixes` (+1) — rule 49.
- [x] `pages/__tests__/TouristTaxPage.review-fixes.test.jsx` (4) — rules 22, 30, 34.
- [x] `src/__tests__/api.tourist-tax-report.test.js` (+2) — rule 36; `components/__tests__/FinanceDataChecksCard.load-and-links.test.jsx` (+1) — rule 31's link.
- [x] `components/__tests__/StickyTotalsBar.test.jsx` (2) — rule 20.
- [x] `components/__tests__/PeriodSelector.quarter-year.test.jsx` (4) — rule 18.
- [x] The existing page suites, moved onto the report payload (shared fixture `pages/__tests__/touristTaxReportFixtures.jsx`),
      every assertion kept: `TouristTaxPage.test.jsx` (5), `.added-guests` (10), `.declarable` (6); the tile suites
      `.declared-total-cents` (1) and `.kpi-label` (1) now read the bar's « À reverser » and « Séjours » (rule 20).

### Manual UI verification (2026-11-05, throwaway seeded DB, ports 47110/47111)
- [x] 1280 px: month, quarter T3 with 9 stays (2 platform rows greyed and tagged), the base columns on a percentage
      logement, the tick of a row moving « Déjà déclaré » and « reste » from the server, « Par nuit », a reversed
      custom window refused beside the dates while the table keeps the last result. No console warning.
- [x] 900 px: cards beside the drawer, the bar on two rows. 390 px: cards, the bar folded to two figures and
      unfolded, no horizontal scroll. CSV of the register downloaded with its total line (212,16).

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
