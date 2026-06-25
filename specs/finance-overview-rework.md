# Finance « Vue générale » rework — total-de-séjour basis

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/finance-overview-rework` |
| **Created** | 2026-06-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Touches** | `models/financeModel.js`, `controllers/*finance*`, `pages/FinancePage.js`, `api.js` |

---

## 1. Context

The Finance « Vue générale » page ([FinancePage.js](../client/src/pages/FinancePage.js)) currently
drives every figure from the **encaissement schedule** (acompte + solde + complément + complément
fin de séjour, split paid/unpaid). Adrien wants the page rebuilt around the **« total de séjour »**
(the headline stay value) as the single revenue basis, with two new year cards, redesigned graphs,
an upcoming-only list, and a stricter operational table.

Resolved decisions (AskUserQuestion 2026-06-16):
- **« total de séjour » = acompte + solde + complément d'arrivée + complément de fin de séjour**,
  the end-of-stay complement counted **only if it is NOT settled via caisse interne** (off-books).
  (= the « Total du séjour TTC » of the fiche, plus the on-the-books end-of-stay complement.)
- **Period model = the existing du/au date range** (unchanged). The two new cards are annual.
- **Reference date = the departure date (`endDate`)**: a reservation counts in the month/year of its
  check-out. « Past » = `endDate < today`.

## 2. Goal

Rebuild the page so every revenue figure is the **Σ total-de-séjour** of the relevant reservations
(by `endDate`), keep « Encaissé » equal to the accounting total, and tighten the operational lists.
Clicking any row anywhere opens the reservation fiche.

## 3. Functional rules

### 3.1 The « total de séjour » of a reservation (the revenue unit)
`totalSejour(r) = depositAmount + balanceAmount + (complementAmount unless complementPaidCash = 1) + (endOfStayComplementAmount unless endOfStayComplementPaidCash = 1)`.
Both complements are excluded when settled via caisse interne (off-books) — decision 2026-06-16.
Rounded to cents. This is the per-reservation value summed everywhere below.

### 3.2 Top cards (left → right)
1. **Revenus depuis le début de l'année** *(new)* — Σ totalSejour of reservations whose `endDate` is in
   `[Jan 1 of the current year, today]`.
2. **Revenu total sur l'année** *(new)* — Σ totalSejour of reservations whose `endDate` is in the current
   **calendar year** (Jan 1 – Dec 31, future bookings included).
3. **Revenu total** *(period)* — Σ totalSejour of reservations whose `endDate` is in the selected du/au
   range (redefines the existing « revenu total » = « l'addition des totaux de séjour »).
4. **Encaissé** — total actually collected over the period = **accounting sum** of every paid component
   (acompte + solde + complément + fin de séjour) marked paid, **excluding caisse interne** (so it equals
   what the compta export shows). By `endDate` in range.
5. **En attente de règlement** — Σ totalSejour of reservations whose `endDate` is in the range **AND in the past**
   (`endDate < today`) **AND not fully settled**. The whole stay total counts (not just the unpaid part).
   Carries a « sur la période » qualifier like the « Revenu total » card.

Each card also shows, in **smaller text under the TTC figure**, the matching **HT** amount (§3.7).

### 3.3 « Settled » definition (drives En attente + operational)
A reservation is **settled** when every applicable component is paid **or** marked caisse interne:
acompte (or disabled), solde, complément d'arrivée, complément fin de séjour — each either `*Paid = 1`
**or** its `*PaidCash = 1`. A caisse-interne complement counts as settled (money in, off-books).

### 3.4 Graphs
- **Revenus par logement** — Σ totalSejour **per property** over the period (by `endDate`). Single value
  per property (no more collected/pending split). The card states the active **du/au period** under its
  title, and the **amount is printed inside each bar** (white, centered).
- **Répartition** — pie of **Encaissé** vs **En attente** (the two card figures). The amounts are printed
  **inside the camembert slices** (white text at each slice centroid), not as outer labels. The two chart
  cards (« Revenus par logement » + « Répartition ») share the **same height**.
- **Projection à une date** — date input **defaults to today + 1 month**. All projection figures are based
  on totalSejour of the reservations (by `endDate`) up to that date. The section is **placed at the very end
  of the page** (below « Suivi opérationnel ») and is a **collapsible accordion, folded by default**.

### 3.5 Upcoming list — payments table (superseded 2026-06-25)
> **Superseded by [finance-upcoming-payments-table.md](finance-upcoming-payments-table.md) (2026-06-25).**
> The « Réservations à venir » tab is now the **same payments table as « Paiements en attente »**,
> read-only and **without** the « Compl. fin de séjour » column, with a green
> « En attente de paiement : Σ reste à payer » chip top-right. The Planning arrival cards
> (`ReservationCard` / `ReservationSasDialog`) were removed from FinancePage (still used by the
> Planning page); the page no longer fetches each reservation's detail.

- Shows **only upcoming reservations** (`endDate >= today`), same set as before (top-N per property).
- *(History: column table until 2026-06-16 → Planning arrival cards 2026-06-16 → back to a (read-only)
  payments table 2026-06-25.)*

### 3.6 « Suivi opérationnel »
- **Paiement en retard** — only **direct** reservations (`platform = 'direct'`) that are overdue. Platform
  bookings are handled by the platform → excluded. When there is **nothing overdue, the tab is hidden
  entirely** (the selected view falls back to « Paiements en attente »).
- **Paiement en attente** — only **past** reservations (`endDate < today`) **not yet settled** (§3.3). The
  amount column shows the **total de séjour** (drop the old « prix total »). The **caution column is removed**.
  A trailing **« Tout solder »** button per row marks the reservation fully settled (all components paid →
  it leaves the list). A **green box, top-right of the list**, shows the **total still awaiting payment**
  (Σ « reste à payer »).
- **Réservations sur la période** — a reservation whose complement(s) were paid via **caisse interne** is
  considered **fully settled** (§3.3) and shown as such.
- Row click (anywhere except the action button) → open the reservation fiche.
- **Column totals** — every operational table (retard / attente / à venir / période) and the projection
  table carries a **footer row totalling each numeric column** (server-computed). A disabled deposit shows
  « Désactivé » (no amount) and is excluded from the acompte total.

### 3.7 « Montant HT » (element-by-element, server-side) — decision 2026-06-16
HT is computed **on the server, element by element**: the VAT-able revenue of a reservation is `finalPrice`
(accommodation + options + resources, single global `vatRate` from app_settings); the **taxe de séjour**
(`touristTaxTotal`) bears **no VAT** and is **not** revenue HT. The HT fraction of the full TTC is therefore
`(finalPrice ÷ (1 + vatRate/100)) ÷ (finalPrice + touristTaxTotal)`, applied to whatever TTC portion is being
summed (total de séjour, encaissé, …) so each card's HT stays consistent with the TTC figure shown above it.

## 4. Architecture

### 4.1 Server side (`server/src/`)
| Layer | File | C/T | Responsibility |
|---|---|---|---|
| models | `models/financeModel.js` | T | Add `totalSejour(r)` (§3.1) + `isSettled(r)` (§3.3) + `htAmount(r, ttcPortion, vatRate)` (§3.7) + `getVatRate(db)`. Rebase `summary(from,to)`: filter by `endDate ∈ [from,to]`; emit `revenueTotal` (Σ totalSejour), `collected` (compta), `pending` (Σ totalSejour of past-unsettled), `revenueByProperty` (Σ totalSejour), `yearToDate` + `yearTotal`, plus the **`*Ht`** counterpart of each figure (§3.7). Rebase `projection(date)` on totalSejour. Rebase `operational()`: overdue = direct-only; pending = past-unsettled with totalSejour; settled honours caisse interne; drop caution; add **`totals`** (column sums) to each list. |
| controllers | finance controller / routes | T | Pass-through of the new payload shape; a settle action reuses `PATCH /reservations/:id/payment` (set every component paid) — no new endpoint needed. |

### 4.2 Client side (`client/src/`)
| Layer | File | C/T | Responsibility |
|---|---|---|---|
| pages | `pages/FinancePage.js` | T | Cards on two rows (annual / period) each with its HT line (§3.2/§3.7); « Revenus par logement » single-value bars + du/au caption; « Répartition » pie with **in-slice amounts**; projection table **moved to the end of the page** (default today+1mo); upcoming list with the new column order + Total de séjour pinned right + paid indicator; operational tables per §3.6 (overdue direct-only, pending past-unsettled + « Tout solder » button, no caution) **+ a footer totals row per table**; **every row click → `navigate('/reservations/:id')`**. |
| services | `api.js` | T | Adjust `getFinanceSummary/Projection/Operational` consumers to the new shape; the « Tout solder » uses `markPayment`. |

No DB schema change — all values derive from existing reservation fields.

## 5. Data model

No new tables/columns. « total de séjour » + « settled » are computed from existing reservation fields
(`depositAmount/Paid`, `balanceAmount/Paid`, `complementAmount/Paid/PaidCash`,
`endOfStayComplementAmount/Paid/PaidCash`, `platform`, `startDate`, `endDate`). The HT figures (§3.7) add
`finalPrice` + `touristTaxTotal` per reservation and the global `app_settings.vatRate`.

## 6. UI / UX

- **Cards** — laid out on **two rows with the period selector between them**: the two **annual** cards at
  the very top of the page (independent of the du/au range, 2 across from `sm` up / stacked on `xs`), then
  the **period selector** (du/au), then the three **period** cards (revenu total / encaissé / en attente de
  règlement — which depend on the range; 3 across from `sm` up / stacked on `xs`). Keep the existing colour language
  (primary / green / orange). Inside each card the **TTC amount is centered both horizontally and
  vertically** and the **HT line is right-aligned** with a small right margin; the cards are kept **compact**
  (tight top/bottom padding + minimal spacing between label, amount and HT). On the « Revenu total » and
  « En attente de règlement » cards the « sur la période » qualifier sits **inline on the same line as the
  label**. The two annual cards use the
  same treatment — a main label (« Revenus » / « Revenu total ») + a smaller inline qualifier
  (« depuis le début de l'année » / « sur l'année »).
- **List + operational tables** — rows get `cursor: pointer` + hover; click navigates to the fiche
  (`stopPropagation` on the « Tout solder » button so it doesn't also navigate). Each table ends with a
  bold **footer totals row** (top border) summing its numeric columns. Mobile: tables already scroll/stack
  per the existing page; the new column order is preserved.
- **Projection** — the date field defaults to today + 1 month; the card sits at the **bottom of the page**.

## 7. Test plan

### Server unit tests (`financeModel`) — `server/src/tests/finance-model.unit.test.js` (17 tests, green)
- [x] `totalSejour`: sums the four components; excludes BOTH complements when their caisse-interne
  flag is set; includes them otherwise.
- [x] `summary`: revenueTotal / yearToDate / yearTotal use `endDate` windows; pending = Σ totalSejour of
  past-unsettled only; collected = compta (excludes caisse interne); revenueByProperty sums totalSejour.
- [x] `isSettled`: paid-or-cash per component (a zero-amount component is trivially settled); a
  caisse-interne complement → settled → drops out of pending.
- [x] `operational`: overdue excludes platform reservations; pending = past-unsettled; amounts = totalSejour;
  upcoming carries totalSejour + nights; each list carries column `totals` (disabled deposit excluded).
- [x] `projection`: Σ totalSejour by `endDate ≤ target`; collected = compta; pending = the rest.
- [x] `HT` (§3.7): element-by-element — `finalPrice ÷ (1+vat)`, taxe de séjour excluded; HT of the collected
  portion is consistent with the TTC figure.

### Client — `client/src/pages/__tests__/FinancePage.test.js` (6 tests, green)
- [x] FinancePage renders the 5 cards (2 year cards first); upcoming list shows Total de séjour pinned
  right with its paid indicator (settled honours caisse interne); a row click navigates to the fiche.
- [x] « Tout solder » calls `markPayment` with every open component paid and doesn't navigate.
- [x] Each card shows its element-by-element HT in smaller text; the pending table foots its columns.

### Manual UI verification (Playwright, 2026-06-16)
- [x] 5 cards render year-first with the primary/green/orange language; « Revenus par logement » is a
  single total-de-séjour bar per logement; « Répartition » is encaissé vs en attente; projection defaults
  to today + 1 month.
- [x] « Tout solder » on a clean reservation settles it and removes it from both en-attente and en-retard;
  the en-attente pie figure + the encaissé card recompute (a malformed seed row is correctly rejected by
  the server contribs-conservation guard — pre-existing data).
- [x] Upcoming list shows the four payment components then Total de séjour pinned right + a paid indicator;
  a caisse-interne complement is excluded from the total and tagged « caisse »; row click opens the fiche.
- [x] Mobile (390px): the 5 cards stack, tables scroll inside their container.
- [x] *(2nd pass)* Each card shows its HT under the TTC; the pie prints amounts inside the slices; the
  projection table is at the bottom; the operational tables (retard / attente / à venir / période) each
  foot their columns; verified desktop + 390px.

## 8. Out of scope

- Changing the accounting/compta export (« Encaissé » is defined to match it, not to change it).
- Per-month selector (the du/au range is kept).
- Historical revenue beyond the current calendar year for the year cards.

## 9. Open questions

- **Resolved 2026-06-16:** total-de-séjour composition; du/au range kept; reference date = `endDate`;
  **caisse interne excluded for BOTH complements** (arrival + end-of-stay).
- « Revenu total » (période) counts a reservation by `endDate` in range regardless of paid status — so it
  can exceed Encaissé + En attente. Accepted as the intended definition (the three are independent metrics).
