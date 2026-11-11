# Date pickers close on selection (reservation page)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-datepicker-close` |
| **Created** | 2026-06-16 |
| **Author** | Adrien |
| **Touches** | `components/DateField.jsx` (new) and its callers (§4) |

---

## 1. Context

Every date field on the reservation page (échéance acompte, échéance solde, « payé le » of each payment
component, dates de caution, dates d'arrivée/départ) is a native `<input type="date">`. On some browsers /
OSes the native calendar stays open after a day is clicked, forcing a second click elsewhere to dismiss it.

## 2. Goal

Clicking a day in any of these calendars should **immediately close the calendar** — one click picks the
date and dismisses the picker.

## 3. Functional rules

- When a date is selected in any reservation-page date field, the calendar closes right away.
  - **Reading of 2026-11-02 (audit R19-L1).** « Selected » means picked in the native calendar, never
    typed. The blur ran after every change, and Chromium fires a change on each digit once the date is
    complete (2 → 0002, 20 → 0020…): the first digit of the year dropped the focus, so typing 2028 left
    0002 and a day of 15 left 01. A date could not be typed on the fiche at all. `DateField` now blurs
    only when no key was pressed on the field in the last 500 ms; a pointer press on the field (which is
    how the calendar opens) clears that mark, so a pick after typing still closes the calendar.
  - **Reading of 2026-11-02, bounds.** While a date is being typed, the `min` / `max` the caller gives in
    `slotProps.htmlInput` stay those of the first key press until the field loses the focus. Chromium
    drops a half-typed date when a bound moves, and the fiche derives its bounds from the value being
    typed (arrival `min` from the previous stay before the typed start, departure `max` from the next
    stay after the typed end): without the freeze the second digit of the year emptied the field. A
    pointer press on the field lifts the freeze too (amended 2026-11-02, review of PR #936): the calendar
    it opens shows the live bounds, after a blur or not. The next key press freezes them again.
- The selected value is applied exactly as before (no behaviour change beyond closing).

## 4. Architecture

### Client (`client/src/`)
| Layer | File | C/T | Responsibility |
|---|---|---|---|
| components | `components/DateField.jsx` | C | Generic native date input: a thin `TextField` wrapper that forces `type="date"` and, after the caller's `onChange`, **blurs the input** so the native calendar closes on selection — unless the change was typed (a key pressed on the field less than 500 ms before; reading of 2026-11-02). While typing it holds the `htmlInput` `min` / `max` of the first key press until the blur or a pointer press. The caller's `onKeyDown`, `onPointerDown` and `onBlur` still fire. |
| components | `components/reservation/StaySection.jsx` | T | « Date d'arrivée » / « Date de départ », with bounds derived from the typed value. |
| components | `components/reservation/FinanceSection.jsx` | T | « Encaissé le ». |
| components | `components/reservation/PaymentMarkForm.jsx` | T | The payment date (`autoFocus`). |
| components | `components/reservation/InstallmentPlanCard.jsx` | T | An installment's due date (`max` = arrival; committed on blur and Enter). |
| components | `components/reservation/MidStayNoteRow.jsx` | T | A mid-stay note's date. |
| components | `components/reservation/RefundDialog.jsx` | T | The refund date. |
| components | `components/CancellationCompensationDialog.jsx` | T | Its 4 date fields. |
| plugins | `plugins/sdk/index.js` | T | Exports `DateField` to plugins; used by `plugins/linen/LaundryExtraTripDialog.jsx`. |

The readings of 2026-11-02 apply to every caller above, the SDK export included.

No server / API / data-model change.

## 5. UI / UX

- Behaviour is identical except the native picker dismisses on day-click. Same labels, validation, min/max
  (StaySection passes `htmlInput` min/max through `DateField` unchanged). Mobile unaffected.

## 6. Test plan

### Client — `client/src/components/__tests__/DateField.test.js` (3 tests, green)
- [x] renders a native date input (`type="date"`) and forwards the change to the caller;
- [x] blurs the field on selection (so the native calendar closes);
- [x] works without an `onChange` prop.
- [x] existing reservation-section tests still pass (FinanceSection / StaySection, 37 green).

### Client — `client/src/components/__tests__/DateField.keyboard.test.jsx` (9 tests, green; 2026-11-02)
- [x] a change right after a key press keeps the focus and reaches the caller; every digit of a typed
  year keeps it; Backspace clearing keeps it;
- [x] a pointer press after typing, or a change long after the last key press, is a pick: it blurs;
- [x] the caller's `onKeyDown` / `onPointerDown` / `onBlur` still fire;
- [x] a bound moved by the typed value waits for the blur; without typing it applies at once.
  Red on the previous `DateField`: 5 of the 8 fail.
- [x] a pointer press in the field after typing lifts the frozen bounds (review of PR #936; red before
  the fix).

### Manual UI verification
- [ ] On the reservation page, picking a day in the acompte / solde / arrivée / départ calendars closes it
  immediately. (Native picker close is browser UI, not automatable via Playwright — covered by the blur
  unit test + a render regression check.)
- [x] 2026-11-02, headless Chromium (fr-FR) on a copy of the shadow, 1280 and 390 px: on a new fiche,
  15032028 typed in « Date d'arrivée » gives 15/03/2028 and 22032028 in « Date de départ » gives
  22/03/2028, the focus staying in the field (before: 0002, then an empty field). A change after a pointer
  press on the field, the way the calendar sets it, still blurs. The native popup itself stays outside
  Playwright's reach.

## 7. Out of scope

- The text-typed `DateInput` component (DD/MM/YYYY) — it has no calendar and is unaffected.
- Date pickers outside the reservation page.

## 8. Open questions

- None.
