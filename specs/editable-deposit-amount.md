# Editable deposit amount

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/editable-deposit-amount` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The deposit ("acompte") of a direct reservation is computed by the pricing engine as
`acompte = preArrival × property.depositPercent%`, and the balance ("solde") as
`solde = preArrival − acompte` ([pricing.js:1361](../server/src/utils/pricing.js#L1361)).
Today the amount is **read-only** in the UI: [FinanceSection.js](../client/src/components/reservation/FinanceSection.js)
only lets the operator edit the due dates and the paid toggles, and [PricingSummary.js](../client/src/components/PricingSummary.js)
displays `quote.depositAmount` / `quote.balanceAmount` as plain text.

Operators sometimes negotiate a deposit that differs from the default percentage (a round number,
a client arrangement). They currently have no way to set it.

## 2. Goal

On a direct reservation, the operator can override the deposit amount with a manual value. Once
overridden, the deposit is **frozen** at that value and the balance absorbs the rest of the
pre-arrival total — including any later increase (added options, etc.). Clearing the field restores
the automatic calculation.

## 3. Functional rules

1. The deposit amount field is **editable** only for **direct** reservations whose deposit is **not
   disabled** (`depositDisabled = 0`). Platform reservations have no deposit (unchanged) and the
   `depositDisabled` opt-out keeps showing "Acompte désactivé — ajouté au solde" (unchanged).
2. **Empty field = automatic.** When no override is set (`depositAmountOverride = NULL`), the engine
   keeps the historic behaviour: `acompte = preArrival × depositPercent%`, `solde = preArrival − acompte`.
3. **A manual value freezes the deposit.** When `depositAmountOverride` is set, the engine uses it as
   the deposit and recomputes `solde = preArrival − acompte`. The override is re-fed to the engine on
   every recompute, so the deposit **does not change** when the stay total changes — the delta lands
   in the **solde** (and, once both deposit and balance are paid, in the Complément, exactly like a
   paid deposit does today).
4. The override is **clamped** to `[0, preArrival]`: a value above the pre-arrival total collapses to
   `preArrival` (deposit = whole pre-arrival, balance = 0); a negative value is rejected at the
   validation boundary (`NEGATIVE_AMOUNT`).
5. Marking the deposit **paid** does not change the amount: the paid path already freezes
   `depositAmount` (rule 3 just makes the same freeze happen *before* payment). Editing is disabled
   once the deposit is paid.
6. Clearing the field (empty) **restores the automatic calculation** on the next recompute.
7. **"Actualiser tarifs"** refreshes the accommodation base price to the current catalog but does
   **not** clear the override — per the operator's decision the deposit stays frozen; only the solde
   reflects the refreshed total. (To return to auto, clear the field.)
8. The override survives reload: it is persisted on the reservation and rehydrated into the form.

**Edge cases:**
- Override set, then platform changed to non-direct → engine ignores the override (platform branch
  forces deposit = 0); the stored value is harmless and is re-applied only if the platform reverts to direct.
- Override set, then `depositDisabled` toggled ON → deposit = 0, balance absorbs all (disabled branch
  wins); override ignored while disabled.
- Override > preArrival → deposit clamped to preArrival, balance = 0.
- Override = 0 → deposit explicitly 0, balance = full preArrival (distinct from "auto", which would
  apply the percentage). This is a legitimate "no deposit, but deposit concept still on" choice.

---

## 4. Architecture

> **Fat backend, thin frontend.** The freeze/clamp/recompute logic lives entirely in the pricing
> engine. The client only renders an editable field and round-trips the raw override value.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | — | No signature change (body field is additive). |
| `controllers/` | `reservationsController.js` | T | Read `depositAmountOverride` from body, validate it (money), pass to the engine on create + update. |
| `models/` | `reservationsModel.js` | T | Persist `depositAmountOverride` (insert + update); rehydrate it (coerced to `''`/number) in `getByIdWithDetails`. |
| `utils/` | `pricing.js` | T | New `depositAmountOverride` param; frozen-deposit branch (direct + not disabled + not paid) with clamp to `[0, preArrival]`. |
| `utils/` | `financeValidation.js` | — | Reused as-is (`validateMoneyAmount` already treats empty/null as "not provided"). |
| `database.js` | `database.js` | T | Idempotent migration: `ALTER TABLE reservations ADD COLUMN depositAmountOverride REAL` (nullable, NULL = auto). |
| `tests/` | `pricing.deposit-override.test.js` | C | Unit tests for rules 2–4 + edge cases. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | `depositAmountOverride` in form state, quote input, and save payload; hydrate from loaded reservation. |
| `components/` | `reservation/FinanceSection.js` | T | Editable "Montant acompte" field (`ArithmeticTextField`) in the Acompte block; disabled when paid / disabled / platform. |
| `components/` | `PricingSummary.js` | — | Unchanged — already renders `quote.depositAmount` / `quote.balanceAmount`. |
| `api.js` | `api.js` | — | Unchanged — payload is a plain object, field passes through. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `ArithmeticTextField` | Same component already used for `customPrice`; supports arithmetic + commit-on-blur. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `FinanceSection` | Already reservation-specific. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations` | `{ …, depositAmountOverride? }` | `{ id }` | `depositAmountOverride`: number ≥ 0 or null/'' (auto). |
| PUT | `/api/reservations/:id` | `{ …, depositAmountOverride? }` | reservation | Same; rejected with `NEGATIVE_AMOUNT` if < 0. |
| GET | `/api/reservations/:id` | — | `{ …, depositAmountOverride }` | `''` when auto, number when overridden. |

---

## 5. Data model

New column on `reservations`:

```sql
ALTER TABLE reservations ADD COLUMN depositAmountOverride REAL;  -- nullable; NULL = automatic
```

- Idempotent block in [database.js](../server/src/database.js) (guarded by `cols.includes(...)`).
- Default for existing rows: `NULL` → automatic calculation → behaviour unchanged.
- No backfill. `depositAmount` (the resolved amount) stays the persisted authoritative figure used
  by accounting; `depositAmountOverride` is only the operator's frozen input re-fed to the engine.

**Data impact:** none on existing records — they keep `NULL` and behave exactly as before.

## 6. UI / UX

**Acompte block in `FinanceSection` (direct, not disabled):**
- A new `ArithmeticTextField` labelled **"Montant acompte (€)"** above the existing "Échéance acompte"
  field, mirroring the "Prix ajusté" pattern.
- Empty value → placeholder/helper text "Calcul auto ({depositPercent}%)" so the operator sees what
  auto would produce; the actual computed amount is shown in the right-panel summary.
- Helper text when a value is set: "Acompte figé — le solde absorbe les variations de tarif."
- Disabled when the deposit is paid (`form.depositPaid`) — with helper "Acompte payé, montant figé."
- Not shown at all for platform reservations / when `depositDisabled` is ON (existing italic notes stay).

**`PricingSummary` (right panel):** unchanged — the Acompte / Solde lines already reflect the
engine's `depositAmount` / `balanceAmount`, so the override is visible there live as the operator types.

**Responsive:** the field is inside the existing Acompte `Grid` cell (`xs=12, md=6`); it inherits the
section's responsive stacking. `ArithmeticTextField` is `fullWidth size="small"` — full-width on `xs`,
half-column on `md+`. No new breakpoint logic.

**`PageActionBar`:** not touched — `ReservationPage` already owns its action bar; this change adds no
page-level action.

## 7. Test plan

### Server unit tests
- [ ] `tests/pricing.deposit-override.test.js`
  - rule 2 — no override → percentage-based deposit + balance (unchanged).
  - rule 3 — override set → deposit frozen, balance = preArrival − override; adding an option grows
    the balance, not the deposit.
  - rule 4 — override > preArrival → deposit clamped to preArrival, balance 0.
  - edge — override = 0 → deposit 0, balance = full preArrival.
  - edge — override ignored when platform non-direct and when `depositDisabled = 1`.

### Manual UI verification
- [ ] Happy path: direct reservation, type an override → summary shows frozen deposit + adjusted solde; save + reload keeps it.
- [ ] Add an option after setting the override → solde increases, deposit unchanged.
- [ ] Clear the field → deposit returns to the percentage calculation.
- [ ] Regression: platform reservation still shows "Pas d'acompte"; `depositDisabled` toggle still shows "Acompte désactivé".
- [ ] Mobile (`xs`): field stacks full-width, no horizontal scroll.

## 8. Out of scope

- Editing the **balance** directly (it stays derived = preArrival − deposit).
- A per-property default "deposit as fixed amount" setting (this is per-reservation only).
- Changing how a **paid** deposit behaves (already frozen).
- Platform reservations' single-transfer model.

## 9. Open questions

- Q: On "Actualiser tarifs", should the override be cleared back to auto?
  - A (2026-06-11, Adrien): **No.** Once set manually the deposit must not change; only the solde
    reflects tariff changes. Clearing the field is the explicit way back to auto. (Rule 7.)
- Q: Which dropdowns/screens are affected?
  - A: Only the reservation editor (FinanceSection + PricingSummary). No other screen edits the deposit.
