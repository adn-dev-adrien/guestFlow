# Devis — accept-to-reservation flow

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/login-and-dev-https` _(Claude-managed; bundled with the test-pass fixes)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 4 — Devis (partial; full Devis MVC remains a later slice). See `specs/ROADMAP.md`. |

---

## 1. Context

A devis is edited through `ReservationPage` in devis mode (`/reservations/new?mode=devis&devisId=…`).
Converting a devis into a reservation used to be a standalone **"Passer en réservation"** action
(`AutoFixHighIcon`) in the page action bar, separate from the devis **status** dropdown
(`Brouillon` / `Envoyé` / `Accepté`). That duplicated the "this devis is now a booking" intent in two
places, and the Finance section's **"Actualiser tarifs"** button was only available for reservations,
not for devis. After conversion the user also landed on the new reservation with no meaningful
back-target.

The server endpoint `POST /api/devis/:id/convert-to-reservation` already persists a full reservation
(reservation + options + custom options + resources + nights + copied history), marks the devis
`status = 'converted'` with `convertedReservationId`, and returns `{ success, reservationId }`.

## 2. Goal

Accepting a devis (status → **Accepté**) is the single way to turn it into a reservation: it saves the
devis, converts it into a persisted reservation after confirmation, and lands on that reservation with a
"back to the calendar centered on it" target. The devis editor also exposes "Actualiser tarifs" like the
reservation editor.

## 3. Functional rules

1. **No standalone "Passer en réservation" action.** It is removed from the devis editor action bar.
2. **Accept = convert.** Setting the devis status to **Accepté** (in the action-bar dropdown) triggers a
   confirmation: *« En acceptant ce devis, il sera enregistré puis converti en réservation (les dates
   seront bloquées). Voulez-vous continuer ? »* with actions **Annuler** / **Convertir en réservation**.
3. **On confirm:** the current devis edits are **saved first** (so the reservation reflects them), then
   `convert-to-reservation` is called, then the app navigates to the **created reservation**
   (`/reservations/:id`). The reservation is therefore already persisted — no extra manual save, and the
   landing reservation must **not** be flagged "unsaved" (see rule 8).
4. **Cancel is non-destructive.** Cancelling the confirmation leaves the devis unchanged; the status
   dropdown reverts to its previous value (it is controlled by `form.status`, which is not mutated).
5. **Other statuses** (`Brouillon`, `Envoyé`) just update the devis form (`status`) as before.
6. **Back/Annuler from the converted reservation returns to the calendar centered on it.** The
   navigation passes `?from=/calendar`; the reservation editor's existing
   `buildBackUrlWithReservationFocus()` expands that to
   `/calendar?propertyId=…&focusStartDate=…&focusEndDate=…` from the loaded reservation.
7. **"Actualiser tarifs" available in devis mode.** The Finance section shows the button for devis as
   well as reservations; it recomputes with current rates (`forceCurrentPricing`) and clears any manual
   price (`customPrice`). The confirmation copy adapts to "ce devis".
8. **No false "unsaved changes" prompt on a freshly loaded record (reworked guard).** When an existing
   reservation/devis is opened (including the just-converted reservation), the server pricing recalc
   reshapes the loaded form once on mount (offered flags, derived amounts) with no user action. The
   unsaved-changes baseline must therefore be captured **after** that first recalc has applied, not
   before — otherwise leaving via "Annuler" or navigation wrongly shows the "Modifications non
   enregistrées" dialog. New/prefilled records still baseline immediately. Genuine user edits after load
   still flag the form dirty as before.

**Edge cases:**
- Save validation fails (no client/dates/property, conflicts, capacity/min-nights refused) → conversion
  is aborted, the user stays on the devis.
- Devis already converted (`convertedReservationId` set) → the server returns `400` and the error is
  shown; no second reservation is created.
- New, never-saved devis (no `editingDevisId`) → there is no conversion path (the status dropdown only
  converts a persisted devis); selecting a status just updates the form.

---

## 4. Architecture

> Client-only behavior change. The conversion + persistence is the existing server endpoint (fat
> backend); the client only orchestrates save → convert → navigate and the back-target.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `devis.js` | — | `POST /:id/convert-to-reservation` unchanged — already creates the reservation, marks the devis converted, returns `reservationId`. |

No server change. No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | Remove the "Passer en réservation" action + its icon import; add `handleDevisStatusChange` (confirm → save → convert → navigate with `?from=/calendar`); wire the status `Select` to it; make `refreshToCurrentPricing` work in devis mode. **Rework the unsaved-changes baseline effect** (rule 8): for an existing record, set `initialSnapshot` only after the first `pricingQuote` has applied. |
| `components/reservation/` | `FinanceSection.js` | T | Show "Actualiser tarifs" when `isDevisMode || reservationId`. |
| `utils/` | `navigation.js` | — | Reused (`getFromParam`, `navigateBackWithFrom`). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ConfirmDialog` (via `useAppDialogs().confirm`), `FinanceSection` (feature-local) | — |
| **Created (new generic)** | (none) | — |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/devis/:id/convert-to-reservation` | — | `{ success: true, reservationId }` | Auth required. `400` if already converted. Unchanged by this spec. |

---

## 5. Data model

No schema changes. The conversion writes existing tables (`reservations`, `reservation_options`,
`reservation_custom_options`, `reservation_resources`, `reservation_nights`, `reservation_history`) and
updates `devis.status`/`devis.convertedReservationId` — all pre-existing.

**Data impact:** accepting a devis creates one reservation and flips the devis to `converted`. No loss.

## 6. UI / UX

- **Devis editor action bar:** `[Retour] [Statut ▼] [Télécharger PDF] [Enregistrer] [Annuler]
  [Supprimer]` — no "Passer en réservation".
- **Status dropdown → Accepté:** opens the confirmation dialog (French copy in rule 2). Confirm converts
  and navigates to the reservation; cancel keeps the devis and the previous status.
- **Finance section (devis):** "Actualiser tarifs" button next to the "Finance" title; confirmation copy
  mentions "ce devis"; on confirm the manual price is cleared and prices recomputed.
- **Converted reservation:** standard reservation editor; **Annuler**/back returns to
  `/calendar` centered on the reservation (propertyId + focus dates).
- **Responsive:** unchanged — the action bar (`PageActionBar`) and Finance section already adapt on
  `xs`/`md`/`lg`; the dialog is the shared confirm dialog (fullscreen-friendly on mobile).

## 7. Test plan

### Server unit tests
- [x] N/A — no server change. Existing suite stays green (257).

### Manual UI verification
- [x] Devis editor no longer shows "Passer en réservation" (verified in browser).
- [x] Status → Accepté shows the confirmation dialog with Annuler / Convertir en réservation; cancel is
      non-destructive (verified in browser).
- [x] "Actualiser tarifs" is present in the Finance section in devis mode (verified in browser).
- [x] Opening the converted reservation (the one produced by devis #3) and clicking **Annuler** goes
      straight to `/calendar?propertyId=…&focusStartDate=…&focusEndDate=…` (centered) with **no**
      "Modifications non enregistrées" dialog — confirms rules 6 + 8 (verified in browser).
- [ ] Accept on a *non-converted* devis → confirm → reservation created and opened (full end-to-end);
      not run here to avoid mutating data.
- [ ] Genuine edit after load still prompts on leave (dirty guard not disabled).
- [ ] Mobile (`xs`): dropdown, dialog and Finance button render correctly.

## 8. Out of scope

- Full Devis MVC extraction (routes → controllers → models) — later Bloc 4 slice.
- The dead `DevisForm.js` and the dead CalendarPage reservation dialog.
- Any pricing-engine change (the quote/PDF are owned by the pricing spec).

## 9. Open questions

- Q: Should accepting a *new, unsaved* devis save-then-convert in one step? — A: No; conversion requires
  a persisted devis. The user saves first (or uses an existing devis). Revisit if the workflow proves
  awkward.
