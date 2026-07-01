# Spec — Tourist-tax extraction: "déclarée" checkbox + reservation-dates fix

| | |
|---|---|
| **Feature** | Tourist-tax extraction page — per-reservation "déclarée" tracking + dates display fix |
| **Status** | Implemented |
| **Author** | Adrien + Claude |
| **Date** | 2026-07-01 |

## 1. Context

The **Extraction taxe de séjour** page (`/finance/tourist-tax`, `TouristTaxPage.js`) lists, per property,
the reservations whose tourist tax must be remitted to the commune for a selected month. The operator uses
it to fill the monthly declaration on the commune's portal.

Two problems surface in real use:

1. **Wrong « Dates réservation ».** The column is meant to show the reservation's stay dates (arrival →
   departure, exactly like the fiche réservation). Instead it subtracts one day from the departure date
   (it was showing the *last night*), so a 1-night stay 20/06 → 21/06 renders as « 20/06 au 20/06 ».
2. **No way to track what's already declared.** The declaration is done month by month on an external
   portal; the operator needs to tick each reservation as it's entered, and see *when* it was declared, so
   an interrupted session can be resumed without double-declaring or missing a line.

## 2. Goal

- Show the true reservation dates (arrival → departure) in the extraction table.
- Add a **« Déclarée » checkbox in front of every row**, persisted per reservation, that records **when**
  the reservation was declared and reflects that state on every reload.

## 3. Functional rules

1. **Dates column = arrival → departure.** `Dates réservation` shows `startDate au endDate` — the same two
   dates as the fiche réservation. No day is subtracted. (A stay 20/06 → 21/06 shows « 20/06 au 21/06 ».)
2. **« Déclarée » is per reservation, declared once.** A reservation appears in exactly one monthly
   extraction (the month its tax-carrying échéance is collected — see `getTouristTaxExtraction`), so a
   single per-reservation marker is sufficient; there is no per-month duplication to disambiguate.
3. **Ticking records the date.** Ticking the checkbox sets `touristTaxDeclaredAt = now` (server clock).
   Unticking clears it back to `NULL`. The stored value is a date-time string; the UI shows the **date**.
4. **The date is visible.** When ticked, the operator can see *when* it was declared (tooltip
   « Déclarée le JJ/MM/AAAA » on the checkbox). Unticked → « Non déclarée ».
5. **Clicking the checkbox never navigates.** The rest of the row still opens the reservation on click; the
   checkbox cell stops event propagation so ticking doesn't navigate away.
6. **Authoritative server state.** The declared marker is persisted server-side and returned in the
   extraction payload; the client only renders it + optimistically reflects the toggle.

**Edge cases:**
- Re-ticking an already-declared reservation refreshes nothing destructive (idempotent set to a new
  now — acceptable; the marker just means « declared », the exact instant is informational).
- A reservation that leaves the month's selection (e.g. its échéance is un-paid) simply stops appearing;
  its `touristTaxDeclaredAt` is retained and reappears if it comes back.

## 4. Architecture

### 4.1 Server (`server/src/`)
| Layer | File | Role |
|---|---|---|
| `database.js` | `database.js` | NEW idempotent migration: `reservations.touristTaxDeclaredAt TEXT` (nullable). |
| `models/` | `models/financeModel.js` | `getTouristTaxExtraction` also SELECTs + returns `touristTaxDeclaredAt` per reservation. NEW `setTouristTaxDeclared({ reservationId, declared })` → sets the column to `datetime('now')` or `NULL`, returns the new value. |
| `controllers/` | `controllers/financeController.js` | NEW thin handler `setTouristTaxDeclared` — parse `:reservationId` + `{ declared }`, call the model, respond `{ ok, declaredAt }`. |
| `routes/` | `routes/finance.js` | NEW `PATCH /finance/tourist-tax/:reservationId/declared`. |

### 4.2 Client (`client/src/`)
| Layer | File | Role |
|---|---|---|
| `pages/` | `pages/TouristTaxPage.js` | Fix `formatReservationDates` (no −1 day). Add a first « Déclarée » column: a `Checkbox` bound to `row.touristTaxDeclaredAt`, wrapped in a `Tooltip`, with a cell-level `stopPropagation`. Optimistic local update on toggle. Empty-row `colSpan` 7 → 8. |
| `api.js` | `api.js` | NEW `setTouristTaxDeclared(reservationId, declared)` → `PATCH /finance/tourist-tax/:id/declared`. |

No new generic component: a single MUI `Checkbox` + `Tooltip` in the existing table is the minimal fit
(the page has no other checkbox to share with). Reuse is revisited if a second "declared/verified" table
appears.

### 4.3 API contract
- `PATCH /finance/tourist-tax/:reservationId/declared` — body `{ declared: boolean }`.
  Response `{ ok: true, declaredAt: string|null }`. 404 if the reservation doesn't exist.
- `GET /finance/tourist-tax?month=YYYY-MM` — each `reservations[]` item gains `touristTaxDeclaredAt: string|null`.

## 5. Data model

- **`reservations.touristTaxDeclaredAt TEXT`** (idempotent ADD COLUMN, default `NULL`). Set to the server
  time-stamp when the operator ticks « Déclarée », cleared to `NULL` on untick. Purely additive; existing
  rows are `NULL` (= not declared). No recompute.

## 6. UI / UX

- **New first column « Déclarée »**: a checkbox in front of every row. Checked ⇔ `touristTaxDeclaredAt`
  is set. Wrapped in a `Tooltip` (« Déclarée le JJ/MM/AAAA » / « Non déclarée »). The header cell reads
  « Déclarée ».
- **Dates column** now shows arrival → departure (fiche-résa dates).
- **Row click** still navigates to the reservation; the checkbox cell calls `stopPropagation` so ticking
  stays on the page.
- **Responsive**: the table already scrolls horizontally inside `TableContainer` (`minWidth`); the extra
  narrow checkbox column keeps it usable on mobile (no layout change beyond the added column). The
  checkbox is a 44×44 MUI touch target.

## 7. Test plan

### Server unit tests (`tests/finance-tourist-tax-declared.unit.test.js`, NEW)
- [x] `setTouristTaxDeclared(declared=true)` sets `touristTaxDeclaredAt` to a non-null date-time; returns it.
- [x] `setTouristTaxDeclared(declared=false)` clears it back to `NULL`.
- [x] `getTouristTaxExtraction` exposes `touristTaxDeclaredAt` per reservation (declared value preserved).

### Client vitest tests (`pages/__tests__/TouristTaxPage.test.js`, NEW)
- [x] **Date non-regression**: a reservation `startDate 2026-06-20 / endDate 2026-06-21` renders
      « 20/06/2026 au 21/06/2026 » (not « au 20/06/2026 »).
- [x] Declared checkbox reflects `touristTaxDeclaredAt` (checked when set, unchecked when null) and toggling
      calls `api.setTouristTaxDeclared` with the right args, without navigating.

### Manual UI verification
- [ ] Load the page for a month with direct reservations; confirm dates match the fiche, tick a row → date
      tooltip appears + persists across reload; untick clears it. Checked at mobile + desktop widths.

## 8. Out of scope

- Bulk « tout déclarer » action, per-month re-declaration history, export of the declared state.
- Locking a declared reservation from edits.

## 9. Open questions

- None (checkbox + declaration date + single PR confirmed with the operator on 2026-07-01).
