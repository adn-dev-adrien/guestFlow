# Option-driven planning cards

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/option-planning-card` _(created after approval)_ |
| **Created** | 2026-06-17 |
| **Author** | Adrien |
| **Touches** | `database.js`, `models/optionsModel*`, `models/reservationsModel`, `models/planningOptionCardsModel` (new), `controllers/planningController`, `routes/planning`, `pages/OptionsPage`, `components/reservation/ExtrasSection`, `pages/PlanningPage`, `components/OptionDayCard` (new) |

---

## 1. Context

The Planning (`PlanningPage`) already shows per-day operational cards: arrivals (`ReservationCard`),
departures, laundry (`LaundryDayCard`), breakfast (`BreakfastDayCard`). The operator wants a **new kind of
card driven by an option**: when a reservation includes a flagged option (e.g. « Repas »), a card must appear
in the planning at a chosen date + time, reusing the reservation's client info — to remind the operator to
act (prepare the meal, etc.).

Resolved decisions (AskUserQuestion 2026-06-17):
- The option carries a **default date + default time**; both are **editable per reservation** on the fiche.

## 2. Goal

An option can be flagged « carte planning ». Each reservation that selects it produces a card in the
planning, on a date + time defaulting from the option but adjustable per reservation, showing the option
label + the client + the property. Clicking the card opens the reservation fiche.

## 3. Functional rules

### 3.1 Option configuration (catalog)
1. An option gains a toggle **« Afficher une carte dans le planning »** (`showsPlanningCard`, default OFF).
2. When ON, a **mode de répétition** (`cardRepeat`) is chosen — **both repeat across the stay days**
   (decision 2026-06-17, no single fixed-date mode):
   - **« Une fois par jour »** (`'once_per_day'`, default) — **one** card per stay day. The operator sets a
     **single default heure**.
   - **« Plusieurs fois par jour »** (`'multiple_per_day'`) — **several** cards per stay day (typically
     meals). The operator configures a **list of créneaux horaires**; the **number of slots = cards/day**
     (e.g. 08:00 · 12:30 · 19:30 ⇒ 3/day).
3. Slots are stored as `planningCardTimes` (JSON array of `HH:MM`): **exactly 1** entry for `'once_per_day'`,
   **N ≥ 1** for `'multiple_per_day'`. (`planningCardDate` is unused — kept nullable for back-compat; the
   legacy `'daily'` value maps to `'multiple_per_day'`, `'once'` to `'once_per_day'`.)
4. Toggling OFF keeps the stored values so re-enabling restores them.

### 3.2 Per-reservation occurrences (the fiche) — the source of truth
5. When a `showsPlanningCard` option is **on a reservation**, the fiche (ExtrasSection) shows, pre-filled from
   the option's defaults: the **editable heure(s)** (one field for `'once_per_day'`, the slot list for
   `'multiple_per_day'` — edited once, applied to every day) **then the per-day selection** as **one row per
   stay day, each présent créneau a selectable chip** showing its heure (filled = selected; same layout for
   both modes — `'once_per_day'` simply has one chip/day). Only the créneaux within the guest's presence
   appear on the boundary days (§6.bis): e.g. arrivée 15:00 ⇒ the arrival day offers only the late créneaux
   (a 09:00 once-per-day option hides that day entirely); départ 10:00 ⇒ the departure day offers only the
   morning créneaux. All selected by default; the operator toggles each (jour × créneau) individually.
   - **Breakfast departure-morning rule (`autoOptionType = 'breakfast'`):** breakfast is still served the
     **departure morning** even when its time falls after check-out (e.g. breakfast 09:00, check-out
     08:00). Instead of the presence filter dropping that occurrence (which left the seed grid empty on a
     1-night stay → the engine returns no line → the toggle bounces back off), the departure-day occurrence
     is **kept and retimed to 30 min before the scheduled departure** (08:00 → 07:30). Applied by
     `seedTime` in both the first-enable seed and the date/heure reconcile. The arrival morning stays
     excluded (no breakfast before check-in).
   - **Empty-grid safety net (other daily options):** if the presence filter still excludes *every*
     candidate slot (a non-breakfast daily option entirely outside the guest's window), `buildInitialGrid`
     falls back to seeding **all stay days** (checked) so a manual enable never silently vanishes; the
     operator then adjusts the days.
6. The **selected occurrences** (checked day × slot) are the single source of truth: they drive both the
   planning cards (§3.3) and the option's billed quantity/price (§3.4). They are stored on
   `reservation_options.cardOccurrences` — a JSON array of `{ date, time, done }` (the checked ones; `done` =
   §3.5). Re-opening a saved reservation restores the selection.
6.bis. **Presence filtering (decision 2026-06-17).** A slot only produces an occurrence when the guest is
   actually present at that time: on the **arrival day** a créneau **before `checkInTime`** is dropped; on
   the **departure day** a créneau **after `checkOutTime`** is dropped; middle days keep every slot (untimed
   slots are always kept). Editing a slot's heure on the fiche **re-filters** the boundary days live (a meal
   moved across the bound appears/disappears). Example: 3 meals (08:00 · 12:30 · 19:30) over a 17→20 stay
   (arrivée 15:00, départ 10:00) ⇒ 17:`19:30` · 18/19:`all 3` · 20:`08:00` = **8 occurrences**.

### 3.3 Planning rendering
7. For the visible window, the server returns **one card per selected occurrence** whose `date` ∈ window, for
   `kind = 'reservation'` only (devis excluded). Each carries: option **title**, **client** (first + last, or
   the iCal summary as elsewhere), **property name**, the occurrence **date** + **time**, `reservationId`,
   `optionId`. (No server-side expansion — the occurrences are already materialised on the reservation.)
8. Cards appear **under the day header** of their date, alongside the laundry / breakfast cards; multiple
   same-day occurrences are sorted by time. Click → open the reservation fiche (`/reservations/:id`).
9. Card content **mirrors the arrival/departure card format** (decision 2026-06-17): **one card per
   occurrence**, with the **option title** as the heading + the **time in a pill** beside it (like the
   departure card), then the **property name** (home icon), then a **person icon + client name + family
   composition** (Adultes / Enfants / Ados / Bébés chips, non-zero only). It keeps a distinct **deep-purple
   background** and is a touch **more compact** than the arrival/departure cards. The model therefore also
   returns `adults / children / teens / babies`.

### 3.4 Quantity & price follow the selection
10. The option's **billed quantity auto-adjusts to the selection**, server-side (the authority):
    `billedUnits = (number of selected occurrences) × (guest count when the option is per-person, else 1)`,
    using the **same guest basis** as today's per-person options. Examples:
    - per-personne option, **4 guests × 2 selected days** ⇒ **8** ;
    - a 3-slots/day meal option over a 3-day stay, all checked, 4 guests ⇒ 4 × 9 = **36** ;
    - a fixed-price occurrence option ⇒ **1 × (selected count)**.
    For a card-option this **replaces** the automatic nights/days computation (the operator's selection is
    authoritative). Price = `billedUnits × unitPrice`, as today.
10.bis **The guest count of a per-person card option is editable** since 2026-08-20
    ([card-option-served-persons.md](card-option-served-persons.md)): the line carries
    `reservation_options.cardPersons` — how many people each of its moments actually serves — and the
    formula reads `billedUnits = moments × (cardPersons ?? guest count)`. `NULL` (the default, and every
    line written before that date) means « the whole party », so rule 10 above is unchanged for them.
    The fiche shows a « Personnes servies » field where the « Qté » field is hidden, the arrival SAS shows
    the same stepper on its sale pages, and the ceiling is the property's capacity (`properties.maxGuests`).
11. Checking/unchecking or editing an occurrence on the fiche updates the quantity + price **live** (client
    preview) and is **recomputed server-side on save** (the authority). The reservation's total + the
    devis/PDF follow. The « Personnes servies » field behaves exactly the same way.
11.bis **`unitPrice` is the one the booking was sold at, not today's**
    (`specs/devis-extras-parity-and-price-lock.md` §3 rule 13bis, added 2026-08-16). Only `billedUnits`
    follows the selection; the price per unit is replayed from `reservation_options.unitPrice` for as long
    as the booking is price-locked. Raising a catalogue / per-property price never re-prices a card option
    on an existing reservation — that used to surface as an unexplained end-of-stay complement.

> **Candidate days** (decision 2026-06-17): every day the guest is present, `startDate … endDate`
> inclusive, **all pre-checked**; the operator unchecks unwanted days (the departure-day case is handled by
> simply unchecking it — no separate rule needed).

### 3.5 « Préparé » flag on the planning card (decision 2026-06-17)
12. Each planning card carries a **« fait » circle checkbox** (same affordance as the arrival/departure
    cards). Ticking it marks **that occurrence** prepared: a `done` boolean stored **per occurrence** in
    `cardOccurrences` (`{ date, time, done }`). When done, the card turns **green** (border + tint + time
    pill), dims, and shows a **« Fait » badge** next to the time — mirroring the arrival « Prêt » / departure
    « Effectué » chips.
13. The toggle persists immediately via **`POST /api/planning/option-cards/done`**
    `{ reservationId, optionId, date, time, done }` (optimistic on the client, reverts on failure). `done`
    is **orthogonal to billing** (never changes `billedUnits`) and **survives a reservation re-save** (the
    pricing engine preserves it through `cardOccurrences`).

## 4. Architecture

> **Fat backend, thin frontend.** The option flag + defaults, the per-reservation values, and the
> window-shaped card list all live server-side; the client renders ready-made cards.

### 4.1 Server (`server/src/`)
| Layer | File | C/T | Responsibility |
|---|---|---|---|
| database | `database.js` | T | Idempotent migrations: `options` += `showsPlanningCard INTEGER DEFAULT 0`, `cardRepeat TEXT DEFAULT 'once'`, `planningCardDate TEXT`, `planningCardTimes TEXT`; `reservation_options` += `cardOccurrences TEXT`. (The `cardRepeat` default is harmless — new options always write `once_per_day`/`multiple_per_day`.) |
| models | options model (where options are read/written) | T | Round-trip the new option columns; normalize `cardRepeat` to the two day-modes, clamp `once_per_day` to 1 slot, parse/serialise `planningCardTimes` JSON. |
| models | `models/reservationsModel.js` | T | On save, persist each card-option's `cardOccurrences` (JSON, incl. `done`). Return it parsed with the reservation's options. |
| pricing | `utils/pricing.js` (where `billedUnits` is derived) | T | For a card-option, **derive `billedUnits` from `cardOccurrences`** (§3.4): `count × (guests if per-person else 1)`, replacing nights/days. `normalizeCardOccurrences` preserves `{date,time,done}`. Authoritative server-side. |
| models | `models/planningOptionCardsModel.js` | C | `cardsInRange(from,to)` → emit one card per stored occurrence (with family + `done`) whose `date` ∈ [from,to]; `'reservation'` only. **`setOccurrenceDone({reservationId,optionId,date,time,done})`** flips one occurrence's `done`. Factory `buildModel(db)`. |
| controllers | `controllers/planningController.js` | T | `optionCards` → `GET /api/planning/option-cards?from&to`; **`setOptionCardDone` → `POST /api/planning/option-cards/done`** (validates + toggles). |
| routes | `routes/planning.js` | T | Wire both routes. |

No change to accounting (the flag + occurrences drive only this option's `billedUnits`; `done` is metadata).

### 4.2 Client (`client/src/`)
| Layer | File | C/T | Responsibility |
|---|---|---|---|
| pages | `pages/OptionsPage.js` | T | The « carte planning » toggle + the **mode** select (« Une fois par jour » → one heure / « Plusieurs fois par jour » → time-slot list with add/remove) on the option form; `fromItem`/`toPayload` carry them. |
| components | `components/reservation/ExtrasSection.js` | T | For a selected `showsPlanningCard` option, render the **editable heure(s)** (shared) + the **per-day selection** (one row per day with a **chip per présent créneau**, both modes), and thread the selected `cardOccurrences` into the save payload. Reflect the resulting **quantity** (count × guest-factor). Re-filter presence + recompute occurrences when stay dates / heures change. |
| components | `components/OptionDayCard.js` | C | New presentational card — **one card per occurrence** in the arrival/departure format: a **« fait » circle** + option title + time pill, then property, then person + client + family chips (vertically aligned, indented under the title); own deep-purple bg, more compact; green when done; click → fiche. |
| pages | `pages/PlanningPage.js` | T | Fetch `api.getPlanningOptionCards`; render `OptionDayCard`s under each day; `handleToggleOptionCardDone` persists the « fait » flag (optimistic). |
| services | `api.js` | T | `getPlanningOptionCards({from,to})` + `setPlanningOptionCardDone({reservationId,optionId,date,time,done})`. |
| utils | `utils/cardOccurrences.js` (new) | C | Occurrence-grid helpers: `buildInitialGrid` (all pre-checked, first enable), `buildGridFromStored` (edit-load), `reconcileGrid` (stay-date / heure change), `isPresent` (boundary-day check-in/out filter, §6.bis), `toWireOccurrences` (checked → `{date,time,done}`). UTC-based date math (no TZ drift). |
| utils | `utils/applyQuoteToForm.js` | T | **Preserve each card-option's working occurrence grid across live recomputes** (like `inComplement`). Without it, the next recompute sends no occurrences → the server returns no line → the option vanishes (regression found + fixed during implementation, 2026-06-17). |

## 5. Data model

New columns (no new tables):
- `options`: `showsPlanningCard` (INTEGER 0/1, default 0), `cardRepeat` (TEXT `'once_per_day'|'multiple_per_day'`),
  `planningCardDate` (TEXT, unused — kept nullable), `planningCardTimes` (TEXT JSON array of `HH:MM`, null).
- `reservation_options`: `cardOccurrences` (TEXT JSON array of `{ date, time, done }`, null — the **selected**
  occurrences for this reservation; its length × guest-factor drives `billedUnits` (§3.4); `done` = §3.5).

JSON columns keep the schema flat (no extra table) while supporting N occurrences. Existing rows default to
OFF → no behaviour change until the operator flags an option.

## 6. UI / UX

- **OptionsPage**: the toggle reveals the **mode** (radio/select « Une fois » / « Chaque jour du séjour »).
  « Une fois » → a date + a time. « Chaque jour » → a **list of time slots** with add/remove (« + ajouter un
  créneau »), the count being the cards/day. Consistent with the existing option form; mobile: fields stack.
- **ExtrasSection** (fiche résa): under a card-option's row, an **occurrence checklist** — `'once'`: one
  editable date + heure (date via `DateField`, closes on pick); `'daily'`: one checkbox row per day × slot
  (« {date} — {heure} », all pre-checked, heure editable). A small caption shows the resulting quantity
  (« 8 = 4 pers × 2 jours » style). Mobile: rows stack.
- **PlanningPage**: `OptionDayCard` placed under the day header with the other day cards; responsive like the
  existing cards. Multiple occurrences on a day are time-sorted; empty time → no « HH:MM » shown.

## 7. Test plan

### Server unit tests
- [x] `planningOptionCardsModel.cardsInRange`: emits one card per stored occurrence in window; excludes
  devis; excludes non-card options; carries client + property + title + date/time; client-name fallback
  (name → iCal summary → placeholder); same-day occurrences time-sorted; null/empty → nothing.
  (`tests/planning-option-cards-model.unit.test.js`, 6 tests.)
- [x] `optionsModel`: the card config (`showsPlanningCard` / `cardRepeat` / `planningCardDate` /
  `planningCardTimes`) round-trips; `'once'` clamps to ≤1 slot; `planningCardTimes` parses back to an array.
  (`tests/options-model-planning-card.unit.test.js`, 4 tests.)
- [x] **Pricing**: `billedUnits` of a card-option = `selectedOccurrences × (guests if per-person else 1)`
  (4 guests × 2 days = 8 ; 3 slots × 3 days × 4 guests = 36 ; fixed = count); empty selection → no line;
  the line carries its occurrences for persistence. (`tests/pricing-option-planning-card.unit.test.js`, 5 tests.)
- [x] Migration is idempotent (full suite re-run safe; 1587 server tests green).

### Client tests
- [x] `utils/cardOccurrences`: enumerate / dailySlots / buildInitialGrid / buildGridFromStored /
  reconcileGrid / toWireOccurrences. (`utils/__tests__/cardOccurrences.test.js`, 12 tests.)
- [x] `applyQuoteToForm` preserves the occurrence grid across recomputes (regression guard within the
  existing 17-test suite, all green).

### Manual UI verification (done 2026-06-17, dev browser)
- [x] OptionsPage: toggle → mode select; « Chaque jour » reveals the slot list (« Ajouter un créneau »);
  saved option round-trips (`showsPlanningCard=1, cardRepeat='daily', planningCardTimes=["09:00"]`).
- [x] Fiche réservation 12080 (Gîte, 17→20 juin, 4 adultes): enabling « Repas du soir » shows the 4-day
  checklist pre-checked, « Quantité : 16 (4 × 4 pers.) », Total 192 €; unchecking the 17th → « 12 (3 × 4
  pers.) », 144 €; save persists `billedUnits=12`, 3 occurrences; edit-reload restores the exact selection.
- [x] Planning: 3 `OptionDayCard`s render on 18/19/20 juin (« Options · 09:00 · Gîte • Nodelete Attention :
  Repas du soir »).

## 8. Out of scope

- Repetition patterns **beyond « once » and « each day of the stay »** (e.g. weekly, specific weekdays,
  every N days, or different slots on different days). « Daily » applies the same slots to every stay day.
- Per-option custom **icon/colour** (a generic icon for all option-cards this iteration).
- Notifications/push for these cards (planning display only).

## 9. Open questions

- **Resolved 2026-06-17:** default date/time on the option, editable per reservation; **repeat mode on the
  option** — « une fois » (single date+time) or « chaque jour du séjour » with **N créneaux/jour** (e.g.
  meals). Daily range = `startDate … endDate` inclusive (§3.3, confirmable).
- Icon for the card: a generic « événement » icon this iteration unless you want per-option icons (→ a
  follow-up).
