# Direct reservations — per-payment-method commissions

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/direct-payment-method-commission` _(user-managed)_ |
| **Created** | 2026-06-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Platform reservations (Airbnb, Booking, Gîtes de France…) already carry a **commission**: the
operator types the platform's commission in the « Paiement plateforme » block, the pricing engine
([pricing.js](../server/src/utils/pricing.js#L1599)) computes `net perçu = total − commission`, sets
the solde to that net, and the accounting layer
([accountingModel.js](../server/src/models/accountingModel.js#L332)) books a commission expense line
and grosses the CA back up to the brut. See `specs/platform-commission-line.md` and
`specs/platform-payment-entry.md`.

**Direct reservations** (`platform = 'direct'`) have **no commission concept at all** today. Yet a
direct booking is also subject to fees: when the guest pays by **carte bancaire / SumUp / Stripe**,
the payment processor retains a percentage. The operator currently has no way to record that fee, so
the net actually received and the accounting are wrong for any card-paid direct booking.

Unlike platforms — where a single commission rides on the whole stay — a direct reservation is split
into up to three échéances (**acompte / solde / complément**), and each échéance can be paid by a
**different** means (e.g. acompte by card, solde by transfer, complément in cash). The commission
must therefore be resolved **per échéance**, from the payment method chosen for that échéance.

## 2. Goal

For a direct reservation, the operator can pick a **moyen de paiement** for each échéance (acompte /
solde / complément). Each payment method carries a configurable commission rate (set once in
Paramètres); the engine computes the per-échéance commission, the resulting **net perçu**, and the
accounting books the fee exactly as it already does for platform commissions.

## 3. Functional rules

### 3.1 Payment-method catalogue (Paramètres)

1. A new **Moyens de paiement** section in Paramètres manages a list of payment methods. Each method
   has: a **name** (unique, e.g. « Virement », « Espèces », « Chèque », « Carte bancaire »), a
   **commission rate** in `%` (≥ 0, default `0`), a **fixed fee** in `€` (≥ 0, default `0` — the
   per-transaction flat part some processors bill, e.g. Stripe « 0,25 € + 2,5 % »), an optional
   **commission account number** (falls back to `app_settings.defaultCommissionAccountNumber` when
   blank), a **VAT-on-commission** flag, an **active** flag, and a **default** flag (exactly one method
   is the default).
2. The list is seeded on first migration with four methods, all at **0 %** so existing data is
   unaffected: « Virement » (**default**), « Espèces », « Chèque », « Carte bancaire ». The operator
   then edits « Carte bancaire » (and any other) to its real rate.
3. A method that is referenced by at least one reservation cannot be hard-deleted; it is
   **deactivated** (`isActive = 0`) instead — it disappears from the pickers but historical
   reservations keep their stored snapshot.
4. Setting a method as default clears the flag on the previously-default method (exactly one default
   at all times). The default method cannot be deactivated.

### 3.2 Per-échéance selection on a direct reservation

5. Payment-method selection applies **only to direct reservations** (`platform = 'direct'`). For
   platform reservations the existing « Paiement plateforme » commission flow is untouched and no
   payment-method picker is shown.
6. A direct reservation stores a payment method for each of its three échéances: **acompte**,
   **solde**, **complément**. When unset (new reservation, or échéance amount = 0), each defaults to
   the catalogue's **default** method.
7. The UI defaults to **one method for the whole reservation** (the same method pre-selected on the
   three échéances). The operator can expand a « détailler par paiement » control to assign a
   different method to each échéance.

### 3.3 Commission computation (engine, authoritative)

8. For each échéance `k ∈ {deposit, balance, complement}` of a direct reservation, the engine computes
   `commission_k = amount_k > 0 ? roundMoney(fixed(method_k) + amount_k × rate(method_k) / 100) : 0`,
   where `amount_k` is the échéance's **TTC** amount and `rate`/`fixed` are the chosen method's rate +
   per-transaction fixed fee. Each charged échéance is one processor transaction, so the **fixed part is
   billed once per non-zero échéance** (a 0 € échéance is no transaction → no fee). Resolved 2026-06-22.
9. The reservation's **total commission** = `commission_deposit + commission_balance +
   commission_complement`; the reservation's **net perçu** = `(deposit + balance + complement) − total
   commission` — i.e. the total actually charged to the guest across the three échéances (tax included,
   since the processor bills on the full transaction) minus the fees. It is **not** `finalPrice − commission`
   (`finalPrice` excludes the tourist tax, which would silently drop the tax riding in an échéance from the
   net). Resolved 2026-06-22 during UI verification.
10. The échéance amounts the guest owes (acompte / solde / complément) are **unchanged** by the
    commission — the guest pays the full amount; the commission is the fee the operator's processor
    retains. (This differs from platforms, where the platform already withheld the fee before paying
    the operator, so the platform's solde is reduced to the net. Here the gross is what the guest pays
    and what the operator books as CA; the fee is a separate expense.)
11. A method at `0 %` produces `commission_k = 0` and a net perçu equal to the gross — i.e. the exact
    behaviour of today's direct reservations (no regression).
12. Commission amounts are **snapshotted** on the reservation at save time (recomputed by the engine
    on every save, like every other derived figure). Changing a method's rate in Paramètres later does
    **not** retroactively alter already-saved reservations until they are re-saved.

### 3.4 Accounting

13. Each **paid** échéance of a direct reservation with a non-zero commission books, in addition to
    its existing revenue/encaissement lines:
    - a **commission expense** debit on the method's commission account (or the global default),
    - an optional **deductible VAT** debit when the method's VAT-on-commission flag is set,
    - the client/bank encaissement line is the échéance amount **net of its commission** (the real
      bank movement), exactly as the platform path already nets the solde.
14. No CA gross-up is applied for direct reservations: the stored échéance amounts already sum to
    `finalPrice` (the full gross), so the CA is recognised on the gross with `grossRatio = 1`. The
    commission is purely an expense + a reduction of the net cash line. (The gross-up exists only for
    platforms because they store **net** amounts.)
15. The accounting commission account / VAT resolution mirrors the platform path
    (`resolveCommissionConfig`), but reads the **payment method** config instead of the **platform**
    config.

**Edge cases:**
- Échéance amount = 0 (e.g. no acompte) → `commission = 0`, no commission line, method irrelevant
  (still defaulted for consistency).
- Reservation switched from platform → direct (or vice-versa) → on save, the engine clears the
  irrelevant commission family (platform commission for direct, payment-method commissions for
  platform) so the two mechanisms never stack.
- A reservation referencing a now-deactivated method → the stored snapshot (amount + account) is used
  for accounting; the picker shows the deactivated method as the current value (disabled/greyed) until
  the operator changes it.
- All methods at 0 % (fresh install, untouched seed) → behaviour identical to pre-feature: net perçu =
  gross everywhere, no commission lines.

---

## 4. Architecture

> **Fat backend, thin frontend.** Rate lookup, per-échéance commission math, net-perçu, and all
> accounting belong to the engine and accounting models. The client only renders the method pickers,
> the ready-computed commission/net figures returned by `calculate-price`, and the Paramètres CRUD
> form. No commission math runs in React.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: create `payment_methods` table, seed 4 methods, add `{deposit,balance,complement}PaymentMethodId` + `{deposit,balance,complement}CommissionAmount` columns to `reservations`. |
| `models/` | `paymentMethodsModel.js` | C | CRUD over `payment_methods` (list active/all, create, update, set-default, deactivate); guards single-default + no-delete-if-referenced. |
| `models/` | `reservationsModel.js` | T | Read/write the 3 method ids + 3 commission snapshots on insert/update; clamp/normalize per direct-vs-platform. |
| `models/` | `accountingModel.js` | T | In `buildEntry`, for direct reservations resolve per-échéance method commission → expense + VAT debit + net cash line (mirrors platform branch); `grossRatio = 1`. |
| `controllers/` | `paymentMethodsController.js` | C | Thin handlers for the CRUD endpoints; validation (name required/unique, rate ≥ 0, exactly one default). |
| `controllers/` | `reservationsController.js` | T | Accept + validate the 3 method ids on calculate-price/create/update; forward to engine; persist snapshots from the quote. |
| `routes/` | `paymentMethods.js` | C | `GET/POST/PUT/DELETE /api/payment-methods` (+ set-default), thin → controller. |
| `routes/` | `index.js` (or app wiring) | T | Mount the new router. |
| `utils/` | `pricing.js` | T | `calculateReservationQuote`: accept the 3 method ids + a method-rate map, compute `commission_k`, total commission, net perçu; expose them in the returned quote. Pure, unit-tested. |
| `tests/` | `directPaymentCommission.unit.test.js` | C | Engine per-échéance commission math + edge cases (0 %, mixed methods, platform vs direct exclusivity). |
| `tests/` | `paymentMethodsModel.unit.test.js` | C | Single-default invariant, deactivate-not-delete, seed. |

**Notes:**
- The engine needs the methods' rates. Controller loads the active methods once and passes a
  `{ id → { rate, account, hasVat } }` map into the quote call (the engine stays pure — no DB access).
- Routes stay thin; all invariants live in `paymentMethodsModel` / `paymentMethodsController`.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `SettingsPage.js` | T | Mounts the new payment-methods section + wires its load/save into the settings flow. |
| `components/` | `SettingsPaymentMethodsSection.js` | C | Paramètres CRUD: list rows (name, rate %, account, VAT, default radio, active toggle), add/edit/deactivate. |
| `components/reservation/` | `FinanceSection.js` | T | For direct reservations, render the per-échéance method pickers (collapsed = one global method; expandable per échéance) + the net-perçu read-out. |
| `components/` | `PricingSummary.js` | T | Show, per échéance, the commission (when > 0) and the reservation's total commission + net perçu, mirroring the platform 3-line block. |
| `components/reservation/` | `ReservationFormContext` (provider) | T | Carry the 3 method ids in form state; include them in calculate-price + save payloads. |
| `api.js` | `api.js` | T | `getPaymentMethods()`, `createPaymentMethod()`, `updatePaymentMethod()`, `deletePaymentMethod()`; thread the 3 method ids through reservation calls. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar` (Settings save/cancel — unchanged), `FormDialog`/MUI `Select`, `ArithmeticTextField`/`HelpedTextField`, the platform-block layout in `FinanceSection`/`PricingSummary` | Reuse the platform commission block's visual language for the direct net-perçu read-out. |
| **Created (new generic)** | `PaymentMethodSelect` (MUI `Select` bound to the active payment-methods list, with the deactivated-current-value handling) | Generic: reused by all three échéance pickers and any future place a method must be chosen. JSDoc header listing props. |
| **Specific (kept feature-local)** | `SettingsPaymentMethodsSection` | Tied to the Paramètres CRUD + single-default/seed semantics; not reusable elsewhere. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/payment-methods` | — (`?all=1` to include inactive) | `[{ id, name, commissionPercent, commissionAccountNumber, hasVatOnCommission, isDefault, isActive, sortOrder }]` | Active-only by default. |
| POST | `/api/payment-methods` | `{ name, commissionPercent, commissionAccountNumber?, hasVatOnCommission?, isDefault? }` | created method | 400 on dup name / rate < 0. |
| PUT | `/api/payment-methods/:id` | partial of the above | updated method | Setting `isDefault:true` clears the previous default. |
| DELETE | `/api/payment-methods/:id` | — | `{ deactivated: true }` or `{ deleted: true }` | Deactivates if referenced; hard-deletes only if unused and not default. |
| POST | `/api/reservations/calculate-price` | adds `depositPaymentMethodId`, `balancePaymentMethodId`, `complementPaymentMethodId` | quote adds `depositCommissionAmount`, `balanceCommissionAmount`, `complementCommissionAmount`, `totalPaymentCommission`, `netReceivedAmount` | Direct only; ignored for platform. |
| POST/PUT | `/api/reservations` / `/api/reservations/:id` | same 3 ids | reservation incl. the 3 snapshots | Persists engine output. |

---

## 5. Data model

**New table `payment_methods`** (mirrors the `platforms` catalogue pattern):

```sql
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  commissionPercent REAL NOT NULL DEFAULT 0,
  commissionFixed REAL NOT NULL DEFAULT 0,      -- per-transaction flat fee (€), e.g. Stripe 0,25 €
  commissionAccountNumber TEXT,                 -- NULL → app_settings.defaultCommissionAccountNumber
  hasVatOnCommission INTEGER NOT NULL DEFAULT 0,
  isDefault INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
```

`commissionFixed` is added by an idempotent `ALTER TABLE … ADD COLUMN` (DEFAULT 0) for DBs predating it.

Seed (idempotent, only if table empty): Virement (0 %, default), Espèces (0 %), Chèque (0 %), Carte
bancaire (0 %).

**`reservations` new columns** (idempotent `ADD COLUMN`):

```sql
depositPaymentMethodId     INTEGER         -- FK → payment_methods.id (nullable)
balancePaymentMethodId     INTEGER
complementPaymentMethodId  INTEGER
depositCommissionAmount    REAL DEFAULT 0  -- engine snapshot
balanceCommissionAmount    REAL DEFAULT 0
complementCommissionAmount REAL DEFAULT 0
```

**Migration strategy:** all blocks idempotent in `database.js`. Existing reservations get `NULL`
method ids (resolved to the default = Virement 0 % at read/compute) and `0` commissions → **no change
to any existing figure**. Seeds run only when `payment_methods` is empty.

**Data impact:** none on existing money. The seed methods are all 0 %, so no historical net/CA moves
until the operator both sets a real rate **and** re-saves a reservation.

## 6. UI / UX

### Paramètres — « Moyens de paiement »
A card listing each method as a row: **name**, **commission %** (number field), **compte de
commission** (text, optional, placeholder = the global default), **TVA sur commission** (switch),
**défaut** (radio, exactly one), **actif** (switch). « Ajouter un moyen de paiement » appends a draft
row. Save/cancel go through the existing Settings `PageActionBar` (no new bar). Copy in French.

### Réservation — FinanceSection (direct only)
Below the acompte/solde/complément amounts, a compact **« Moyen de paiement »** control. Collapsed
default: a single `PaymentMethodSelect` applying to the whole reservation. A « détailler par
paiement » toggle expands to three labelled selects (Acompte / Solde / Complément). When a selected
method's rate > 0, each échéance shows its commission inline (e.g. `Acompte 200 € · CB 1,5 % →
commission 3,00 €`).

### PricingSummary
When the reservation has any non-zero payment commission, append a block mirroring the platform one:
```
Total du séjour TTC ........ 700,00 €
Commission (moyens de paiement) ... − 12,25 €
Net perçu TTC .............. 687,75 €
```
For platform reservations this block keeps showing the platform commission (unchanged).

**Responsive:**
- `xs`: the three échéance selects stack vertically full-width; the Paramètres rows become stacked
  label/value cards (no wide table); dialogs `fullScreen`.
- `md`/`lg`: échéance selects sit on one row; Paramètres rows render as a table.

**Sticky action bar:** Paramètres reuses the existing Settings `PageActionBar` (Save/Cancel); the
reservation page bar is unchanged. No new bar introduced.

## 7. Test plan

### Server unit tests
- [x] `tests/directPaymentCommission.unit.test.js` (8 tests) — per-échéance commission (mixed methods,
  0 %, rounding); **Stripe fixed + variable (0,25 € + 2,5 %) billed once per non-zero échéance**; total
  commission + net perçu (= échéance sum − commission invariant); default fill; direct-vs-platform
  exclusivity; no-rate-map → zero.
- [x] `tests/paymentMethodsModel.unit.test.js` (10 tests) — seed; single-default invariant;
  deactivate-not-delete when referenced; default cannot be deactivated/deleted; rateMap includes inactive;
  **fixed fee round-trips + clamps ≥ 0**.
- [x] `tests/accounting-direct-payment-commission.unit.test.js` (5 tests) — a direct reservation with a
  card-paid balance books the commission expense + VAT (if flagged) and nets the bank line; `grossRatio = 1`;
  CA = finalPrice; Σ debits = Σ credits.
- Full server suite: **1789/1789** passing.

### Manual UI verification (2026-06-22, Playwright on dev :3000)
- [x] Paramètres: « Moyens de paiement » renders the 4 seeded methods; setting Carte bancaire to 1,5 %
  persists via the API round-trip.
- [x] Direct reservation #12081: « Moyen de paiement » block + « Détailler par paiement » toggle; picking
  Carte bancaire (1,5 %) → commission 8,71 € + net perçu 572,09 € in both FinanceSection and the
  PricingSummary « Commission (moyens de paiement) / Net perçu TTC » block (internally consistent).
- [x] Détailler par paiement → 3 selects (Acompte / Solde / Complément) with the per-échéance commission
  shown inline.
- [x] Client unit suite **574/574**, E2E **28 passed / 1 skipped**, client build green.
- [ ] Mobile (`xs`) spot-check — selects stack full-width (responsive `sx` verified in code; not re-shot).

## 8. Out of scope

- The `endOfStayComplementAmount` bucket (caution/end-of-stay) — keeps the default method, no
  dedicated picker for now (see Open questions).
- Per-method fixed fees (e.g. « 0,25 € + 1,5 % ») — percentage only in this iteration.
- Automatic detection of the real method from a PSP webhook — the operator selects it manually.
- Retroactively re-saving historical reservations to apply a newly-set rate — deliberate (rule 12).
- Any change to the platform commission mechanism.

## 9. Open questions

- Q: Is the commission rate applied on the **TTC** échéance amount or HT?
  - A: **TTC** — resolved 2026-06-22. Card processors bill on the total charged, taxe comprise.
- Q: Should `endOfStayComplementAmount` get its own method picker, or always follow the « complément »
  method / the default?
  - A: **Out of scope** this iteration — resolved 2026-06-22. It follows the « complément » method (no
    dedicated picker).
- Q: Can a method carry a per-method commission **account** + VAT flag (mirroring platforms), or is a
  single global commission account enough?
  - A: **Per-method account + VAT flag**, falling back to the global default — resolved 2026-06-22.
