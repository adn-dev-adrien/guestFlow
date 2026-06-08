# Arithmetic input on reservation price fields

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-price-arithmetic` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On the reservation page (`FinanceSection`), the operator often needs to adjust a price by a small
delta (add a fee, subtract a discount, sum two amounts). Today the **"Prix hébergement ajusté"**
(`customPrice`) and **"Prix payé par le client"** (`clientGrossAmount`) fields are plain
`type="number"` inputs — you can only type a final number, and the browser blocks `+`/`*`. The
operator wants to type an expression like `100+20` and have it evaluated to `120`.

## 2. Goal

In those two money fields, typing an arithmetic expression (e.g. `100+20`, `(100+20)*2`, `350+12,5`)
and pressing **Enter** or clicking away **evaluates** it and sets the numeric result.

## 3. Functional rules

1. The two fields accept arithmetic expressions using `+ - * /`, parentheses, and decimals. The
   French decimal comma (`100,5`) is accepted as well as the dot.
2. The expression is evaluated **on Enter or on blur** (focus leaving the field) — **not** on every
   keystroke. While typing, the raw text is shown untouched.
3. On a valid expression → the field is set to the **numeric result**, rounded to 2 decimals and
   clamped to ≥ 0 (money). The downstream pricing recompute / commit happens with that number, exactly
   as if the operator had typed the final value.
4. On an **invalid / incomplete** expression (e.g. `100+`, `(100`, `abc`) → the field silently
   **reverts** to the last committed value. No error, no garbage persisted.
5. Clearing the field commits an **empty** value (same as before — clears the override).
6. Evaluation is **safe**: no `eval`/`Function`; a constrained tokenizer + shunting-yard parser. A
   user-typed field can never execute code.
7. Server-side behavior is unchanged: the server still validates + rounds money (`validateFinanceInputs`,
   `roundMoney`). This is a pure client-side input convenience; the committed value is a normal number.

**Edge cases:**
- `100/0` (division by zero) → invalid → revert.
- `100/3` → `33.33` (rounded to 2 decimals).
- `10-50` in `customPrice` → clamped to `0`.
- Unary signs: `-50+70` → `20`; `+100` → `100`.

---

## 4. Architecture

> Client-only UX enhancement. No backend, no data model, no API change.

### 4.1 Server side
| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | None. Server money validation/rounding unchanged. |

### 4.2 Client side (`client/src/`)
| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `utils/arithmetic.js` | C | `evaluateArithmetic(input)` — safe tokenizer → RPN → eval; returns `number` or `null` (empty/invalid). Pure, unit-tested. |
| `components/` | `components/ArithmeticTextField.js` | C | Generic money TextField: holds a text draft, commits the evaluated value on Enter/blur, reverts on invalid, clears on empty. `value` / `onCommit` controlled. |
| `components/reservation/` | `components/reservation/FinanceSection.js` | T | Replace the two `type="number"` fields (`customPrice`, `clientGrossAmount`) with `<ArithmeticTextField>`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Created (new generic)** | `ArithmeticTextField` | Generic — any money field can adopt it (deposit/balance/caution overrides are future candidates). JSDoc lists props. Backed by the pure `arithmetic.js` util. |
| **Consumed** | MUI `TextField` | Wrapped, with all props forwarded. |

---

## 5. Data model

No change.

## 6. UI / UX

- The two fields look identical to before (same label, size, helper text, error state) but are now
  text inputs (`inputMode="decimal"` for a numeric mobile keypad). Focus selects all (unchanged).
- After committing, the field shows the plain number (e.g. `120`). The "Prix ajusté" delta caption and
  the platform commission box recompute from the committed value as before.
- Responsive/touch behavior unchanged.

## 7. Test plan

### Client unit tests
- [x] `utils/__tests__/arithmetic.test.js` (**9 tests**): numbers, comma decimals, operators,
  precedence + parentheses, unary signs, empty/null, malformed → null, division by zero → null,
  unrounded raw result.
- [x] `components/__tests__/ArithmeticTextField.test.js` (**6 tests**): evaluates on blur + on Enter;
  no commit per keystroke; rounds to 2 decimals + clamps ≥0; invalid reverts; clearing commits ''.
- [x] `components/reservation/__tests__/FinanceSection.test.js`: updated — the adjusted-price field
  commits the evaluated expression on blur (not per keystroke).

### Manual UI verification
- [ ] In a reservation: type `100+20` in « Prix ajusté », press Enter → shows `120`, pricing recomputes.
- [ ] Type `350+12,5` in « Prix payé par le client », click away → `362.5`, commission recomputes.
- [ ] Type `100+` then blur → reverts to the previous value. *(pending — needs the running app)*

## 8. Out of scope

- Applying the arithmetic input to other money fields (deposit/balance/caution overrides) — easy
  follow-up now that `ArithmeticTextField` exists, but not requested.
- Percentages / units / currency symbols inside the expression.
- Showing a live preview of the result while typing (commit-on-blur only).

## 9. Open questions

(None.)
