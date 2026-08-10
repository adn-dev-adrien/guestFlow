# Remboursements — return money to a guest without touching the sale

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-refunds` |
| **Created** | 2026-08-10 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A guest left the gîte before the end of the stay. The unstayed **night is still billed** (no-show /
early-departure policy), but the **breakfasts that were never served must be given back**. The money
flow is: the guest pays the **full** stay (acompte + solde already collected), then the owner sends a
**bank transfer** back for the breakfasts.

GuestFlow has no way to represent that today. Every euro that exists on a reservation is an
**encaissement** — one of five buckets, all of them *incoming*:

| Bucket | Column(s) | Journal entry kind |
|---|---|---|
| Acompte | `depositAmount` / `depositPaid` / `depositPaidDate` | `deposit` |
| Solde | `balanceAmount` / `balancePaid` / `balancePaidDate` | `balance` |
| Complément d'arrivée | `complementAmount` / … | `complement` |
| Complément de fin de séjour | `endOfStayComplementAmount` / … | `endOfStayComplement` |
| Notes en séjour | `midStaySettledNotes` (register) | `midStayComplement` |

`accountingModel.encaissementsByMonth()` walks exactly those buckets and
`utils/accountingExport.js` turns each into one debit on the client auxiliary account + N credits
(70xxx revenue, 44571xx VAT, 46710000 tourist-tax pass-through). There is **no negative movement
anywhere in the chain**, and no `refund` concept in the DB.

The two workarounds available today are both wrong:

- **Shrink the billed line** (6 breakfasts → 4): `finalPrice` drops below what was already collected,
  so the reservation reads « trop-perçu » everywhere (`remainingToPay` goes negative, the collection
  alert and the operational payments table lie), it fights
  [reservation-option-immutability.md](reservation-option-immutability.md), and the accounting keeps
  the original full-price entries — the CA is never actually corrected.
- **A negative custom option**: same `finalPrice` corruption, plus it silently rewrites a sale that
  was genuinely made at that price on that date.

What is missing is the accountant's own primitive: an **avoir** — a separate, dated event that
reverses part of a sale without rewriting it.

## 2. Goal

From the reservation fiche, the operator records a **remboursement**: which prestations are being
given back, for how much, on which date, by which means. The sale and every collected échéance stay
exactly as they were; the refunded amount is deducted from the « total de séjour » and from the CA,
and the monthly accounting export carries a **reversed journal entry (avoir)** dated at the refund.

## 3. Functional rules

### 3.1 The refund register

1. A **remboursement** is money returned to the guest **after** the sale. It never mutates the sale:
   `finalPrice`, the option/custom/resource lines, `touristTaxTotal`, the échéance amounts
   (`depositAmount` / `balanceAmount` / `complementAmount` / `endOfStayComplementAmount`), the paid
   flags and their payment dates are all left untouched.
2. Refunds live in their own tables (§5), one **header** (date, means, total, reason) + N **lines**
   (what is being given back). A reservation carries 0..N refunds.
3. The header's `refundDate` is the **real money-out date** — the date the transfer/cash actually
   left. It drives the accounting month exactly like a `*PaidDate` drives an encaissement's.
4. Three means (`method`): **`transfer`** (virement — the default), **`cash`** (espèces), and
   **`internal`** (caisse interne). `transfer` and `cash` are *book money*; `internal` is **off the
   books**, following the exact convention the cash complements already use
   ([cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md),
   [mid-stay-notes.md](mid-stay-notes.md) rule 15).
5. `totalTtc` is **server-computed** as Σ line amounts — a client-sent total is never trusted
   ([mid-stay-notes.md](mid-stay-notes.md) rule 7, same philosophy).
6. A refund is **immutable** once created. A correction is a **delete + recreate**, mirroring the
   note-cancel design. Deleting is always allowed (no month lock exists in the app today).

### 3.2 What can be refunded

7. The server exposes, per reservation, a `refundableLines` payload — one entry per **billed** line:
   - **`accommodation`** — one aggregated line = `finalPrice − Σ options − Σ custom − Σ resources`
     (the same accommodation TTC the accounting model derives, `accountingModel.buildPerLineData`);
   - one line per **option** (`opt:<id>`), **custom option** (`custom:<label>`) and **resource**
     (`res:<id>`), keyed exactly like [midStayExtras.js](../server/src/utils/midStayExtras.js)
     (`extraLineKey`) so the two features never disagree on identity;
   - **`touristTax`** when `touristTaxTotal > 0`.

   Each entry carries `key`, `label`, `bucket`, `quantity`, `unitPrice`, `billedTtc`,
   `refundedTtc` (Σ of the refund lines already recorded on that key), `refundableTtc =
   max(0, billedTtc − refundedTtc)` and `vatRate`.
8. **Offered lines never appear** (they are stored at 0 € — there is nothing to give back), and
   neither do lines whose `refundableTtc` is 0.
9. A refund may also carry **free lines**: a label + an amount + a bucket chosen by the operator
   (default « Prestation complémentaire »). A free line has no `key` and no per-line cap — it is the
   commercial-gesture escape hatch.
10. **Per-key cap**: for every keyed line, Σ refunded on that key across all refunds must stay
    ≤ `billedTtc`. Violation → **409 `REFUND_EXCEEDS_LINE`** (the payload names the key).
11. **Global cap**: Σ of every refund of the reservation (all means, free lines included) must stay
    ≤ `finalPrice + touristTaxTotal`. Violation → **409 `REFUND_EXCEEDS_STAY`**.
12. Every line amount must be **> 0**, and the refund total must be > 0 → **400
    `REFUND_INVALID_AMOUNT`** otherwise.
13. `refundDate` must be a valid `YYYY-MM-DD` and **not in the future** (the money has to have moved)
    → **400 `REFUND_INVALID_DATE`**.
14. **VAT is frozen at creation.** Each line stores the `vatRate` that applied when it was recorded:
    the app's single global `vatRate` ([single-vat-rate.md](single-vat-rate.md)) for the three revenue
    buckets, **0** for the `touristTax` bucket (a pass-through bears no VAT). A later settings change
    never re-prices an avoir already issued — same principle as the stored-money accounting path.
15. Refunds are available on a **past-locked** reservation
    ([admin-unlock-past-reservations.md](admin-unlock-past-reservations.md)): an early departure is
    discovered *after* the stay by construction, so the past lock must not block them. They are
    **admin-only** — the reception role's path allowlist
    ([reception-role-checkin-only.md](reception-role-checkin-only.md)) is not extended, and the
    accountant role stays read-only.

### 3.3 Fiche & finance aggregates

16. **Nothing about the collection status changes.** `remainingToPay`, `isSettled`, the dashboard
    collection alert and the operational payments table
    ([finance-operational-remaining-to-pay.md](finance-operational-remaining-to-pay.md),
    [dashboard-collection-alert.md](dashboard-collection-alert.md)) ignore refunds entirely: a
    fully-paid, partly-refunded reservation stays **soldée**. A refund is money already returned, it
    is never « pending » — the same reasoning that keeps the notes register out of those paths
    ([mid-stay-notes.md](mid-stay-notes.md) rule 16).
17. The fiche's **« Total de séjour »** (`sejourNetTotal`, the figure
    [fiche-total-sejour-net-of-commission.md](fiche-total-sejour-net-of-commission.md) defines) is
    **net of refunds**, and a dedicated « Remboursements − X € » line appears in the pricing summary
    right below the collection buckets.
18. `financeModel.totalSejour()` and `financeModel.comptaCollected()` subtract refunds, so every
    figure derived from them follows automatically: the Suivi financier cards, the per-property
    revenue chart, the breakdown dialogs and their HT counterparts
    ([finance-overview-rework.md](finance-overview-rework.md),
    [finance-per-property-revenue-chart.md](finance-per-property-revenue-chart.md)).
19. **Means convention, mirroring the caisse interne rule:** `transfer` + `cash` refunds are deducted
    from the book aggregates (totalSejour, encaissé, CA, export). An `internal` refund is off the
    books: it is excluded from those, and only counted in the « avec caisse » readings — exactly what
    `complementPaidCash` does at each aggregate, site by site.
20. A refund is attached to a reservation's **period** for the finance windows (it rides
    `totalSejour`, whose window is the reservation's, not the refund's date). The accounting export is
    the only surface that uses `refundDate` as its own timeline — same asymmetry as today between the
    finance overview (by reservation window) and the journal (by payment date).

### 3.4 Accounting — the avoir

21. Every **non-`internal`** refund emits **one journal entry** of kind **`refund`** in the month of
    its `refundDate`, sourced by a dedicated `refundsByMonth()` query (a real table, so the month
    filter is a plain range predicate — no `LIKE` scan like the notes register needs).
22. The entry is the **exact mirror** of an encaissement:

    | Side | Account | Amount |
    |---|---|---|
    | **Crédit** | `C<NOM>` (client auxiliary) | refund total TTC |
    | **Débit** | `70600000` / `70600010` / `70601000` per bucket | HT of that bucket's lines |
    | **Débit** | `44571100` / `44571200` per rate | VAT of those lines |
    | **Débit** | `46710000` | tourist-tax lines, in full (no VAT) |

    Σ débits = Σ crédits = refund TTC, the rounding residue absorbed on the **last debit** line (the
    encaissement path absorbs it on the last credit).
23. **No commission line, ever** — the owner refunds the guest directly, out of their own bank
    account, whatever the platform of the original sale.
24. Journal `VT`, `Pièce` empty, libellé = the same uppercased « PRÉNOM NOM » as the sale's entries
    — so the accountant reads the avoir next to the invoice it corrects.
25. The visual journal preview on `/comptabilite` shows the refund as its own card, flagged
    « Remboursement », built from the very same row walk as the CSV (the existing
    `entryToStructured` guarantee that preview == export must keep holding).
26. **`internal` refunds never reach the export nor the preview**, exactly like a cash complement or
    a caisse-interne note.

**Edge cases:**

- **The trigger case** — early departure, night billed, 2 breakfasts (2 × 12 €) refunded by transfer:
  the sale stays at its full price, the solde stays « payé » at its full amount, one refund of 24 €
  is recorded → the fiche shows « Remboursements −24,00 € », the CA of the transfer's month drops by
  21,82 € HT + 2,18 € de TVA, and the accountant gets a balanced avoir.
- **Refund recorded before the money is fully collected** (allowed, rules 10–11 are the only caps):
  the fiche's « reste à payer » is unaffected; the dialog surfaces a warning caption, not a block.
- **A refunded line is later shrunk or removed on the fiche**: existing refunds keep their money (it
  physically left the bank). `refundableTtc` clamps to 0, so no *further* refund is possible on that
  key.
- **Tourist-tax refund**: single debit on `46710000`, no VAT, no revenue account touched.
- **Reservation deleted**: refunds cascade away (`ON DELETE CASCADE`).
- **Devis (`kind='devis'`)**: no refunds — the endpoints reject with 400, like every other money flow.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | T | 3 thin routes: `GET /:id/refunds`, `POST /:id/refunds`, `DELETE /:id/refunds/:refundId` → refundsController |
| `controllers/` | `refundsController.js` | C | Orchestrates: load reservation, build refundable lines, validate the payload (rules 10–15), persist, return the fresh register + lines |
| `models/` | `refundsModel.js` | C | DB access: `listByReservation`, `create` (header + lines in one transaction), `remove`, `totalsByReservation` (book / with-cash split), `refundedByKey`, `refundsByMonth` |
| `models/` | `accountingModel.js` | T | New `refundsByMonth({month, year})` → `refund` entries (bucket HT/VAT already split, `direction: 'refund'`); `encaissementsByMonth` untouched |
| `models/` | `financeModel.js` | T | `totalSejour` / `comptaCollected` subtract the book refunds; `midStayNotesTotal`-style `refundsTotal(r, {withCash})` helper; the breakdown rows expose a « Remboursements » column entry |
| `models/` | `reservationsModel.js` | T | `getById` joins the refund register + totals into the payload consumed by the fiche |
| `controllers/` | `accountingController.js` | T | Merges encaissement + refund entries, sorted by date, for both `sales.csv` and `sales` |
| `controllers/` | `reservationsController.js` | T | Feeds `refundsTotal` into the quote inputs (like `midStayQuoteInputs`) and exposes `refundableLines` on `GET /:id` |
| `utils/` | `refunds.js` | C | **Pure**: `buildRefundableLines(storedLines, refunds, {finalPrice, touristTaxTotal, vatRate})`, `validateRefundPayload(...)`, `splitLineHtVat(...)`, `refundBucketAccount(bucket)` |
| `utils/` | `accountingExport.js` | T | `refundEntryToRows()` (credit client / debit revenue+VAT+pass-through, residue on the last debit) routed from `entryToRows` on `entry.direction === 'refund'`; `entryToStructured` inherits it for free |
| `utils/` | `pricing.js` | T | New input `refundsTotal`; new output `refundsTotal` + `sejourNetTotal` net of refunds (single subtraction, no other engine change) |
| `constants/` | `accounting.js` | T | `REFUND_BUCKET_TO_ACCOUNT` (adds `touristTax → 46710000` on top of the existing `BUCKET_TO_ACCOUNT`) |
| `utils/` | `reservationSettlement.js` | T | Gains `comptaCollected` / `midStayNotesTotal` / `refundsBook` (extracted from `financeModel` so the fiche's « encaissé » caption and the finance views share ONE authority), all three net of refunds |
| `middleware/` | `enforceRoleAccess.js` | — | (none — the new paths are admin-only by default; the reception allowlist drift test pins that) |
| `schema.sql` | `schema.sql` | T | The two tables + 2 indices. Per specs/migrations-baseline.md the baseline is re-executed at every boot with `CREATE TABLE IF NOT EXISTS`, so a brand-new table needs NO extra block in `database.js` (that file is only for altering existing rows) |

**Notes:**
- `utils/refunds.js` is pure (no DB, no clock) so every cap, every VAT split and every
  refundable-line derivation is unit-testable in isolation — same shape as `midStayExtras.js`.
- No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Refund dialog open/close state, create/delete handlers, refetch after mutation |
| `pages/` | `AccountingPage.jsx` | T | Renders `refund` entries as avoir cards (chip « Remboursement », inverted debit/credit reading) |
| `components/reservation/` | `FinanceSection.jsx` | T | New « Remboursements » block: total, « Nouveau remboursement » button, collapsible history with per-refund delete |
| `components/reservation/` | `RefundDialog.jsx` | C | Feature-local dialog: refundable-line picker + free lines + date + means + reason + live total |
| `components/` | `PricingSummary.jsx` | T | « Remboursements − X € » line + « Total de séjour » net of refunds |
| `services/` | `api.js` | T | `createReservationRefund(id, payload)`, `deleteReservationRefund(id, refundId)` |
| `hooks/` | — | — | (none) |
| `utils/` | — | — | (none — every amount and every cap comes from the server payload) |
| `constants/` | — | — | (French labels co-located in `RefundDialog.jsx`, like `MidStayNoteDialog.jsx`) |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `ConfirmDialog`, `DateField`, `ArithmeticTextField`, `EmptyState`, `CollapsibleSection` | All pre-existing; the dialog is a composition, not a new shell. |
| **Created (new generic)** | — | Nothing here is cross-page: the picker is bound to a reservation's billed lines. |
| **Specific (kept feature-local)** | `RefundDialog` | Mirrors `MidStayNoteDialog` (same « pick lines + one global settlement choice » shape) but reads the *billed* register instead of the *pending* one and writes a reversed movement. Generifying the two into one dialog would mean a props matrix larger than either component — deliberately kept separate. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/refunds` | — | `{ refunds, refundableLines, refundTotals: { book, withCash }, collectedTtc }` | Admin only. Also inlined in `GET /api/reservations/:id` so the fiche needs no extra round-trip — hence the `refund*` prefixes (a bare `totals` would collide in the reservation payload). `collectedTtc` feeds the dialog's over-refund caption. |
| POST | `/api/reservations/:id/refunds` | `{ refundDate, method, reason?, lines: [{ key?, label, bucket, quantity?, unitPrice?, amountTtc }] }` | `201 { refund, refunds, refundableLines, refundTotals, collectedTtc }` | Server recomputes `totalTtc` and freezes `vatRate` per line. |
| DELETE | `/api/reservations/:id/refunds/:refundId` | — | `200 { refunds, refundableLines, refundTotals, collectedTtc }` | 404 when the refund doesn't belong to `:id`. |

Auth: `requireAuth` + admin role (403 `FORBIDDEN_ROLE` for reception/accountant).
Errors: `{ error, code }` with the codes of rules 10–13.
Idempotency: none — a double POST creates two refunds (visible in the history, deletable).

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS reservation_refunds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reservationId INTEGER NOT NULL,
  refundDate    TEXT NOT NULL,                     -- YYYY-MM-DD, real money-out date
  method        TEXT NOT NULL DEFAULT 'transfer',  -- 'transfer' | 'cash' | 'internal'
  totalTtc      REAL NOT NULL DEFAULT 0,           -- server-computed Σ lines
  reason        TEXT DEFAULT '',
  createdAt     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reservation_refund_lines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  refundId  INTEGER NOT NULL,
  lineKey   TEXT,                                  -- 'accommodation' | 'opt:<id>' | 'res:<id>' | 'custom:<label>' | 'touristTax' | NULL (free line)
  label     TEXT NOT NULL,
  bucket    TEXT NOT NULL,                         -- 'accommodation' | 'options' | 'resources' | 'touristTax'
  quantity  REAL,
  unitPrice REAL,
  amountTtc REAL NOT NULL,
  vatRate   REAL NOT NULL DEFAULT 0,               -- frozen at creation (rule 14)
  FOREIGN KEY (refundId) REFERENCES reservation_refunds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refunds_reservation ON reservation_refunds(reservationId);
CREATE INDEX IF NOT EXISTS idx_refunds_date        ON reservation_refunds(refundDate);
```

Migration strategy: the two tables + their indices live in `server/src/schema.sql`, which
`database.js` re-executes at every boot with `CREATE … IF NOT EXISTS`
([migrations-baseline.md](migrations-baseline.md)) — so both a fresh install and the production DB get
them without a separate migration block (that file is reserved for changes that must alter existing
rows, which this one doesn't).

**Data impact:** none. Purely additive — no column added to `reservations`, no existing row read or
rewritten, no backfill. Removing the feature would be a pure table drop. Existing reservations simply
have an empty register, and every aggregate subtracts 0.

## 6. UI / UX

### Fiche réservation — bloc « Remboursements » (`FinanceSection`)

Placed **after every collection block** (arrival complement → notes en séjour → complément de fin de
séjour) and **before « Caution »** — the money flows out once everything above has flowed in. Same
visual grammar as the notes block (title + total chip + entry-point button + collapsible history):

```
Remboursements                                    (−24,00 €)
                                        [ + Nouveau remboursement ]
  Voir l'historique (1 remboursement)
  ── 14/08/2026 · Virement · −24,00 €                        [🗑]
     Petit-déjeuner × 2 …………………………………… −24,00 €
     « Départ anticipé — petits-déjeuners non pris »
```

Empty state: the block renders with the button only, no total chip, no history link.

### Dialogue « Nouveau remboursement » (`RefundDialog`)

1. **Prestations facturées** — one row per refundable line: checkbox, label, `Facturé 72,00 €` /
   `Déjà remboursé 0,00 €`, and an amount field prefilled at the full `refundableTtc`, editable,
   capped client-side as a UX hint (the server is the authority). Options priced per unit also show a
   quantity stepper that drives the amount (`qty × unitPrice`).
2. **Autre ligne** — « + Ajouter une ligne libre » : libellé + montant + catégorie
   (Hébergement / Prestation complémentaire / Activité / Taxe de séjour), default « Prestation
   complémentaire ».
3. **Date du remboursement** — `DateField`, default today, future dates refused.
4. **Moyen** — radio: « Virement » (default) / « Espèces » / « Caisse interne », the last one with the
   caption « hors comptabilité » (same wording as the existing caisse-interne choices).
5. **Motif** (optionnel) — free text, e.g. « Départ anticipé — petits-déjeuners non pris ».
6. **Total remboursé : −24,00 €** at the bottom, live.
7. Caption warning (not a block) when the total exceeds what has actually been collected so far:
   « Ce remboursement dépasse le montant encaissé à ce jour. »
8. Validation errors from the server (`REFUND_EXCEEDS_LINE` / `REFUND_EXCEEDS_STAY`) surface as an
   `ErrorAlert` inside the dialog, the dialog stays open with the input preserved.

Deleting a refund goes through `ConfirmDialog`: « Supprimer ce remboursement ? L'écriture d'avoir
correspondante disparaîtra de l'export comptable. »

### Page Comptabilité

The refund card sits in the month's journal, chronologically, with a « Remboursement » chip and the
inverted reading (crédit compte client / débits 70xxx + TVA). The « équilibré » indicator applies
unchanged. The CSV gains the same rows — no new column.

### Responsive behavior (mandatory)

- **`xs` (≤600px):** `RefundDialog` is `fullScreen`. Each refundable line stacks (label on one row,
  `Facturé / Déjà remboursé` caption below, amount field full-width). The means radio stacks
  vertically. The history rows in `FinanceSection` wrap: date + means on one line, amount right-
  aligned below, delete icon ≥44×44.
- **`md` (~900px):** dialog back to a standard `sm` modal, each line on one row (label · caption ·
  qty · amount), means radios inline.
- **`lg` (≥1200px):** identical to `md`; the fiche block sits in the existing finance column with no
  layout change.
- No horizontal scroll anywhere; the Comptabilité journal keeps its existing contained scroll.

### Sticky action bar

No new page — the fiche's existing `PageActionBar` is untouched (a refund is a section-level action,
like « Nouvelle note », not a page-level one).

## 7. Test plan

### Server unit tests (38 new — full suite 2421 ✅)
- [x] `tests/refunds-utils.unit.test.js` — `buildRefundableLines` (accommodation derivation, offered
      lines excluded, `refundedTtc` accumulation, clamp to 0 after a line shrinks), per-key cap,
      global cap, amount/date validation, HT/VAT split incl. `touristTax` at rate 0 (rules 7–14).
- [x] `tests/refunds-model.unit.test.js` — header+lines created in one transaction, `totalTtc` =
      Σ lines, `totalsByReservation` book vs with-cash split, delete cascade, reservation delete
      cascade (rules 1–6, 19).
- [x] `tests/accounting-refunds.unit.test.js` — one `refund` entry per non-internal refund in
      the right month; rows balanced (Σ débits == Σ crédits) with the residue on the last debit;
      credit on `C<NOM>`, debits on 70xxx/44571xx/46710000; no commission line on a platform
      reservation; `internal` refunds absent from both CSV and structured preview (rules 21–26).
- [x] `tests/finance-refunds.unit.test.js` — `totalSejour` and `comptaCollected` net of book
      refunds, unchanged by an `internal` refund; `remainingToPay` / `isSettled` untouched
      (rules 16–19).
- [x] `tests/finance-refunds.unit.test.js` (moteur) — `sejourNetTotal` net of refunds, every other quote figure
      byte-identical to the no-refund run (rule 17).
- [x] `tests/reception-role-allowlist.unit.test.js` (existing drift test) — still red-flags the new
      refund paths as admin-only (rule 15).

### Client tests (`npx vitest run` — 15 new, full suite 820 ✅)
- [x] `RefundDialog.test.jsx` — line selection drives the total, free line adds up, future date
      refused, server error rendered inline.
- [x] `FinanceSection.refunds.test.jsx` — block hidden-when-empty, total, history, delete flow.

### Manual UI verification
- [x] Happy path: the trigger case end-to-end — full payment collected, refund 2 breakfasts by
      transfer, check the fiche total, the Suivi financier card, the journal preview and the CSV.
- [x] Edge case: caisse-interne refund → visible on the fiche, absent from `/comptabilite`.
- [x] Edge case: over-cap refund → 409 surfaced in the dialog, nothing persisted.
- [x] Regression: a reservation with mid-stay notes + end-of-stay complement keeps its exact previous
      figures with no refund recorded.
- [x] Mobile (`xs`): dialog fullscreen, history readable, no horizontal scroll.
- [x] `npm run test:e2e` (Playwright) green — 45 passed, 1 skipped.

## 8. Out of scope

- **Cancelling a whole reservation / global cancellation policy** — a refund here is partial and
  manual; nothing computes « what should be refunded » from a policy.
- **Automating the bank transfer** (Qonto payout API): the operator makes the transfer themselves and
  records it. Only the bookkeeping is in scope.
- **Reissuing the devis/facture PDF** with the avoir on it.
- **Refunds initiated from the SAS de départ** (decision 2026-08-10: fiche only for now).
- **A month-close lock** preventing the deletion of a refund already exported.
- **Refund of a platform commission** or any platform-side money flow.

## 9. Open questions

- **Resolved 2026-08-10** — where does the « encaissé » figure behind the dialog's over-refund caption
  come from? `financeModel.comptaCollected` was moved to `utils/reservationSettlement.js` and reused
  as-is, rather than re-deriving the number in the refunds controller: one authority, no drift.
- Q: Should an avoir carry its own `Pièce` number once the accountant provides a numbering scheme?
  - A: Deferred — the whole export leaves `Pièce` empty today
    ([accountant-accounting-export.md](accountant-accounting-export.md) §3.4 rule 13b); refunds join
    whatever scheme lands there.
