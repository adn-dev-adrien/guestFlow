# Disable the deposit on a per-reservation basis

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/admin-unlock-past-reservations` _(piggybacks the existing PR per Adrien's call on 2026-06-01)_ |
| **Created** | 2026-06-01 |
| **Author** | Adrien |
| **Related PR** | (same PR as `admin-unlock-past-reservations`) |

---

## 1. Context

A reservation in GuestFlow is split into two encaissements: an **acompte** (deposit, typically 30 % of the pre-arrival total based on the property's `depositPercent`) and a **solde** (balance, the rest). The accounting export ([accountingModel.js:70-72](server/src/models/accountingModel.js#L70-L72)) emits **one journal entry per actually-paid encaissement** — so a standard reservation produces two lines: one when the deposit is marked paid, one when the balance is marked paid.

This split makes no sense when the deposit is handled by the booking **platform itself** (Airbnb, Booking, etc.) and never transits through Adrien's accounts. In those cases:
- The deposit never appears on Adrien's bank statements.
- It still ends up as a journal entry in the export because the reservation has a non-zero `depositAmount` and (potentially) `depositPaid=1`.
- The accountant sees two entries for one platform booking, has to reconcile them, and asks Adrien every quarter "what's this random €120 line?".

The fix is to mark such reservations as having **no deposit at all** — `depositAmount` collapses to 0, `balanceAmount` absorbs the whole pre-arrival total, and the deposit row in the accounting export is structurally absent (no `depositPaid=1` row to emit).

## 2. Goal

For each reservation, Adrien can flip a single switch in the reservation page to declare "this booking has no deposit — all money in the balance". The switch is reversible, defaults OFF (standard split applies), and survives subsequent edits of the reservation (the pricing engine respects it instead of re-computing the deposit from the property's `depositPercent`).

## 3. Functional rules

1. A new boolean column `reservations.depositDisabled INTEGER NOT NULL DEFAULT 0` stores the state per reservation. Default `0` for every existing row, so the change is opt-in per reservation.
2. When `depositDisabled = 1`:
   - The reservation's deposit drops to 0 (`depositAmount = 0`, `depositPaid = 0`, `depositPaidDate = NULL`, `depositDueDate = NULL`).
   - The reservation's balance absorbs the deposit (`balanceAmount = preArrivalAmount`).
   - The pricing engine respects the flag on every recompute (no fallback to `property.depositPercent`).
   - The accounting export emits **zero deposit lines** for this reservation (the existing `WHERE depositPaid = 1 ...` filter does the job — no special-case needed).
3. When `depositDisabled = 0` (default): current behaviour is preserved, no change anywhere.
4. The switch is shown only in the reservation page (`FinanceSection`) next to the "Acompte" title. No confirmation dialog; the toggle is reversible (flip OFF restores the standard pricing computation; the engine will recompute deposit from `property.depositPercent` like for a brand-new reservation, since the original deposit value isn't preserved by Adrien's choice).
5. **Reversibility caveat (documented in the UI hint):** flipping OFF→ON loses the original deposit/balance split because Variant A was chosen over a flag-plus-preserved-values design. Going back ON→OFF re-derives the split from the property's `depositPercent`, which may differ from what was there originally if it was a manual override. Acceptable for the platform-handles-deposit use case where the original split was irrelevant anyway.
6. The flag is included in the existing 14-field allowlist of `pastReservationLocked` so that an admin who realises *after the fact* that a past reservation was a platform booking can still disable the deposit without needing the broader "unlock past reservations" toggle (the two features compose).
7. The flag is captured in `reservationAudit.buildAuditSnapshotFromPayload` + diffed by `computeAuditChanges` so the reservation history surfaces the toggle changes.
8. UI behaviour when ON:
   - The whole Acompte block (montant + date d'échéance + bouton "Marquer payé" + date paiement) collapses to a single line in `text.secondary` : *"Acompte désactivé — ajouté au solde"*, with the Switch still visible to flip back.
   - The Solde block displays its amount as usual; that amount is now the full pre-arrival total because the pricing engine has already done the consolidation.
9. **Access**: same as any other reservation edit — admin and accountant cannot edit reservations today (accountant is read-only on reservations); admin handles this exclusively. No role-specific UI gating needed.

**Edge cases:**

- `depositPaid = 1` already when admin flips `depositDisabled` to ON → the pricing engine forces `depositPaid = 0` + `depositPaidDate = NULL` and the journal entry for the (already-emitted) deposit isn't undone retroactively; the entry stays in past exports, but no new one is emitted from this point on. Acceptable per Adrien's "I just want to stop the bleeding from now on" mindset.
- A reservation with `customPrice` and `depositDisabled = 1` → the custom price flows into `balanceAmount` directly; same accounting result.
- iCal-sourced reservation imported as a "block" (`kind != 'reservation'`) → not impacted (deposit/balance only apply to `kind = 'reservation'`).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Add `tryAddReservationCol('depositDisabled', "ALTER TABLE reservations ADD COLUMN depositDisabled INTEGER NOT NULL DEFAULT 0")` near the other reservation column migrations. |
| `models/` | `reservationsModel.js` | T | Add `depositDisabled` to the `INSERT` + `UPDATE` field lists and the `SELECT` shapes. Include it in `getAuditSnapshotFromDb`. |
| `utils/` | `pricing.js` | T | When `depositDisabled === 1`, short-circuit `resolvedDepositAmount = 0` + `resolvedBalanceAmount = preArrivalAmount` (still subject to the existing `depositPaid/balancePaid` lock semantics, but `depositPaid` is forced to `0` upstream by the controller). |
| `controllers/` | `reservationsController.js` | T | Read `req.body.depositDisabled`. When `1`, force `req.body.depositPaid = 0` + `req.body.depositPaidDate = null` + `req.body.depositDueDate = null` before pricing runs. Pass `depositDisabled` to `calculateReservationQuote`. Add `depositDisabled` to the 14-field allowlist (line ~338) so an admin can flip it on a past reservation even without the global unlock. |
| `models/` | `financeModel.js` | T | `getProjection` propagates `depositDisabled` in the per-reservation detail object so the FinancePage projection table can render the disabled state. Other endpoints (`getSummary`, `getOperational`) already pass the column through via the existing `SELECT r.*` + spread. |
| `utils/` | `reservationAudit.js` | T | Add `depositDisabled` to `buildAuditSnapshotFromPayload` + the diff fields so the reservation history surfaces toggles. |
| `models/` | `accountingModel.js` | — | No change — the existing `WHERE depositPaid = 1 AND depositPaidDate ...` filter is exactly what we need (no `depositPaid=1` → no journal entry). |
| `tests/` | `pricing-deposit-disabled.unit.test.js` | C | New unit test file covering: `depositDisabled=0` (regression), `=1` (deposit collapses to 0, balance absorbs), the engine respects the flag across multiple recomputes (regression for the bug Variant A would have produced), the override doesn't break `complementAmount` math. |
| `tests/` | `accounting-deposit-disabled.unit.test.js` | C | New: insert a reservation with `depositDisabled=1` + `balancePaid=1`, run the month export, assert exactly one journal entry (the balance) and zero deposit entries. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | Add `depositDisabled: 0` to the initial form state; carry it through the existing payload shape. |
| `components/reservation/` | `FinanceSection.js` | T | Render the `Switch` next to the "Acompte" title. When ON, collapse the deposit block to a single muted line + keep the Switch visible. When OFF, render the existing deposit UI as today. The Switch is fully controlled: on toggle, it updates `form.depositDisabled` and the parent component re-renders. |
| `components/` | `PricingSummary.js` | T | The Acompte row reads `form.depositDisabled`. When ON, the amount is replaced by an italic muted `Désactivé (ajouté au solde)` line, and the due-date caption + "Acompte payé" chip are hidden. Keeps the summary visually consistent with FinanceSection. |
| `pages/` | `Dashboard.js` | T | Line ~248 status text: the "Acompte ${depositPaid ? OK : NON}" check becomes "Acompte ${depositPaid \|\| depositDisabled ? OK : NON}" — for a depositDisabled reservation there's nothing to chase. |
| `pages/` | `FinancePage.js` | T | Three display surfaces patched (projection table, pending-payments table, summary chip line): show italic "Désactivé" / "Acompte désactivé" chip instead of "0€" + "Dû [null]" / checkbox + 0€ / "Acompte non payé" chip. |
| `api.js` | `api.js` | — | No change — the existing reservation update/create endpoints carry arbitrary body fields. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Switch`, `Typography`, `Box`, `Stack` from MUI | Already used throughout `FinanceSection`. |
| **Created (new generic)** | — | None. The collapsed-deposit state is a 2-line `Stack` inside `FinanceSection`, not extracted as a generic. |
| **Specific (kept feature-local)** | The collapsed-deposit block in `FinanceSection.js` | One-off layout for this feature. No reuse value. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations` | `{ ...usual, depositDisabled?: 0\|1 }` | Created reservation (includes `depositDisabled`) | Defaults to 0 if absent. |
| PUT | `/api/reservations/:id` | `{ ...usual, depositDisabled?: 0\|1 }` | Updated reservation | Honoured even on past-locked reservations (in the allowlist). |
| PATCH | `/api/reservations/:id/payment` | unchanged | unchanged | Not concerned — only payment statuses. |
| GET | `/api/reservations` / `/api/reservations/:id` | — | Each reservation row includes `depositDisabled: 0\|1` | Wired through the SELECT shape. |

---

## 5. Data model

**New column:** `reservations.depositDisabled INTEGER NOT NULL DEFAULT 0`.

**Migration (idempotent block in `server/src/database.js`)** — follows the existing `tryAddReservationCol` pattern that no-ops if the column is already present:

```sql
ALTER TABLE reservations ADD COLUMN depositDisabled INTEGER NOT NULL DEFAULT 0
```

**Data impact:** None. Every existing reservation gets `depositDisabled = 0` automatically (via the column's DEFAULT). Behavior is unchanged for them.

---

## 6. UI / UX

### Reservation page → FinanceSection — Acompte block

**State A — `depositDisabled = 0` (default):**

```
Acompte                                          [ ⬜ ]   ← Switch OFF
  Montant : [ 120.00 €   ]
  Date d'échéance : [ 2026-05-25 ]
  [ Marquer acompte payé ]   (vert quand payé)
  Date paiement : [ 2026-05-25 ]   (apparaît quand payé)
```

**State B — `depositDisabled = 1`:**

```
Acompte                                          [ ⬛ ]   ← Switch ON
  Acompte désactivé — ajouté au solde
```

Le bloc Solde reste identique dans les deux états ; quand ON, son montant est juste plus élevé (le moteur fait la consolidation).

### Responsive behavior

No breakpoint-specific change. The Switch is small enough to fit on any width next to the title. The collapsed-block on `depositDisabled=1` is one line of caption-style text — fits naturally on mobile.

### Sticky action bar

No change. ReservationPage already uses `PageActionBar`. The toggle change is captured by the existing dirty-form draft + the existing Save button.

### Copy (French strings)

| Where | String |
|---|---|
| Switch label / aria-label | `Désactiver l'acompte (encaissé directement au solde)` |
| Collapsed-state line | `Acompte désactivé — ajouté au solde` |

No empty / loading / error states unique to this section — handled by the parent ReservationPage.

---

## 7. Test plan

### Server unit tests

- [x] `pricing-deposit-disabled.unit.test.js` — 7 cases: default (regression), flag=1 collapses deposit+absorbs balance, boolean variant accepted, survives 3 repeated calls (no silent reset), depositPercent=0 edge case, flag wins over a stale depositPaid=true, every falsy variant is a no-op. All green at first run.
- ~~`accounting-deposit-disabled.unit.test.js`~~ — **not needed**. The accounting export emits a deposit entry only when `depositPaid=1 AND depositPaidDate is in the month` (existing behaviour at [accountingModel.js:54-56](server/src/models/accountingModel.js#L54-L56)). The server pipeline (pricing engine + controller force-zero of `depositPaid`) guarantees `depositPaid` stays at 0 whenever `depositDisabled=1` — so no deposit row is ever emitted for those reservations. No new accounting code was added, hence no new accounting test surface. The pricing test above covers the upstream invariant.

### Manual UI verification

- [ ] Open a future reservation → see the Switch next to "Acompte" in OFF state, montant Acompte affiché normalement.
- [ ] Flip the Switch ON → bloc Acompte se réduit à la ligne "Acompte désactivé — ajouté au solde" ; Save → reload → état persisté ; le solde affiche maintenant le total complet.
- [ ] Marquer le solde payé → export comptable du mois → **une seule ligne** (le solde au montant total), pas de ligne acompte.
- [ ] Re-flipper OFF → bloc Acompte revient avec montant recalculé par le moteur (depositPercent de la propriété).
- [ ] Régression : créer une réservation normale (sans toucher le Switch) → 2 lignes dans l'export comme avant.
- [ ] Régression : flipper sur une réservation passée (avec `allowEditPastReservations=0` car le flag est dans l'allowlist) → Save accepté.
- [ ] Mobile (`xs`) : titre "Acompte" + Switch tiennent sur une ligne, ou label/Switch stack vertical proprement.

---

## 8. Out of scope

- **Visual trace on the accounting CSV** that the disabled-deposit reservation had its acompte handled elsewhere. Adrien decision (2026-06-01): clean single line, no special column / mention. Add later if the accountant asks.
- **Auto-detection by platform** (e.g. "if `platform = 'airbnb'`, set `depositDisabled = 1` by default"). Manual per-reservation decision — Adrien wants generic.
- **Preserving the original `depositAmount` value to restore on toggle-back** (Variant B from my original proposal). Adrien chose the lossy Variant A: re-activation re-derives from `property.depositPercent`. Trade-off accepted.
- **Bulk toggle** (e.g. select all Airbnb reservations and disable their deposits in one click). Not needed — per-reservation is enough.
- **Audit trail in `reservation_history` with a dedicated "deposit disabled" event**. The flag is captured by the standard audit snapshot diff, so every toggle change shows up as a normal field-change row. Good enough.

## 9. Open questions

(Resolved before moving Status to Approved.)

- ~~Q: Lossy mutation (Variant A) or flag column?~~ → A: Flag column (Adrien 2026-06-01, after discovery that lossy mutation didn't survive pricing-engine recompute).
- ~~Q: Trace in the accounting export?~~ → A: No (Adrien 2026-06-01).
- ~~Q: For which payment fields does the "undo" capability apply?~~ → A: This spec is **not** about undoing payment statuses — it's about removing the deposit *concept* for a specific reservation. The payment-status fields stay as they are.
- Q: Should an iCal-sourced reservation default to `depositDisabled = 1`? → **Proposed:** No, default 0 to keep behaviour predictable. Adrien manually toggles per-reservation if needed.
