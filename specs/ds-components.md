# DS Phase 2 — Component library & feedback system

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/ds-components` |
| **Created** | 2026-07-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Umbrella** | [design-system.md](design-system.md) — phase 2 of 6 |

---

## 1. Context

Phase 1 shipped the « Maison » theme (PR #329). Phase 2 builds the **component layer** the sweeps
(phases 3-6) will consume: the three missing mandated generics (`LoadingState`, `EmptyState`,
`ErrorAlert`), a single toast-based feedback system, mobile-compliant dialog primitives, the
scaffold-to-PageActionBar swap, app-level error/404 handling, badge consolidation, and the
DESIGN-SYSTEM reference doc + `/design` catalogue.

Audit facts this phase fixes (verified 2026-07-03, refs in [design-system.md §1](design-system.md)):
4 divergent loading patterns + 9 pages with no indicator; 7+ ad-hoc empty states; 13 inline error
Alerts and **5 pages swallowing fetch errors silently**; **6 post-action feedback patterns and zero
Snackbar**; `FormDialog`/`ConfirmDialog`/`DialogProvider` render `<Dialog>` without
`fullScreen` on mobile (~13 pages non-compliant by inheritance); no ErrorBoundary and no `path="*"`
route (crash / unknown URL = blank screen); `EmailHistoryPage` shadows the shared `StatusBadge` with
a local one; « Payé » has 4+ chip treatments and platform badges 2 renderings.

## 2. Goal

After this phase: any page can render loading/empty/error states and fire success/error toasts with
one import; every shared dialog is fullScreen on mobile; 4 pages (Clients, Historique emails,
Options, Ressources) get the sticky `PageActionBar` in one move; a crash or unknown URL shows a
recoverable screen; statuses and platforms have exactly one chip rendering each; and
`specs/DESIGN-SYSTEM.md` + `/design` document it all. Sweeps 3-6 then only *apply* these pieces.

## 3. Functional rules

### 3.1 New generic components (`client/src/components/`, JSDoc header mandatory)

1. **`LoadingState`** — centered `CircularProgress` (default) or `variant="skeleton"` (n rows);
   props: `label?` (French), `py?`. Replaces the 4 divergent loading patterns.
2. **`EmptyState`** — icon + message + optional CTA (`actionLabel` + `onAction`); used by lists,
   the 404 page, and `DataPageScaffold`'s empty row.
3. **`ErrorAlert`** — standardized `Alert severity="error"` + optional « Réessayer » button
   (`onRetry`); message defaults to « Impossible de charger les données. ». Kills silent-error
   pages during sweeps.
4. **`PlatformChip`** — one rendering for platform badges (filled chip, white text,
   `getPlatformColor()`); replaces the filled-Chip and hand-rolled-Box variants.
5. **`UnsavedChangesDialog`** — merges the two divergent dialogs (`PropertyDetail` vs
   `ReservationPage`): title « Modifications non enregistrées », verb « Enregistrer », stay-button
   first. Both pages migrate to it **in this phase** (they are the only two implementations).
6. **`ResponsiveTable`** — `TableCard` + `renderMobileCard(row)` prop: real `<Table>` on `md+`,
   stacked cards on `xs` (modeled on `UserManagementPage`). Adopted by sweeps; **quick win here**:
   `PlatformAccountsPage`'s raw `<Table>` (no scroll container at all) is wrapped.

### 3.2 Feedback — one toast system (`useToast`)

7. `DialogProvider` gains a **Snackbar-based toast API**: `const { showSuccess, showError } =
   useToast()` (same provider, new hook export). Auto-hide 4 s (success) / 6 s (error), bottom-center,
   one at a time, `Alert` body with the semantic `soft` background tokens from phase 1.
8. **The 6 existing feedback patterns migrate now** (single behavioral system, cross-block):
   inline Alerts named `snackbar` (`LinenStockPage`, `UserManagementPage`), `globalMessage`
   (`SettingsPage`, `PlatformAccountsPage`), `notice` (`PaymentsSettingsPage`), the success `alert()`
   modal (`ReservationPage:2394`), `window.alert` (`PlanningPage:304,329`), and `PropertyDetail`'s
   silent save → all become `showSuccess`/`showError`. Blocking modals stay only where the user must
   confirm (unchanged `confirm()` usages).

### 3.3 Mobile-compliant dialog primitives

9. `FormDialog`, `ConfirmDialog` and `DialogProvider`'s alert dialog get
   `fullScreen={useMediaQuery(theme.breakpoints.down('sm'))}` — ~13 consumer pages become compliant
   by inheritance. (Page-local raw `<Dialog>`s migrate during sweeps.)

### 3.4 Scaffold & app shell

10. **`DataPageScaffold` renders `PageActionBar`** instead of `PageHeader` (create action as a
    labeled `node` button in `actionsBefore`, the pattern DevisPage already uses); its empty row
    uses `EmptyState`. Migrates `ClientsPage`, `EmailHistoryPage`, `OptionsPage`, `ResourcesPage`
    in one change.
11. **`ErrorBoundary`** (new, wraps the routed shell): render crash → `EmptyState`-based screen with
    « Recharger la page » CTA; logs the error to console.
12. **`path="*"` NotFound route**: `EmptyState` « Page introuvable » + « Retour au tableau de
    bord » CTA.

### 3.5 Badge consolidation

13. Delete `EmailHistoryPage`'s local `StatusBadge`; it consumes the shared one.
14. Shared `StatusBadge` restyles to the DS chip pattern: **soft background + dark text** from the
    phase-1 `palette.<sem>.soft` tokens (never filled semantic Chips). « Payé »-style chips across
    pages adopt it during sweeps; this phase makes it the canonical rendering + documents it.

### 3.6 Reference deliverables

15. **`specs/DESIGN-SYSTEM.md`** — tokens tables (from phase 1), typography roles, spacing scale,
    the canonical top-right actions (§3.4 umbrella), table conventions (§3.5 umbrella), component
    catalogue with do/don't per component. CLAUDE.md §7 gets a pointer.
16. **`/design` v2** — fixes the phase-1 review finding: the `pageTitle`/`sectionHeader` type
    specimens currently render as a real second `<h1>`/spurious `<h2>` in the document outline
    (variantMapping); specimens get a local non-heading `variantMapping` override. Then new
    « Composants » sections rendering the real components in their states:
    LoadingState (2 variants), EmptyState, ErrorAlert (+retry), toasts (live trigger buttons),
    StatusBadge/PlatformChip specimens, ConfirmDialog/FormDialog/UnsavedChangesDialog openers,
    ResponsiveTable demo.

### 3.7 Hygiene

17. JSDoc headers added to `ConfirmDialog`, `FormDialog`, `TableCard`, `DataPageScaffold`.
18. `Tooltip` + `aria-label` on the icon-only table buttons flagged by the audit
    (`ClientsPage:502`, `EmailHistoryPage:145`).

**Edge cases:**
- `useToast` outside the provider → same explicit throw as `useAppDialogs`.
- ErrorBoundary must NOT swallow route changes: reset on `location.pathname` change.
- `DataPageScaffold` pages keep their exact create-button labels (French) — only the container
  changes.
- NotFound route must stay AFTER all real routes; accountant role sees it too (no role gate on 404).

---

## 4. Architecture

> **Fat backend, thin frontend — unaffected.** Pure client-side presentation/UX; no endpoint, no
> payload change. Toasts/states render what the server already returns.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | **No server change.** |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| components | `LoadingState.js`, `EmptyState.js`, `ErrorAlert.js`, `PlatformChip.js`, `UnsavedChangesDialog.js`, `ResponsiveTable.js`, `ErrorBoundary.js` | C | §3.1 + §3.4 generics (JSDoc each). |
| components | `DialogProvider.js` | T | `useToast` (Snackbar) + fullScreen alert dialog. |
| components | `FormDialog.js`, `ConfirmDialog.js` | T | fullScreen on xs. |
| components | `DataPageScaffold.js` | T | PageActionBar + EmptyState. |
| components | `StatusBadge.js` | T | Soft-bg DS restyle + JSDoc. |
| components | `TableCard.js` | T | JSDoc (ResponsiveTable composes it). |
| pages | `LinenStockPage`, `UserManagementPage`, `SettingsPage`, `PlatformAccountsPage`, `PaymentsSettingsPage`, `ReservationPage`, `PlanningPage`, `PropertyDetail` | T | Feedback migration → `useToast` (§3.2); `PropertyDetail` + `ReservationPage` → `UnsavedChangesDialog`; `PlatformAccountsPage` table wrap. |
| pages | `EmailHistoryPage.js` | T | Local StatusBadge deleted → shared. |
| pages | `DesignPage.js` | T | v2 « Composants » catalogue. |
| `App.js` | shell | T | ErrorBoundary wrap + `path="*"` NotFound. |
| docs | `specs/DESIGN-SYSTEM.md` | C | Reference doc (§3.6). |

**Component reuse declaration:** creates the 7 generics above (all designed for app-wide reuse — the
whole point of the phase); consumes phase-1 tokens; no page-specific component created.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No schema change, no migration.

## 6. UI / UX

- Toasts: bottom-center Snackbar, Alert with soft semantic background, auto-hide 4 s/6 s, xs-safe
  (full-width margin 16px).
- Dialogs fullScreen under `sm`; unchanged above.
- 404 / crash screens: centered `EmptyState` on the paper background, French copy, one CTA.
- `/design` v2 sections are interactive (open the dialogs, fire the toasts) — the catalogue is the
  visual regression net.
- **Responsive:** every new generic verified at xs/md/lg; ResponsiveTable demo on `/design` shows
  both renderings; mobile check mandatory on the migrated feedback pages.

## 7. Test plan

### Client unit tests (vitest)
- [ ] Each new generic: render + states (LoadingState variants, EmptyState CTA, ErrorAlert retry
  callback, PlatformChip color resolution, UnsavedChangesDialog buttons order/labels).
- [ ] `useToast`: success/error render, auto-hide, throw outside provider.
- [ ] fullScreen dialogs: `matchMedia` mock at xs → `fullScreen` prop true (FormDialog,
  ConfirmDialog, alert).
- [ ] `DataPageScaffold`: renders PageActionBar (sticky bar present), create node button fires,
  EmptyState shown when `hasItems` false.
- [ ] ErrorBoundary: child throw → fallback + reset on route change. NotFound route renders on
  unknown URL.
- [ ] Migrated pages: feedback tests updated (Alert assertions → toast assertions).
- [ ] Full suite green.

### E2E (Playwright)
- [ ] Full suite green; +1 smoke: unknown URL shows « Page introuvable ».

### Manual UI verification
- [ ] `/design` v2: every component demo works (dialogs open fullScreen on xs, toasts fire).
- [ ] One migrated feedback flow per pattern (e.g. save Réglages → success toast; failed save →
  error toast).
- [ ] Unsaved-changes guard on PropertyDetail + ReservationPage unchanged behaviorally.
- [ ] xs/md/lg pass on the 4 scaffold pages.

## 8. Out of scope

- Wiring `LoadingState`/`EmptyState`/`ErrorAlert` into the 28 pages (sweeps 3-6 do it per block —
  except where a component this phase touches already renders one, e.g. DataPageScaffold).
- Table-alignment enforcement & cards-on-xs migrations beyond the PlatformAccounts quick win.
- The pre-existing `/settings` `alignItems` console error (phase-3 sweep).
- Dark mode, WordPress blocks, PDFs/emails (umbrella §8).

## 9. Open questions

- None blocking. Toast position (bottom-center) and durations (4 s/6 s) are proposals — trivially
  adjustable at review.
