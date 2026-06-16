# Date pickers close on selection (reservation page)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-datepicker-close` |
| **Created** | 2026-06-16 |
| **Author** | Adrien |
| **Touches** | `components/DateField.js` (new), `components/reservation/FinanceSection.js`, `components/reservation/StaySection.js` |

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
- The selected value is applied exactly as before (no behaviour change beyond closing).

## 4. Architecture

### Client (`client/src/`)
| Layer | File | C/T | Responsibility |
|---|---|---|---|
| components | `components/DateField.js` | C | Generic native date input: a thin `TextField` wrapper that forces `type="date"` and, after the caller's `onChange`, **blurs the input** so the native calendar closes on selection. |
| components | `components/reservation/FinanceSection.js` | T | The 8 native date `TextField`s (acompte/solde échéances, 4× « payé le », caution réception/restitution) now use `DateField`. |
| components | `components/reservation/StaySection.js` | T | The 2 native date `TextField`s (arrivée/départ) now use `DateField`. |

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

### Manual UI verification
- [ ] On the reservation page, picking a day in the acompte / solde / arrivée / départ calendars closes it
  immediately. (Native picker close is browser UI, not automatable via Playwright — covered by the blur
  unit test + a render regression check.)

## 7. Out of scope

- The text-typed `DateInput` component (DD/MM/YYYY) — it has no calendar and is unaffected.
- Date pickers outside the reservation page.

## 8. Open questions

- None.
