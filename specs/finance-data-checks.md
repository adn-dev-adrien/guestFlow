# « À vérifier » — data checks of the Suivi financier

| Field | Value |
|---|---|
| **Status** | Implemented (server + API client; the panel of §4.2 round 2 follows) |
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
   included) that are `declarable` and not ticked; the month is listed when any is. Item `{ month, label,
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

### 4.2 Client side (`client/src/`) — round 1: the API function; round 2: the panel

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `api.js` | `api.js` | T | `getFinanceDataChecks(params)` (round 1). |
| `components/` | `DataChecksPanel.jsx` | C (round 2) | Generic « À vérifier » list: one disclosure row per check (count, label, severity chip, « i » hint), its items as links, « et N autres » from `moreCount`, nothing rendered when `pendingCount` is 0 except a one-line « Rien à vérifier ». Generic: any page holding `{ checks }` can render it. |
| `pages/` | `FinancePage.jsx` | T (round 2) | Loads the checks with the page's exercise and logement (stale answers ignored, a refusal never dead-ends the page) and renders the panel at the bottom. |
| `constants/` | — | — | Severity chip labels « à corriger » / « à vérifier » / « information » co-located with the component. |

**Component reuse declaration (round 2):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge` (or lot 0's chip), `EmptyState`, `ErrorAlert` | The panel styles of lot 0. |
| **Created (new generic)** | `DataChecksPanel` | A list of counted checks with links fits any « faire le point » view. |
| **Specific (kept feature-local)** | — | — |

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

## 6. UI / UX (round 2)

The design reference (`#controles`): a white panel titled « À vérifier » at the bottom of the Suivi financier,
one disclosure row per non-empty check — count (tabular figures), label, severity chip (« à corriger » red,
« à vérifier » honey, « information » grey) — opening the list of its items, each a link (label, then the
detail in secondary text), « et 3 autres » when `moreCount > 0`. With `pendingCount = 0`: one line « Rien à
vérifier sur l’exercice. ». It follows the page's exercise and logement; it has no action of its own in the
`PageActionBar`.

- **Mobile (xs):** rows full width, 48 px touch targets, the chip under the label when it does not fit, item
  labels wrap (no horizontal scroll).
- **Tablet / desktop:** the same list, panel width of the page grid.
- Loading: the panel's skeleton; a refusal: `ErrorAlert` inside the panel, the rest of the page untouched.

## 7. Test plan

### Server unit tests
- [x] `tests/finance-data-checks.unit.test.js` (15) — rules 1, 2, 4, 5, 6, 7, 8, 9, 10: positive / negative /
      edge per check, platform modes (reversed, owner, remitted), rate 0, added guests, cancelled, departure day,
      other logement, other exercise, website request, placeholder label, page-equal amount, unpaid not declarable,
      months before the first tick, cap, read-only route.
- [x] `tests/finance-data-checks-shape.unit.test.js` (4) — rules 2, 3, 4: cap, unknown key, order and
      `pendingCount`, labels and details.
- [x] `tests/tourist-tax-never-discounted.unit.test.js` (4) — rule 11.

### Client (vitest)
- [x] `src/__tests__/api.finance-data-checks.test.js` (1) — rule 10.
- [ ] Round 2: `components/__tests__/DataChecksPanel.render.test.jsx`, `pages/__tests__/FinancePage.data-checks.test.jsx`.

### Manual UI verification (round 2)
- [ ] Happy path on a copy of the data: each item opens its fiche / month.
- [ ] Mobile 375 px: rows, chips and long labels wrap.
- [ ] Regression: the dashboard tiles and « En retard » unchanged.

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

**Found while building (not fixed here):** a stay created with `adults: 0` is stored with `adults = 1` but its
tourist tax computed for 0 adults (seen in the unit fixture). Rule 6 lists such a stay — rightly — but the
creation path deserves its own look.
