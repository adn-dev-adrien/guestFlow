# Reopen a completed SAS — re-editable check-in / check-out

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/reopen-completed-sas` |
| **Created** | 2026-06-15 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [arrival-departure-sas.md](arrival-departure-sas.md), [extinguisher-seal-and-repair-amounts.md](extinguisher-seal-and-repair-amounts.md), [sas-breakfast-and-handover-note.md](sas-breakfast-and-handover-note.md) |

---

## 1. Context

The arrival / departure SAS (`ReservationSasDialog`) is a guided wizard that commits the
operator's decisions in **one call** at the final recap. Once committed, the reservation is
stamped `arrivalSasDoneAt` (resp. `departureSasDoneAt`), and the planning SAS button
**locks**: it turns into a disabled green ✓ — "a finished SAS cannot be reopened" (decision
2026-06-13, [arrival-departure-sas.md](arrival-departure-sas.md) §3.0).

In practice the operator needs to **reopen a finished SAS to review and correct** what was
entered: a wrong missing-linen count, a forgotten caution tick, a typo in the handover note,
a misjudged extinguisher seal, breakfast counts. Today that's impossible — the only escape is
manual surgery on the reservation fiche, which doesn't mirror the SAS flow.

This spec **reverses the lock**: a completed SAS becomes re-openable from the planning, the
wizard reopens **pre-filled** with everything previously entered, and re-validating **replaces**
the prior outcome — crucially **without double-charging** the arrival complement.

Decisions (AskUserQuestion 2026-06-15):
- **Scope = full re-edit** — reopen pre-filled, re-validate overwrites/replaces (not view-only).
- **Entry point = the green ✓ button becomes clickable again** (no separate edit button).

## 2. Goal

From the planning, clicking the green ✓ of a completed arrival (resp. departure) SAS reopens
the same wizard, pre-filled with the previously-committed data. The operator walks the steps
(values pre-set), changes anything, and re-validates. The re-commit is **idempotent**: the
arrival complement reflects the latest input with **no duplicate lines and no doubled amount**;
breakfast / handover / extinguisher seal / end-of-stay complement are overwritten; caution
flags follow the checkbox faithfully. A SAS never reverts to "not done".

## 3. Functional rules

1. **Entry point — clickable ✓.** When `arrivalSasDoneAt` (resp. `departureSasDoneAt`) is set,
   the planning SAS button keeps its green ✓ (`CheckCircleIcon`, `color="success"`) but is **no
   longer `disabled`**. Tooltip becomes « Revoir / modifier le check-in » (resp. « … le
   check-out »). Clicking reopens the wizard in the same mode. (Reverses
   [arrival-departure-sas.md](arrival-departure-sas.md) §3.0 lock.)
   **Restricted for the reception role
   ([reception-sas-lock-after-commit.md](reception-sas-lock-after-commit.md), 2026-08-04):** this
   whole re-edit is **admin-only**. For a reception-only user the ✓ stays green but **disabled**, and
   the server refuses any commit on a committed SAS (403 `SAS_ALREADY_COMMITTED`).

2. **Pre-fill on reopen.** When the wizard opens on a reservation that already has the relevant
   `…SasDoneAt`, every decision is seeded from the persisted state (instead of starting blank):
   - **Arrival:** `caution = 'fait'` iff `cautionReceived`; `extinguisherOk` from
     `extinguisherSealOkAtArrival` (1→true, 0→false, NULL→true); breakfast counts/hour/note
     (already loaded via `getSas.breakfast`); `handoverNote` from `departureHandoverNote`;
     the bed-linen complement + cleaning charge reconstructed from the **SAS-origin complement
     lines** (rule 5).
   - **Departure:** `cautionReturned` from `cautionReturned`; `extinguisherOk` from
     `extinguisherSealOkAtDeparture`; the end-of-stay complement (missing items + end-of-stay
     cleaning + extinguisher-seal billing) reconstructed from `endOfStayComplementDetail` (JSON).

3. **Relevant steps reachable in edit mode.** When reopening a done SAS, the **departure**
   caution-return step is shown **even when already returned** (pre-ticked), so a mis-marked return
   can be corrected. Other step gating (portal, options, breakfast applicability, bed-linen alert,
   missing-items ask) is unchanged. Forward + « Précédent » navigation unchanged.
   **Superseded for the arrival caution (specs/sas-hide-settled-steps.md §3):** the arrival caution
   step is now hidden as soon as it's received, **even in edit mode**. Its state is still pre-filled
   (so the recap notes « Caution marquée comme perçue ») and left untouched on re-commit; correcting a
   mis-marked *arrival* caution is done from the reservation fiche, not the SAS.

4. **Re-commit = REPLACE, never append (finance-critical).**
   - **Arrival complement.** SAS-origin complement rows in `reservation_custom_options` are
     tagged `sasArrivalOrigin = 1`. On every `commitArrivalSas`:
     1. Sum the existing `sasArrivalOrigin = 1` rows for the reservation, then **delete** them.
     2. If the arrival complement is **not paid** (`complementPaid ≠ 1`): subtract that old sum
        from `complementAmount`, insert the new complement lines (tagged `sasArrivalOrigin = 1`),
        and add their sum. Net: `complementAmount` reflects exactly the latest SAS lines.
     3. If the complement **is already paid** → it is **frozen**: the existing complement rows
        and `complementAmount` are left untouched (no delete, no re-insert). The operator cannot
        alter a settled complement from the SAS (out of scope §8). Non-financial fields still
        update.
     - **First commit** has no tagged rows → behaves exactly as before this spec (pure insert).
   - **Departure end-of-stay complement.** Already overwrite-based (`endOfStayComplementAmount`
     + `endOfStayComplementDetail` are `SET`) → re-commit simply overwrites. No change needed.
   - **Breakfast / handover note / extinguisher seal** — already `SET` (overwrite). No change.

5. **Arrival complement reconstruction.** SAS-origin complement lines store `description` (label)
   + `amount`. On reopen the dialog maps each line to a current priced linen item **by label**
   (`qty = round(amount / item.price)`) to repopulate the bed-linen step; a line whose label is
   the cleaning label (« Ménage ») repopulates the cleaning toggle. A line that no longer matches
   any item (linen item renamed / removed since the commit) is **preserved verbatim** as a fixed,
   non-editable recap line and re-saved unchanged on re-commit — never lost, never duplicated.

6. **Caution is a faithful, reversible edit.** `commitArrivalSas` / `commitDepartureSas` set the
   caution received / returned flag to **exactly** the checkbox state:
   - ticked → flag = 1, date = `COALESCE(existing date, today)` (preserve the first date);
   - unticked → flag = 0, date = NULL.
   This lets the operator fix a mis-tick. Only the `cautionReceived` / `cautionReturned`
   booleans + their dates are affected — payments and complements are untouched.

7. **The SAS stays done.** Re-committing refreshes `…SasDoneAt = datetime('now')` (stays set).
   The button stays a clickable green ✓. There is no "un-complete" action.

8. **Quitter writes nothing.** Unchanged: closing the reopened wizard without validating leaves
   the previously-committed data intact (decisions live in memory until the single commit).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | C(reate)/T(ouch) | Responsibility |
|---|---|---|---|
| database | `database.js` | T | Idempotent migration: `ALTER TABLE reservation_custom_options ADD COLUMN sasArrivalOrigin INTEGER NOT NULL DEFAULT 0` (PRAGMA-guarded). Existing rows default 0 → never touched by the SAS replace pass. |
| models | `models/reservationsModel.js` | T | `commitArrivalSas`: replace-semantics for the complement (sum+delete tagged rows → recompute `complementAmount` unless paid → insert new tagged rows); faithful caution (set **or** clear flag+date). `commitDepartureSas`: faithful caution (set **or** clear). `getByIdWithDetails`: surface `sasArrivalOrigin` on each custom-option line so the client can pick SAS-origin complement lines. |
| controllers | `controllers/sasController.js` | (no change) | `getSas` already returns `reservation` (incl. custom options), `breakfast`, `cleaning`, `linenItems`, `repairAmounts`. Commit handlers already forward the needed fields. |

### 4.2 Client side (`client/src/`)

| Layer | File | C/T | Responsibility |
|---|---|---|---|
| components | `components/ReservationCard.js` | T | Arrival SAS button: when `arrivalSasDoneAt`, keep green ✓ but drop `disabled`; tooltip → « Revoir / modifier le check-in ». |
| components | `components/DepartureMiniRow.js` | T | Departure SAS button: when `departureSasDoneAt`, keep green ✓ but drop `disabled`; tooltip → « Revoir / modifier le check-out ». |
| components | `components/sas/ReservationSasDialog.js` | T | Pre-fill all decisions from `data.reservation` (rule 2); reconstruct the arrival complement (rule 5) + departure end-of-stay from `endOfStayComplementDetail`; show caution steps in edit mode (rule 3); carry preserved unmatched lines into the commit payload. |
| services | `services/`/`api.js` | (no change) | Reuses `getReservationSas` + `commitArrivalSas` / `commitDepartureSas`. |

No new generic component (this is a behavioral change to existing wizard + two planning cards).

### 4.3 API contract

- **No endpoint added or changed.** `GET /api/reservations/:id/sas` response gains
  `sasArrivalOrigin` (0/1) on each `reservation.options` entry that is a custom option —
  a backward-compatible additive field. Commit payloads are unchanged.

## 5. Data model

- **New column** `reservation_custom_options.sasArrivalOrigin INTEGER NOT NULL DEFAULT 0`.
  Idempotent `ADD COLUMN` in `database.js`. Existing rows default `0` (= not SAS-origin), so the
  arrival replace pass never deletes complement lines added elsewhere (reservation fiche editor).
  `commitArrivalSas` writes `1` on the lines it inserts. **No data loss / no corruption**:
  default `0` is correct for every pre-existing row.
- No other schema change. Departure reuses the existing `endOfStayComplementDetail` JSON.

## 6. UI / UX

- **Planning cards (mobile + desktop).** The completed-SAS button is now a **clickable** green ✓
  (`CheckCircleIcon`, `color="success"`). Tooltip « Revoir / modifier le check-in/check-out ».
  No layout change — same 44×44 touch target, same responsive button row on `xs`.
- **Wizard.** Identical stepper, opened pre-filled. The recap shows the current (edited) values.
  `fullScreen` on mobile, « Précédent » / « Suivant » / « Quitter » unchanged.
- **No new colour / badge.** Visual continuity with the existing SAS.

## 7. Test plan

### Server unit tests (`server/src/tests/`)

- [ ] `commitArrivalSas` re-commit **replaces** the complement: two commits with different
  missing-linen sets leave exactly the second set's `sasArrivalOrigin` rows; `complementAmount`
  equals the second set's sum (not the cumulated sum). First commit unchanged vs. legacy.
- [ ] `commitArrivalSas` with `complementPaid = 1` → complement rows + amount frozen (no delete /
  no re-insert / no amount change); non-financial fields still updated.
- [ ] `commitArrivalSas` caution: tick sets `cautionReceived=1` + date; **untick clears**
  `cautionReceived=0` + date NULL; re-tick preserves the original date via COALESCE.
- [ ] `commitDepartureSas` caution returned: symmetric set / clear.
- [ ] `commitDepartureSas` end-of-stay re-commit overwrites amount + detail (no accumulation).
- [ ] `getByIdWithDetails` surfaces `sasArrivalOrigin` on custom-option lines.

### Client unit tests (`client/src/components/__tests__/`)

- [ ] `ReservationCard`: when `arrivalSasDoneAt` set, the SAS button is **enabled** (not
  `disabled`), green ✓, tooltip « Revoir / modifier le check-in », fires `onOpenSas`.
- [ ] `DepartureMiniRow`: symmetric (enabled, « Revoir / modifier le check-out »).

### Manual UI verification (dev server)

- [ ] Run an arrival SAS with a missing-linen complement + caution + breakfast + handover; commit.
- [ ] Reopen via the green ✓ → all values pre-filled (complement qty, caution ticked, breakfast,
  handover, seal). Change the linen qty; re-validate → reservation shows the **new** complement,
  no duplicate lines, amount not doubled.
- [ ] Untick caution on reopen → `cautionReceived` cleared on the fiche.
- [ ] Reopen a departure SAS → end-of-stay items + caution-return + seal pre-filled; edit + commit
  overwrites cleanly.
- [ ] Mobile (`xs`): ✓ button reachable + clickable; wizard `fullScreen`.

## 8. Out of scope

- **Editing a complement that is already paid** (`complementPaid = 1`) — frozen by rule 4.3.
- **Un-completing a SAS** (reverting `…SasDoneAt` to NULL) — the marker stays set (rule 7).
- **History / audit entries for SAS edits** — the original SAS commit writes none; unchanged here.
- **Reconstruction across a linen-item price change** — `qty = round(amount/price)` uses the
  current price; near-immediate reopen makes drift negligible (see Open questions).

## 9. Open questions

- **Resolved 2026-06-15 (AskUserQuestion):** scope = full re-edit; entry point = clickable ✓.
- **Resolved 2026-06-15 (AskUserQuestion):** caution reversibility (rule 6) = **faithful /
  reversible** — unticking clears the finance marker + its date; re-ticking re-sets it (keeping
  the first date via COALESCE). Affects only `cautionReceived` / `cautionReturned` + dates.
- **Price-drift on arrival reconstruction** — if a priced linen item's price changed between the
  original commit and the reopen, the reconstructed qty (`amount/price`) may differ from what was
  entered. Acceptable for near-immediate reopen; revisit only if it bites.
