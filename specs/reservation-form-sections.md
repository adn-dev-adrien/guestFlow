# ReservationPage — split the form into section components (via a form context)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-form-sections` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar, slice **3c-3** (final). See `specs/ROADMAP.md`. |

---

## 1. Context

After 3c-1 (PageActionBar) and 3c-2 (PricingSummary), `ReservationPage.js` is ~2812 LOC. Its left
column is a single long block of form cards: **Séjour** (dates + mini calendar), **Client**,
**Voyageurs et couchages** (guests/beds + capacity), **Canal** (platform), **Options et ressources**
(options + custom options + resources, ~236 LOC), **Finance** (custom price, deposit, balance, caution,
~234 LOC) and **Notes**. This is the last readability slice of Bloc 3.

These sections are **tightly coupled** to the page's `form` state, `updateForm`, ~20 derived capacity/
pricing values and several handlers. A naive prop-based split would give 15-25-prop components
(prop-drilling) — a lateral move that isn't cleaner and risks the money flow. **Revised approach
(chosen):** introduce a **React context** (`useReservationForm`) that exposes the form bundle, so the
section components consume only what they need with **no prop-drilling**.

## 2. Goal

Decompose the left-column form into focused, behavior-preserving section components that read the form
state/handlers from a shared context, so ReservationPage reads as a composition of sections instead of
one long JSX block. No behavior or visual change.

## 3. Functional rules

1. **Behavior-preserving & visually identical.** Every field, label, validation hint, disabled/locked
   state, capacity warning, "Suggérer les lits", option/resource pickers, "Offrir", custom options
   add/edit/remove, finance fields (incl. the manual-price + "Actualiser les tarifs" flow) and notes
   behave exactly as today.
2. **A form context, no prop-drilling.** A `ReservationFormContext` + `useReservationForm()` hook exposes
   the bundle the form needs: `form`, `updateForm`, the derived capacity/pricing values, the handlers
   (`setOptionEnabled`, `setOptionQuantity`, `setResourceQuantity`, custom-option add/update/remove,
   `setOfferedOptionIds`/`setResourceOffered`, `handleSuggestBeds`, `handleReservationPropertyChange`,
   `handleManualDateInputChange`, `refreshToCurrentPricing`, …), the catalogs (`properties`,
   `propertyOptions`, `availableResources`, `clients`), and flags (`isReservationLocked`, `isDevisMode`,
   etc.). Section components call `useReservationForm()` and destructure only what they use.
3. **State & logic stay on the page.** ReservationPage keeps owning all state, the pricing effect,
   derived computations and handlers; it just **assembles them into one context value object**
   (`formContextValue`) and wraps the form in the Provider. The context is an *exposure layer*, not a
   relocation of logic — the safest way to decompose without moving the money-critical pipeline.
   _Implementation note:_ the bundle is built as a plain object each render rather than memoized — the
   page re-renders fully on every form change anyway (so the sections, its descendants, re-render
   regardless), and an exhaustive `useMemo` dep array over the ~50 derived values would risk
   `react-hooks/exhaustive-deps` failing the `CI=true` build for no behavioral gain.
4. **Feature-local section components** under `client/src/components/reservation/`:
   `StaySection`, `GuestsBedsSection`, `ExtrasSection` (options + custom options + resources),
   `FinanceSection`. Small sections (**Client**, **Canal**, **Notes**) may be extracted too or kept
   inline — whatever is cleanest without behavior change.
5. **No change to the pricing quote, save/devis logic, or PricingSummary** (3c-2) — only the left-column
   form JSX is reorganized to consume the context.
6. ReservationPage shrinks substantially (the form JSX moves into sections), composing
   `<ReservationFormProvider value={…}> <StaySection/> <GuestsBedsSection/> … </ReservationFormProvider>`.

**Edge cases:** locked (past) reservation styling/disabled, devis mode differences, capacity-exceeded
warnings, baby-bed availability, per-hour resources, custom options — all preserved verbatim.

---

## 4. Architecture

### 4.1 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/reservation/` | `ReservationFormContext.js` | C | `createContext` + `ReservationFormProvider` + `useReservationForm()` hook. Pure plumbing. |
| `components/reservation/` | `StaySection.js` | C | Dates + property + mini calendar + min-nights hint. Consumes the context. |
| `components/reservation/` | `GuestsBedsSection.js` | C | Guests + beds + capacity warnings + "Suggérer les lits". Consumes the context. |
| `components/reservation/` | `ExtrasSection.js` | C | Options (incl. auto) + custom options + resources pickers. Consumes the context. |
| `components/reservation/` | `FinanceSection.js` | C | Manual price + "Actualiser les tarifs" + deposit/balance/caution + paid toggles. Consumes the context. |
| `pages/` | `ReservationPage.js` | T | Assemble the memoized context value; wrap the form in `<ReservationFormProvider>`; render the sections; remove the moved JSX + now-unused imports. Small sections (Client/Canal/Notes) inline or tiny components. |
| `(test infra)` | `src/setupTests.js` + dev deps | C | Add `@testing-library/react` + `jest-dom` + `user-event` so the section component tests (§7) can run via `react-scripts test`. |
| `components/reservation/__tests__/` | `*.test.js` | C | One test per section + a context-guard test (see §7). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Created (specific / feature-local)** | `ReservationFormContext`, `StaySection`, `GuestsBedsSection`, `ExtrasSection`, `FinanceSection` | Page-specific (coupled to the reservation form). The context avoids prop-drilling; sections are a readability decomposition, not reuse. Under `components/reservation/`. |

No server, API, or data changes.

### 4.2 API contract

Unchanged.

---

## 5. Data model

No changes.

## 6. UI / UX

No visible change — the reservation/devis form looks and behaves identically; only the source is
decomposed into section components. Responsive behavior unchanged.

## 7. Test plan

### Client component tests (new) — the "no feature lost" guard
Set up React Testing Library (add dev deps `@testing-library/react`, `@testing-library/jest-dom`,
`@testing-library/user-event` + `src/setupTests.js`), then add a test per section that renders it inside
a `ReservationFormProvider` with a mock context value and asserts:
- [x] `StaySection.test.js` — renders property select, both date fields, check-in/out selects, the
      mini-calendar host, and min-nights/conflict hints; changing a date calls `handleManualDateInputChange`;
      changing check-in/out calls `updateForm`.
- [x] `GuestsBedsSection.test.js` — renders adults/children/teens/babies + single/double/baby beds +
      "Suggérer les lits"; editing a guest count calls `updateForm`; capacity-exceeded warning shows when
      the mock flags say so; "Suggérer les lits" calls `handleSuggestBeds`.
- [x] `ExtrasSection.test.js` — renders an option row with its switch (calls `setOptionEnabled`), a
      quantity field (calls `setOptionQuantity`), custom-options add (`addCustomOption`), and a resource
      row; offered/auto states render.
- [x] `FinanceSection.test.js` — renders the manual-price field (calls `updateForm`/`customPrice`),
      "Actualiser les tarifs" (calls `refreshToCurrentPricing`), deposit/balance/caution fields + paid
      toggles (call the right callbacks).
- [x] `useReservationForm` throws a clear error when used outside its provider.
These tests pin down each feature so a regression during (or after) the decomposition fails fast.
Result: **19 tests across 5 suites, all passing** (`react-scripts test`). A shared
`mockReservationForm.js` builds a full mock context so each section renders in isolation.

### Server unit tests
- [x] N/A for this slice. Existing server suite stays green.

### Manual UI verification (per section)
- [x] Stay: change dates → quote refreshes (705.60€ accommodation, 35.28€ tax, 740.88€ total, acompte/
      solde with due dates); all sections render via the context (verified in browser).
- [x] All sections render correctly composed (Séjour / Client / Voyageurs / Canal / Options & ressources /
      Finance / Notes) with the right-hand PricingSummary — confirmed by accessibility snapshot.
- [ ] Guests/beds: capacity warnings + "Suggérer les lits" behave as before. _(rendering confirmed;
      not exercised end-to-end)_
- [ ] Extras: add/remove options & resources, custom options, "Offrir" toggles → summary updates.
      _(rendering confirmed; not exercised end-to-end)_
- [ ] Finance: manual price (struck/green), "Actualiser les tarifs" clears it, deposit/balance/caution +
      paid toggles work. _(rendering confirmed; not exercised end-to-end)_
- [ ] Devis mode + locked (past) reservation: disabled/locked states identical. _(not exercised)_
- [x] `0` app console errors (only pre-login auth 401s + dev HMR websocket); clean `CI=true` build.
- [ ] Mobile (`xs`): form stacks and renders correctly.

## 8. Out of scope

- `reservationConflicts` server consolidation (slice 3c-4) — optional follow-up.
- Any behavior/logic change; any change to PricingSummary or the save/quote pipeline.

## 9. Open questions

- Q: Extract Client/Canal/Notes too, or keep inline? — A (proposed): keep the small ones inline (or as
  trivial components) to avoid prop churn for little gain; extract the four substantial sections.
  Confirm during review.
