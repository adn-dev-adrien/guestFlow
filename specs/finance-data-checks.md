# « À vérifier » — data checks of the Suivi financier

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hc-l5` (integrated into `feature/finance-reporting-hippocamp`) |
| **Created** | 2026-11-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The benchmark of HIPPOCAMP (`docs/rapports/2026-11-05-benchmark-hippocamp.html`, section « Contrôles »,
approved by Adrien on 2026-11-05) found one idea worth taking from its « Faire le point » screen: a list of
data checks counted over the exercise, each leading to the records concerned. GuestFlow already surfaces many
defects, each in its own place, and this panel must not repeat any of them:

| Already shown elsewhere | Where |
|---|---|
| Late acompte / solde / installment / platform payout | « En retard » tile of the Suivi financier (`financeModel.overdueOf`), « Échéances de paiement » card |
| Receipts in a gap with their fiche, unclaimed credits | « Écarts de règlement » (online-payment reconciliation) |
| Upcoming Booking stays never filled | « À compléter » (booking-intake plugin, stays not started yet) |
| Nights priced on the fallback tariff | « unpriced » chips of the Suivi financier |
| Dates taken, iCal drift / cancellation, repaired numbers, e-mails to check | home cards (`routes/dashboard.js`) |

What nothing shows today: a finished stay whose tourist tax is missing, a past month whose tax is not
ticked « Déclarée », a finished platform stay whose « Paiement plateforme » was never filled, and a finished
stay still held by the client the iCal import made up. Those are the four checks of this spec.

The mock-up's « Séjours terminés sans solde encaissé » is the « En retard » tile and is left out. Its
« Clients sans pays » cannot exist: the client record has no country field (only a free address).

## 2. Goal

At the bottom of the Suivi financier, the operator sees which records of the exercise need a correction or a
look, how many, and opens each one from the list.

## 3. Functional rules

1. **Scope.** The checks read the exercise of the request (`fiscalYear`, the dashboard's own reading: an
   unparseable value falls back to the current exercise, `utils/fiscalYear.resolve`) and optionally one
   logement (`propertyId`; unknown or malformed → 400 « Logement inconnu. », the dashboard's refusal). The
   month / custom window of the page is NOT applied: a defect does not disappear because the operator zooms
   on a month, and the panel answers « what is wrong in this exercise ».
2. **Catalogue.** The payload always holds the four checks, each `{ key, severity, label, hint, count,
   moreCount, items }`, labels and hints in French, written once in `utils/financeDataChecks.js`:
   `tourist-tax-missing` (fix), `tourist-tax-undeclared` (fix), `platform-payment-missing` (check),
   `guest-name-missing` (check). A check with nothing to report is sent with `count: 0` and no items.
3. **Order and severity.** `fix` (« à corriger ») before `check` (« à vérifier ») before `info`
   (« information », reserved, no check uses it yet), then the catalogue order. `pendingCount` = the number of
   checks with `count > 0`.
4. **Cap.** A check lists its first 20 items (`ITEM_LIMIT`) in chronological order; `count` is the whole
   number and `moreCount = count − items.length`, both computed on the server.
5. **The stays a stay check reads** (rules 6, 8, 9): `kind = 'reservation'` (devis and set-aside duplicates are
   out), not cancelled (`cancelledAt IS NULL`), over — today (server's local day) > `endDate`, the tourist
   tax's own « terminé » (D16) — and whose last night (`endDate − 1`) lies in the exercise, in the logement
   asked. Each item is `{ reservationId, label, detail }`, the label « n° · voyageur · logement · du → au »
   (the guest left out when the client is a placeholder, the year shown only when it is not the current one).
6. **`tourist-tax-missing` — « Séjours terminés sans taxe de séjour alors qu’elle est à reverser ».** A stay of
   rule 5 whose stored `touristTaxTotal` is 0 while (a) WE remit its tax — `pricing.isTouristTaxRemittedByOwner`,
   the very function that routes the « Taxe de séjour » page and the 46710000 line (direct, a platform that
   reverses it to us, or one where we collect at arrival; a platform that remits it itself is out), and (b) the
   engine, asked for the tax « Recalculer » would give (`quoteStoredReservation` with the freeze lifted), finds
   one above 0. The detail gives that amount (« Taxe calculée : 4,80 € »). A logement whose commune levies no
   tax (rate 0) gives 0 and is never listed; added guests are part of the amount the engine gives.
7. **`tourist-tax-undeclared` — « Mois passés dont la taxe n’est pas entièrement déclarée ».** For each month of
   the exercise strictly before the current month, the rows of `financeModel.getTouristTaxExtraction` (the
   « Suivi taxe de séjour » page itself: same stays, same attribution month, same amounts, added-guests rows
   included) that are `declarable`, not ticked and carry a tax above 0 € (a 0 € row leaves nothing to remit; a
   finished stay at 0 € that should carry a tax is rule 6's); the month is listed when any is. Item `{ month, label,
   detail, amount, stays }`: « Septembre 2026 », « Reste 18,15 € à déclarer · 2 séjours », `amount` = the sum of
   those rows' `taxAmount` (the page's own figure, proved equal by a test). A row not declarable (unpaid, D16)
   is the « En retard » tile's business and is not counted. Months before the last night of the earliest stay
   ever ticked are not judged: the tick exists since 2026-07-01 and earlier months were declared without it.
8. **`platform-payment-missing` — « Séjours plateforme terminés sans « Paiement plateforme » ».** A stay of rule 5
   that is a platform stay by the dashboard's reading (`financeDashboardModel.isPlatformStay`: not a website
   request, not a direct channel by `isDirectChannel`) and whose « Montant total payé par le client »
   (`platformGrossAmount`) is empty. That figure is the one that pins the total of a platform stay
   (platform-payment-entry rule 1); without it the books carry our tariff, not what the guest paid. The commission
   and the « Virement reçu » are not judged: the commission may legitimately be 0 or derived, the transfer is an
   optional control (platform-payment-entry rule 5) whose gaps the reconciliation already shows. No overlap with
   booking-intake's « À compléter », which lists stays not started yet.
9. **`guest-name-missing` — « Séjours terminés sans nom de voyageur ».** A stay of rule 5 whose client is an iCal
   placeholder by `utils/placeholderClient.isPlaceholderClient` (« Ical … », or the platform's own words such as
   « Reserved »). The accounting export names the client account and the entry after the last name
   (`C`+NAME), so such a stay is booked under a made-up name. Detail « Client : Ical Booking ».
10. **API.** `GET /api/finance/data-checks?fiscalYear=&propertyId=` answers the payload of §4.3; read-only,
    nothing is written; the client reads it through `api.getFinanceDataChecks({ fiscalYear, propertyId })`, empty
    values left out of the query string.
11. **Invariant — a price lever never discounts the tourist tax itself** (from the HIPPOCAMP study, where a
    −10 % promotion lowered a stay's tax). Per adult and night, the tax reads only the rate, the adults and the
    nights: a discount, an adjusted price, an offered line, an offered extra-guest supplement or a pinned
    platform brut leave it whole. As a percentage of the accommodation, a lever reaches it only through its
    legal base, the accommodation charged (tourist-tax-matches-the-office-calculation rules 2-3), never as a
    reduction of the tax line: the tax is the commune's percentage of that base and the stay total adds it
    whole. No « taxe de séjour remisée » check is needed: it cannot happen by construction.
12. **The panel.** « À vérifier » is a `Panel` at the bottom of the Suivi financier, under the booking pace, with
    one muted line « Exercice <label> » (the exercise the server read). It draws one row per check whose
    `count` is above 0, in the server's order; a check at 0 is not drawn.
13. **A row.** The row reads the count (tabular figures), the label and the severity in words — « à corriger »
    (fix, error tone), « à vérifier » (check, honey tone), « information » (info, neutral) — never colour alone.
    Its « i » opens the check's `hint` (`DefinitionButton`).
14. **Its items.** The row is a disclosure button (`aria-expanded`, `aria-controls`), closed on load; open, it
    lists the items: the label as a link when the item has a target, its detail below in secondary text, then
    « + N autres » (« + 1 autre ») when `moreCount > 0`. The client never counts: N is the server's `moreCount`.
    Under `prefers-reduced-motion: reduce` the opening is instant.
15. **Nothing to check.** When every count is 0 the panel stays, with the one line « Rien à vérifier sur
    l’exercice. » — the operator sees that the checks ran, not a section that vanished.
16. **Reads and links.** The panel reads `getFinanceDataChecks({ fiscalYear, propertyId })` with the exercise the
    dashboard answered (`fiscalYear.key`) and the logement of the URL, again on every change of either and on
    the page's « Actualiser »; an answer for a scope left behind is dropped (`useLatestRequest`). A stay opens
    its fiche `withFrom('/reservations/<id>', <this page with its query>)`; a month opens the tourist-tax page on
    that month (`/finance/tourist-tax?month=YYYY-MM`, same `from`), which opens that month when it is a real one
    not to come and its default month otherwise.
17. **Never a dead end.** The panel appears only under a loaded dashboard, so the page's own refusals keep their
    period selector (finance-dashboard-redesign rule 51). A refusal of the checks stays inside the panel — the
    server's reason, or « Impossible de charger les contrôles. », with « Réessayer » — and the rest of the page
    is untouched. While loading, the panel shows its spinner « Chargement des contrôles… ».

**Edge cases:**
- A cancelled stay → in no stay check (no tax owed, the cancellation has its own books).
- The departure day itself → not finished yet; listed from the next day.
- An exercise in the future → every check is empty.
- An operator who never ticked « Déclarée » → rule 7 is empty (nothing to start from).
- A stay with both a placeholder client and no brut → listed by rules 8 and 9: two different defects.

---

## 4. Architecture

> **Fat backend.** Which stays and months are listed, the counts, the cap, the order, every label and amount
> are computed on the server. The client renders the list and links each item.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `finance.js` | T | `GET /data-checks` → the new controller. |
| `controllers/` | `financeDataChecksController.js` | C | Thin: query → model → 200 or the model's 400. |
| `models/` | `financeDataChecksModel.js` | C | Resolves the exercise and logement; reads the finished stays of rule 5; runs the four checks through the rules that define them (`quoteStoredReservation`, `isTouristTaxRemittedByOwner`, `getTouristTaxExtraction`, `isPlatformStay`, `isPlaceholderClient`). |
| `utils/` | `financeDataChecks.js` | C | Pure: the catalogue (key, severity, label, hint), the cap, the order, the item labels and details. |
| `models/` | `financeModel.js`, `financeDashboardModel.js` | — | Read only, unchanged. |
| `database.js` | — | — | No schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `api.js` | `api.js` | T | `getFinanceDataChecks(params)`. |
| `components/` | `DataChecksPanel.jsx` | C | Generic « À vérifier » list (rules 12-15): one disclosure row per non-empty check, severity words, « i » hint, items as links, « + N autres », the empty line. Renders only. |
| `components/` | `FinanceDataChecksCard.jsx` | C | Feature-local loader (rules 16-17): reads the endpoint for the page's exercise and logement, builds the two link targets, keeps a refusal inside the panel. |
| `pages/` | `FinancePage.jsx` | T | One mount point under the booking pace: `<FinanceDataChecksCard fiscalYear propertyId refreshKey />`. |
| `pages/` | `TouristTaxPage.jsx` | T | Opens the month named by `?month=YYYY-MM` when real and not to come (rule 16). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Panel`, `DefinitionButton`, `softChipSx` (StatusBadge), `LoadingState`, `ErrorAlert`, `useLatestRequest`, `withFrom` | Lot 0's report grammar and the shared states. |
| **Created (new generic)** | `DataChecksPanel` | Any « faire le point » view (a future home card, a plugin's checks) renders the same payload shape. |
| **Specific (kept feature-local)** | `FinanceDataChecksCard` | It knows the finance endpoint and the two finance link targets, like `BookingPaceCard`. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/finance/data-checks` | `?fiscalYear=<end year>&propertyId=<id>` (both optional) | `200` payload below; `400 { error: 'Logement inconnu.' }` | Admin (the `/api/finance` gating). Read-only. |

```json
{
  "exercise": { "key": 2026, "label": "2026", "from": "2026-01-01", "to": "2026-12-31" },
  "propertyId": null,
  "asOf": "2026-11-05",
  "pendingCount": 3,
  "checks": [
    {
      "key": "tourist-tax-missing", "severity": "fix",
      "label": "Séjours terminés sans taxe de séjour alors qu’elle est à reverser",
      "hint": "La fiche porte 0 € de taxe, mais le calcul du logement en donne une.",
      "count": 1, "moreCount": 0,
      "items": [{ "reservationId": 412, "label": "202609011 · Marie Martin · Granja · 26/09 → 28/09", "detail": "Taxe calculée : 4,80 €" }]
    },
    {
      "key": "tourist-tax-undeclared", "severity": "fix",
      "label": "Mois passés dont la taxe n’est pas entièrement déclarée",
      "hint": "Des séjours déclarables du mois ne sont pas cochés « Déclarée ».",
      "count": 1, "moreCount": 0,
      "items": [{ "month": "2026-09", "label": "Septembre 2026", "detail": "Reste 18,15 € à déclarer · 2 séjours", "amount": 18.15, "stays": 2 }]
    },
    {
      "key": "platform-payment-missing", "severity": "check",
      "label": "Séjours plateforme terminés sans « Paiement plateforme »",
      "hint": "Le montant payé par le client n’est pas saisi : le total vient du tarif.",
      "count": 0, "moreCount": 0, "items": []
    },
    {
      "key": "guest-name-missing", "severity": "check",
      "label": "Séjours terminés sans nom de voyageur",
      "hint": "Le client est resté celui créé par l’import du calendrier.",
      "count": 23, "moreCount": 3,
      "items": [{ "reservationId": 377, "label": "202608013 · Granja · 10/08 → 12/08", "detail": "Client : Ical Booking" }]
    }
  ]
}
```

A stay item links to `/reservations/<reservationId>`; a month item to the « Suivi taxe de séjour » page on that
month.

---

## 5. Data model

None. No column, no table, nothing stored (dismissals are out of scope, §8).

## 6. UI / UX

The design reference (`#controles`), in MUI and the « Maison » theme: a white `Panel` « À VÉRIFIER » at the
bottom of the Suivi financier, the caption « Exercice 2026 », then one bordered row per non-empty check — count
in bold tabular figures, label, severity chip (soft error « à corriger », soft honey « à vérifier », neutral
« information »), a chevron and the « i ». Open, the row lists its items: label in sapin as a link, detail
under it in secondary text, « + 3 autres » last. Nothing to check: « Rien à vérifier sur l’exercice. ».
The panel has no action of its own in the `PageActionBar`; the page's « Actualiser » reloads it.

- **Desktop (1280):** count · label · chip · chevron on one line, the « i » at the right edge.
- **Tablet (~900):** the same; long labels wrap.
- **Mobile (390):** the label wraps beside the count, the chip and chevron drop under it; rows 48 px tall at
  least; on touch the item links get extra vertical padding; no horizontal scroll (checked).
- Loading: the panel's spinner; a refusal: `ErrorAlert` inside the panel with « Réessayer ».

## 7. Test plan

### Server unit tests
- [x] `tests/finance-data-checks.unit.test.js` (16) — rules 1, 2, 4, 5, 6, 7, 8, 9, 10: positive / negative /
      edge per check, platform modes (reversed, owner, remitted), rate 0, added guests, cancelled, departure day,
      other logement, other exercise, website request, placeholder label, page-equal amount, unpaid not declarable,
      a 0 € undeclared row, months before the first tick, cap, read-only route.
- [x] `tests/finance-data-checks-shape.unit.test.js` (4) — rules 2, 3, 4: cap, unknown key, order and
      `pendingCount`, labels and details.
- [x] `tests/tourist-tax-never-discounted.unit.test.js` (4) — rule 11.

### Client (vitest)
- [x] `src/__tests__/api.finance-data-checks.test.js` (1) — rule 10.
- [x] `components/__tests__/DataChecksPanel.render.test.jsx` (7) — rules 12, 13, 14, 15.
- [x] `components/__tests__/FinanceDataChecksCard.load-and-links.test.jsx` (6) — rules 15, 16, 17.
- [x] `pages/__tests__/FinancePage.data-checks.test.jsx` (2) — rules 16, 17.
- [x] `pages/__tests__/TouristTaxPage.month-link.test.jsx` (4) — rule 16.

### Manual UI verification (throwaway seeded DB, ports 47150/47151)
- [x] 1280 px and 390 px: four rows in order, chips in words, rows open on their items, « + 4 autres », the
      « i » definition; no page-level horizontal scroll; console clean.
- [x] A month item opens « Extraction taxe de séjour » on that month; a stay item points to its fiche with
      `from=/finance`.
- [x] Regression: the dashboard above the panel unchanged.

## 8. Out of scope

- Dismissing a check per item with the dismissal remembered (HIPPOCAMP offers it): not now; a dismissal table and
  its write route would come with their own spec.
- A country / provenance field on the client (no such field exists; lot 4's open question).
- Finished stays without a collected solde (the « En retard » tile), payout gaps (reconciliation).
- Judging the commission or the « Virement reçu » of a platform stay (rule 8).
- Applying the page's month / custom window (rule 1).
- A « taxe de séjour remisée » check (rule 11: impossible by construction).

## 9. Open questions

**Resolved by default (2026-11-05, brief rule 12):**
- Window → the exercise (and logement), not the month / custom window of the page (rule 1).
- « Terminé » → today > `endDate`, the D16 reading shared with « Déclarée » (rule 5).
- Tax « expected » → the amount « Recalculer » would give with today's logement settings (rule 6). A stay of an
  exercise whose commune raised the tax only later would be listed; accepted, the panel says « à corriger », the
  operator judges.
- Undeclared months start at the earliest ticked stay (rule 7), not at the start of the exercise.
- `platform-payment-missing` reads the brut only (rule 8).
- Cap = 20 items per check (rule 4).
- All counts at 0 → the panel stays with one line rather than disappearing (rule 15).
- Month link target → `/finance/tourist-tax?month=YYYY-MM`; the tax page did not read a month from its URL, it now does (rule 16).

**Found while building (not fixed here):** a stay created with `adults: 0` is stored with `adults = 1` but its
tourist tax computed for 0 adults (seen in the unit fixture). Rule 6 lists such a stay — rightly — but the
creation path deserves its own look.
