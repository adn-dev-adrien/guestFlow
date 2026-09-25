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
8. **A currency symbol is decoration, not a parse error.** `€`, `$`, `£` and the word `EUR` are
   dropped wherever they sit (`460,48 €`, `€ 460,48`, `460,48€`) before the expression is parsed.
   The operator fills these fields by copying an amount off a platform statement, and a statement
   never writes a bare number.
9. **Thousands separators are read as separators, not as missing operators.** A space between a
   digit and a group of exactly three digits is removed — and *every* kind of space counts, because
   a copy-paste carries a non-breaking (`U+00A0`) or narrow non-breaking (`U+202F`) one, not the
   ASCII space. A dot is removed the same way, but **only when it cannot be the decimal mark**:
   either a comma plays that role after it (`1.197,00`), or the input holds several dots and no
   operator at all (`1.234.567`). Everywhere else `1.234` stays the decimal it has always been, so
   `1.234+5.678` is still `6.912` and never `6912`. Spaces around an operator (`100 + 20`) are
   untouched.

   *Why this is a fix and not a comfort:* combined with rule 4, an unreadable paste **reverted the
   field to its last committed value** — empty, on a reservation being reconciled for the first
   time. Pasting `1 197,00 €` into « Total séjour facturé par la plateforme » therefore erased
   itself on Enter, with no message and nothing to explain it (production, 2026-09-25).

**Edge cases:**
- `100/0` (division by zero) → invalid → revert.
- `100/3` → `33.33` (rounded to 2 decimals).
- `10-50` in `customPrice` → clamped to `0`.
- Unary signs: `-50+70` → `20`; `+100` → `100`.
- `1 197,00 € - 35,91 €` → `1161.09` (rules 8-9 compose with rule 1).
- `100 %` → still invalid: only currency is dropped, not any unit (rule 8).
- `€` alone → empty after normalization → nothing committed (rule 5).

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
| `utils/` | `utils/arithmetic.js` | C/T | `evaluateArithmetic(input)` — safe tokenizer → RPN → eval; returns `number` or `null` (empty/invalid). Pure, unit-tested. **Touched 2026-09-25**: exports `normalizeMoneyInput(input)` — a pure text pass (currency symbol, Unicode spaces, thousands separators) run before tokenizing (rules 8-9). |
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
- [x] `utils/__tests__/arithmetic.pasted-amounts.test.js` (**7 tests**, rules 8-9): euro sign in the
  three positions + `EUR`; a symbol alone commits nothing; the three kinds of space as a thousands
  separator; the dot only when unambiguous (`1.234+5.678` stays `6.912`); a statement amount inside
  an expression; what is genuinely unreadable stays unreadable; `normalizeMoneyInput` as pure text.
- [x] `components/__tests__/ArithmeticTextField.test.js` (**6 tests**): evaluates on blur + on Enter;
  no commit per keystroke; rounds to 2 decimals + clamps ≥0; invalid reverts; clearing commits ''.
- [x] `components/reservation/__tests__/FinanceSection.test.js`: updated — the adjusted-price field
  commits the evaluated expression on blur (not per keystroke).

### Manual UI verification
- [ ] In a reservation: type `100+20` in « Prix ajusté », press Enter → shows `120`, pricing recomputes.
- [ ] Type `350+12,5` in « Prix payé par le client », click away → `362.5`, commission recomputes.
- [ ] Type `100+` then blur → reverts to the previous value. *(pending — needs the running app)*
- [x] 2026-09-25, on a Lodgify reservation switched to Booking: paste `1 197,00 €` into « Total
  séjour facturé par la plateforme », blur → `1197` stays (before the fix: the field emptied).
  Same in « Virement reçu (contrôle) ». Checked at `xs` (390px) too: the field is unchanged.
- [x] A bare number (`300`) still commits on a past, still-locked fiche — the platform block stays
  editable there, which is how the bug was met.

## 8. Out of scope

- Applying the arithmetic input to other money fields (deposit/balance/caution overrides) — easy
  follow-up now that `ArithmeticTextField` exists, but not requested.
  - 2026-07-20 update: the custom option « Prix TTC » field adopted it (third usage site) — see
    specs/custom-option-amount-comma.md. Deposit/balance/caution overrides remain open.
- Percentages and units inside the expression (`100 %`, `3 nuits`). ~~Currency symbols~~ —
  **resolved 2026-09-25**: a currency symbol and thousands separators ARE tolerated (rules 8-9).
  Excluding them was the bug, not the boundary.
- Showing a live preview of the result while typing (commit-on-blur only).

## 9. Open questions

### Resolved

- **2026-09-25 — what should an unreadable entry do?** It keeps reverting silently (rule 4). Making
  the refusal visible (keep the text, field in error) was offered and **deliberately not taken**:
  the point was that a pasted amount should be *read*, not that the operator should be told off for
  pasting one. Reopen if a paste ever fails in a way rules 8-9 do not cover.

(None open.)
