# Notes en séjour — group, sell and settle extras during the stay

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mid-stay-notes` _(user-managed)_ |
| **Created** | 2026-08-06 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Since [mid-stay-extras-to-end-of-stay-complement.md](mid-stay-extras-to-end-of-stay-complement.md)
(PR #379), a reservation has **three collection moments**:

| Moment | Bucket | Settlement |
|---|---|---|
| **Check-in** | Arrival complement (`complementAmount`) | at the arrival SAS, or deferred to check-out ([defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md)) |
| **During the stay** | → everything lands in the end-of-stay complement | ❌ **cannot be collected before departure** |
| **Check-out** | End-of-stay complement (`endOfStayComplementAmount` + detail) | as a single block at the departure SAS (one global `endOfStayComplementPaid` flag) |

The gap: a guest who takes a breakfast mid-stay and **wants to pay for it on the spot** cannot —
the end-of-stay complement is only collectable as a whole, at the door. And the same guest can take
another extra the next day and leave *that one* for check-out: the decision is per purchase, not per
stay.

A per-line « Encaisser » button on every complement line was considered and **rejected** (decision
2026-08-06): it would clutter the fiche. The retained design is the **note** (a bar/restaurant tab):
a dedicated dialog where the operator composes a group of prestations — picked from what is already
pending and/or added from the catalogue — and closes it with **one global payment choice**: settle
now (CB / caisse interne) or leave it for check-out.

Building blocks reused untouched:

- the mid-stay split (`midStayExtras.js`): every euro sold after arrival is identified per line key
  (`opt:<id>` / `res:<id>` / `custom:<label>`) and carved out of the frozen pre-arrival buckets;
- the option catalogue with collapsible categories (Boissons / Restauration —
  [option-categories.md](option-categories.md)) as the source for in-stay sales;
- the « caisse interne » convention ([cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md)):
  cash-settled money counts in the financial tracking but stays out of the accounting.

## 2. Goal

During a stay, the operator opens **« Nouvelle note »** from the fiche, reviews what is pending and
adds new prestations, and closes the note with one payment choice. Settled notes accumulate in a new
**« Encaissements en séjour »** fiche block (running total + browsable history), are counted in the
finance tracking and the accounting at their payment date, and the end-of-stay complement simply
becomes **the remainder** — collected at check-out exactly as today.

## 3. Functional rules

### 3.1 The notes register

1. The reservation carries a **register of settled notes** `midStaySettledNotes`: a JSON array of
   notes `{ id, paidDate, paidCash, total, lines: [{ label, qty, unitPrice, amount, key }] }`.
   Each note is one punctual collection of one or more mid-stay sales. `NULL`/empty by default.
   `id` is a per-reservation increment (max + 1) so a note can be cancelled unambiguously.
2. **A note only exists if it was settled.** A note closed with « En fin de séjour » simply leaves
   (or puts) its prestations in the end-of-stay remainder — no register entry, no trace beyond the
   normal complement lines. The register is a history of **collections**, not of sales.
3. **Cancelling a note** (typo/mis-click): the note is removed from the register and its lines are
   re-inserted into the end-of-stay detail (merged by key with any existing remainder line of the
   same key). Refused with a 409 when the end-of-stay complement is already collected globally
   (`endOfStayComplementPaid = 1` or `…PaidCash = 1`) — un-mark the global flag first, same freeze
   philosophy as everywhere else. Cancelling a settlement does **not** un-sell the prestations: they
   go back to « to collect at check-out »; removing the sale itself is a separate fiche edit.
4. The **end-of-stay complement keeps its exact current contract** — stored amount + detail = the
   remainder (unsettled mid-stay sales + departure-SAS lines), one global « payé » flag, chip on the
   planning, merged deferred card, departure-SAS collection. Nothing that reads it changes meaning.

### 3.2 Composing and settling a note

5. The note dialog offers two sources (decision 2026-08-06, Q3):
   - **« À percevoir »** — the current end-of-stay **mid-stay remainder lines**, each checkable
     (whole-line selection, showing its amount). Departure-SAS lines (ménage, linge, extincteur)
     never appear here — they are born at check-out and stay on the global flag.
   - **« Ajouter une prestation »** — the reservation's option catalogue (same categories as the
     fiche Options section). Adding items here **is a normal sale**: on validation the reservation
     is saved through the standard pipeline (pricing engine, planning cards, laundry counts…), and
     the new amounts land in the remainder like any mid-stay sale. A **planning-card option**
     (petit-déjeuner…) is billed by its scheduled occurrences, never by a raw quantity — like the
     fiche, which shows no Qté field for it, the dialog offers a simple **« Ajouter » / « Ajouté ✓ »**
     and the days stay editable on the fiche ([option-planning-card.md](option-planning-card.md) §3.4).
     Auto-timed options (arrivée anticipée / départ tardif) are never a mid-stay sale and are absent.
5bis. **The baseline the preview uses.** The arrival baseline is captured lazily, on the first save
   at/after `startDate` ([mid-stay-extras-to-end-of-stay-complement.md](mid-stay-extras-to-end-of-stay-complement.md) §3.1
   rule 3). A stay that started but was never re-saved therefore has none, and the note total would
   read 0 € for a prestation just added. The **read path synthesizes** the baseline the next save
   would store (the currently stored extras) so the preview matches the post-save reality — and
   never writes. Once captured, the stored baseline always wins.
6. **Closing the note** offers three choices: **CB / Chèque**, **Caisse interne** (both = settle
   now), **En fin de séjour** (= sale only, everything stays in the remainder).
7. **Amounts are engine-authoritative.** The dialog's displayed note total comes from the live
   server quote (`midStayExtrasLines`); the settle request sends per-key **instructions**
   `{ key, amount }` that the server validates against the stored remainder (`amount ≤ remaining(k)`,
   409 otherwise) — no client-computed money is ever trusted as-is.
8. **Partial settlement per key is supported at the server** (the bar case: 2 breakfasts from
   yesterday unpaid, the guest pays only today's 3rd one): when the instructed `amount` is lower
   than the key's remainder, the remainder line is **split** — the paid part moves into the note,
   the rest stays. Qty/unitPrice of both parts follow the existing whole-units heuristic of
   `midStayExtras` (whole units when divisible, flat amount otherwise). The dialog composes this
   naturally: a catalogue addition settles its own delta; a checked pending line settles whole.

### 3.3 Engine

9. Per key `k`: `midStay(k) = max(0, T(k) − base(k))` (unchanged), `settled(k) = Σ note lines[k]`,
   `remaining(k) = max(0, midStay(k) − settled(k))`. The synced end-of-stay mid-stay lines are the
   `remaining` parts. The amount **extracted from the pre-arrival / arrival-complement buckets stays
   `midStay(k)` whole** (remaining + settled): money settled during the stay never flows back into
   the frozen buckets.
10. The engine takes the register as input and exposes `midStaySettledTotal` (+ note lines).
    `endOfStayComplementTotal = endOfStaySasAmount + Σ remaining` (the fiche's end-of-stay figure is
    the remainder only), and `sejourNetTotal = net + complementAmount + endOfStayComplementTotal +
    midStaySettledTotal`.
11. **Freeze**: unchanged for the remainder (once `endOfStayComplementPaid`, the stored lines rule).
    The register is frozen **by construction** — historical amounts, never re-priced.
12. **Selling more of an already-settled key** (2 breakfasts settled Tuesday, a 3rd taken Thursday):
    `remaining = midStay − settled` = the new part → it reappears in the remainder. The register
    keeps the settled notes untouched.
13. **Removing/shrinking a line after settlement**: `remaining` clamps to 0; the register keeps its
    money (it is physically in the till). A refund = cancel the note (rule 3), then remove the sale.

### 3.4 Finance & accounting

14. **One journal entry per note** (2026-08-06 — supersedes the earlier « one entry per line »
    answer, which predated the note design; the note IS the real-world collection): each non-cash
    note emits an encaissement of kind **`midStayComplement`** in the month of its `paidDate` — the
    note's flat TTC total split HT + VAT at the app `vatRate`, booked on the « options » revenue
    bucket (70600010), no commission, no tourist tax. Exact parity with the `endOfStayComplement`
    entry shape; French label « Prestations en séjour ». Several notes of one reservation can
    coexist in one month (one entry each).
15. **Caisse interne**: a `paidCash = 1` note is excluded from the accounting + CSV export and
    follows the **same conventions as the existing cash complements at every aggregate** (financial
    tracking counts it as collected money; CA/compta aggregates exclude it — site by site, mirroring
    what `complementPaidCash` does there).
16. The register is never « pending »: `remainingToPay`, `isSettled`, the dashboard collection alert
    and the operational payments table are untouched (a note is collected by definition; the
    remainder keeps flowing through the existing end-of-stay pending path).

### 3.5 Fiche & SAS

17. **New fiche block « Encaissements en séjour »** (FinanceSection, between the arrival complement
    and the end-of-stay complement — chronological order): running total of all settled notes, a
    **« Nouvelle note »** button, and a collapsible **history** listing each note (date, mode CB /
    Caisse interne, total, expandable lines, ✕ cancel with confirmation). Block visible when the
    stay has started (`startDate ≤ today`) **or** the register is non-empty; the button is disabled
    with an explanatory tooltip while the end-of-stay complement is globally collected (rule 3 / 11).
18. **The end-of-stay complement block is unchanged** — no per-line buttons (2026-08-06 decision:
    avoid clutter). It keeps showing the remainder lines + the global « Marquer payé » / « Caisse
    interne » controls.
19. **PricingSummary cascade**: the « perçus sur place » deduction covers arrival complement +
    end-of-stay remainder + settled notes; each comes back as its own line (« Complément d'arrivée »,
    « Complément de fin de séjour », « Encaissements en séjour »); « Total perçu sur le séjour »
    includes all three. Direct reservations: a « dont encaissements en séjour » line.
20. **Departure SAS recap**: an informational « Déjà réglé en séjour : X € » line (read-only) above
    the billed lines; the « Total à percevoir » stays the remainder (+ recalled arrival complement).
    The register lives in its own column and is **not** re-sent by the commit — no loss risk.
21. **« Accueil » (reception) role**: no access to note settlement/cancellation in v1 — the
    fail-closed payment-patch field filter (`toReceptionPaymentPatch`) drops the new fields.

**Edge cases:**

- Note settling the **whole** remainder with no SAS lines → end-of-stay amount falls to 0, global
  flag stays 0 (nothing left at the door); the departure SAS shows « Déjà réglé en séjour » and a
  zero total. Nothing is ever due twice.
- Settle instruction on a key with no remainder, or `amount > remaining(k)` (double-click, stale
  second tab) → 409, no state change, the fiche reloads the fresh state.
- Cancelling a note whose key **also** has a new remainder part (3rd breakfast after the note) →
  re-inserted lines merge into the existing remainder line of the key (single line per key after the
  next sync).
- End-of-stay complement already collected globally → « Nouvelle note » disabled (tooltip
  « Complément de fin de séjour déjà encaissé — décochez-le pour créer une note »); cancelling a
  note is refused (rule 3) until the global flag is un-marked.
- Dialog cancelled after touching the catalogue → the form additions are rolled back (snapshot on
  open, restored on cancel); nothing is saved, nothing is settled.
- The fiche form has unsaved edits when the note is validated → the note's validation performs the
  **standard save** (whole current form, dirty-guard semantics unchanged) — the note never bypasses
  the normal save pipeline.
- Reservation created before this spec → register `NULL`, behaviour identical to PR #379.
- The deferred arrival complement (`complementDeferredToCheckout`) is orthogonal and unchanged: the
  merged door card keeps showing arrival + remainder; a settled note is already-collected money and
  never joins a « to collect » card.

---

## 4. Architecture

> **Fat backend, thin frontend.** The settle/cancel transactions, the per-key validation + split,
> the remainder↔register moves and every aggregate live on the server. The client composes a note
> visually, then plays two existing pipelines: the standard reservation save, and a payment PATCH
> carrying instructions.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: `midStaySettledNotes TEXT DEFAULT NULL`. |
| `utils/` | `midStayExtras.js` | T | Register helpers: `parseNotes`, `settledByKey(notes)` (Σ per key across notes), `nextNoteId`; `resolveMidStaySplit` deducts `settled(k)` in both branches (live + frozen); split-line heuristic factored for reuse by the partial settle. |
| `utils/` | `pricing.js` | T | New input `midStaySettledNotes`; deducts `settled(k)` from the synced remainder while still extracting `midStay(k)` whole from the frozen buckets; exposes `midStaySettledTotal`; `sejourNetTotal` per rule 10. |
| `models/` | `reservationsModel.js` | T | `settleMidStayNote(id, { items: [{ key, amount }], cash })` — transactional: validate each amount against the stored remainder, split lines when partial, append one note (today, cash, server-summed total), rewrite the detail, re-total. `cancelMidStayNote(id, noteId)` — inverse move with per-key merge, 409 when the global end-of-stay flag is set. `resolveArrivalExtrasBaseline` (rule 5bis). `writeEndOfStayDetail` — the single write point where the remainder + the register always move together. Columns guarded like `arrivalExtrasBaseline`. |
| `controllers/` | `reservationsController.js` | T | `updatePayment`: two new action fields `settleMidStayNote` / `cancelMidStayNote`, applied FIRST and mapped to 404/409 by code; `midStayQuoteInputs` loads the register + the resolved baseline for the engine. |
| `models/` | `accountingModel.js` | T | Emit one `midStayComplement` entry per non-cash note whose `paidDate` falls in the month (rule 14); select the guarded column. **The month WHERE clause gains a note branch** (`midStaySettledNotes LIKE '%"paidDate":"YYYY-MM-%'`): a stay whose only collection of the month is a note has no bucket paid in it and would otherwise never be selected. `inMonth` stays the authoritative per-row filter. |
| `utils/` | `accountingExport.js` | — | **No change**: the export is kind-agnostic (libellé = client name, rows built from the entry's buckets), so the new kind flows through as `endOfStayComplement` already does. |
| `models/` | `financeModel.js` | T | Notes join the aggregates with the same cash conventions as the existing complements (rule 15); never pending. |
| `utils/` | `reservationSettlement.js` | T | Collected-side aggregates gain the notes; `remainingToPay`/`bucketStates` untouched (rule 16). |

**Notes:** the settle transaction works on **stored amounts only** (no engine call inside the
transaction) — the next quote/save reconverges by construction (`remaining = midStay − settled`).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `MidStayNoteDialog.js` | **C** | The « Nouvelle note » dialog: checkable pending lines + catalogue picker bound to the same form state as the Options section (snapshot/rollback on cancel), live note total from the server quote, three closing actions. Feature-specific by design (wired to the reservation form contract) — not a generic component. |
| `components/reservation/` | `FinanceSection.js` | T | New « Encaissements en séjour » block (rule 17): running total, « Nouvelle note » button, collapsible note history with ✕ cancel; end-of-stay block untouched (rule 18). |
| `components/` | `PricingSummary.js` | T | Cascade per rule 19 (notes deducted + re-added on their own line; direct variant). |
| `components/sas/` | `ReservationSasDialog.js` | T | « Déjà réglé en séjour : X € » info line in the departure recap (from the reservation row). |
| `pages/` | `ReservationPage.js` | T | Load `midStaySettledNotes` into the form (+ `EMPTY_FORM`); host the dialog (open state, post-settle refresh). |
| `api.js` | `api.js` | — | `markPayment` already passes arbitrary payment payloads through. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `ConfirmDialog`, `StatusBadge` | Note dialog shell, cancel confirmation, settled badges. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `MidStayNoteDialog` | Bound to the reservation form contract (options state, quote flow) — not meaningfully generalisable. |

### 4.3 API contract

| Method | Endpoint | Request body (additive) | Notes |
|---|---|---|---|
| PATCH | `/api/reservations/:id/payment` | `{ settleMidStayNote?: { items: [{ key, amount }], cash }, cancelMidStayNote?: { id } }` | Settle: 409 when a key has no remainder or `amount > remaining(k)`. Cancel: 409 when the end-of-stay flag is set. Reception role: fields dropped (rule 21). |
| GET | `/api/reservations/:id` | — | `r.*` carries the new column. |
| POST | `/api/reservations/calculate-price` | unchanged | Response adds `midStaySettledTotal`; `endOfStayComplementTotal` is the remainder-based figure. |
| GET | `/api/accounting/sales[.csv]` | — | New `midStayComplement` entries (one per settled note, cash excluded). |

---

## 5. Data model

Idempotent `ALTER TABLE` block in [database.js](../server/src/database.js):

```sql
ALTER TABLE reservations ADD COLUMN midStaySettledNotes TEXT DEFAULT NULL;
```

Content: JSON array of notes, e.g.

```json
[{ "id": 1, "paidDate": "2026-08-06", "paidCash": 0, "total": 30,
   "lines": [
     { "label": "Petit-déjeuner", "qty": 2, "unitPrice": 12, "amount": 24, "key": "opt:9" },
     { "label": "Coca", "qty": 2, "unitPrice": 3, "amount": 6, "key": "opt:14" }
   ] }]
```

**Data impact:** purely additive; existing rows get `NULL` (empty register) and behave exactly as
before. Settling only ever **moves** stored amounts between the end-of-stay detail and the register
inside one transaction — the invariant `remainder + register = everything sold mid-stay` holds at
every step. No backfill, no loss.

## 6. UI / UX

- **Fiche → new block « Encaissements en séjour »** (between arrival and end-of-stay complements):

  ```
  Encaissements en séjour ............... 47,00 €
    [ + Nouvelle note ]
    ▸ Voir l'historique (2 notes)
      06/08 — 30,00 € — CB                    [ ✕ ]
        Petit-déjeuner : 2 × 12,00 € = 24,00 €
        Coca : 2 × 3,00 € = 6,00 €
      05/08 — 17,00 € — Caisse interne        [ ✕ ]
        Boisson : 5,00 €
        Gâteau : 12,00 €
  ```

- **« Nouvelle note » dialog** (`FormDialog`, fullScreen on mobile):

  ```
  Nouvelle note
  ── À percevoir ─────────────────────────────
  ☑ Petit-déjeuner : 2 × 12,00 € = 24,00 €
  ☐ Location vélo : 18,00 €
  ── Ajouter une prestation ──────────────────
  [▸ Boissons]   Coca 3,00 €   qté [2]
  [▸ Restauration] …
  ────────────────────────────────────────────
  Total de la note : 30,00 €
  [ CB / Chèque ]  [ Caisse interne ]  [ En fin de séjour ]      Annuler
  ```

  « En fin de séjour » is shown only when the note adds new prestations (a pending-only selection
  left for check-out is a no-op). Cancel rolls back any catalogue addition.
- **Copy (FR):** « Encaissements en séjour », « Nouvelle note », « À percevoir »,
  « Ajouter une prestation », « Total de la note », « En fin de séjour », « payé le {date} (CB) » /
  « (Caisse interne) », cancel confirm « Annuler cet encaissement ? Les prestations redeviennent à
  percevoir en fin de séjour. », accounting label « Prestations en séjour ».
- **States:** button disabled + tooltip while the end-of-stay complement is globally collected;
  settle/cancel errors surface through the existing fiche error path; actions disabled while a PATCH
  is in flight; empty history → the block shows only the button (total hidden at 0 €).
- **Responsive:** dialog `fullScreen` on `xs`; the three closing actions stack vertically full-width
  on `xs`; history lines wrap on two lines on `xs` (date+total / mode); catalogue categories reuse
  their existing mobile behaviour. No behavioural difference `md`/`lg`.
- **PageActionBar:** N/A (content inside existing pages and dialogs).

## 7. Test plan

### Server unit tests (`cd server && npm test` → **2359 verts**, +26)

- [x] `mid-stay-extras.unit.test.js` (extend, +7) — `settledByKey` / `notesTotal` / `nextNoteId`;
      deduction from the remainder while the carve-out keeps the whole sale; fully-settled key leaves
      the remainder; sell-more-after-settle; remove-after-settle clamps; frozen branch counts stored
      remainder + register; `buildMidStayLine` unit heuristic.
- [x] `pricing-mid-stay-extras.unit.test.js` (extend, +4) — invariant `acompte + solde + complément +
      reste + notes = totalStayPrice`; note partielle; note + facturation SAS; « aucune note →
      moteur strictement identique » (non-régression).
- [x] `reservations-mid-stay-sync.unit.test.js` (extend, +9) — `settleMidStayNote`: multi-key move,
      **partial split** (cas du bar), server-summed total, 409 on unknown key / over-amount / global
      flag set; `cancelMidStayNote`: inverse move with per-key merge, 404 unknown, 409 when settled;
      the remainder resync never touches the register; `resolveArrivalExtrasBaseline` (rule 5bis).
- [x] `accounting-encaissements-integration.unit.test.js` (extend, +3) — one `midStayComplement`
      entry per non-cash note at its own `paidDate`, HT+VAT at the app rate on the options bucket;
      cash notes + out-of-month notes absent; a note-settled sale keeps the `complement` entry balanced.
- [x] `finance-model.unit.test.js` (extend, +3) — a note raises the total AND the collected figure,
      never the pending one; a caisse-interne note is off-books on both sides.

### Client tests (`cd client && npx vitest run` → **788 verts**, +14)

- [x] `MidStayNoteDialog.test.js` (**new**, 6) — pending lines checkable, total following the
      selection, per-key instructions (never a client-computed price), a catalogue addition billed
      for its **delta only**, cash flag, buttons inert while the note is empty, cancel rolls back.
- [x] `FinanceSection.mid-stay-notes.test.js` (**new**, 6) — block visibility (stay started / notes
      present), running total, history with date + mode + lines, cancel → confirm → PATCH + reload,
      button disabled when the end-of-stay complement is settled, **and no per-line button on the
      end-of-stay block**.
- [x] `PricingSummary.commission.test.js` (extend, +2) — notes line in the platform cascade + direct
      « dont encaissements en séjour ».
- [x] The 4 `FinanceSection.*` suites now render inside `DialogProvider` (the block uses the app-wide
      confirm service).

### E2E (`npm run test:e2e`)

- [x] Existing suite green (45 passed, 1 skipped) — no new journey.

### Manual UI verification — exécutée le 2026-08-06 sur le serveur de dev

- [x] Réservation Lodgify **en cours** : le bloc « Encaissements en séjour » + « Nouvelle note » sont là.
- [x] Fenêtre : catalogue par catégories (Prestations / Animations / Boissons / Restauration),
      steppers pour les options simples, **« Ajouter » / « Ajouté ✓ »** pour les options à carte de
      planning, total de la note **live depuis le moteur** (24,00 €).
- [x] « CB / Chèque » → note enregistrée `{id 1, total 24, CB, ligne « Petit déjeuner 24 »}` ;
      **acompte 124,50 et solde 310,90 inchangés**, complément d'arrivée 0, **complément de fin de
      séjour 0** (rien ne reste à percevoir au départ).
- [x] Fiche rechargée : bloc « Encaissements en séjour (24,00 €) » + historique
      « 06/08 — 24,00 € — CB » avec sa ligne et le ✕.
- [x] Cascade : 459,40 → − 24,00 (perçus sur place) → 435,40 soumis à commission → versement 435,40
      → + 24,00 encaissements en séjour → **Total perçu 459,40**. Équilibrée.
- [x] Annulation : confirmation « Les prestations redeviennent à percevoir en fin de séjour. » →
      la note disparaît, les 24 € reviennent en ligne `midStayExtra` du complément de fin de séjour.
- [ ] Départ SAS « Déjà réglé en séjour » : non rejoué à la main (couvert par le rendu conditionnel
      + les tests unitaires) — le récap du SAS avait été vérifié sur la spec précédente.
- [ ] Page comptabilité : non rejouée à la main (couverte par les tests d'intégration compta).
- [ ] Mobile (≤600 px) : non rejoué — dialog `fullScreen` + actions empilées par construction.

## 8. Out of scope

- Online payment links for notes (`paymentLinksModel` unchanged).
- Custom (free-text) lines **created from** the note dialog — they stay a fiche edit; an existing
  pending custom line is checkable like any other.
- Automatic refunds (cancel-the-note + remove-the-sale is the manual path).
- Per-line settlement of departure-SAS lines (global flag only, as today).
- « Accueil » (reception) access to notes.
- Guest-facing notification/receipt for a note.
- A printable/PDF note.

## 9. Open questions — resolved 2026-08-06

- **Q1 — settlement gesture.** Initially answered « per-line Encaisser button »; **superseded the
  same day** by Adrien's design feedback: per-line buttons clutter the fiche. → **The note dialog**
  (compose a group, one global payment choice) + a dedicated « Encaissements en séjour » block with
  running total + history.
- **Q2 — accounting granularity.** Initially « one journal entry per line »; with the note design
  the real-world collection **is the note** → **one entry per settled note** at its `paidDate`
  (same spirit: one entry per actual collection, no artificial day-grouping).
- **Q3 — note dialog content.** → **Pending lines + catalogue** (not catalogue-only, not
  pending-only): covers both « the guest pays what he just took » and « the guest drops by to pay
  yesterday's extras ».
