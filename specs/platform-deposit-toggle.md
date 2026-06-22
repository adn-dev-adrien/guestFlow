# Per-platform « acompte » toggle

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-deposit-toggle` _(user-managed)_ |
| **Created** | 2026-06-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Today **every platform reservation is forced to a single payment**: the pricing engine sets
`depositAmount = 0` and puts the whole pre-arrival total in the `balanceAmount` (solde), for any
`platform !== 'direct'` (see [pricing.js](../server/src/utils/pricing.js) `if (platformIsNonDirect)`).
This was correct for Airbnb/Booking (one net transfer), but the operator is now treating their own
channel (**Lodgify**) as a platform, and there the guest pays an **acompte then a solde** — so the
all-in-solde rule is wrong for it.

## 2. Goal

In « Logement › Plateformes et iCal », the operator can declare, per platform, whether reservations on
that platform **take an acompte** or not. Default = **no acompte** (everything in the solde, exactly
as today). When « avec acompte », a platform reservation uses the normal acompte/solde split (the
property's deposit %), like a direct booking.

## 3. Functional rules

1. A new per-platform setting **« Acompte »** (Oui / Non) is shown in the property platforms table,
   next to « Taxe de séjour ». Like the tax mode, it is **global per platform** (changing it applies to
   every property) and hidden for the `direct` row (direct always has its own deposit flow).
2. Default = **Non** (no acompte). Existing platforms are unaffected: all platform reservations keep
   `depositAmount = 0`, everything in the solde.
3. When a platform is set to **« Acompte = Oui »**, its reservations use the normal deposit/balance
   split: `depositAmount = depositPercent(property) × preArrival`, `balanceAmount = remainder` — the
   same chain as direct bookings (so `depositAmountOverride`, `depositPaid`, `depositDisabled` all
   apply as usual).
4. **Commission interaction (the « solde = net » invariant is preserved).** For a platform with a
   per-reservation commission (`platformCommissionAmount > 0`), the stored acompte + solde are the
   operator's **net** amounts: `acompte + solde = preArrival − commission`. The acompte is the
   property `depositPercent` applied to that **net** pre-arrival; the solde absorbs the rest.
   - No-acompte platform → `acompte = 0`, `solde = preArrival − commission` (unchanged).
   - With-acompte platform → `acompte = depositPercent × (preArrival − commission)`,
     `solde = (preArrival − commission) − acompte`.
5. **Accounting — commission allocated proportionally across acompte + solde.** The platform commission
   is split **pro rata of the stored amount across the deposit + balance only** (`commission_kind =
   commission × amount_kind / (deposit + balance)`); the **complement is excluded** (on-site, host-
   billed — no platform commission, unchanged rule). The balance carries the rounding remainder so Σ =
   the entered commission. Backward-compatible: a no-acompte platform has `acompte = 0`, so the whole
   commission still lands on the solde. With an acompte, each échéance's **net cash = its stored
   amount** and the **CA = finalPrice** (the gross-up + proportional commission cancel exactly).
   "Treat the acompte like the solde" (operator's words): the acompte carries its proportional share of
   the commission, just like the solde does today.
6. The toggle changes only the **deposit split + commission allocation**; the **total séjour**,
   **net perçu**, **tourist-tax routing** and **forced-extras-to-complement** rules are unchanged.

**Edge cases:**
- Platform with acompte but `platformCommissionAmount = 0` → plain acompte/solde split, no commission
  lines, `grossRatio = 1` (gross === net). Simplest path.
- `depositDisabled = ON` on a with-acompte platform reservation → deposit forced to 0 (the
  per-reservation opt-out wins over the platform setting).
- A platform switched from « Oui » to « Non » → on the next recompute/save, existing reservations
  collapse the acompte back into the solde (the engine re-derives on every save).

---

## 4. Architecture

> **Fat backend.** The deposit split + commission allocation are 100 % engine/accounting. The client
> only renders the new toggle and the (already-computed) acompte/solde figures.

> **Fiche display (fix 2026-06-22).** `FinanceSection` previously hid the Acompte block for **every**
> platform reservation (« Pas d'acompte — virement unique »), so a platform set « Acompte = Oui » still
> showed no acompte on the fiche. The engine now **echoes `platformTakesDeposit`** in the live quote, and
> `FinanceSection` shows the normal Acompte block (override + due date + « marquer payé ») when the
> reservation is direct **or** a platform with `platformTakesDeposit`; the « pas d'acompte » caption is
> kept only for a platform set « Non ». `PricingSummary` already reads `form.depositAmount` (synced from
> the quote), so the acompte amount displays once the engine returns it.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE platforms ADD COLUMN platformTakesDeposit INTEGER NOT NULL DEFAULT 0`. |
| `schema.sql` | `schema.sql` | T | Same column in the baseline. |
| `models/` | `platformsModel.js` | T | Read `platformTakesDeposit` in `listForProperty`; `getDepositMode(name)` + `setDepositMode(name, takes)`; include it in the dedup-preserved settings. |
| `controllers/` | `platformsController.js` | T | `setDepositMode` handler. |
| `controllers/` | `reservationsController.js` | T | Resolve the platform's `platformTakesDeposit` (by name) and pass it to the engine at the 3 quote call sites. |
| `routes/` | `platforms.js` | T | `PUT /platforms/:key/deposit-mode`. |
| `utils/` | `pricing.js` | T | Accept `platformTakesDeposit`; gate the deposit-forcing branch on it; deduct the commission from the balance after the split (net invariant). |
| `models/` | `accountingModel.js` | T | Allocate the platform commission **pro rata** across kinds (replaces balance-only). |
| `tests/` | `platform-deposit-toggle.unit.test.js` | C | Engine: net split + commission; accounting: proportional commission, net cash per kind, CA = finalPrice, backward-compat with no-acompte. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `PropertyDetail.js` | T | New « Acompte » control (Oui/Non) per platform row, wired like `renderTaxControl` (live in read mode, draft in edit). |
| `api.js` | `api.js` | T | `setPlatformDepositMode(platformKey, takesDeposit)`. |

**Component reuse:** no new component — reuses the existing platforms-table row + a small MUI `Select`
mirroring `renderTaxControl`.

### 4.3 API contract

| Method | Endpoint | Body | Response |
|---|---|---|---|
| PUT | `/api/platforms/:key/deposit-mode` | `{ takesDeposit: boolean }` | `{ name, platformTakesDeposit }` |
| GET | `/api/properties/:id/platforms` | — | each row gains `platformTakesDeposit` (0/1) |

## 5. Data model

`ALTER TABLE platforms ADD COLUMN platformTakesDeposit INTEGER NOT NULL DEFAULT 0` (idempotent + in
`schema.sql`). Default 0 = no acompte → **no behaviour change** for existing platforms. The slug-dedup
migration carries this setting over (treated as a customised value when = 1).

**Data impact:** none on existing reservations until they're re-saved on a platform flipped to « Oui ».

## 6. UI / UX

In the property platforms table, a compact **« Acompte »** `Select` (Oui / Non) per non-direct row,
beside « Taxe de séjour ». Read mode persists on change (live), edit mode stores to the draft and
persists on Save — identical pattern to the tax-mode control. `direct` row shows « — ».

**Responsive:** the control sits in the same expandable per-row cell as the tax mode on `xs`; on `md+`
it's a column. No layout overhaul.

## 7. Test plan

### Server unit tests — `tests/platform-deposit-toggle.unit.test.js` (7)
- [x] Engine: with-acompte platform → `acompte = depositPercent × (preArrival − commission)`,
  `acompte + solde = preArrival − commission`; no-acompte → `acompte = 0` (unchanged).
- [x] Engine: manual override → solde absorbs the rest of the net; `depositDisabled` wins over a
  with-acompte platform.
- [x] Accounting: deposit + balance both carry their pro-rata commission; **net cash per kind = stored
  amount**; **Σ CA = finalPrice**; Σ debits = Σ credits.
- [x] Accounting backward-compat: a no-acompte platform (deposit 0) still books the whole commission on
  the solde — existing `accounting-commission-lines` + `accounting-no-deposit-on-platform` stay green.
- Full server suite: **1803/1803**.

### Manual UI verification (2026-06-22, Playwright on dev :3000)
- [x] « Acompte » column renders in the property platforms table; setting Airbnb « Oui » persists
  (`platformTakesDeposit` 0 → 1) and is exposed on `GET /properties/:id/platforms`.
- [x] With Airbnb « Oui », reservation #12087 (finalPrice 360) splits into acompte 72 + solde 168
  (= 240 pre-arrival, 30 %) instead of all-in-solde; restored to « Non » after.
- Client suite **574/574**, build green.

## 8. Out of scope

- Per-(property, platform) acompte (it's global per platform, like the tax mode).
- Changing how the platform commission € is entered (still `platformCommissionAmount`).
- The reverted per-payment-method / Stripe commission feature (PR #274).

## 9. Open questions

- Q: For a platform **with a commission**, is the displayed/stored acompte the operator's **net** share
  or the **gross** the guest pays?
  - A: **Net** — resolved 2026-06-22. The operator's words: "treat the acompte like the solde" — the
    acompte carries its proportional share of the commission (just like the solde today), and
    `acompte + solde = net perçu = total − commission`. The acompte amount is manually overridable; a
    smaller acompte → larger solde; in all cases it reconciles to the séjour total.
- Q: Status → `Approved`/`Implemented` once shipped.
  - A: Implementing now.
