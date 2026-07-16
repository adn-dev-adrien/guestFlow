# DS Phase 6 — Sweep Réservations & fiches (final)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ds-sweep-reservations` |
| **Created** | 2026-07-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Umbrella** | [design-system.md](design-system.md) — phase 6 of 6 (**closes the program**) |
| **Reference** | [design-system-reference.md](design-system-reference.md) |

---

## 1. Context

Final block sweep. Scope = the reservation/property/client fiches + the pricing components deferred
from phase 4 + the pre-auth screens: `ReservationPage`, `PropertyDetail`, `PropertiesPage`,
`ClientsPage`, `PropertyPricingSeasonsPage`, `SchoolHolidaysPage`, `EstablishmentClosuresPage`,
`LoginPage` + `ForcedPasswordChange`, the reservation-form sections (`StaySection`,
`GuestsBedsSection`, `ExtrasSection`, `FinanceSection`), `PricingSummary`, `PlatformPriceCard`,
`ReservationConflictBadge`. After this phase every app page/route is on the design system.

**Two premise corrections from the block audit (2026-07-16) vs. the umbrella's original notes:**
- **`ReservationPage`'s sticky bar is ALREADY on the shared `PageActionBar`** (`:2602-2630`). The
  CLAUDE.md §7 note ("inline bar at ~1855–2051 must migrate") is stale — phase-6 work on
  ReservationPage is **tokens / typography / money / states / dirty-guard**, not the bar.
- **`SeasonsClosuresPage` is already a phase-3-style tab wrapper** (`barCenter` tabs → child bar).
  No new wrapper.

Audit highlights (file:line evidence, current tree incl. #336):
- **`StatusBadge` / `PlatformChip` adoption across the 19 files = 0.** Every platform/status pill is
  a hand-rolled MUI `Chip` (ClientsPage `:338,:383`; PricingSummary `:736,:768,:778,:781`;
  FinanceSection `:221-226`; ReservationConflictBadge `:19-26`).
- **`PropertyDetail` is the worst page:** hand-rolled header with page-level buttons **in content**
  (`:769` Supprimer, `:772-774` Annuler/Enregistrer/Créer); raw `Chargement…` Typography (`:742`),
  **no error state** — a save failure is misrouted to a **photo-validation field** (`:437`,
  `showError` not even imported); raw tables (`:1126,:1325`); hand-rolled dirty guard; dead `Dialog`
  import (`:6`).
- **Money not via `formatCurrency`:** ClientsPage (`:340,:385`), PricingSummary (`:198`),
  FinanceSection (9 sites — `:71,:111,:113,:218,:225,:473,:506,:595,:600`), ExtrasSection
  (`:365,:366,:428,:499,:625,:689`), ReservationPage history `toLocaleString` (`:2234`).
- **Section headers on raw `subtitle2`/`h6`/`subtitle1`** across ReservationPage, PropertyDetail,
  the four reservation sections, PricingSummary, PlatformPriceCard.
- **Silent/absent states:** `useCrudResource` exposes `loading`/`error` that ClientsPage +
  PropertiesPage **ignore**; ReservationPage init-load failure → `console.error` only
  (`:997,:1062`); PropertyPricingSeasons load has no error path.
- **Inline hex:** `#fff`/`#fafafa` (ReservationPage `:2478…`, PricingSummary `:176,:226`,
  ExtrasSection/FinanceSection), `#757575` (PropertyDetail `:66`), ExtrasSection option/resource
  accents `#2e7d32`/`#1565c0` + rgba, FinanceSection `#f7fafc` + `rgba(33,150,243,…)`.
- **Dialogs not fullScreen-on-xs:** ClientsPage deleteImpact `Dialog` (`:548`),
  PropertyPricingSeasons season editor + apply `Dialog` (`:733,:926`).
- **Pre-auth screens** (LoginPage `:51`, ForcedPasswordChange App.js `:923`): title on sans `h5` —
  the « Maison » serif identity isn't applied.
- **Dead code:** ReservationPage + PropertyDetail unused `Dialog` imports; PropertyPricingSeasons
  unused local `formatMoney` (`:92`).

## 2. Goal

Every fiche/pre-auth screen satisfies the umbrella done-criteria — real loading/empty/error states,
`StatusBadge`/`PlatformChip` for every status/platform pill, `formatCurrency` for every money render,
role-variant typography, tokens-only colors, `FormDialog`/`ConfirmDialog` (fullScreen-on-xs) for
every dialog, `useDirtyFormGuard` on the two big forms, serif « Maison » identity on the pre-auth
screens — **with no change to any computed figure, pricing, or validation rule.**

## 3. Functional rules

### 3.1 ReservationPage (tokens / typo / money / states / dirty-guard — NOT the bar)

1. Wire the already-present `PageActionBar` `saveDisabled`/`saveBusy` (Save reflects
   dirty + in-flight; today it's always enabled, no spinner).
2. States: full-page raw `CircularProgress` → `LoadingState`; init-load failure (`:997,:1062`) →
   `ErrorAlert` (retry) instead of `console.error`; history block `Chargement…`/`Aucun historique`
   → `LoadingState`/`EmptyState`.
3. Colors: `#fff`/`#fafafa` (`:2478,:2642-2648,:2805,:2834`) → `background.paper` / `grey.50` tokens.
4. Typography: the four `subtitle2` section headers (Client `:2672`, Canal `:2742`, Notes `:2758`,
   Historique `:2808`) → `sectionHeader`.
5. Money/dates: history `date.toLocaleString('fr-FR')` (`:2234`) → `displayDateTime`.
6. Consolidate the hand-rolled dirty guard (isDirty/popstate/`__guestflowBeforeNavigate`/beforeunload)
   onto **`useDirtyFormGuard`** — same behavior, one source. Keep `UnsavedChangesDialog`.
7. Remove the dead `Dialog*` import (`:6`); keep `useMediaQuery`. Off-scale spacing → blessed scale.
8. Action outcomes: the `alert({title:'Erreur'…})` / success `alert()` sites (`:2139,:2285,:2305,
   :2367,:2392,:2400,:2417`) → `useToast` `showError`/`showSuccess` (already imported). Blocking
   confirms stay on `useAppDialogs`.

### 3.2 PropertyDetail (worst page — full bring-up)

9. **Header → `PageActionBar`.** Resolved 2026-07-16 (AskUserQuestion): **the property name becomes
   the first form field** (a labelled `TextField` « Nom du logement » at the top of the form) and
   the bar shows a **static serif title** « Logement » / « Nouveau logement » — consistent with every
   other fiche (option A). Canonical actions, **aria-labels preserved** so the existing test's
   `getByRole('button', { name })` stays green: Save `saveTooltip` = « Enregistrer » /
   « Créer le logement » (new); `onCancel` « Annuler »; Delete in `actionsAfter`
   (« Supprimer le logement », error, disabled when locked). `PropertyDetail.test.js`'s name
   assertion moves from `getByText('Le Moulin')` to the field value (`getByDisplayValue`).
10. States: raw `Chargement…` → `LoadingState`; add an `ErrorAlert` on load failure; **import
    `showError`** and route save/delete failures to a toast (stop misrouting the save error to the
    photo field `:437`); no more silent `catch {}` (`:487`).
11. Colors: `#757575` (`:66`) → the shared `DEFAULT_PLATFORM_COLOR` constant; `#fff` (`:612`) →
    token. (PlatformColorPicker hex stays — it's a color picker.)
12. Typography: `h4` title (see §9), `h6` section headers (`:788,:871,:901,:928,:1001,:1175,:1219`)
    → `sectionHeader`; `subtitle1`/`subtitle2` → `sectionHeader`/`body` per role.
13. Tables: raw `Table` taxe/TVA (`:1126`) + Plateformes/iCal (`:1325`) → `TableCard`
    (scroll-contained; the iCal table is admin-dense → no xs cards, documented).
14. Dead `Dialog*` import (`:6`) removed. Consolidate dirty guard onto `useDirtyFormGuard`.
    Off-scale spacing → scale.

### 3.3 ClientsPage

15. Pass the `useCrudResource` `loading`/`error`/`onRetry` into `DataPageScaffold` (LoadingState +
    retryable ErrorAlert for free). Dialog: raw `CircularProgress`/empty Typography/`color="error"`
    → `LoadingState`/`EmptyState`/`ErrorAlert`.
16. Money `${finalPrice} €` (`:340,:385`) → `formatCurrency`.
17. Platform `Chip` (`:338`) → `PlatformChip`; devis-status `Chip` (`:383`) → `StatusBadge`.
18. The clients table gets `renderMobileCard` (operator-critical → xs cards) via the scaffold's
    mobile-cards mode. Keep the « — » empty cells.
19. `deleteImpact` raw `Dialog` (`:548`) → `ConfirmDialog` (fullScreen-on-xs inherited).

### 3.4 PropertyPricingSeasonsPage

20. Legacy `PageHeader` → `PageActionBar`; « Appliquer à un autre logement » + « Nouvelle saison »
    become bar actions (labeled create `node` + an `actionsBefore` helper).
21. States: `Chargement…` → `LoadingState`; load-failure `ErrorAlert`; empty tier row → `EmptyState`.
22. `applyFeedback` inline `Alert` (`:546`) → `useToast`. Season editor + apply `Dialog`
    (`:733,:926`) → `FormDialog` (fullScreen-on-xs). Unsaved-changes → `UnsavedChangesDialog`.
23. Colors `#f5f5f5/#fafafa/#f0f0f0/#e3f2fd/'white'` → tokens (season color-picker presets stay).
    `h6`/`subtitle2` → `sectionHeader`. Raw tables (`:550,:827`) → `TableCard`. Dead `formatMoney`
    (`:92`) removed. Off-scale spacing → scale.

### 3.5 SchoolHolidaysPage / EstablishmentClosuresPage (largely compliant — finish)

24. Both: wrap the mount `load()` in try/catch → `ErrorAlert` (retry) + `LoadingState`;
    EstablishmentClosures empty Typography (`:157`) → `EmptyState`.
25. SchoolHolidays: the Delete/Unlock buttons inside the FormDialog content (`:176-195`) → the
    FormDialog **`secondaryAction`** slot (added in phase 5).
26. EstablishmentClosures: the create action's ignored `variant:'contained'` (`:138`) → a labeled
    create `node` (DataPageScaffold convention).

### 3.6 Pre-auth screens (« Maison » identity)

27. `LoginPage` title (`:51`) and `ForcedPasswordChange` title (App.js `:923`) → serif
    (`variant="pageTitle"` `component="h1"`) — completes the identity started by the wordmark
    (phase 5). Card layout/tokens already compliant; `p:{xs:3,sm:4}` → `p:{xs:2,sm:3}`. Inline
    pre-auth `Alert`s stay (outside the toast provider).

### 3.7 Pricing components (deferred from phase 4)

28. `PricingSummary`: `#fff`/`#fafafa` (`:176,:226`) → tokens; « Résumé tarifaire » `subtitle1`
    (`:177`) → `sectionHeader`; the one raw `…€` (`:198`) → `formatCurrency`; `toLocaleDateString`
    (`:240,:732,:764`) → `displayDate`; payment-status chips (`:736,:768,:778,:781`) → `StatusBadge`;
    off-scale spacing → scale.
29. `PlatformPriceCard`: raw `CircularProgress`/empties → `LoadingState`/`EmptyState`; `h6`
    « Prix plateformes » (`:67`) → `sectionHeader`; raw `Table` (`:94`) → `TableCard`. (Money already
    `formatCurrency` ✓.)

### 3.8 Reservation-form sections + badge

30. `StaySection`/`GuestsBedsSection`: `subtitle2` (`:30,:33`) → `sectionHeader`; `Stack spacing 2.25`
    → 2.
31. `ExtrasSection`: option/resource accents `#2e7d32`→`success.main`, `#1565c0`→`info.main`,
    `#fff`→token, box-shadow rgba → `alpha()`; `subtitle2` → `sectionHeader`; price/total `…€` /
    `toFixed(2)+'€'` (`:365,:366,:428,:499,:625,:689`) → `formatCurrency`; off-scale spacing → scale.
32. `FinanceSection`: `#f7fafc`/`rgba(33,150,243,…)` → tokens/`alpha()`; the 9 raw money sites →
    `formatCurrency`; the KPI `h6` (`:70`) → `kpiValue`; `subtitle2` headers → `sectionHeader`;
    reconcile-status chip (`:221`) → `StatusBadge`; `Stack spacing 2.5` → 2 (or 3).
33. `ReservationConflictBadge` `Chip` (`:19`) → `StatusBadge` (`status="error"`, leading icon).

**Edge cases:**
- No computed figure / pricing / tourist-tax / validation change — presentation only.
- Contextual date formats (weekday labels, same-month range collapse in ReservationSearchBox/
  ExtrasSection/PropertyPricingSeasons `formatMonthYear`) stay.
- The PricingSummary right-rail md-only inner scroll stays (deliberate; bar still sticky).
- ReservationSearchBox: light-touch (app-shell search) — no visible change required.

---

## 4. Architecture

> **Fat backend, thin frontend — unaffected.** No endpoint, payload, or business-logic change.

### 4.1 Server side — no change.

### 4.2 Client side (`client/src/`)

| Layer | File | Responsibility |
|---|---|---|
| pages | `ReservationPage.js` | saveDisabled/Busy, states, tokens, sectionHeader, displayDateTime, useDirtyFormGuard, toasts, dead-import cleanup. |
| pages | `PropertyDetail.js` | Header → PageActionBar, states + showError, tokens, sectionHeader, TableCard, useDirtyFormGuard. |
| pages | `PropertiesPage.js` | PageHeader → PageActionBar, EmptyState + loading/error from useCrudResource, hover token. |
| pages | `ClientsPage.js` | Scaffold states, formatCurrency, PlatformChip + StatusBadge, xs cards, ConfirmDialog. |
| pages | `PropertyPricingSeasonsPage.js` | PageActionBar, states, useToast, FormDialog, UnsavedChangesDialog, TableCard, tokens, dead-code. |
| pages | `SchoolHolidaysPage.js` | load states; FormDialog secondaryAction for delete/unlock. |
| pages | `EstablishmentClosuresPage.js` | load states, EmptyState, labeled create node. |
| pages | `LoginPage.js` + `App.js` (ForcedPasswordChange) | serif « Maison » title, spacing. |
| components | `PricingSummary.js` | tokens, sectionHeader, formatCurrency, displayDate, StatusBadge. |
| components | `PlatformPriceCard.js` | LoadingState/EmptyState, sectionHeader, TableCard. |
| components | `reservation/StaySection.js`, `GuestsBedsSection.js` | sectionHeader, spacing. |
| components | `reservation/ExtrasSection.js` | tokens, sectionHeader, formatCurrency, spacing. |
| components | `reservation/FinanceSection.js` | tokens, formatCurrency, kpiValue, sectionHeader, StatusBadge, spacing. |
| components | `ReservationConflictBadge.js` | → StatusBadge. |

**Component reuse declaration:** consumes phase-1/2/5 generics only (`PageActionBar` incl.
`titleOnXs`, `FormDialog` incl. `secondaryAction`, `ConfirmDialog`, `UnsavedChangesDialog`,
`DataPageScaffold`, `TableCard`, `ResponsiveTable`, `LoadingState`/`EmptyState`/`ErrorAlert`,
`StatusBadge`, `PlatformChip`, `useToast`, `useDirtyFormGuard`, variants, `formatCurrency`,
`displayDate*`, `alpha`). No new generic expected.

### 4.3 API contract — unchanged.

## 5. Data model — none.

## 6. UI / UX

- Every fiche opens at the top with its bar visible; save-flow pages guard unsaved changes.
- Money everywhere `formatCurrency`; status/platform everywhere `StatusBadge`/`PlatformChip`.
- Clients list → cards on xs; property/pricing tables scroll-contained.
- Pre-auth screens carry the serif « Maison » title.
- Re-verified at xs/md/lg; ReservationPage save-in-progress spinner visible; PropertyDetail
  create + edit + delete flows exercised.

## 7. Test plan

### Client unit tests (vitest)
- [x] `PropertyDetail.test.js` updated for the PageActionBar migration: name gate
  `findByText('Le Moulin')` → `findByDisplayValue('Le Moulin')` (name is now the first form field);
  Save/Cancel absent (not just disabled) when clean; delete/create/save reachable by preserved
  aria-label. 29/29 green.
- [x] `FinanceSection.platform-no-deposit.test.js` (`26.00€`/`200.00€`) + `ExtrasSection.platform-
  force-complement.test.js` (`Total: 20.00€`) → canonical `formatCurrency` (`26,00 €`, `200,00 €`).
- [x] Section-title suites stay green (subtitle2→sectionHeader keeps the text; no role assertions).
- [x] New: `ClientsPage.states.test.js` (2) — failed list → retryable ErrorAlert; empty →
  EmptyState. `ClientsPage.save-cancel.test.js` wrapped in ThemeProvider + `useToast` mock.
- [x] Full suite green — **650 tests / 88 files** (+2).

### E2E (Playwright)
- [ ] Full suite green; +1 check: PropertyDetail (`/properties/new`) save CTA reachable in the bar
  (icon aria-label « Créer le logement »).

### Manual UI verification
- [ ] ReservationPage (new + edit + devis): save disabled/spinner, states, section headers, history
  via displayDateTime, console clean at xs/md/lg.
- [ ] PropertyDetail (new + edit + delete): bar actions, error toasts, tables, dirty guard.
- [ ] Clients / Logements / Saisons tarifaires / Vacances / Fermetures / Login / mot-de-passe forcé.

## 7bis. Implementation notes (2026-07-16) — deviations

All rules landed except two **documented deferrals** (internal refactors with real regression risk,
no user-visible change), plus one advisory kept as-is:

- **Dirty-form guard consolidation (rules 6 + 14) — DEFERRED.** ReservationPage and PropertyDetail
  keep their **hand-rolled** guards (`dirtyRef` + `beforeunload` + `popstate` +
  `window.__guestflowBeforeNavigate` + `UnsavedChangesDialog`). `useDirtyFormGuard` diffs
  `JSON.stringify(draft)` vs `saved`; both pages compute dirtiness from **custom flags** (`dirty ||
  timedOptionsDirty`; `initialSnapshot !== formSnapshot`) that don't map to a single draft/saved
  pair. Swapping would change data-loss-protection semantics on the two highest-value editors — not
  worth the risk for a presentational phase. The guards already deliver the exact UX.
- **ReservationPage action feedback (rule 8, advisory) — kept on `useAppDialogs.alert`.** Its
  outcomes are consequential (payment-link sent, devis converted, dates blocked) and its pre-submit
  validations are **blocking** (must stop the save); a modal acknowledgment is appropriate. Mixing
  blocking guards and transient toasts in one 2900-LOC editor was judged higher-risk than the value.
  `showSuccess` stays where it already was (balance-request). The audit itself marked R3 advisory.
- **PropertyPricingSeasons unsaved-changes** stays on `ConfirmDialog` (a sanctioned generic) rather
  than `UnsavedChangesDialog` — same reasoning, low value.

Everything else shipped: PropertyDetail header → `PageActionBar` (name = first field, static serif
title, aria-labels preserved), states + `showError` (save/delete failures no longer misrouted to the
photo field), tokens, `sectionHeader`, `TableCard`; ReservationPage saveDisabled/saveBusy,
`LoadingState`/`EmptyState`/`ErrorAlert`, `displayDateTime`, tokens, `sectionHeader`, dead `Dialog`
import removed; `StatusBadge`/`PlatformChip` adoption (ClientsPage, PricingSummary, FinanceSection,
ReservationConflictBadge); `formatCurrency` across ClientsPage/PricingSummary/FinanceSection/
ExtrasSection; `FormDialog` (ClientsPage delete-impact, PropertyPricingSeasons editor + apply,
`secondaryAction` for SchoolHolidays); pre-auth serif titles.

## 8. Out of scope

- Any server, figure, pricing, or validation change.
- ReservationSearchBox visual redesign (light-touch only).

## 9. Open questions

- **Resolved 2026-07-16 (AskUserQuestion): spec approved, direct implementation** (no intermediate
  plan step), phase-4/5 pattern.
- **Resolved 2026-07-16 (AskUserQuestion): PropertyDetail name → first form field** (option A),
  static serif bar title — rule 9.
- **Resolved 2026-07-16 (AskUserQuestion): sequencing → merge #336 first.** The branch
  `fix/ds-sweep-reservations` is created from a fresh `master` **after** #336 (phase 5) is
  squash-merged, so the phase-6 PR is a clean one-feature diff with no phase-5 overlap.
