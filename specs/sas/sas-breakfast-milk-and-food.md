# SAS breakfast — milk drink, food counters, bigger time

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-breakfast-milk-and-food` |
| **Created** | 2026-07-18 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

> **Extended by [[sas-breakfast-bread-and-push]] (2026-07-19):** the « À manger » heading was
> replaced by a strong divider, a « Pain (baguette) » 0,5-step counter joined the section,
> pastries/bread get server-side smart defaults pre-commit, and a serving-time push was added.

---

## 1. Context

The arrival-SAS breakfast step ([[sas-breakfast-and-handover-note]], Implemented) lets the guest set the breakfast time, count drinks (Café / Thé / Chocolat chaud via three `CountStepper`s, stored in `reservations.breakfastCoffee/Tea/Chocolate`), and leave a note. A coherence hint (« X boisson(s) pour Y personne(s) ») turns orange on mismatch and a non-blocking `ConfirmDialog` fires on « Suivant ». The operator reads the counts + time pill on the planning breakfast card (`OptionDayCard`, fed by `GET /api/planning/breakfast`).

Missing today: **milk** as a drink choice, any way to know **how many pastries or cereal bowls** to prepare, and the time input is a small discreet field (`maxWidth: 200`, small size) — hard to notice on a phone.

## 2. Goal

During check-in, the guest can also ask for milk, and state how many viennoiseries and how many bowls of cereal the tray should carry; the chosen breakfast time is displayed big and readable. The operator sees the new counts on the planning breakfast card.

## 3. Functional rules

1. **Milk drink**: a 4th stepper « Lait » joins Café / Thé / Chocolat chaud, stored in `reservations.breakfastMilk` (INTEGER ≥ 0, default 0). Milk counts toward the drinks total in the coherence hint.
2. **Food section**: below the drinks, a new « À manger » group with two independent steppers — « Viennoiseries » (`reservations.breakfastPastries`) and « Céréales » (`reservations.breakfastCereals`), both INTEGER ≥ 0, default 0.
3. **Coherence**: two hints, same style and behavior as today:
   - drinks: « {coffee+tea+chocolate+milk} boisson(s) pour {persons} personne(s) » — orange + bold on mismatch;
   - food: « {pastries+cereals} à manger pour {persons} personne(s) » — same treatment.
   « Suivant » with any mismatch opens the existing single `ConfirmDialog` (non-blocking); its message names only the mismatching category(ies) (boissons, aliments, or both).
4. **Bigger time (SAS only)**: the « Heure du petit déjeuner » input is rendered prominently — input value in large type (≥ 1.5 rem, bold), full-width on `xs` — so the chosen time is readable at a glance. The planning card's time pill is unchanged (decision 2026-07-18).
5. **Persistence & validation**: the three new fields ride the existing `POST /api/reservations/:id/sas/arrival` payload; server clamps each to a non-negative integer (same rule as the existing drink counts). Omitted fields default to 0 on commit, matching current behavior for the drinks.
6. **Operator view**: `GET /api/planning/breakfast` items gain `milk, pastries, cereals`; the planning breakfast card renders the three new counters with the same display rule as the existing drink counters (Lait in the drinks row; Viennoiseries / Céréales as a food row).
7. Devis and non-applicable reservations are untouched (fields only sent/stored when the breakfast step is applicable — existing gating).

**Edge cases:**
- Reservation checked in before this change → new columns read 0; SAS re-open (reopen-completed-sas) shows 0s, editable as usual.
- All-zero food section → hint shows « 0 à manger pour Y personne(s) » in orange (mismatch) but stays non-blocking, like drinks today.
- Guest sets food but no drinks (or vice versa) → each hint evaluates independently; one confirm dialog covers both.

---

## 4. Architecture

> Fat backend, thin frontend: clamping, defaults, payload shaping and planning aggregation stay server-side; the client renders steppers and the hint strings from server-provided `persons`.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` (+ `schema.sql`) | T | 3 guarded columns on `reservations`: `breakfastMilk`, `breakfastPastries`, `breakfastCereals` (INTEGER NOT NULL DEFAULT 0) |
| `models/` | `reservationsModel.js` | T | `commitArrivalSas` writes the 3 new columns (clamped ≥ 0 ints, default 0 when omitted) |
| `models/` | `breakfastModel.js` | T | SELECTs + `getForReservation` + planning items gain `milk, pastries, cereals` |
| `controllers/` | `sasController.js` | T | `getSas` breakfast block + `commitArrival` forwarding gain the 3 fields |
| `routes/` | — | — | (none — existing endpoints, additive payloads) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.js` | T | « Lait » stepper; « À manger » section (2 steppers); food coherence hint + combined confirm message; big time input; payload fields |
| `components/` | `OptionDayCard.js` | T | Renders `milk` in the drinks counters and a Viennoiseries / Céréales row |
| `pages/` | `PlanningPage.js` | T | The breakfast-card item mapping whitelists fields — `milk`, `pastries`, `cereals` added (found during UI verification: the API sent them but the mapping dropped them) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing)** | module-level `CountStepper` (ReservationSasDialog), `ConfirmDialog` | Same building blocks as the current drinks |
| **Created (new generic)** | — | none |

### 4.3 API contract (additive)

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/reservations/:id/sas` | `breakfast` block gains `milk, pastries, cereals` (ints) |
| POST | `/api/reservations/:id/sas/arrival` | accepts `breakfastMilk?, breakfastPastries?, breakfastCereals?` (clamped ≥ 0 ints) |
| GET | `/api/planning/breakfast` | each item gains `milk, pastries, cereals` |

## 5. Data model

`reservations` gains `breakfastMilk`, `breakfastPastries`, `breakfastCereals` — INTEGER NOT NULL DEFAULT 0, guarded `ALTER TABLE` in `database.js` + mirrored in `schema.sql`. Default 0 is correct for every existing row (nothing requested). No data loss risk.

## 6. UI / UX

**SAS — étape « Petit déjeuner »** (top to bottom):
1. « Heure du petit déjeuner » — same time input, now prominent: large bold value (`≥ 1.5 rem`), full-width on `xs` (fixed comfortable width on `sm+`).
2. Divider, then **Boissons**: Café, Thé, Chocolat chaud, **Lait** (icon `LocalDrink` or similar), each a `CountStepper`; drinks hint below.
3. Divider, then **« À manger »**: Viennoiseries (icon `BakeryDining`), Céréales (custom `WheatIcon` — a real wheat ear, mdi « barley » glyph wrapped in a MUI SvgIcon; user feedback 2026-07-18, replaced `RiceBowl` then `Grain`); food hint below.
4. Note field (unchanged).
Confirm dialog on « Suivant » when any hint mismatches — message names the mismatching category(ies), e.g. « Le nombre de boissons (2) et le nombre d'aliments (0) ne correspondent pas au nombre de personnes (3). Continuer quand même ? ».

**Planning — carte petit déjeuner**: counters row gains « Lait » ; second line « Viennoiseries × N » / « Céréales × N » with the same zero-count display rule as the existing drink counters. Time pill unchanged.

**Responsive**: steppers already stack full-width on `xs` (existing layout); the big time input takes the full row on `xs`. No new dialogs.

## 7. Test plan

### Server unit tests — 2058 pass (full suite, 2026-07-18)
- [x] `sas-commit.unit.test.js` (extended) — commit writes the 3 new columns (1.2→1, −3→0), defaults 0 when omitted
- [x] `breakfast-model.unit.test.js` (extended) — planning items + `getForReservation` carry `milk, pastries, cereals`; `breakfast-option-card.unit.test.js` schema updated

### Client tests
- [x] Vitest (661 pass): `ReservationSasDialog.test.js` extended — payload carries the 3 fields; combined plural message (drinks+food), food-only singular message, both-matched no-confirm; stepper indices via a `PLUS` map
- [x] E2E: 32 pass / 1 skipped

### Manual UI verification (2026-07-18, dev — reservation 22198, reset afterwards)
- [x] SAS arrival: big bold time (09:00), 4 drink steppers incl. Lait, « À manger » section; both hints turn grey at 4/4; no confirm when both match; commit persisted `2|0|0|2|3|1|09:00` in DB
- [x] Re-open SAS (re-edit mode) → all counts pre-filled
- [x] Planning card (19/07) shows « Café 2 · Lait 2 » + « Viennoiseries 3 · Céréales 1 » (after the PlanningPage mapping fix)
- [x] Mobile 375px: time full-width, steppers stacked, no horizontal scroll

## 8. Out of scope

- Planning time pill styling (unchanged — decision 2026-07-18).
- Pricing: the breakfast option price is per person and unchanged; the new counts are preparation info only.
- Stock/inventory of viennoiseries; per-flavor details.
- J-2 / J-7 email content (coffee-machine line etc. untouched).

## 9. Open questions

All resolved 2026-07-18 with Adrien (AskUserQuestion): two independent food counters (not an exclusive choice); food gets the same non-blocking coherence hint as drinks (milk joins the drinks sum); bigger time in the SAS only.
