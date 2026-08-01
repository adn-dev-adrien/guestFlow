# Reservation quantity stepper (`QuantityField`)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/reservation-quantity-stepper` _(user-managed)_ |
| **Created** | 2026-08-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On the reservation fiche (`ReservationPage`), every numeric input is a raw MUI `<TextField type="number">`
wired straight to a form setter. Two concrete problems make these fields painful — especially on a phone,
where the reservation is often edited in the field:

1. **Clearing the field deselects the option.** The « Qté » of an option is bound directly to
   `setOptionQuantity` ([ReservationPage.js:1284](../client/src/pages/ReservationPage.js#L1284)). That setter
   treats a quantity `≤ 0` — and an empty input, which parses to `NaN → 0` — as *remove the line* from
   `form.selectedOptions`. The moment the operator clears the digit to type a new one, the option's quantity
   becomes 0, the line is dropped, `explicitlyEnabled` flips to `false`
   ([ExtrasSection.js:333](../client/src/components/reservation/ExtrasSection.js#L333)), the whole editing
   block unmounts and the option looks *unchecked*. The user literally cannot empty-then-retype. Same wiring on
   the resource « Qté » / « Heures » field (`setResourceQuantity`, drops the line at `≤ 0`). The user reported
   this against the « Linge de lit » option; it reproduces on desktop too.

2. **No increment affordance on mobile.** `<input type="number">` shows no spinner arrows on iOS/Android, so
   there is no way to nudge a value up or down by touch — the operator must summon the numeric keyboard and
   retype, which triggers problem 1.

The codebase already solves the "decouple typing from commit" problem for the custom-option price via
`ArithmeticTextField` (local draft + commit on blur/Enter), and already has two ad-hoc `−/＋` steppers
(`Stepper` in `LaundryManualAdditionsDialog`, `CountStepper` in `sas/ReservationSasDialog`). There is no
shared, reusable stepper — CLAUDE.md §7 says this is exactly the kind of cross-cutting widget to extract.

## 2. Goal

The operator can edit every quantity on the reservation fiche comfortably on phone and desktop: the field
tolerates being momentarily empty while typing (never silently un-selecting the option), and offers tappable
`−` / `＋` buttons to step the value without a keyboard.

## 3. Functional rules

A new generic component **`QuantityField`** owns the numeric-input behavior. It is a controlled input over a
single number, with a local draft so intermediate states never leak to the parent.

1. **Draft while editing.** While the input is focused, the user's raw text is shown untouched. The parent's
   `onCommit` is **not** called on every keystroke — only on `−` / `＋`, on blur, and on Enter.
2. **Commit clamps.** On commit the draft is parsed and clamped to `[min, max]` (`max` optional). The clamped
   number is passed to `onCommit`. The displayed value resyncs to the committed number.
3. **Empty on commit → fallback, never a stray 0.**
   - Default (`allowEmpty = false`): an empty/invalid draft on blur reverts to `min` (so a min-1 field can
     never emit 0 → the option is never dropped). `−` / `＋` always operate on a number.
   - `allowEmpty = true`: an empty draft commits `''` (the field legitimately supports "blank", e.g. bed
     counters that start empty). `−`/`＋` treat a blank value as `min` for stepping.
4. **Stepper buttons.** A `−` button (left) and a `＋` button (right) step the committed value by `step`
   (default 1), clamped to `[min, max]`, committing immediately (live, like a keyboard entry of that value).
   `−` is disabled at `min` (or when blank in `allowEmpty` mode and `min ≥ 0` would go negative); `＋` is
   disabled at `max`.
5. **Keyboard.** `ArrowUp` / `ArrowDown` step by `step`; `Enter` commits and blurs. The input uses
   `inputMode="numeric"` (or `"decimal"` when `step` is fractional) so mobile shows the number pad, and
   `type="text"` so we fully control formatting (no native spinner).
6. **Passthrough.** `label`, `error`, `helperText`, `disabled`, `size`, `fullWidth`, `sx` and any other
   `...rest` forward to the underlying MUI `<TextField>` so callers keep validation/labelling exactly as today.
   The input stays labelled (accessible via its `label`), so existing `getByLabelText(...)` tests keep working.

**Wiring on the fiche** (behavior the fields must now have):

7. **Option « Qté »** ([ExtrasSection.js](../client/src/components/reservation/ExtrasSection.js)) uses
   `QuantityField` with `min = 1`, `allowEmpty = false`. Emptying then retyping keeps the option selected;
   `onCommit` maps through `toBaseQuantity` exactly as the old `onChange` did. The price recomputes on commit
   (blur / step / Enter) instead of per keystroke.
8. **Resource « Qté » / « Heures »** uses `QuantityField` with `min = 1`, `allowEmpty = false`, `max` = the
   existing availability cap (`(resource.available||0) * multiplier`) for non-hourly resources, and forwards
   `error` / `helperText` (availability conflict message) unchanged.
9. **Lits doubles / Lits simples** ([ExtrasSection.js](../client/src/components/reservation/ExtrasSection.js),
   `BedLinenInputsBlock`) use `QuantityField` with `min = 0`, `allowEmpty = true`, `max = maxDoubleBeds` /
   `maxSingleBeds`, forwarding the `error` (capacity mismatch / over-limit) + `helperText`. A blank value stays
   blank (unchanged from today, where the counters are reset to `''` when the option is disabled).
10. **Lits bébé** ([GuestsBedsSection.js](../client/src/components/reservation/GuestsBedsSection.js)) uses
    `QuantityField` with `min = 0`, `allowEmpty = true`, `max = maxBabyBedsByRule`, forwarding the
    « Dispo restante » helper text.

**Edge cases:**
- Type garbage (`"abc"`) then blur → reverts to last committed value (or `min` if empty). No `NaN` reaches the form.
- Paste `"5"` into a min-1/max-4 field then blur → commits `4`.
- Hold-agnostic: a single tap on `＋` steps once (no auto-repeat — out of scope).
- Per-person / per-night option (multiplier > 1): the field shows the *displayed* quantity (`base × multiplier`)
  and steps it by 1 in displayed space, then converts to base via `toBaseQuantity` — identical semantics to the
  old free-typed field, now with buttons. No change to the multiplier math.
- Locked reservation (`isReservationLocked`) / unavailable resource: `disabled` forwarded → input and both
  buttons disabled.

---

## 4. Architecture

Client-only change. No business logic moves to the client: `QuantityField` does **local UI state** (draft)
and **UX clamping** only. The authoritative clamping/normalization already lives in `setOptionQuantity` /
`setResourceQuantity` and on the server; those are untouched. This fits "thin frontend — rendering + local UI
state" exactly.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | **None.** No route, controller, model, migration or payload change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `QuantityField.js` | C | Generic controlled number input: local draft, commit-on-blur/Enter, `−`/`＋` steppers, clamp to `[min,max]`, `allowEmpty`. Forwards MUI `TextField` props. |
| `components/reservation/` | `ExtrasSection.js` | T | Replace the option « Qté », resource « Qté/Heures », and `BedLinenInputsBlock` lits doubles/simples `TextField`s with `QuantityField`. |
| `components/reservation/` | `GuestsBedsSection.js` | T | Replace the « Lits bébé » `TextField` with `QuantityField`. |
| `pages/` | `ReservationPage.js` | — | **Not touched** — the form setters already normalize; commit semantics unchanged. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | (none new consumed) |
| **Created (new generic)** | `QuantityField` | Generic by design — any numeric quantity/counter input. Immediate consumers: 4 fiche fields. Obvious future consumers: the two existing ad-hoc steppers (`LaundryManualAdditionsDialog`'s `Stepper`, `sas/ReservationSasDialog`'s `CountStepper`) and the Voyageurs guest counters — migrating those is **out of scope** here but the API is designed to absorb them. |
| **Specific (kept feature-local)** | — | none |

### 4.3 API contract

No API change.

---

## 5. Data model

No schema change. No data impact — `QuantityField` commits the same numeric values the old inputs did
(`min`-clamped instead of `0`/`NaN` for the never-empty fields).

## 6. UI / UX

**`QuantityField` visual** — a single MUI `TextField` (keeps label above, error/helperText below) with the
stepper buttons as input adornments:

```
        Qté
 ┌─────┬───────────┬─────┐
 │  −  │     2      │  ＋ │
 └─────┴───────────┴─────┘
   ↑ IconButton  ↑ centered value  ↑ IconButton
```

- `−` / `＋` are `IconButton`s (`RemoveIcon` / `AddIcon`, `fontSize="small"`) in `startAdornment` /
  `endAdornment`, min touch target 40×40 (MUI default; bumped to ≥44 on the buttons for the field context).
- The value is centered (`inputProps.style.textAlign: 'center'`).
- French tooltips/aria: `−` → "Diminuer", `＋` → "Augmenter".
- Disabled state greys the input and both buttons.

**Affected fiche fields** — same positions/labels/widths as today; only the widget changes:
- Option « Qté », resource « Qté »/« Heures » (Options et ressources card).
- « Lits doubles » / « Lits simples » (inside the enabled Linge-de-lit option card).
- « Lits bébé » (Voyageurs card, shown when babies > 0).

**Copy (FR):** button tooltips « Diminuer » / « Augmenter ». No other new strings; existing labels and helper
texts (« Dispo restante: … », « La quantité correspond au nombre d'heures. », capacity errors) are preserved.

**Responsive behavior:**
- `xs` (mobile): the `−`/`＋` buttons are the primary interaction — no reliance on native spinners, which don't
  render on mobile. Fields that are `fullWidth` today (`width: { xs: '100%' }`) stay full-width; the adornment
  buttons sit flush at each end, comfortably tappable (≥44px).
- `md` / `lg`: same component; auto width (`sm: 'auto'`) as today. `ArrowUp`/`ArrowDown` and typing still work
  for keyboard-first desktop users.
- No horizontal overflow introduced (adornments live inside the existing field box).

**Sticky action bar:** unchanged — `ReservationPage` already renders its inline action bar; this spec touches no
page-level action.

## 7. Test plan

### Server unit tests
- [x] None — no server logic changes (CLAUDE.md §9: tests not required for pure UI).

### Client unit tests (Vitest)
- [x] `components/__tests__/QuantityField.test.js` (C, 9 tests) — covers rules 1–5:
  - typing then blur commits the clamped number; intermediate keystrokes do **not** call `onCommit`;
  - empty draft + blur → `min` when `allowEmpty=false`, `''` when `allowEmpty=true` (rule 3);
  - `＋` / `−` step by `step`, clamp at `max` / `min`, and commit immediately (rule 4);
  - `−` disabled at `min`, `＋` disabled at `max`; `disabled` disables input + both buttons;
  - invalid text (`"abc"`) reverts to last committed value.
- [x] `components/reservation/__tests__/ExtrasSection.qty-clear.test.js` (C) — **regression pin for the bug**:
  emptying the option « Qté » field and blurring commits `1` (via `toBaseQuantity`), i.e. the option is **not**
  deselected. (Bug: previously committed `0` → line dropped.)
- [x] Existing pins stay green: `components/__tests__/ExtrasSection.bed-linen-inputs.test.js`
  (`getByLabelText(/Lits doubles|simples/i)` must still resolve), `GuestsBedsSection.baby-bed.test.js`,
  `ExtrasSection.platform-force-complement.test.js`.

### Playwright E2E
- [x] Existing reservation-editing specs stay green (build + unit tests don't render React — run `npm run test:e2e`).

### Manual UI verification
- [x] Happy path (desktop): open a reservation, enable « Linge de lit », clear the Qté digit, type `2`, blur →
      option stays selected, total recomputes.
- [x] Mobile (`xs`): the `−`/`＋` buttons step the option Qté and the bed counters without a keyboard.
- [ ] Edge: type non-numeric then blur → reverts; step past `max` on a capped resource → clamps.
- [ ] Regression: resource availability error message + capacity-mismatch error still surface; disabling the
      Linge-de-lit option still clears the bed counters; locked reservation disables the fields.


### Implementation notes (2026-08-01)
- Full client suite **697/697** green; client build OK. Two pre-existing pins were adapted to the new
  commit-on-blur / no-native-`max` behavior: `GuestsBedsSection.baby-bed.test.js` (focus→change→blur to commit;
  cap asserted via the disabled increment stepper) and `ExtrasSection.test.js` (Qté commits on blur).
- Live verification on the dev server confirmed the fix: clearing « Linge de lit » Qté kept the option selected
  and fell back to 1 (decrement disabled at min); increment stepped 1→2; mobile (390px) shows full-width
  steppers with no overflow.
- Playwright E2E runs in CI on the PR (local run deferred: dev servers held ports 3000/4000).
- Each `QuantityField` receives `disabled={isReservationLocked}`; `GuestsBedsSection` now reads
  `isReservationLocked` from the form context for this.
- Behavior change (intended, §9): quantities/price recompute on commit (blur / stepper / Enter), not per keystroke.

## 8. Out of scope

- Migrating the two existing ad-hoc steppers (`LaundryManualAdditionsDialog`, `sas/ReservationSasDialog`) and the
  Voyageurs guest counters (adultes / enfants / ados / bébés) to `QuantityField`. The component is designed to
  absorb them later; not done here to keep the change focused. (The guest counters share the same "empty → 0"
  awkwardness but do **not** deselect anything, so they're lower priority.)
- Press-and-hold auto-repeat on the `−`/`＋` buttons.
- Any server-side or pricing-engine change.

## 9. Open questions

- Q: Should the option « Qté » price recompute live per keystroke or only on commit (blur/step/Enter)?
  - A: **On commit**, matching the existing `ArithmeticTextField` behavior for the custom-option price. This is
    what makes the empty-while-typing state safe. Resolved 2026-08-01.
- Q: Extend to the Voyageurs guest counters now?
  - A: **No** — kept out of scope (see §8); they don't cause the deselect bug. Resolved 2026-08-01.
