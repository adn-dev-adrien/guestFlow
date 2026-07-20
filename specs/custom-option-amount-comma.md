# Custom option amount — comma input + line survival across recomputes

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/custom-option-comma-amount` |
| **Created** | 2026-07-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Bug reported 2026-07-20: on the reservation form, typing a French comma in a custom option's
« Prix TTC » field (e.g. `12,5`) instantly closed the line — the amount snapped to 0 and the
whole custom line vanished from the form.

Two stacked causes:

1. The field was a `type="number"` input. A comma makes the browser report an empty value, so
   every keystroke committed `amount = 0` into the form state.
2. The live pricing recompute filters incomplete custom lines (empty description or amount ≤ 0)
   out of the request payload, and `applyQuoteToForm` rebuilt `form.customOptions` **only from
   the quote's echoed lines** — any line the payload skipped was erased from the form on the
   next recompute. The same mechanism also deleted a freshly-added empty line as soon as any
   other field change triggered a recompute.

## 2. Goal

The operator can type a custom option amount with a French comma, and an in-progress
(incomplete) custom line never disappears on its own.

## 3. Functional rules

1. The « Prix TTC » field of a custom line accepts free text and commits on **Enter/blur** only,
   via the existing `ArithmeticTextField` (French comma accepted, arithmetic expressions too,
   result rounded to 2 decimals, clamped ≥ 0, invalid input reverts to the last committed value).
   No commit happens mid-typing.
2. Clearing the field commits `amount = 0` (the line stays visible; it is simply not sent to the
   pricing engine until completed).
3. `applyQuoteToForm` MUST preserve any `prev.customOptions` line absent from the quote's echoed
   custom lines, verbatim and in its original position. Quote-echoed lines are merged as before
   (engine amounts/contribs, local `inComplement` wins). Quote-only lines (initial load) are
   appended.
4. A complete line (description + amount > 0) keeps round-tripping through the engine unchanged:
   sent in the payload, echoed in the quote, merged back.

**Edge cases:**
- Typing `12,` mid-edit → nothing commits; the draft text stays; blur evaluates `12`.
- A recompute triggered by any other field (dates, guests, Compl. toggle…) while an incomplete
  line exists → the line survives untouched.
- Deleting a line then receiving a stale quote echo → guarded by the existing `requestId`
  check in `ReservationPage` (stale responses are discarded), no resurrection.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

None — client-only fix. The pricing engine contract is unchanged (incomplete lines were already
filtered out of the payload; they still are).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `ExtrasSection.js` | T | « Prix TTC » swaps `type="number"` → `ArithmeticTextField` (commit on Enter/blur). Also moves a stray `alignItems` prop into `sx` (MUI 9 DOM-prop warning). |
| `utils/` | `applyQuoteToForm.js` | T | `customOptions` rebuild now keeps prev lines missing from the quote (rule 3). |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `ArithmeticTextField` | Third adoption (after `customPrice` + `clientGrossAmount`, specs/reservation-price-arithmetic.md). |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | — | |

### 4.3 API contract

Unchanged.

---

## 5. Data model

None.

## 6. UI / UX

- Same layout and width as before; the field simply behaves like the other money fields
  (« Prix TTC » shows the committed number, free text while focused).
- Responsive: unchanged (full-width on `xs`, 180px on `sm+`).

## 7. Test plan

### Client unit tests (vitest)
- [x] `utils/applyQuoteToForm.test.js` — 3 new tests: incomplete line kept when absent from the
      quote; echoed + unechoed mix preserves order and merges; quote-only lines appear on
      initial load (20 tests total in file).
- [x] `components/reservation/__tests__/ExtrasSection.test.js` — 1 new test: typing `12,5` does
      not commit mid-typing, blur commits `{ amount: 12.5 }` (7 tests total in file).

### Manual UI verification
- [x] Happy path: add a line, type `12,5`, Tab → field shows `12.5`, line intact, summary shows
      « 12,50 € » after the live recompute.
- [x] Edge case: a second empty line survives a recompute triggered by a Compl. toggle on
      another line (pre-fix: it vanished).
- [x] Regression check: catalog options / resources rows unaffected; Compl. toggles still stick.
- [x] `npm run test:e2e` (Playwright, 26 specs) green.

## 8. Out of scope

- Adopting `ArithmeticTextField` on other money fields (deposit/balance/caution overrides) —
  still the follow-up noted in specs/reservation-price-arithmetic.md.
- Any server-side validation change.

## 9. Open questions

None.
