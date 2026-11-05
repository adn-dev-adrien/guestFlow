# Non-card options — a typed number of people stays that number

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/non-card-option-served-persons` _(Claude-managed)_; `fix/non-card-option-served-persons-inte` for `inte/plugins` |
| **Created** | 2026-11-03 |
| **Approved** | 2026-11-03 |
| **Author** | Adrien |
| **Amends** | [card-option-served-persons.md](card-option-served-persons.md) rules 1, 5, 6, 9, 16; [reservation-quantity-stepper.md](reservation-quantity-stepper.md) (per-person Qté); [sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) (non-card SAS sale) |
| **Decision summary** | [docs/specs/2026-11-03-non-card-option-served-persons.html](../docs/specs/2026-11-03-non-card-option-served-persons.html) |
| **Related PR** | _(opened at the end of implementation)_ |

---

## 1. Context

For a non-card option (`options.showsPlanningCard = 0`) priced `per_person`, `per_night` or
`per_person_per_night`, `reservation_options.quantity` stores a BASE: what the operator typed divided
by the multiplier, rounded to 4 decimals. The client does it in `toBaseQuantity` /
`toDisplayedQuantity` (`client/src/pages/ReservationPage.jsx`), the server in
`server/src/utils/sasOptionSale.js` (`round4(billedUnits / multiplier)`), and the engine re-derives
`billedUnits = quantity × getTypeMultiplier(priceType, persons, nights)` in `pricing.js`.

So 3 meals typed for 4 people are stored as 0.75, and the same line bills 3.75 meals once the party
becomes 5.

**Confirmed in production on 2026-11-03** (read-only), reservation 22336 (created by converting quote
22335), 24-26 December:

| When | Party | What happened | `finalPrice` |
|---|---|---|---|
| 01/11 16:23 | 10 | bath linen typed 11, stored base 1.1 | +8.00 € |
| 01/11 19:26 | 10 → 11 | 1.1 × 11 = 12.1 towels sets | +58.80 € (50 € extra guest + 8.80 € of linen nobody asked for) |

Bed linen ended at 11.1 (base 1.0091) on the same fiche, offered, so at no cost. The guest had paid
1,732.20 € on 2026-11-03, a payment not yet recorded on the fiche. Across production, 8 of the 86 non-card per-person lines have `quantity ≠ 1`:
4 healthy lines from the SAS (integer `billedUnits`) and these 4 lines (22336 and quote 22335).

Card options already solved this with `reservation_options.cardPersons` (NULL = follows the party,
integer = frozen; `resolveServedPersons`, `pricing.js`). This spec extends that mechanism.

**Correction applied on 2026-11-03, reservation 22336 only, at Adrien's request.** Bath linen and bed
linen set to 11. Stay total 1,792.60 €, balance 1,732.20 € paid on 03/11, arrival complement 60.40 €
(50 € extra guest, 8 € linen, 2.40 € tax) to settle on site. The values come from replaying the real
sequence through the API on a copy of production, and saving through the app afterwards moves no amount.
Backup: `~/guestflow/data/backup-avant-correction-202611001-20261103-074253.db`. Quote 22335 is untouched.

## 2. Goal

A typed number is billed as typed whatever the party or the stay later becomes, and the operator is told
when it no longer matches. A line nobody touched follows the party and the nights. A decimal quantity
never appears on these lines again.

## 3. Functional rules

1. **Scope:** non-card options priced `per_person` / `per_person_per_night`, and `per_night` since
   rule 19. Unchanged: `per_stay`, `per_hour`, `per_participant_progressive`, `percent_of_stay`, the cancellation insurance
   and every card option.
2. The number of people served is stored in `cardPersons` (NULL = the whole party).
3. `served = resolveServedPersons({cardPersons, persons, maxGuests}).served`;
   `billedUnits = quantity × served × (ppn ? nights : 1)`. `quantity` remains the base of the other
   dimensions (normally 1).
4. A count equal to the party is stored NULL and follows the party. A different count is frozen.
5. **Bounds:** `1 ≤ served ≤ max(party, maxGuests)`. Removing the option is done with the switch, never
   by typing 0.
6. The number of people served enters neither the occupancy nor the tourist tax. The readers that
   multiply `persons × quantity` today use `served × quantity`: non-card breakfast
   (`breakfastModel.js` `morningPersons`) and bath linen / laundry (`laundryModel.js`,
   `linenInventory.js`, `linenInventoryModel.js`).
7. A change of party never produces a decimal quantity again.
8. **Fiche, `per_person`:** « Qté » is the number of people served, pre-filled with the party, integer
   stepper. The server stores `cardPersons` and `quantity = 1`.
9. **Fiche, `per_person_per_night`:** same, with the hint « × N nuits ».
10. ~~`per_night`: unchanged.~~ Superseded by rule 19 (2026-11-03).
    > **Sans test** — superseded by rule 19, which is tested.
11. The client never multiplies nor divides the typed number (CLAUDE.md §6.0).
12. **SAS:** `priceOptionSale` for a non-card per-person option stores `cardPersons` and `quantity = 1`;
    no more `round4`.
13. **Mid-stay (`MidStayNoteDialog`):** same field as the fiche. What the note counts as added, and what
    « Annuler » restores, read that number and not `quantity`, which stays 1.
14. **Migration**, idempotent (one-shot `non_card_served_persons_v1` in the `migrations` table), on non-card `per_person` / `ppn` lines where
    `quantity ≠ 1`: `served = billedUnits / (ppn ? nights : 1)`. When it is a positive integer:
    `cardPersons = served` (NULL if equal to the party), `quantity = 1`. Never rewrites `billedUnits`,
    `unitPrice`, `totalPrice`, `inComplement` nor the deposit/balance contributions.
15. When `served` is not an integer (a line that already drifted): the line is logged and left as is,
    then corrected case by case after Adrien's agreement. A sold or locked line is corrected only on an
    explicit decision.

Rules added during planning (2026-11-03), found while reading the code:

16. **Migration ceiling.** A line whose integer `served` exceeds `max(party, maxGuests)` is treated like
    rule 15: logged and left. Migrating it would let the engine clamp it on the next save, and money
    would move silently. No such line exists in production today.
17. **A line sold at arrival keeps its floor, in people.** `arrivalLineFloors` reasons in `quantity`,
    which is now 1. It also returns `minTypedCount`, what the fiche uses as the field's minimum. The
    server guard does not change: `arrivalExtrasViolations` refuses any save below the amount sold.
18. **A drifted line reads as what it bills.** The engine returns `servedPersons` (`quantity × served`)
    on these lines, so rule 15's lines show 12.1 rather than a reassuring 11. Typing a whole number
    stores it as rule 8 says and repairs the line: this is how a rule 15 correction is made.

Rules added after Adrien's review of this spec (2026-11-03):

19. **`per_night` gets the same fix.** A typed number of nights is stored in the new column
    `reservation_options.cardNights` (NULL = follows the stay, integer = frozen) with `quantity = 1`, and
    `billedUnits = quantity × (cardNights ?? nights)`. A value equal to the stay is stored NULL. Minimum 1.
    Rules 14-16 apply with `served = billedUnits`. The cancellation insurance stays excluded.
20. **A typed value that no longer matches turns red.** When the party changes, every line with a frozen
    number of people that differs from the new party is flagged: non-card options AND the « Personnes
    servies » field of card options. When the stay changes, the same for a frozen number of nights. The
    field shows the error state and the line says what it was typed for.
21. **The operator is told at once.** An alert under the party and dates names the lines concerned. The
    server decides which lines: the quote returns `typedCountAlerts`, the client renders them.
22. **Saving asks.** While a line is flagged, the update answers `409 TYPED_COUNTS_STALE` unless
    `forceTypedCounts` is set, on the same pattern as `MIN_NIGHTS`. The fiche opens the existing `confirm`
    dialog: « Annuler » returns to the fiche, « Forcer l'enregistrement » saves the values as they are.
23. **Forcing is the decision.** Once saved, the value is the new reference and the line is no longer
    flagged on reload. A line that was not flagged and is typed after the party changed is not flagged:
    each line carries the party or stay it was typed for, for the current editing session.
    **Editing a flagged line does not clear the flag.** Its reference stays the party it was typed for,
    so the field stays red until the value equals the current party or stay, the operator applies it
    (rule 26), the party or stay returns to the reference, or a save is forced.
    A devis behaves the same: a forced save clears the flags at once, without a reload (audit R21-C1).
24. **Only an operator is asked.** A server caller with nobody in front of it (mail intakes) sends
    `forceTypedCounts`. A locked past reservation is not asked, like the other save guards.
25. **Non-regression, permanent.** The suite must fail if: a typed value moves when the party or the stay
    changes; any combination of type, typed value, party and nights yields a decimal `billedUnits`; the
    reservation 22336 sequence yields anything but 88 € and 60.40 €; the save guard is bypassed; or
    `OptionRow` / `MidStayNoteDialog` start converting a typed value with a multiplier again.
26. **Applying the new value in one click.** A flagged field has a button with circular arrows beside it,
    tooltip « Appliquer 11 personnes » or « Appliquer 3 nuits ». It sends `cardPersons` / `cardNights` as
    NULL: the line follows the party or the stay again and the flag goes. On `xs` the button stays beside
    the field, 44 × 44 px. It is not offered when the current value is outside rule 5's bounds.

Rules added after audit round 21 (2026-11-03):

27. **An offered line sold at arrival keeps its floor on the typed count.** Its `quantity` stays 1 and it bills
    0 €, so neither the quantity check nor the amount check can see a reduction. `arrivalExtrasViolations` compares
    the submitted line's `cardPersons` / `cardNights` with `minTypedCount` and answers `reduced`
    (`400 ARRIVAL_EXTRAS_FROZEN`). A line sent NULL follows the party or the stay and is not compared: billed units
    are never read here, or a party lowered on a whole-party line would be refused. The floor is rounded down to a
    whole number, so a drifted offered line is still repaired as rule 18 says.
28. **A per-person SAS sale sent with `units` and no `persons`** (a tab still running the previous bundle, up to
    `sas` 1.7.4) reads as people served: `max(1, floor(units / (ppn ? nights : 1)))`, then rule 12 applies: stored
    in `cardPersons`, `quantity = 1`. The units are divided by the nights only, never by the party, so the typed
    count stays what it is. `persons` wins when both are sent. `units` that are not a positive number (`0`, `-2`,
    `'abc'`) with no `persons` sell nothing, as before #946; neither `units` nor `persons` is still the party. A
    `units`-only `per_night` or `per_stay` sale is unchanged.
29. **The server sends the figure to print.** `quantity` stays 1 on a typed line, so no reader prints it
    as a count. Stored lines (`getByIdWithDetails`, the reception view, the stored summary) and quote lines
    carry `displayCount`: the people served on `per_person` / `per_person_per_night`, the nights on
    `per_night`, whether typed or followed, read as the fiche's field reads them (a whole party of 4 reads
    4, a drifted line reads what it bills, rule 18). A card line, the cancellation insurance and every other
    price type keep `quantity`. The dashboard's arrivals, the SAS « Prestations réservées », `PricingSummary`
    and the Google Calendar description print it; `ReservationCard` keeps `billedUnits`. A non-card breakfast
    with `quantityUnit: 'morning'` counts mornings: the typed nights on `per_night`, the stay's nights on
    `per_person_per_night`. No amount moves.
30. **The field shows what is billed.** In `applyQuoteToForm`, a numeric `cardPersons` / `cardNights` echo
    wins over the form, so a count the engine clamped reads as the clamped number; a `null` echo keeps the
    form value, since it means « follows » and must not wipe a number being typed. Stale answers are already
    dropped by request id. Supersedes the « form wins » reading of card-option-served-persons.md rule 9.
    The clean baseline of the unsaved-changes guard takes that echo only when the quote asked for the value
    the baseline holds, so a stored count above capacity opens clean (the engine read it) and a number typed
    before the first quote lands stays an edit, on the fiche's opening and after a payment mark alike.
    A clamp is a move: rule 25 protects a typed value from the party and the stay, not from the capacity. With
    a party forced above capacity (7 for 5, typed 6), lowering the party clamps the line to 5 and it stays 5
    when the party returns to 7, with no alert and ×5 in the summary: the field shows what is billed.
31. **The note's « Annuler » restores the opening state whole.** `MidStayNoteDialog` captures on opening,
    through the page, the option lines, the offered set, the bed counters and the welcome pack's refusals, and
    gives them back on « Annuler », so a line taken out returns with its occurrence grid and its typed count.
32. **The note's rows have the fiche's bounds.** A line sold at arrival keeps its floor (`minTypedCount`, or
    `minQuantity` on a plain line) and its card button is disabled; only a line with no floor can be taken
    off by typing 0. People served are capped at the larger of capacity, party and the value held (rule 5). Typed
    nights stop at 366, or at the value held when higher (rule 34, the constant `OptionRow` reads; added 2026-11-04,
    audit R22-C5: with no ceiling the refusal only came after the click, and the dialog closed with 500 in the form).
33. **« En fin de séjour » waits for an addition.** It is measured against the current opening, so it is
    absent on opening and a second opening never compares with the first.
34. **A typed count is judged, never reinterpreted.** On every write that prices options (preview, create,
    update, devis create and update) a present `cardPersons` is a whole number from 1, a present `cardNights` a
    whole number from 1 to 366 (D7's stay cap), or 400 `INVALID_CARD_PERSONS` / `INVALID_CARD_NIGHTS`, before any
    pricing. Absent, null or empty still means « follows ». A count above the stay stays allowed (rule 25), and a
    `cardPersons` above the capacity is still clamped by the engine (rule 5). A count the line already stores is
    not re-judged when sent back unchanged, so rule 15's archived lines keep saving. *Why:* `0.5` stored a free
    line whose next save billed the whole stay, `400` billed 400 nights with no refusal, `-1` silently meant the
    whole party. Prod check of 2026-11-03: every stored `cardPersons` is whole, no `cardNights` above 366. The
    nights field stops at 366 (`OptionRow`, a hint), or at the stored value when higher.

Rule added after audit round 22 (2026-11-04):

35. **A number typed on an unsold line of the note is that number.** Typing 5 on an unsold plain line sells 5, typing
    1 on an unsold per-night line sells 1 night, typing 2 on an unsold per-person line serves 2 people. The line goes
    through the switch's way in first, so the property's offered default still applies. *Why:* the field used to sell
    the default whatever was typed (1, the stay, the party), and only re-reading it showed the difference. Accepted:
    the field cannot tell a typed 1 from a stepped one, so « + » from 0 on a typed line also commits 1, not the party.
    A count equal to the party or the stay follows them (rule 4).

**Edge cases:**
- Party lowered below a frozen count (3 served, party now 2) → stays 3, within rule 5's ceiling when the
  property allows it; the engine's existing clamp applies otherwise.
- Baby only added → no change, babies never count.
- Option switched off and on again → back to the party, pre-filled.
- WordPress widget → still sends quantity 1 = everyone: a NULL `cardPersons`, unchanged.
- Converting a quote → `copyLineGraph` copies `cardPersons` with the line.
- Party forced above capacity, typed 6, party 3, party 7 again → stays 5, no alert (rule 30, accepted 2026-11-03).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | — | — | (none) |
| `models/` | `bookingLinesModel.js` | T | Verify `cardPersons` survives persist, `copyLineGraph`, `getPricingSnapshot` for non-card lines |
| `models/` | `breakfastModel.js` | T | `morningPersons` non-card: `served × quantity` (rule 6) |
| `models/` | `laundryModel.js` | T | Towel demand from `COALESCE(cardPersons, party) × quantity` (rule 6) |
| `models/` | `linenInventoryModel.js` | T | Reads `cardPersons` with the bath lines (rule 6) |
| `models/` | `reservationsModel.js` | T | SAS sale writes `cardNights`; `readExtraLinesWithQuantity` carries `typedCount` (rule 17) |
| `models/` | `devisModel.js` | T | Carries `cardNights`; same save guard as a reservation (rule 22); same refusal of a bad count (rule 34) |
| `models/` | `bookingLinesModel.js` | T | `getStoredTypedCounts`: the stored counts rule 34 does not re-judge |
| `controllers/` | `devisController.js` | T | Forwards the guard's `code` and `lines` |
| `middleware/` | — | — | (none) |
| `utils/` | `pricing.js` | T | Generic option path: pure helper `resolveNonCardUnits`, returns `cardPersons`, `cardNights`, `servedPersons`, `servedNights` |
| `utils/` | `sasOptionSale.js` | T | Rules 12 and 28; `buildOptionOffer` reads `selectedPersons` from `sold.cardPersons` for non-card too |
| `utils/` | `linenInventory.js` | T | Towel count from served people (rule 6) |
| `utils/` | `midStayExtrasWindow.js` | T | `minTypedCount` on the floors (rule 17), compared for an offered line (rule 27) |
| `utils/` | `lineInputBounds.js` | C | The boundary guard of a line's and a party's numbers (rule 34; `reservations-backend-mvc.md` rule 15) |
| `utils/` | `typedCounts.js` | C | Pure: `typedCountAlerts`, the 409 payload, `typedCountOf`, `displayCountOf` (rules 17, 20-23, 29) |
| `models/`, `utils/` | `reservationsModel.js`, `storedSummary.js`, `receptionView.js`, `pricing.js` | T | Carry `displayCount` on stored and quote lines (rule 29) |
| `plugins/google-calendar/` | `events.js`, `model.js`, `manifest.json` | T | The event description prints the same figure, read locally from `billedUnits` so the plugin needs no newer SDK (rule 29); 1.2.7 |
| `utils/` | `servedPersonsOptionMigration.js` | C | Rules 14-16, 19; dry-run returns the list without writing |
| `utils/` | `reservationUpdateBody.js` | T | Carries `cardNights`; server callers send `forceTypedCounts` (rule 24) |
| `controllers/` | `reservationsController.js` | T | `409 TYPED_COUNTS_STALE`, `forceTypedCounts`, `typedCountAlerts` on the quote (rules 21-22) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | Adds `cardNights`; runs the migration once, behind its row in the `migrations` table |

On `inte/plugins` the linen files live in `server/src/plugins/linen/`, and the plugin's manifest version
is bumped.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | `setOptionServedPersons`, `setOptionTypedNights`: carry the typed intent, no arithmetic; alert under party and dates; `TYPED_COUNTS_STALE` handled like `MIN_NIGHTS` |
| `components/` | `reservation/OptionRow.jsx` | T | « Qté » in people or nights + « × N nuits » hint; red state from `typedCountAlerts`, card options included |
| `components/` | `reservation/MidStayNoteDialog.jsx` | T | Same field; restores the opening state, arrival floor, ceiling (rules 31-33); a number typed on an unsold line (rule 35) |
| `pages/`, `components/`, `plugins/sas/` | `Dashboard.jsx`, `PricingSummary.jsx`, `ReservationSasDialog.jsx` | T | Print `displayCount` (rule 29) |
| `components/` | `sas/ReservationSasDialog.jsx` | T | Reuses the « Personnes servies » stepper for non-card per-person options |
| `hooks/`, `services/`, `constants/`, `styles/` | — | — | (none) |
| `utils/` | `applyQuoteToForm.js` | T | Keeps `servedPersons`, `servedNights`, `cardNights` and the typed-against tags; `applyQuoteToBaseline` for the clean baseline (rule 30) |
| `utils/` | `bookingFormHydration.js` | T | Loads `cardNights` |
| `utils/` | `optionTypedCount.js` | C | Which field an option has, what it shows, the nights' ceiling; no arithmetic (rule 11) |
| `components/` | `reservation/TypedCountField.jsx` | C | Stepper + red state + circular arrows, shared by non-card and card options |
| `components/` | `reservation/GuestsBedsSection.jsx` | T | The alert of rule 21 |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `QuantityField`, `CountStepper`, the fiche's `confirm` dialog (`MIN_NIGHTS` pattern) | No new dialog. |
| **Created (new generic)** | — | None in `components/`. |
| **Specific (kept feature-local)** | `TypedCountField` | Tied to the quote's `typedCountAlerts`, used by the two option rows and nothing else. |

### 4.3 API contract

No new endpoint. Backward-compatible additions:

| Payload | Field | Notes |
|---|---|---|
| Option line, request | `cardPersons` | Now honoured on non-card `per_person` / `ppn` lines |
| Option line, quote response | `cardPersons`, `servedPersons` | Stored value, and the figure to display |
| SAS sale, request | `persons` | Replaces `units` for a non-card per-person option; `units` alone is still read (rule 28). The offer's `unitsPerPerson` is gone (2026-11-04, audit R22-S5): the dialog computed a `units` the draft never sent |
| `editLock.arrivalLines[key]` | `minTypedCount` | Rule 17 |
| Option line, request and quote | `cardNights`; `servedNights` on the quote | Rule 19 |
| Option line, request | `typedAtParty`, `typedAtNights` | Form-local reference of rule 23, never stored |
| Stored and quote option lines | `displayCount` | Rule 29: the figure a reader prints |
| Quote response | `typedCountAlerts: [{ optionId, title, kind, typed, reference, current }]` | Rules 20-21 |
| `POST`, `PUT /api/reservations`, `/api/devis` | `forceTypedCounts`; `409 { code: 'TYPED_COUNTS_STALE', lines }` | Rule 22 |

---

## 5. Data model

`reservation_options.cardPersons` exists. New nullable column `reservation_options.cardNights`, added
idempotently in `database.js`; existing rows stay NULL, so they follow the stay as they do today.
Migration: rules 14-16 and 19, one-shot, idempotent (a migrated line has `quantity = 1` and is no longer
matched), in a transaction.

**Data impact:** no amount changes. In production: 4 lines migrated (22199, 9, 22269, 22280). The two
lines of quote 22335 are left and logged; those of 22336 were corrected by hand on 2026-11-03.

**Rollback (accepted exception, recorded 2026-11-03, audit R21; [self-update-and-releases.md](self-update-and-releases.md)
rule 39).** The schema only adds a column, but this migration, and every line the code writes since, changes what
`quantity = 1` means. An engine below v3.20.0 ignores `cardPersons` on a non-card line and knows no `cardNights`, so
after a rollback below v3.20.0 a typed line re-bills the whole party or the whole stay **at its next save**: on a copy
of production under v3.19.0, a line of 1 unit at 8 € became 4 units at 32 €. The stored amount does not move until
that save. Accepted, documentation only: undoing it would mean storing a base quantity again, which is what this spec
removes. After such a rollback, restore the pre-update backup, or review the typed lines before saving their fiches.
On a roll-forward the flag is already set, so a line typed during the rollback window keeps its decimal base and
reads as what it bills until it is retyped (rule 18).

## 6. UI / UX

Interactive rendering in the [decision summary](../docs/specs/2026-11-03-non-card-option-served-persons.html).

- `per_person`: « Qté », integer stepper, pre-filled with the party. The header's « ×5 pers. » hint is
  dropped on these rows: it contradicted a typed 3.
- SAS, non-card per-person option: « Personnes servies — amount » stepper.
- `per_person_per_night`: same, with « × N nuits » as helper text.
- Minimum 1, maximum `max(party, maxGuests)`; the stepper's `＋` is disabled at the ceiling, and a typed
  value out of bounds is clamped by `QuantityField`.
- **Flagged line:** red field, helper text « Saisi pour 10 personnes, groupe : 11 », circular-arrows
  button beside it (`SyncIcon`, rule 26).
- **Alert** under party and dates: « Valeur saisie à vérifier : Linge de toilette ».
- **Dialog at save** (existing `confirm`), title « Quantités saisies à vérifier », one line per option,
  « Annuler » / « Forcer l'enregistrement ».
- `per_night`: « Qté » pre-filled with the nights, integer stepper.
- Printed counts (rule 29): « Linge x3 » on the arrivals, « • Linge × 3 » in the SAS recap, « Linge ×3 » in
  the summary, « - Linge x3 » in the calendar event. A figure of 1 prints no count in the SAS and the summary.
- Note dialog, same on `xs`: a row sold at arrival stops at its floor, a sold card line's « Ajouté ✓ » is disabled, typed
  nights stop at 366, a number on an unsold row sells that number.
- No new page, so `PageActionBar` is untouched.
- **Responsive:** `xs` full-width field as today (`width: { xs: '100%', sm: 180 }`), the hint under the
  field; `md` and `lg` unchanged. `MidStayNoteDialog` is already full-screen on `xs`.

## 7. Test plan

### Server unit tests
- [x] `tests/non-card-option-served-persons.unit.test.js` (12) — rules 1, 5, 6, 12, 14-17, 19
- [x] `plugins/linen/tests/non-card-served-persons.unit.test.js` (2) — rule 6: the contract and the laundry
- [x] `plugins/linen/tests/non-card-served-persons-simulation.unit.test.js` (2) — rule 6: the sum over the stored lines, and the projection reading `cardPersons`
- [x] `tests/typed-counts-alerts.unit.test.js` (7) — rules 19, 20, 23, 25: party, nights, which line is flagged, the floor on a typed count
- [x] `tests/typed-counts-guards.unit.test.js` (6) — rules 19, 21, 22, 24: devis, creation, live quote, locked past stay, replay of a frozen night count
- [x] `tests/typed-counts-floors-and-sas-offer.unit.test.js` (4) — rules 17, 19: floor of an offered line, re-opened SAS, a per-night sale typed and following the stay
- [x] `tests/served-persons-migration-cases.unit.test.js` (1) — rules 14, 16, 19: a real boot on a seeded file, party < count ≤ capacity, per-night count equal to the party, per-night above capacity
- [x] `tests/typed-counts-no-regression.unit.test.js` (11) — rule 25: exhaustive grid, 22336 sequence through the controller, save guard. Mutation-checked: restoring the old computation fails 4 tests, removing the guard fails 2
- [x] `tests/line-input-bounds.unit.test.js` (12) — rule 34, `reservations-backend-mvc.md` rule 15
- [x] `tests/typed-counts-client-guard.unit.test.js` (4) — rule 25: no multiplier conversion left in the option fields
- [x] `tests/sas-option-sales.unit.test.js` — updated (rule 12)
- [x] `tests/sas-sale-legacy-units.unit.test.js` — rule 28: `units` alone, the nights, the remainder, the real resolver
- [x] `tests/typed-count-offered-floor.unit.test.js` (10) — rule 27: pure rule and the real controller
- [x] `tests/typed-count-display-figure.unit.test.js` (10) — rule 29: helper, stored stay, reception view, stored summary, live quote, breakfast mornings
- [x] `plugins/google-calendar/tests/typed-count-description.unit.test.js` (4) — rule 29: push, reconcile, plugin and core read a line alike
- The existing `breakfast-model`, `laundry-model`, `laundry-end-to-end.regression` and `linen-inventory` suites still pass unchanged: a drifted `quantity` keeps scaling the party. Rule 6's new behaviour is covered in the feature's own file (CLAUDE.md §9).

### Client tests
- [x] `OptionRow.served-persons.test.jsx` (8) — field, hint, no arithmetic, red state on an alert
- [x] `MidStayNoteDialog.typed-count.test.jsx` (3) — rule 13
- [x] `GuestsBedsSection.typed-counts.test.jsx` (2) — rule 21
- [x] `ReservationSasDialog.non-card-persons.test.jsx` (3) — §6: « Personnes servies — montant », rule 12: `{ optionId, persons }` in the commit body
- [x] `optionTypedCount.test.js` (4) — rules 1, 18, 19: which option has a field, the nights column
- [x] `applyQuoteToForm.typed-counts.test.js` (3) — rules 18, 19, 23
- [x] `bookingFormHydration.typed-counts.test.js` (1) — rule 19
- [x] `arrivalDraft.typed-count.test.js` (2), `ReservationSasDialog.typed-count.test.jsx` (1) — rule 12, client half
- [x] `MidStayNoteDialog.typed-count-additions.test.jsx` (2) — rule 13: an addition is read on the typed number
- [x] `ReservationPage.typed-counts.test.jsx` (8) — rules 4, 8, 19, 22, 23: floor, equal drops, tags, dirty compare, confirm, flags cleared
- [x] `OptionRow.typed-nights-max.test.jsx` (4) — rule 34
- [x] `ReservationPage.devis-forced-typed-count.test.jsx` (1) — rule 23 on a devis
- [x] `Dashboard.typed-count.test.jsx` (1), `ReservationSasDialog.options-count.test.jsx` (1), `PricingSummary.typed-count.test.jsx` (3) — rule 29
- [x] `applyQuoteToForm.numeric-echo.test.js` (5) — rule 30
- [x] `MidStayNoteDialog.cancel-and-floor.test.jsx` (9) — rules 31-33
- [x] `MidStayNoteDialog.unsold-line-count.test.jsx` (7) — rules 32, 35: the number typed on an unsold line, the nights' ceiling
- [x] `applyQuoteToForm.baseline-echo.test.js` (5), `ReservationPage.typed-count-baseline.test.jsx` (4) — rule 30: a count typed before the quote lands stays an edit, opening and after a mark; a clamped stored count opens clean
- [x] `ReservationPage.options-restore.test.jsx` (2) — rule 31: capture then restore on the real page gives back the lines, the offered set, the beds and the pack's refusals

### End to end
- [x] `e2e/specs/reservations/typed-count-party-change.spec.js` — type 3 for 4 → party 5 → red, alert; retype 2 → still red; dialog: cancel keeps the fiche, force saves; circular arrows → 5, no red
- [x] `e2e/specs/reservations/typed-count-nights.spec.js` — `per_night`: 3 typed for 2 nights → saved → 4 nights → still 3, red, circular arrows → 4; `per_person_per_night`: « × N nuits », an untouched line follows the party and the nights

### Manual UI verification
- [x] Happy path: per-person option typed 3 for 4 people → party 5 → still 3, same total (desktop + mobile)
- [x] Edge case: untouched line follows the party; ppn shows « × N nuits » and follows the nights (held by `typed-count-nights.spec.js`, 2026-11-03)
- [x] Alert: party change turns the field red, card option included; save opens the dialog; reload after forcing shows no red
- [x] Red field: retyping another wrong value stays red; the circular arrows apply the new value and clear it
- [x] `per_night`: typed 3 for 2 nights → 4 nights → still 3, red (held by `typed-count-nights.spec.js`, 2026-11-03). This line used to say « → 3 nights »: a number equal to the new stay is not flagged (rule 20), it follows the stay
- [x] Regression: `per_night` Qté (`typed-count-nights.spec.js`)
- [ ] Regression: arrival SAS catering in a browser. Held by `ReservationSasDialog.catering` and `.typed-count` in Vitest, and on the server by `sas-option-sales`; no E2E walks this step, and nobody has clicked through it since this change
- [ ] Regression: card options « Personnes servies »: held by `ExtrasSection.served-persons` and `OptionRow.served-persons` in Vitest; no E2E, nobody has clicked through it since this change

**Known limit:** the history's option signature reads `quantity` and `totalPrice`, so a typed number changed on an
offered line (0 €) leaves no history entry.

**Known, not caused by this change:** at about 900 px the « Résumé tarifaire » panel overflows the page as
soon as an option is active on the fiche.

## 8. Out of scope

- Resources: their `quantity` also serves as stock.
- The WordPress widget: it sends « 1 = everyone », unchanged.
- The custom line's `soldeContribTtc` was reset to NULL by a priced fiche save on a paid reservation, seen while
  rehearsing the 22336 correction. This spec first read « no amount moves »; that was wrong: the total and the cash
  hold, but revenue moved between 706 accounts on booked entries (audit R21-M1). Fixed on 2026-11-03 by
  [reservation-save-keeps-pricing.md](reservation-save-keeps-pricing.md) rule 19.

## 9. Open questions

(none)
