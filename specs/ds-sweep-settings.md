# DS Phase 3 — Sweep Réglages & admin

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ds-sweep-settings` |
| **Created** | 2026-07-15 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Umbrella** | [design-system.md](design-system.md) — phase 3 of 6 (first sweep) |
| **Reference** | [design-system-reference.md](design-system-reference.md) — the rules this sweep applies |

---

## 1. Context

First application of the per-page done-criteria (umbrella §3.9) to a block. Scope = the Réglages &
admin surface: `SettingsPage` (+ its 11 `Settings*Section` cards), `PaymentsSettingsPage`,
`EmailTemplatesPage`, `UserManagementPage`, `LinenStockPage`, `PlatformAccountsPage`,
`BillableAmountsPage`, the two tab wrappers (`OptionsResourcesPage`, `SeasonsClosuresPage`) and
their tab contents (`OptionsPage`/`ResourcesPage` via `PricedItemsPage`, `SchoolHolidaysPage`,
`EstablishmentClosuresPage`).

Block audit (2026-07-15, file:line evidence) — the gaps this sweep closes:
- **Saves outside the bar:** `BillableAmountsPage` has NO `onSave` on its bar — the saves are two
  bottom « Enregistrer » rows inside the content (`SettingsBillableAmountsSection.js:116,:138`).
  `EmailTemplatesPage` has a **hand-rolled h4 header** (`:317-328`) with page actions in it + a
  card-corner « Nouveau modèle » (`:352`). `UserManagementPage` has a card-corner « Ajouter un
  compte » (`:332`). `PlatformAccountsPage` has « Rafraîchir la liste » in a card header (`:251`).
- **Double header on the tab wrappers:** both wrappers render only `<Tabs>`, and each child page
  renders its own sticky `PageActionBar` below → two stacked headers.
- **States:** `EmailTemplatesPage.reload()` has **no catch** (silent load failure) and uses
  « Chargement… »/« Aucun modèle » text cells; `PricedItemsPage` never destructures
  `useCrudResource`'s `loading`/`error` (silent); `UserManagementPage` uses raw Alerts for
  empty/error; `BillableAmountsPage` swallows load errors (`.catch(()=>[])`) and still uses an
  inline `msg` Alert for feedback (was outside the phase-2 list).
- **Typography:** `variant="sectionHeader"` adoption in the block = **0** — all 11 section cards
  use `h6`+`sx` (+ `subtitle1/2` in Payments/BillableAmounts/UserManagement).
- **Tables:** `PricedItemsPage` price/quantity columns left-aligned, raw `` `${price} €` `` strings,
  `'-'` hyphens for empty cells, no mobile cards (minWidth 980 scroll-only);
  `EmailTemplatesPage`/`UserManagementPage`/`PlatformAccountsPage` use raw tables instead of
  `TableCard` (UserManagement already has mobile cards).
- **Formatters escapees:** `UserManagementPage.formatLastLogin` (local `Intl.DateTimeFormat`);
  raw `€` strings in `PricedItemsPage.js:223` and `OptionsPage.js:468,:472,:476`.
- **Hex/rgba (3 sites):** `LogoUpload.js:96,:99` (`#eee`, `#fafafa`), `ResourcesPage.js:374`
  (`rgba(2,136,209,0.05)`).
- **Off-scale spacing:** `spacing={2.5}` ×11 (every Settings section card), `gap: 2.5`
  (PaymentsSettings:187), `spacing={1.2}` (UserManagement:541), `mt: 0.75` (LogoUpload:157).
- **Dirty guards missing** on save-flow pages: `PaymentsSettingsPage` (manual `dirty`),
  `PlatformAccountsPage` (manual `isDirty`), `BillableAmountsPage` (none).
- **The pre-existing `/settings` console error root-caused:** `LogoUpload.js:85` passes
  `alignItems={{…}}` as a `Stack` **prop**; MUI 9's Stack forwards unknown props to the DOM (and
  drops the style) → React `alignItems`-on-DOM error. Only such leak in the tree.

## 2. Goal

Every page of the Réglages & admin block satisfies the umbrella done-criteria: one sticky canonical
bar holding ALL page actions, real loading/empty/error states (no silent failures), serif section
headings, §3.5-compliant tables (right-aligned tabular amounts, `formatCurrency`, « — », mobile
cards where operator-critical), tokens-only colors, blessed spacing, dirty-form guards on save
flows — and the `/settings` console error and double-header tab pages are gone.

## 3. Functional rules

### 3.1 Actions into the bar (§3.4)

1. **BillableAmountsPage** — the bar gains `onSave`/`onCancel` (+ `saveBusy`, dirty-driven
   disabled); the two content « Enregistrer » rows disappear. The two « Ajouter » buttons stay
   (list-item add = content-local, like a form field). Feedback → toasts; load failure → `ErrorAlert`.
2. **EmailTemplatesPage** — hand-rolled header replaced by `PageActionBar` (title « Emails »):
   labeled node CTA « Créer un email », « Voir l'historique » as a bar action (History icon,
   tooltip), « Nouveau modèle » moves from the card corner into the bar as a second labeled node
   CTA. Title switches to the bar's `pageTitle`.
3. **UserManagementPage** — « Ajouter un compte » moves into the bar (labeled node CTA).
4. **PlatformAccountsPage** — « Rafraîchir la liste » becomes a bar `actionsBefore` icon action
   (`SyncIcon`, tooltip « Rafraîchir la liste », color info — canonical Sync role).
5. **PaymentsSettingsPage** — documented §3.4 exemption: « Connecter Qonto » / « Enregistrer le
   webhook » / « Connecter le provider » are OAuth/flow buttons INSIDE their status cards
   (form-local steps, not page-level actions) — they stay in place.

### 3.2 One bar on the tab wrappers (kills the double header)

6. `PageActionBar` gains an optional **`center` usage for Tabs**; `DataPageScaffold` and the two
   standalone pages (`SchoolHolidaysPage`, `EstablishmentClosuresPage`) accept a **`barCenter`**
   node forwarded to their bar. The wrappers (`OptionsResourcesPage`, `SeasonsClosuresPage`) stop
   rendering a separate `<Tabs>` strip and instead pass their Tabs as `barCenter` to the active
   child → **one** sticky bar: `[Title] … [Tabs] … [CTA]`. On `xs` (where `center` is hidden), the
   wrapper renders the Tabs as a slim strip under the bar — documented mobile behavior.
   Standalone routes (`/options`, `/school-holidays`, …) are unchanged (no `barCenter`).

### 3.3 States (§ reference « load vs action »)

7. **EmailTemplatesPage** — `reload()` gets a catch → `ErrorAlert` (retry); loading → `LoadingState`
   (skeleton rows); empty → `EmptyState`; `reloadPending` failure → toast error.
8. **PricedItemsPage** — destructure `loading`/`error` from `useCrudResource`: `LoadingState`
   skeleton while loading, `ErrorAlert` (retry) on failure. (Empty already `EmptyState` via scaffold.)
9. **UserManagementPage** — raw error Alert → `ErrorAlert` (retry = `refresh`); raw info-empty Alert
   → `EmptyState`.
10. **BillableAmountsPage** — drop the silent `.catch(()=>[])`: load failure → `ErrorAlert`; the
    inline `msg` Alert → `useToast`.
11. **PaymentsSettingsPage** — split the mixed `error` state: load failures → persistent
    `ErrorAlert`; action failures → `showError` toasts.

### 3.4 Typography (§2 reference)

12. All 11 `Settings*Section` headings + the section headings of Payments / UserManagement /
    LinenStock / PlatformAccounts / BillableAmounts / EmailTemplates → `variant="sectionHeader"`
    (serif). Page titles only via the bar.

### 3.5 Tables (§5 reference)

13. **PricedItemsPage** — « Prix » right-aligned + `tabular-nums` + `formatCurrency` (header aligned
    with body); « Quantité » right-aligned; empty cells « — » (not `'-'`); becomes a
    `ResponsiveTable` (mobile cards: name + price + actions). Same treatment for the
    OptionsPage-specific price cells (`renderPriceCell`).
14. **EmailTemplatesPage** — table becomes `ResponsiveTable` (mobile cards: name + offset + toggle +
    actions).
15. **UserManagementPage** — raw table container → `TableCard` (its existing mobile cards stay).
16. **PlatformAccountsPage** — raw container → `TableCard`. **Documented exemption:** no xs cards —
    it's an editable config grid (office task); scroll-contained is acceptable.

### 3.6 Tokens, spacing, hygiene

17. `LogoUpload.js:85` — `alignItems` prop → `sx` (**fixes the pre-existing `/settings` React
    console error**); `#eee`/`#fafafa` → `divider` / `grey.50`; `mt: 0.75` → `1`.
18. `ResourcesPage.js:374` — `rgba(2,136,209,0.05)` → `alpha(theme.palette.info.main, 0.05)`.
19. Spacing onto the blessed scale: the 11 section cards `spacing={2.5}` → `2` (house rhythm
    decision), `gap: 2.5` → `2`, `spacing={1.2}` → `1`.
20. `UserManagementPage.formatLastLogin` → `displayDateTime`; raw `€` strings → `formatCurrency`.

### 3.7 Dirty-form guards

21. `useDirtyFormGuard` added to `PaymentsSettingsPage`, `PlatformAccountsPage` and
    `BillableAmountsPage` (bar-level save + guard dialog like Settings/LinenStock).

**Edge cases:**
- Standalone child routes keep their own bar (no `barCenter`) — only the wrapper mode collapses.
- `PlatformAccountsPage` xs = scroll (rule 16 exemption). `PaymentsSettings` OAuth buttons stay
  in-card (rule 5 exemption).
- No behavior change anywhere beyond the states/guards described — presentation sweep.

---

## 4. Architecture

> **Fat backend, thin frontend — unaffected.** No endpoint, payload or business-logic change.

### 4.1 Server side — no change.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| components | `PageActionBar.js` | T | (only if needed) ensure `center` suits a Tabs node. |
| components | `DataPageScaffold.js` | T | `barCenter` passthrough. |
| components | `Settings*Section.js` ×11 | T | `sectionHeader` + spacing 2. |
| components | `SettingsBillableAmountsSection.js` | T | Remove content save rows; expose save/dirty to the page. |
| components | `LogoUpload.js` | T | alignItems→sx (console error), hex→tokens, spacing. |
| components | `PricedItemsPage.js` | T | States + §3.5 table + ResponsiveTable + formatCurrency. |
| pages | `BillableAmountsPage`, `EmailTemplatesPage`, `UserManagementPage`, `PlatformAccountsPage`, `PaymentsSettingsPage` | T | Rules above (bar, states, guards, typography). |
| pages | `OptionsResourcesPage`, `SeasonsClosuresPage` | T | Tabs → `barCenter` of the active child. |
| pages | `OptionsPage`, `ResourcesPage`, `SchoolHolidaysPage`, `EstablishmentClosuresPage` | T | `barCenter` prop; price cells; rgba fix. |

**Component reuse declaration:** consumes phase-1/2 generics only (`LoadingState`, `EmptyState`,
`ErrorAlert`, `ResponsiveTable`, `TableCard`, `useToast`, `useDirtyFormGuard`). No new generic
expected; if one emerges it lands in the library + `/design` + reference doc in the same PR.

### 4.3 API contract — unchanged.

## 5. Data model — none.

## 6. UI / UX

- Tab wrappers: single sticky bar `[Titre] [Onglets centrés] [CTA]` on `sm+`; on `xs` the Tabs sit
  in a slim strip directly under the bar (center is hidden on xs by design).
- BillableAmounts/Payments/PlatformAccounts gain the standard save UX (bar Save + guard dialog).
- Mobile: PricedItemsPage & EmailTemplates lists become cards on `xs`; all pages re-verified at
  xs/md/lg.

## 7. Test plan

### Client unit tests (vitest) — full suite 639/639 green
- [x] Page suites updated: EmailTemplates (useToast mock made STABLE — a fresh-object mock re-fired
  effect chains), UserManagement (wrapped with the app theme so `sectionHeader` maps to a heading).
- [x] New `BillableAmountsPage.test.js` (4): bar-level save persists BOTH lists (content save
  buttons gone), keyed extinguisher row protected, retryable ErrorAlert on load failure, toast.
- [x] `PricedItemsPage` behaviors covered through the Options/Resources suites (formatCurrency
  cells, scaffold states).
- [x] The old self-loading `SettingsBillableAmountsSection.test.js` replaced by the page test (the
  section is presentational now).

### E2E (Playwright) — 30 passed / 1 skipped
- [x] `emails-page.spec` updated: « Voir l'historique » is now a bar icon-button (was a link).
- [x] +1 mobile smoke `settings/options-mobile-cards.spec.js`: `/options` at 390px renders cards,
  zero horizontal page scroll (anchored on the CTA — the bar title is hidden on xs by design).

### Manual UI verification (2026-07-15, Playwright-driven browser)
- [x] `/settings`: **console clean — the `alignItems` React error is gone** (LogoUpload fix).
- [x] `/parametres/options-ressources` desktop: ONE bar `[Options de séjour | Onglets centrés |
  Nouvelle option]`; xs: slim tabs strip + cards with right-aligned `formatCurrency` prices.
- [x] `/parametres/tarifs`: Save/Cancel in the bar, zero content save buttons (DOM-verified).
- [x] Prix column right-aligned with « — » empties (desktop screenshot).

## 8. Out of scope

- Other blocks (Finance, Planning, Réservations — phases 4-6).
- `PlatformAccountsPage` xs cards (exemption, rule 16) and `PaymentsSettings` OAuth buttons
  placement (exemption, rule 5).
- Any server change.

## 9. Open questions & implementation deviations

- House section rhythm `spacing={2.5}` → `2` applied (×11 cards).
- **Rule 15/16 nuance:** `PlatformAccountsPage`'s table stays in a `TableContainer` INSIDE its
  existing Card (the card carries a heading + captions above the table) — wrapping in `TableCard`
  would double-card. Scroll containment is what the rule protects; satisfied.
- `SettingsBillableAmountsSection` became **presentational** (state lifted to the page) — the
  cleanest way to give the page a single bar-level save + dirty guard.
- `UserManagementPage.formatLastLogin` kept as a thin local wrapper normalising SQLite's UTC
  timestamps (`Z` suffix) before delegating to `displayDateTime`.
