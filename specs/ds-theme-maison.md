# DS Phase 1 — « Maison » theme & foundations

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ds-theme-maison` |
| **Created** | 2026-07-06 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Umbrella** | [design-system.md](design-system.md) — phase 1 of 6 |

---

> **Superseded on 2026-08-22:** the `/design` showcase page this phase shipped has been removed
> (route, Réglages entry, `pages/DesignPage.jsx`) — the design system is an internal contract, not an
> operator-facing screen. Everything else below still stands; see
> [design-system.md](design-system.md) §3.8. `specs/design-system-reference.md` is the living reference.

---

## 1. Context

Phase 1 of the [design-system program](design-system.md): make the « Maison » direction live app-wide
through the theme (the one file every page already consumes), fix the audit's quick bugs, centralize
formatters, add the scroll-to-top navigation fix (§3.6 umbrella), and open the `/design` showcase (v1:
tokens + typography). No component-library work (phase 2), no page sweeps (phases 3-6).

Facts this phase relies on (verified 2026-07-06):
- `client/src/theme.js` is the single theme, consumed via `App.js` ThemeProvider — palette/typography
  changes propagate to all 28 pages at once.
- Page titles render through exactly two components — `PageHeader.js:13` (h4) and `PageActionBar.js:150`
  (h6) — so switching both to a new `pageTitle` variant restyles every page title in one move.
- Inter loads from the Google Fonts CDN (`client/index.html:11`) — a hidden runtime dependency; the Pi
  deployment should not need internet for fonts.
- Admin gating uses `canSeeRoute()` from `constants/roles` (`App.js:19`).

## 2. Goal

After this phase, the whole app renders in the « Maison » identity (paper background, fir-green primary,
serif page titles, radius 14, warm shadows), pages always open scrolled to the top, money and dates have a
single display format, the audit's quick bugs are gone, and `/design` shows the tokens live. Zero behavior
change, zero server change.

## 3. Functional rules

1. **Theme « Maison »** (`theme.js`) — palette, radius, shadows exactly per
   [umbrella §3.1](design-system.md): primary `#2F5D46`, secondary `#C99038`, background `#F8F5EF` /
   paper `#FFFFFF`, text `#27251F` / `#6E6A5E`, semantic mains + soft backgrounds (stored as
   `palette.<sem>.soft` custom keys for phase-2 chips), divider `rgba(60,54,36,0.1)`,
   `shape.borderRadius: 14`, Card/Paper shadow `0 3px 16px rgba(60,54,36,0.09)`. Existing sane overrides
   kept (Button textTransform, TableContainer overflow, Dialog mobile margins).
2. **Typography roles** ([umbrella §3.2](design-system.md)) — custom MUI variants registered in the theme
   and accepted by `<Typography>`: `pageTitle` (serif 600, 1.35rem / 1.2rem xs), `sectionHeader` (serif
   600, 1.05rem), `kpiValue` (sans 700, 1.6rem, `tabular-nums`), `kpiLabel` (sans 600, 0.72rem). Body
   stays Inter. **`PageHeader` and `PageActionBar` switch their title to `variant="pageTitle"`** — every
   page title goes serif in one move; KPI/section adoptions happen in the sweeps.
3. **Self-hosted fonts, no CDN** — add `@fontsource/source-serif-4` (weights 600/700) for the serif and
   `@fontsource/inter` (400/500/600/700) replacing the Google Fonts `<link>` in `index.html`. The app must
   render identically offline.
4. **`ScrollToTop` on route change** (umbrella §3.6) — a null-rendering component inside the router:
   `window.scrollTo(0, 0)` on `pathname` change (hash-anchor navigations respected; instant scroll). Fixes
   the reported « page opens mid-scroll, top bar not visible ».
5. **Quick bug batch** (audit follow-ups, all S):
   a. **ZONE_COLORS conflict** — `utils/calendarVisuals.js` deletes its local map and imports from
      `constants/schoolHolidayZoneColors.js` (the file whose header already claims single-source-of-truth;
      its palette wins: A `#2196F3`, B `#4CAF50`, C `#FF9800`).
   b. **`#1976d2` → `primary.main`** — the 18 hardcoded stale-MUI-default blues (CalendarDayCell:106,
      ResourcePlanningPage:276/440, MiniPlanningStrip:137, …) become the theme primary.
   c. **DevisPage alert bug** — `DevisPage.js:106` passes a string to `DialogProvider.alert()`
      (options-object API) → wrap in `{ message }` so conversion errors display again.
   d. **Dead components deleted** — `DateInput.js`, `PropertyFormFields.js`,
      `PropertyCalendarOverview.js`, `SyncedPropertyMiniCalendars.js` (0 importers each, re-verified at
      implementation time).
6. **Formatters centralized** (umbrella §3.7) — `utils/formatters.js` gains
   `formatCurrency(n)` → `1 234,50 €` (2 decimals) and `formatCurrencyRounded(n)` → `1 234 €`
   (KPI style). All client-side money strings migrate to them (the 4 divergent formats:
   FinancePage:17, AccountingPage:42, PricingSummary:193, PropertyPricingSeasonsPage:581 + other local
   helpers found by grep). The 14+ local `formatDate` definitions migrate to the shared `displayDate()`
   or its explicit role variants (`displayDateShort`/`Long`/`DateTime`) — deliberate contextual formats
   (weekday-long planning labels, laundry day labels) stay local. Server-shaped strings (devis PDF,
   emails) untouched — fat backend unchanged.
   **Correction (post-merge adversarial review, 2026-07-14, PR `fix/finance-detail-exact-amounts`):**
   the initial codemod applied `formatCurrencyRounded` to ALL of FinancePage's `eur()` sites, including
   the per-reservation reconciliation tables (projection, période, retards) whose amounts carry cents
   (platform commissions) — rows no longer visually summed to their footer. Rule made explicit:
   `formatCurrencyRounded` is for **KPI tiles and chart labels only**; every table row/footer/actionable
   chip uses `formatCurrency`. A cents-reconciliation test now locks it.
7. **`/design` v1** — new `pages/DesignPage.js`, route `/design`, admin-only via the existing
   `canSeeRoute()` pattern, sidebar entry under Réglages. Sections: Palette (swatches + token names +
   hex), Typographie (role specimens with real French copy), Espacements & rayons, Formats (montants via
   `formatCurrency`, dates via `displayDate`). Uses the real theme — no duplicated values. Component
   catalogue arrives in phase 2.
8. **Zero behavior change** — visual + plumbing only. Any page whose tests assert old colors/variants gets
   its test updated in the same commit.

**Edge cases:**
- Custom variants must render the right DOM element (`variantMapping`: pageTitle→h1? No — pageTitle→`h1`
  breaks heading order on pages with their own h-tags; map pageTitle→`h1` is tempting for a11y but the
  safe move is pageTitle→`h4`-equivalent element `h1`… → decision: map `pageTitle`→`h1`,
  `sectionHeader`→`h2`, `kpiValue`/`kpiLabel`→`p`/`span`; pages currently have no competing h1, verified
  during implementation (LoginPage aside, which is out of the shell).
- Recharts fills (FinancePage) keep their explicit colors this phase — chart palette lands with the
  Finance sweep (phase 4).
- The WordPress plugin and devis PDFs are untouched (umbrella §8).

---

## 4. Architecture

> **Fat backend, thin frontend.** 100 % client-side presentation; no endpoint, payload or business-logic
> change. `/design` is gated client-side by the existing role system (exposes no data).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | **No server change.** |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `styles/` | `theme.js` | T | Palette « Maison », typography role variants, radius/shadows, semantic soft tokens. |
| deps | `@fontsource/source-serif-4`, `@fontsource/inter` | C | Self-hosted fonts; remove the CDN `<link>` (`index.html`). |
| `components/` | `PageActionBar.js`, `PageHeader.js` | T | Title → `variant="pageTitle"`. |
| `components/` | `ScrollToTop.js` | C | Null component: scroll reset on pathname change. |
| `components/` | `DateInput.js`, `PropertyFormFields.js`, `PropertyCalendarOverview.js`, `SyncedPropertyMiniCalendars.js` | **D** | Deleted (dead, 0 importers). |
| `utils/` | `formatters.js` | T | `formatCurrency`, `formatCurrencyRounded`; `displayDate` becomes the only date formatter. |
| `utils/` | `calendarVisuals.js` | T | Import ZONE_COLORS from constants (delete local map). |
| `pages/` | `DesignPage.js` | C | `/design` v1 showcase (tokens + typography + formats). |
| `pages/` | `DevisPage.js` | T | Alert-API bug fix (`:106`). |
| `pages/` + `components/` | ~18 files with `#1976d2`, files with local `formatDate`/currency helpers | T | Token + formatter migrations. |
| `App.js` | router | T | Mount `ScrollToTop`; register `/design` route + sidebar entry (admin). |

**Component reuse declaration:** creates `ScrollToTop` (generic, app-level) and `DesignPage`
(page). No other new components — the library work is phase 2 by design.

### 4.3 API contract

Unchanged.

---

## 5. Data model

No schema change, no migration.

## 6. UI / UX

- The whole app shifts to « Maison »: paper background, fir-green primary/actions, serif page titles,
  warmer hairlines, radius 14. Layout/density unchanged this phase (density rules land with sweeps).
- `/design` (admin): simple stacked sections, `PageActionBar` with title only; responsive (swatch grid
  wraps on xs; specimens full-width).
- **Responsive:** no layout change; verify at xs/md/lg that the new background/typography don't break
  contrast or wrap (long serif titles on xs must ellipsize in `PageActionBar` as today).
- **Mobile check (mandatory):** serif titles legible on xs; `/design` usable on phone; scroll-to-top
  verified on the pages where the symptom was reported.

## 7. Test plan

### Client unit tests (vitest) — full suite 613/613 green
- [x] `formatters` (10 tests): `formatCurrency(1234.5)` = `1 234,50 €`, grouping, negatives, `— ` on
  null/NaN, `formatCurrencyRounded(1234.5)` = `1 235 €`, all four date roles incl. the SQLite
  datetime shape.
- [x] `ScrollToTop` (2 tests): pathname change triggers `window.scrollTo(0,0)`; hash navigation does not.
- [x] `DesignPage` (2 tests): smoke render + theme-token regression guard (`#2F5D46`, `tabular-nums`,
  `success.soft`, radius 14).
- [x] Existing suites updated: PricingSummary format assertions (`12.50€` → `12,50 €`, 16 tests),
  `calendar-platform-colors` (dead-component describe removed — the component's only referencer was
  its test).

### E2E (Playwright)
- [x] Full suite green (28 passed / 1 skipped), unmodified — E2E asserts structure/text, not colors.

### Manual UI verification (2026-07-06, Playwright-driven browser)
- [x] Dashboard `lg` (1280): paper background, serif `h1` page title, green identity, warm alert — ✓.
- [x] `/design` full page: palette + soft chips + typo roles + spacing + formats, all live from the
  theme — ✓. Sidebar entry under Réglages, admin-gated.
- [x] Planning `xs` (390): serif title, warm cards, no horizontal scroll — ✓.
- [x] Réglages `md` (900): sticky `PageActionBar` with serif title + Save/Cancel — ✓.
- [x] Scroll-to-top: scrolled to 730 px on Dashboard → navigate to Planning → `scrollY = 0` — ✓.
- [x] Fonts: woff2 bundled in `dist/assets` (no external font request possible — CDN link removed).
- [ ] *(noted, pre-existing)* `/settings` logs a React `alignItems`-as-DOM-prop console error that
  exists on master (no Réglages file touched by this branch) → fix in the phase-3 Réglages sweep.

## 8. Out of scope

- Component library + fullScreen dialogs + toasts + ErrorBoundary (phase 2).
- Page sweeps, table alignment enforcement, KPI variant adoption (phases 3-6).
- Chart palettes (phase 4), dark mode, WordPress blocks, PDFs/emails (umbrella §8).

## 9. Open questions

- **Serif rendering check (resolved at implementation):** if Source Serif 4 disappoints visually in the
  bar, swap candidates (Charter/Iowan self-hosted) — one token + one dependency change.
- None blocking.
