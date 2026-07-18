# Planning breakfast card — preparation popup

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/planning-breakfast-prep-popup` |
| **Created** | 2026-07-18 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The planning breakfast card ([[breakfast-option-planning-card]], rendered through `OptionDayCard` in the « breakfast » theme) shows the morning headcount plus the drink/food chips added by [[sas-breakfast-milk-and-food]]. Clicking the card's detail block currently opens the reservation fiche — useful, but when preparing the tray the operator wants a focused summary, not the full fiche.

## 2. Goal

Clicking a breakfast card opens a small popup summarizing exactly what to prepare for that breakfast — only the non-zero items, each with the same pictogram as the check-in SAS — with the fiche still one tap away.

## 3. Functional rules

1. **Click → popup**: clicking the breakfast card's detail block opens the preparation popup instead of the fiche (decision 2026-07-18). Other `OptionDayCard` usages (generic options, resources) keep opening the fiche. The « fait » circle and its toggle stay on the card, unchanged.
2. **Header**: title « Petit déjeuner » with the serving time in the amber pill style (time prominent), subtitle « {clientName} · {propertyName} », plus the card's day (French long date).
3. **Body — only what must be prepared**, one line per item with the SAS pictograms:
   - always: « {persons} petit(s) déjeuner(s) » (people icon);
   - then only quantities > 0, in this order: Café, Thé, Chocolat chaud, Lait, Viennoiseries, Céréales — rendered « {label} × {n} »;
   - the note, in italics, when non-empty.
4. **Empty composition** (all counts 0, no note) → single line « Composition non renseignée (à compléter au check-in). ».
5. **Actions**: « Fiche » (closes the popup and opens the reservation fiche) and « Fermer ».
6. **No new data**: the popup renders the item already carried by the card (`persons, breakfastTime/time, coffee, tea, chocolate, milk, pastries, cereals, note, clientName, propertyName, date`) — `GET /api/planning/breakfast` is unchanged.

**Edge cases:**
- `done` card → popup still opens (checking what was prepared is legitimate).
- Multiple breakfast cards the same day (several reservations) → each card opens its own popup.

---

## 4. Architecture

> No server change: the payload already carries everything (fat backend did its job in the previous specs). The popup is pure rendering.

### 4.1 Server side — none.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `BreakfastPrepDialog.js` | C | The popup: header (title + time pill + subtitle + date), pictogram lines filtered to non-zero, note, empty state, Fiche/Fermer actions |
| `components/` | `OptionDayCard.js` | T | `onItemClick(reservationId)` → `onItemClick(reservationId, item)` (additive 2nd argument; existing callers unaffected) |
| `pages/` | `PlanningPage.js` | T | Breakfast card gets a dedicated `onItemClick` opening the popup with the full item; renders `<BreakfastPrepDialog>`; its « Fiche » action delegates to the existing `openReservation` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing)** | MUI `Dialog` (ConfirmDialog-style compact layout), SAS pictogram set (`LocalCafe`, `EmojiFoodBeverage`, `FreeBreakfast`, `LocalDrink`, `BakeryDining`, `RiceBowl`, `People`, `AccessTime`) | |
| **Created (new generic)** | — | none |
| **Specific (kept feature-local)** | `BreakfastPrepDialog` | 100 % breakfast-domain content (labels, ordering, empty-state copy) — not a generic pattern |

### 4.3 API contract — unchanged.

## 5. Data model — unchanged.

## 6. UI / UX

- Dialog `maxWidth="xs" fullWidth`, **fullScreen under `sm`** — same rule as `ConfirmDialog` (DS §3.3 / CLAUDE.md dialog rule; corrected 2026-07-18 during implementation, the draft wrongly said non-fullscreen).
- Header: « Petit déjeuner » + amber time chip (same look as the card pill, `AccessTime` icon) on one row; below, « {clientName} · {propertyName} » and the day in `text.secondary`.
- Lines: icon + label left, « × N » right, comfortable touch spacing (≥ 40px rows).
- Note: italic, `text.secondary`, prefixed by a note icon.
- Actions right-aligned: « Fiche » (outlined), « Fermer » (contained). Buttons stack full-width on `xs`.
- **Responsive:** dialog is already narrow; on `xs` it takes ~90 % width, list unchanged, buttons stacked full-width.

## 7. Test plan

### Client tests
- [x] Vitest (665 pass, 90 files): NEW `BreakfastPrepDialog.test.js` (4 tests) — non-zero filtering (Thé/Chocolat hidden), counts, note shown/hidden + singular person label, empty-composition message, Fiche/Fermer callbacks. (The `(reservationId, item)` pass-through is covered end-to-end by the manual check — no dedicated OptionDayCard test file exists.)
- [x] E2E: 32 pass / 1 skipped

### Manual UI verification (2026-07-18, dev — counts seeded on reservation 22198, reset afterwards)
- [x] Click the breakfast card → popup: amber 09:00 pill, « Sarah Arnaud · Aventura lodge — dimanche 19 juillet », « 4 petits déjeuners », then ONLY Café ×2 / Lait ×2 / Viennoiseries ×3 / Céréales ×1 + « sans gluten » in italics
- [x] « Fiche » → `/reservations/22198?from=/planning`; « Fermer » closes
- [x] Empty-composition card (20/07) → « Composition non renseignée (à compléter au check-in). »
- [x] Mobile 375px: fullScreen dialog, buttons stacked full-width

## 8. Out of scope

- Editing the composition from the popup (the SAS re-open flow owns edits).
- Moving the « fait » toggle into the popup.
- Any change to the option/resource `OptionDayCard` cards.

## 9. Open questions

Resolved 2026-07-18 with Adrien (AskUserQuestion): click on the card opens the popup (fiche reachable from a « Fiche » button inside); implemented on a fresh branch from master after PR #343 (milk/food fields) was merged.
