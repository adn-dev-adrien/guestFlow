# Per-item routing to "Complément à percevoir" + per-line per-bucket contribution snapshots

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/force-item-to-complement` _(user-managed)_ |
| **Created** | 2026-06-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The reservation page splits money owed into three encaissements: **acompte** (deposit), **solde** (balance) and **complément à percevoir** (extras). The pricing engine ([pricing.js:1262-1300](server/src/utils/pricing.js#L1262-L1300)) handles the auto-distribution today via aggregate amounts:

- Both unpaid → `depositAmount = preArrivalAmount × depositPercent`, `balanceAmount` absorbs the rest, `complementAmount = 0`.
- Deposit paid, balance unpaid → `depositAmount` locked at received value, `balanceAmount` derives from current preArrival minus the locked deposit, complement = 0.
- Both paid → both locked, `complementAmount = max(0, totalStayTtc − depositAmount − balanceAmount)` absorbs anything added after.

The accounting export ([accountingModel.js:134](server/src/models/accountingModel.js#L134)) emits one journal entry per actually-paid encaissement and pro-rates each entry's per-bucket HT/VAT (accommodation / options / resources) against the **current** quote totals using `fraction = encaissementTtc / totalStayTtc`. This works mathematically (totals conserve) but has two gaps Adrien wants to lift:

1. **No manual override per item.** No way to say "this option / resource / custom / tourist-tax belongs in complément, regardless of the auto rules." Use cases: an item added late and invoiced separately, a cleaning fee handled cash-on-arrival, a tourist tax the owner wants outside the encaissements.
2. **Item growth pollutes earlier entries.** If an option starts at qty 1 (30 €), gets paid in acompte + solde, then the client adds qty 1 (now 60 €), the engine correctly absorbs the +30 € into `complementAmount`. But the journal pro-rates the **full 60 €** across all three entries, so the Acompte entry shows ~16 € of options even though the deposit was paid back when the option was only 30 €. Cross-bucket contamination. PricingSummary likewise shows ONE line "Ménage 60 €" with no visual indication of the split.

## 2. Goal

Each option / resource / custom option / tourist tax can be **manually routed to complément** via a per-item toggle (defaults to "auto"). The summary surfaces the routing as a discreet `compl.` chip next to the libellé.

Additionally, the operator's ventilation rules (what bucket a newly-added item lands in, based on payment state at the time) are made **persistent and auditable**: each item carries its **per-bucket contribution** (`acompteContribTtc`, `soldeContribTtc`) once frozen by a payment flip. The complement contribution is then derivable as `current − acompteContrib − soldeContrib` (auto delta) **+ 100 %** if forced. Same mechanism for accommodation and tourist tax at the reservation level.

Result: every accounting entry (Acompte / Solde / Complément) shows a per-bucket breakdown that **mathematically equals the payment amount** and contains **only** the items / portions actually attached to that bucket — no contamination from later growth.

## 3. Functional rules

### 3.1 Manual forced flag

1. Four new booleans store the forced override:
   - `reservation_options.inComplement INTEGER NOT NULL DEFAULT 0`
   - `reservation_resources.inComplement INTEGER NOT NULL DEFAULT 0`
   - `reservation_custom_options.inComplement INTEGER NOT NULL DEFAULT 0`
   - `reservations.touristTaxInComplement INTEGER NOT NULL DEFAULT 0`
2. `inComplement = 1` (or `touristTaxInComplement = 1`) means: **the item lives entirely in complément**, regardless of payment state.
   - Excluded from `preArrivalAmount` (the base used to compute deposit + balance).
   - Added to `complementAmount` at 100 % of current `totalPrice`.
   - Per-bucket contribution columns (§3.2) stay NULL for forced items — the engine treats NULL as "skip this line for that bucket".
3. **Offered items** (`offered = 1`, `totalPrice = 0`): the forced flag is still persisted (operator may un-offer later) but renders no chip in the summary while offered.
4. Toggling the flag in the UI mutates `form` → triggers the live recompute → PricingSummary updates without manual save.
5. Tourist tax forced flag composes with the existing `touristTaxCollectedOnArrival` (platform auto-routing) via OR: `taxRoutedToComplement = touristTaxInComplement || touristTaxCollectedOnArrival`. No double-count.

#### 3.1.bis Auto-options (early check-in / late check-out / …)

Auto-options (`option.autoOptionType ∈ {early_check_in, late_check_out, …}` + `autoEnabled = 1`) are derived by the engine — they aren't part of `form.selectedOptions` on the client. To still allow routing them to Complément (typical case: a late check-out fee Adrien collects on site), the routing flag travels through a parallel signal:

- **Form state**: `form.autoOptionsInComplement: number[]` — array of optionIds.
- **Payload**: same name, every payload-build site forwards it.
- **Engine input**: `autoOptionsInComplement` parameter on `calculateReservationQuote`. The `autoOptionLines` builder reads it: an auto-option whose id is in the set is flagged `inComplement = 1`, with `acompteContribTtc` / `soldeContribTtc` cleared to NULL (forced lines never carry contribs — §3.2 rule 10).
- **Persistence**: the engine writes `inComplement = 1` on the corresponding `reservation_options` row when the quote is saved, so on load-from-server the array is hydrated from `res.options.filter(o => o.autoOptionType && o.inComplement === 1)`.
- **Backward compat**: if the array is missing but the locked snapshot still has `inComplement = 1`, the engine keeps the line forced — so a reservation saved before the feature shipped doesn't lose its routing.
- **UI**: the same `Compl.` checkbox style as regular options, rendered in the `enabled && isAutoTimedOption` branch of `ExtrasSection`. Membership is read from `form.autoOptionsInComplement`, toggled via `setAutoOptionInComplement(optionId, next)`.

### 3.2 Per-line per-bucket contributions

6. Six new per-line columns store each item's locked contribution to acompte and solde (one set per child table):
   - `reservation_options.acompteContribTtc REAL DEFAULT NULL`
   - `reservation_options.soldeContribTtc REAL DEFAULT NULL`
   - Same on `reservation_resources` and `reservation_custom_options`.
7. Four new reservation-level columns store accommodation and tourist tax contributions:
   - `reservations.accommodationAcompteContribTtc REAL DEFAULT NULL`
   - `reservations.accommodationSoldeContribTtc REAL DEFAULT NULL`
   - `reservations.touristTaxAcompteContribTtc REAL DEFAULT NULL`
   - `reservations.touristTaxSoldeContribTtc REAL DEFAULT NULL`
8. **Capture trigger** — in `reservationsController.updatePayment` (the `PATCH /api/reservations/:id/payment` endpoint):

   **When `depositPaid` flips `0 → 1`:**
   ```pseudocode
   depositPercent_d = depositAmount / preArrivalAmount_d
   // preArrivalAmount_d = sum of non-forced item totalPrice + accommodation + (tax if not on arrival && not forced)

   for each non-forced child line present:
     line.acompteContribTtc = line.totalPrice × depositPercent_d

   reservation.accommodationAcompteContribTtc = currentAccommodationTtc × depositPercent_d
   reservation.touristTaxAcompteContribTtc =
     (touristTaxTotal > 0 && !touristTaxInComplement && !touristTaxCollectedOnArrival)
       ? touristTaxTotal × depositPercent_d
       : 0
   ```

   **When `balancePaid` flips `0 → 1`:**
   ```pseudocode
   for each non-forced child line present:
     if (line.acompteContribTtc IS NOT NULL):
       // Line was present before deposit-paid → completes the auto split
       line.soldeContribTtc = line.totalPrice − line.acompteContribTtc
     else:
       // Line added between deposit-paid and balance-paid → 100 % in solde
       line.soldeContribTtc = line.totalPrice

   reservation.accommodationSoldeContribTtc = currentAccommodationTtc − reservation.accommodationAcompteContribTtc
                                              (if accommodationAcompteContribTtc IS NULL, then = currentAccommodationTtc)
   // Same for touristTax (only when not routed to complement)
   ```

9. **Release trigger** — when a `*Paid` flag flips `1 → 0` (un-marking a payment for correction):
   - `acompteContribTtc` cleared on every line + accommodationAcompteContribTtc + touristTaxAcompteContribTtc when depositPaid `1 → 0`.
   - `soldeContribTtc` cleared on every line + accommodationSoldeContribTtc + touristTaxSoldeContribTtc when balancePaid `1 → 0`.
10. **Forced flag toggle interaction**: when a line is flipped to `inComplement = 1`, its `acompteContribTtc` and `soldeContribTtc` are cleared simultaneously (forced lines have NULL contribs, the engine treats them as 100 % in complement). When flipped back to 0 AFTER a payment was made: contribs stay NULL → the line acts as if added "now" — pre-paid portions don't retroactively exist.

### 3.3 Computation rules — three accounting groups

11. **Group 1A (Acompte entry)** bucket contributions:
    - `options HT` bucket TTC = Σ `line.acompteContribTtc` for option lines + sum of customOptions' `acompteContribTtc`
    - `resources HT` bucket TTC = Σ `line.acompteContribTtc` for resource lines
    - `accommodation HT` bucket TTC = `reservation.accommodationAcompteContribTtc`
    - `tax` portion = `reservation.touristTaxAcompteContribTtc`
    - **Invariant**: Σ of all these = `depositAmount` (exact match — see §3.4).
12. **Group 1B (Solde entry)** bucket contributions — same shape with `soldeContribTtc` values.
13. **Group 2 (Complément entry)** contributions:
    - Forced items at 100 % of current `totalPrice`
    - Non-forced items: `max(0, totalPrice − (acompteContribTtc || 0) − (soldeContribTtc || 0))` (delta after both paid)
    - Accommodation: `max(0, currentAccommodationTtc − (accommodationAcompteContribTtc || 0) − (accommodationSoldeContribTtc || 0))`
    - Tourist tax: forced → `touristTaxTotal` (full) ; auto on-arrival → `touristTaxTotal` (full) ; otherwise → `max(0, touristTaxTotal − acompteContrib − soldeContrib)` (delta from extension)
    - **Invariant**: Σ = `complementAmount`.
14. **HT/VAT extraction** per bucket: each TTC contribution is decomposed via the existing VAT rate columns (`vatPercentageAccommodation`, `vatPercentageOptions`, `vatPercentageResources`) — same logic as the current `buildEntry`, just applied to the snapshot values instead of pro-rated current values.

### 3.4 Conservation invariants

15. At every save / payment flip / live recompute, the engine asserts:
    - `depositAmount` ≡ Σ acompteContribTtc (across all lines + accommodation + tax) when `depositPaid = 1`.
    - `balanceAmount` ≡ Σ soldeContribTtc (across all lines + accommodation + tax) when `balancePaid = 1`.
    - `complementAmount` ≡ Σ complement contributions (forced 100 % + non-forced delta + accommodation delta + tax routing).
    - `depositAmount + balanceAmount + complementAmount ≡ finalPrice + touristTaxTotal` (TTC).
16. A unit test asserts every invariant on a matrix of scenarios (≥ 12 cases): all-unpaid, deposit-only-paid, both-paid; with / without forced items; with / without items added between payments; with / without item growth; with / without stay extension; with / without tax forced or on-arrival.

### 3.5 Access

17. Admin-only at the UI layer (accountants are already read-only on reservations server-side). No new RBAC plumbing.

**Edge cases:**

- Toggle a non-forced line to forced AFTER balance-paid: snapshot columns cleared on that line; engine treats it as 100 % complement. The PricingSummary loses the snapshot-portion line, shows only the `compl.` line. The complement amount grows by the snapshot portion that's no longer attributed to acompte+solde — and acompte+solde amounts shrink correspondingly. Acceptable because the operator is explicitly redirecting historical money.
- Toggle a forced line back to non-forced AFTER balance-paid: contribs stay NULL → the line acts as if added "now" → it ends up in complement via the auto-gap branch (because acompte + solde sums no longer cover everything). Same final amounts.
- Stay dates extended AFTER balance-paid: `accommodationAcompteContribTtc` + `accommodationSoldeContribTtc` are frozen at their captured values. `currentAccommodationTtc − sums` > 0 → accommodation portion in complement is the extension delta. Same handling as item growth.
- Stay dates extended BETWEEN deposit-paid and balance-paid: `accommodationAcompteContribTtc` is frozen; `accommodationSoldeContribTtc = currentAccommodationTtc − accommodationAcompteContribTtc` at balance-paid → absorbs the extension. Clean.
- `paidSnapshotDeposit > paidSnapshotBalance` (impossible in practice — would require shrinking between payments). The `max(0, …)` clamp prevents negative contributions; conservation invariant test catches any drift.
- Item removed AFTER balance-paid (e.g. refund): contribs stay (they represent what WAS in the entry). Complement = `currentTotalPrice − contribs` becomes negative → clamped to 0. The conservation invariant breaks (acompte+solde now > current item value); the engine emits a warning in the server log so the operator knows to manually correct.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | 14 idempotent `ALTER TABLE … ADD COLUMN` (with `if (!cols.includes(...))` guard). 4 × `inComplement` (3 child tables + reservations.touristTaxInComplement), 6 × `acompteContribTtc / soldeContribTtc` (2 per child table × 3), 4 × `accommodation*` + `touristTax*` contribs on `reservations`. |
| `models/` | `reservationsModel.js` | T | `replaceOptions` / `replaceCustomOptions` / `replaceResources` carry `inComplement` per line. They must **NOT** touch the contrib columns (those are written exclusively by the payment-flip code path; the main save would clobber them). `getByIdWithDetails` returns all the new fields per line + at the reservation level. |
| `controllers/` | `reservationsController.updatePayment` | T | Capture/clear contribs on `0 ↔ 1` flips, INSIDE the same transaction as the existing payment update (atomic). Compute `depositPercent_at_d = depositAmount / preArrivalAmount_d` at deposit-paid moment; multiply each item's `totalPrice` by it. At balance-paid: use `totalPrice − acompteContribTtc` for pre-deposit items, `totalPrice` for between items. Conservation invariant asserted before commit (sum of contribs equals depositAmount / balanceAmount). |
| `controllers/` | `reservationsController.create + update` | T | Propagate `inComplement` per line + `touristTaxInComplement` to `calculateReservationQuote`. When a line's `inComplement` flips `0 → 1` during the main save, clear its contrib columns at the same time (rule 10). Pass through to `model.updateReservation` for persistence. Add `touristTaxInComplement` to the 14-field past-lock allowlist. |
| `utils/` | `pricing.js` | T | `calculateReservationQuote` accepts the new fields, returns `quote.optionLines[i].inComplement` + `acompteContribTtc` + `soldeContribTtc` (read directly from the DB row passed in) + computed `complementPortion = totalPrice − (acompteContrib \|\| 0) − (soldeContrib \|\| 0)`. The aggregate math subtracts forced items + forced tax from `preArrivalAmount` (so deposit/balance auto-split applies to the auto group only). `complementAmount = forcedTotal + sum of delta portions (auto)`. **The existing `optionsTotal` / `optionsNetPrice` / etc. stay as full sums** (used for VAT extraction in the quote line table); accounting reads the per-line contribs instead. |
| `utils/` | `reservationAudit.js` | T | Add `touristTaxInComplement` to `HISTORY_FIELD_LABELS` (`"Taxe en complément"`). Per-line `inComplement` folded into `optionsSignature` / `resourcesSignature` (existing pattern). Contrib captures are logged via a separate `addHistoryEntry(id, 'payment-snapshot', { trigger, contribs })` call on the payment flip. |
| `models/` | `accountingModel.js` | T | `buildEntry` (line ~134): for `kind === 'deposit'`, build buckets by summing `acompteContribTtc` per line per kind + `reservation.accommodationAcompteContribTtc` + `reservation.touristTaxAcompteContribTtc`. Extract HT/VAT per bucket using the existing VAT-rate logic. Same for `kind === 'balance'` with `soldeContribTtc`. For `kind === 'complement'`: 100 % of forced items + delta for non-forced + accommodation delta + tax (full if forced/on-arrival, delta otherwise). Conservation invariant: each entry's sum-of-bucket-TTC equals `encaissementTtc`. |
| `tests/` | `pricing-force-and-snapshot.unit.test.js` | C | New file. ≥ 15 cases over the matrix (forced flag × payment state × snapshot presence × growth/extension). Conservation invariant asserted on every case. |
| `tests/` | `accounting-per-line-contribs.unit.test.js` | C | New file. Insert reservation, mark deposit paid → assert each non-forced line has `acompteContribTtc = totalPrice × depositPercent` and the sum equals `depositAmount`. Grow an option, mark balance paid, assert `soldeContribTtc` calculated correctly, sum equals `balanceAmount`. Run the export, assert the per-entry bucket TTC sums match the encaissement amounts and no contamination occurs (deposit entry's options HT = `acompteContribTtc → HT extraction`, not pro-rated against the grown total). |
| `tests/` | `payment-contrib-capture.unit.test.js` | C | New file. Drive `updatePayment` deposit 0→1 and balance 0→1; assert the contrib columns now contain the expected values per line. Verify 1→0 clears them. Forced lines stay NULL throughout. Conservation invariant asserted on capture. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | Each line in `form.selectedOptions` / `customOptions` / `selectedResources` carries `inComplement` (default `false`). `form.touristTaxInComplement` at the top level. All four payload-build sites (calc preview ×3 + final save) propagate the flags. The load-from-server step hydrates `inComplement` + `acompteContribTtc` + `soldeContribTtc` per line. `formSnapshot` memo deps extended so toggling triggers live recompute. |
| `components/reservation/` | `FinanceSection.js` | T | Each option / resource / custom row in the editor gets a `Checkbox` labelled *"Compl."* (tooltip *"À facturer dans le complément à percevoir, hors acompte / solde."*). Tourist tax section gets a `Switch` *"Taxe de séjour en complément"*. |
| `components/` | `PricingSummary.js` | T | For each line, render based on contribs + forced flag:<br/>• **Forced** → 1 line with `compl.` chip + full `totalPrice`.<br/>• **Non-forced**, `totalPrice > acompteContrib + soldeContrib` (delta exists, post-payment growth) → **2 lines** : `<libellé> <split portion>` (no chip) + `<libellé> (+<delta>) [compl.]`.<br/>• **Non-forced**, no delta → 1 line, no chip (current behaviour).<br/>Tourist tax row applies the same logic with `touristTaxInComplement` + `touristTaxAcompteContribTtc` + `touristTaxSoldeContribTtc`. |
| `api.js` | `api.js` | — | No change — payloads already carry arbitrary line fields. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Checkbox`, `Switch`, `Chip`, `Tooltip` (MUI) | Already used throughout the reservation form. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | The "Compl." column in FinanceSection; the duplicated-line rendering in PricingSummary | Both are page-specific. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST / PUT | `/api/reservations[/:id]` | `{ …, touristTaxInComplement?: 0\|1, selectedOptions: [{ …, inComplement?: 0\|1 }], customOptions: [{ …, inComplement?: 0\|1 }], selectedResources: [{ …, inComplement?: 0\|1 }] }` | Updated reservation includes flags + contrib columns per line | Defaults to `0` / `NULL`. |
| PATCH | `/api/reservations/:id/payment` | unchanged | unchanged | Contrib capture/clear happens internally on `*Paid` flips. |
| GET | `/api/reservations[/:id]` | — | Each line includes `inComplement`, `acompteContribTtc`, `soldeContribTtc`; reservation row includes `touristTaxInComplement`, `accommodationAcompteContribTtc`, `accommodationSoldeContribTtc`, `touristTaxAcompteContribTtc`, `touristTaxSoldeContribTtc` | Wired via existing `r.*` + child-table SELECTs. |
| `/api/accounting/sales[.csv]` / `/platforms` | — | unchanged contract | Per-entry buckets now read from the per-line + reservation contrib columns instead of pro-rating current totals | CSV column layout identical. |

---

## 5. Data model

**New columns** (idempotent `if (!cols.includes(...))` guards in `server/src/database.js`):

```sql
-- Forced override flags (4)
ALTER TABLE reservation_options        ADD COLUMN inComplement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservation_resources      ADD COLUMN inComplement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservation_custom_options ADD COLUMN inComplement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservations               ADD COLUMN touristTaxInComplement INTEGER NOT NULL DEFAULT 0;

-- Per-line per-bucket contributions (6)
ALTER TABLE reservation_options        ADD COLUMN acompteContribTtc REAL DEFAULT NULL;
ALTER TABLE reservation_options        ADD COLUMN soldeContribTtc   REAL DEFAULT NULL;
ALTER TABLE reservation_resources      ADD COLUMN acompteContribTtc REAL DEFAULT NULL;
ALTER TABLE reservation_resources      ADD COLUMN soldeContribTtc   REAL DEFAULT NULL;
ALTER TABLE reservation_custom_options ADD COLUMN acompteContribTtc REAL DEFAULT NULL;
ALTER TABLE reservation_custom_options ADD COLUMN soldeContribTtc   REAL DEFAULT NULL;

-- Reservation-level per-bucket contribs for accommodation + tourist tax (4)
ALTER TABLE reservations ADD COLUMN accommodationAcompteContribTtc REAL DEFAULT NULL;
ALTER TABLE reservations ADD COLUMN accommodationSoldeContribTtc   REAL DEFAULT NULL;
ALTER TABLE reservations ADD COLUMN touristTaxAcompteContribTtc    REAL DEFAULT NULL;
ALTER TABLE reservations ADD COLUMN touristTaxSoldeContribTtc      REAL DEFAULT NULL;
```

**Data impact:** None. All defaults `0` (flags) or `NULL` (contribs).

**Backfill for existing already-paid reservations:** there's no historical record we can reconstruct (we don't know what `depositPercent` or per-item totals were at the time the payment was marked). The contrib columns stay NULL → the engine falls back to **today's pro-rating behaviour** (uniform pro-rating against current totals) for those reservations. New reservations + new payments use the clean contrib mechanism.

---

## 6. UI / UX

### 6.1 Reservation page → FinanceSection — toggle column

Each row in the options / resources / custom options editor gets a new compact column with a `Checkbox` labelled *"Compl."* Column header tooltip: *"Cocher pour facturer l'item dans le complément à percevoir (hors acompte / solde)."*

Tourist tax sub-section gets a `Switch` *"Taxe de séjour en complément"* + helper text *"Le montant de la taxe est ajouté au complément à percevoir au lieu d'être réparti dans l'acompte / solde."*

**Hidden when the engine already auto-routes the tax** (added 2026-06-01): on a non-direct platform configured to NOT collect the tax (`ical_sources.collectsTouristTax = 0`), the pricing engine sets `touristTaxCollectedOnArrival = true` and the tax always lands in Complément regardless of the manual flag. Rendering the Switch in that case would be confusing — the user clicks it, nothing changes (the override + the auto-routing both point to the same bucket), and they may think it's broken. The corresponding chip in PricingSummary stays visible in **read-only** state so the user still sees the routing.

### 6.2 Reservation page → PricingSummary — discreet chip + line duplication

Worked example (stay 200 €, option B 50 € pré-acompte, depositPercent 30 %, option A 30 € ajoutée entre acompte et solde, B qty doublée à 100 € après les deux paiements) :

```
┌─────────────────────────────────────────────────────────────┐
│ Hébergement                                  200,00 €        │
│ Option B (×2)                                 50,00 €        │ ← snapshot portion (acompte+solde)
│ Option B (+1) [compl.]                        50,00 €        │ ← delta after balance (complement)
│ Option A                                      30,00 €        │ ← between payments → 100% in solde (no chip)
│ Ménage         [compl.]                       40,00 €        │ ← forced (would appear here if added)
│ Taxe de séjour                                18,00 €        │
├─────────────────────────────────────────────────────────────┤
│ Acompte                                       75,00 €        │ ← depositAmount
│ Solde                                        205,00 €        │ ← balanceAmount (locked)
│ Complément à percevoir                        90,00 €        │ ← 50 (B delta) + 40 (forced Ménage)
└─────────────────────────────────────────────────────────────┘
```

Chip styling: outlined italic gray chip, 18 px height, label `compl.` (active state) or `+ compl.` (inactive/discoverability state).

**Clickable in the summary (2026-06-01 update):** the chip is the same UX surface as the FinanceSection checkbox — clicking it flips the line in / out of Complément directly from the summary. Three states:
- **Active** (`inComplement = 1`): bold outlined chip `compl.`, on click → flips to off.
- **Inactive** (`inComplement = 0`, not offered, no snapshot delta): faded `+ compl.` chip, on hover the outline appears, on click → flips to on.
- **Read-only**: shown on the `delta` row of a split (post-payment growth) — the snapshot portion reflects encaissements that already happened, so the chip is informational; clicking it would break conservation against those payment buckets.

Callbacks plumbed: `onToggleOptionInComplement(optionId, isAuto, next)` (the summary passes `isAuto` so the page can route to `setOptionInComplement` for manual options or `setAutoOptionInComplement` for auto-options — see §3.1.bis), `onToggleCustomOptionInComplement(customKey, next)`, `onToggleResourceInComplement(resourceId, next)`, `onToggleTouristTaxInComplement(next)`.

When `offered = 1`: no chip even if `inComplement = 1` (zero amount). When no delta and not forced: single line + the inactive `+ compl.` chip (so the user discovers the affordance) — clicking it routes the line.

For the duplicated line label (`Option B (+1)`), the engine returns the `quantityAtBalancePaid` per line (computed at payment flip from the qty at that moment) so the client can render `+<delta_qty>`. Falls back to just the amount split if the field is missing (legacy reservation).

### 6.3 Responsive

- `xs` (mobile, ≤ 600px): the new "Compl." checkbox column is tight. If the table overflows, the column wraps to a 2nd line per row (existing MUI behaviour). Cleanup via overflow menu is out of scope.
- The summary's duplicated lines stack naturally (existing flex layout).

### 6.4 Copy (French)

| Where | String |
|---|---|
| FinanceSection — column header tooltip | `Cocher pour facturer l'item dans le complément à percevoir (hors acompte / solde).` |
| FinanceSection — tax switch label | `Taxe de séjour en complément` |
| FinanceSection — tax switch helper | `Le montant de la taxe est ajouté au complément à percevoir au lieu d'être réparti dans l'acompte / solde.` |
| PricingSummary — chip label | `compl.` |
| Duplicated line label | `<libellé> (+<n>)` when qty delta known, else `<libellé> (+<amount>€)` |

---

## 7. Test plan

### 7.1 Server unit tests

- [ ] `pricing-force-and-snapshot.unit.test.js` (new):
  - All flags 0, no contribs (fresh reservation) → identical quote to today (regression).
  - Forced option → 100 % complement, excluded from preArrival.
  - Tourist tax forced → 100 % complement.
  - Tourist tax forced + on-arrival auto → counted once.
  - Conservation invariant on every case: `depositAmount + balanceAmount + complementAmount == finalPrice + touristTaxTotal`.
  - Reservation with contrib columns populated → engine returns them in the quote line array unchanged.
  - ≥ 8 more cases on the (forced × payment state × delta) matrix.
- [ ] `accounting-per-line-contribs.unit.test.js` (new):
  - Pre-deposit option (qty 1, 30 €), deposit paid → assert option.acompteContribTtc = 9 (= 30 × 30 %) → Σ acompteContribTtc = depositAmount.
  - Then balance paid → option.soldeContribTtc = 21 (= 30 − 9) → Σ soldeContribTtc = balanceAmount.
  - Grow option to qty 2 → complement contribution = 30 (delta).
  - Run month export → deposit entry's options HT = 9 / (1 + vat%) [HT extraction], NOT pro-rated against grown 60 €. No contamination.
  - Variant with forced option + on-arrival tax + auto delta all present.
- [ ] `payment-contrib-capture.unit.test.js` (new):
  - Mark depositPaid → assert per-line + reservation contribs populated; conservation: Σ = depositAmount.
  - Mark balancePaid → same for solde.
  - Un-mark depositPaid (1→0) → all acompte contribs cleared (NULL).
  - Forced lines stay NULL throughout.
  - Tax not on arrival and not forced → tax contribs populated. Tax on arrival OR forced → tax acompte/solde contribs = 0 (not NULL — explicit zero to differentiate from "not yet captured").

### 7.2 Manual UI verification

- [ ] Fresh reservation, no flags → identical math to today (regression).
- [ ] Add an option qty=1, mark deposit + balance paid in two clicks → summary shows the option without chip; AccountingPage shows 2 entries (acompte + solde) with options HT pro-rated 30 % / 70 %.
- [ ] Grow the option to qty=2 → summary now shows 2 lines for it (original × 1 no chip + delta × 1 with `compl.` chip); AccountingPage compl. entry contains the delta options HT at 100 %, NO change to acompte/solde entries.
- [ ] Tick "Compl." on a brand-new option → preArrival drops, summary chip visible, deposit/balance amounts unchanged on math.
- [ ] Toggle tourist tax switch ON → tax row chipped, tax excluded from acompte/solde.
- [ ] Mobile (`xs`) → checkbox column reachable; summary splits readably.

---

## 8. Out of scope

- **Backfill of legacy already-paid reservations**: no historical contribs to reconstruct; falls back to today's pro-rating. New reservations / new payments use clean contribs.
- **Partial / granular routing of tourist tax** (e.g. "50 % of tax in complément"). Single binary flag per Adrien.
- **Bulk operations** (force-route all items of a reservation in one click). Per-item only.
- **Per-bucket forced routing other than complément** (e.g. "this item in Solde only"). Only target is complément.
- **Visual feedback in FinanceSection** for which lines are flagged (row colouring). Checkbox is the source of truth.

## 9. Open questions

(All resolved before moving Status to Approved.)

- ~~Q: Toggle location?~~ → A: FinanceSection (toggle) + PricingSummary (chip indicator). Adrien 2026-06-01.
- ~~Q: Visual indicator?~~ → A: italic gray `[compl.]` chip. Adrien 2026-06-01.
- ~~Q: Tourist tax granularity?~~ → A: binary boolean. Adrien 2026-06-01.
- ~~Q: Snapshot model — single (balance-paid) vs double (deposit + balance) vs per-line contributions?~~ → A: **per-line per-bucket contributions** (14 new columns, captured at each `*Paid` flip, conservation invariants asserted). Adrien 2026-06-01.
- ~~Q: Bundle with deposit-disabled or own PR?~~ → A: own branch + own PR. Adrien 2026-06-01.
