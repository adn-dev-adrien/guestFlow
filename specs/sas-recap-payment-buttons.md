# SAS recap — settlement buttons (CB/Chèque · Payé en liquide · En fin de séjour)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-recap-payment-buttons` _(user-managed)_ |
| **Created** | 2026-07-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On the **last page (recap)** of both SAS wizards, the operator records how the complement was settled. Until
now this was **two checkboxes** ([ReservationSasDialog.js](../client/src/components/sas/ReservationSasDialog.js)):

- « Complément encaissé » (arrival) / « Compléments encaissés » (departure) → sets `complementPaid` resp.
  `endOfStayComplementPaid`;
- a nested « Caisse interne » → sets `complementPaidCash` resp. `endOfStayComplementPaidCash` (cash collected,
  counts in financial tracking but excluded from accounting — spec
  [cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md)).

The operator wants clearer, one-tap **buttons** instead of nested checkboxes, and — on **arrival only** — an
explicit way to **defer** the complement to check-out.

## 2. Goal

Replace the settle checkboxes on the recap page with a **single-select set of buttons**:

- **CB / Chèque** — settled, normal accounting.
- **Payé en liquide** — settled in the **caisse interne** (cash, hors compta).
- **En fin de séjour** — *(arrival only)* don't collect now; the amount is **reported to check-out**.

The **check-out (departure) recap** shows the **same buttons minus « En fin de séjour »** (there is no later
stage to defer to).

## 3. Functional rules

1. **Arrival recap** (shown only when there is a complement to collect: `total > 0` and the arrival complement
   isn't already `complementPaid = 1`): three mutually-exclusive buttons — **CB / Chèque**, **Payé en liquide**,
   **En fin de séjour**. Clicking the active one again clears the choice (nothing selected).
2. **Departure recap** (shown only when `departureGrandTotal > 0`): two buttons — **CB / Chèque**, **Payé en
   liquide**. No « En fin de séjour ».
3. **Mapping to the existing paid flags** (no new fields; the commit contract is unchanged):
   - **CB / Chèque** → `complementSettled = true`, `complementPaidCash = false` (departure:
     `complementsSettled = true`, `complementsPaidCash = false`).
   - **Payé en liquide** → `complementSettled = true`, `complementPaidCash = true` (departure:
     `complementsSettled = true`, `complementsPaidCash = true`).
   - **En fin de séjour** *(arrival)* → `complementSettled = false` → the arrival complement stays **unpaid**,
     so the existing **recall mechanism** surfaces it at check-out (« Compléments d'arrivée non perçus »,
     added to the check-out total) and collects it there — spec
     [recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md). **No
     amount is moved between complements** (the tourist tax keeps its 46710000 routing, extras keep revenue —
     accounting-safe, decision 2026-07-20).
   - **Nothing selected** → same as « En fin de séjour » (unpaid → recalled). No button is highlighted.
4. **Re-open pre-fill** (specs/reopen-completed-sas.md): the button state is reconstructed from the stored
   flags — `paid + cash → « Payé en liquide »`, `paid non-cash → « CB / Chèque »`, `unpaid → nothing selected`
   (a deferred complement can't be told apart from « not yet decided »; both commit unpaid, so this is lossless
   in effect).

**Edge cases:**
- Arrival complement already `complementPaid = 1` → the settle buttons are hidden (the existing « déjà marqué
  payé » warning stays), unchanged.
- Nothing to collect (`total`/`departureGrandTotal` = 0) → no buttons.
- Quitter → nothing written, unchanged.

---

## 4. Architecture

> **Thin frontend.** This is a pure UI rework of the recap settlement controls — same commit payload fields
> (`complementSettled`/`complementPaidCash`, `complementsSettled`/`complementsPaidCash`), same server behaviour.
> No server, model, route, or schema change.

### 4.1 Server side

None. The commit endpoints (`commitArrival`/`commitDeparture` in
[sasController.js](../server/src/controllers/sasController.js)) already accept the four boolean fields; the
buttons just resolve to those same booleans.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.js` | T | New local `PaymentModeButtons` (single-select CB/Chèque · Payé en liquide · [En fin de séjour]); two mode states `arrivalPayMode` / `departurePayMode` (`null\|'card'\|'cash'\|'defer'`) replacing the four settle booleans; recap render swaps the checkboxes for the buttons; commit maps the mode → the existing paid-flag booleans; re-open reconstructs the mode from the stored flags. Removed the now-unused `Checkbox` / `FormControlLabel` imports. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Button` / `Stack` / `Typography` | Reused. |
| **Created (new generic)** | — | `PaymentModeButtons` kept feature-local (SAS-specific settlement semantics). |

### 4.3 API contract

Unchanged. `POST /api/reservations/:id/sas/arrival` still takes `complementSettled` + `complementPaidCash`;
`POST /api/reservations/:id/sas/departure` still takes `complementsSettled` + `complementsPaidCash`.

---

## 5. Data model

No change. Reuses `complementPaid` / `complementPaidCash` (arrival) and `endOfStayComplementPaid` /
`endOfStayComplementPaidCash` (departure). No migration.

## 6. UI / UX

- **Recap page**, below the total: a « Règlement »/« Règlement du complément » label + a row of buttons.
  Selected button is **filled** (`contained`), the others **outlined**; « En fin de séjour » is neutral
  (`inherit` colour). Buttons are **full-width stacked on `xs`**, side-by-side on `sm+`, touch targets ≥ 44 px.
- **« En fin de séjour » selected** shows a caption « Reporté au check-out (rappelé dans le SAS de départ). ».
- No loading/empty/error states beyond the existing recap. Inherits the SAS dialog shell (fullscreen on `xs`).

## 7. Test plan

### Client IHM tests (vitest, `components/sas/__tests__/ReservationSasDialog.test.js`, +4)
- [x] Arrival recap « CB / Chèque » → `complementSettled = true`, `complementPaidCash = false`.
- [x] Arrival recap « Payé en liquide » → `complementSettled = true`, `complementPaidCash = true`.
- [x] Arrival recap « En fin de séjour » → shows the « Reporté au check-out » caption; commit
      `complementSettled = false`, `complementPaidCash = false`.
- [x] Departure recap « Payé en liquide » → `complementsSettled = true`, `complementsPaidCash = true`, and **no**
      « En fin de séjour » button is rendered.
- [x] Existing departure-recall test updated to click « CB / Chèque » (was the « Compléments encaissés »
      checkbox). Full SAS suite (20) + full client suite (676) green.

### Manual UI verification
- [x] Arrival recap: the three buttons render; each maps to the right paid flags (verified live + in the DB).
- [x] Departure recap: two buttons, no defer; « Payé en liquide » marks caisse interne.

## 8. Out of scope

- Moving the arrival complement amount physically into the end-of-stay complement (rejected — recall keeps the
  amounts separate, accounting-safe).
- Any change to the accounting routing or the financial-tracking treatment of the flags (unchanged).
- Per-line settlement (the buttons settle the whole complement, as the checkboxes did).

## 9. Open questions

Resolved during scoping (2026-07-20):
- **« En fin de séjour » behaviour** → **leave the arrival complement unpaid → recalled at check-out** (reuse
  the existing recall mechanism; keep the two complements separate in the DB, accounting-safe). The alternative
  (merge into the end-of-stay complement as a 70600010 line) was rejected.
