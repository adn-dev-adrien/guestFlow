# MUI 5 → 9 migration

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mui-5-to-9-migration` _(user-managed)_ |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Second of the four queued major-version dependency upgrades unlocked by the
CRA → Vite migration (PR #111). After react-router 6 → 7 (PR #113), the next
verrou is **`@mui/material` 5 → 9** (and `@mui/x-date-pickers` 6 → 9 to keep
the pair coherent). MUI 9 is also the gating peer for the next chain item
(React 18 → 19): MUI 5 has known StrictMode + concurrent-rendering quirks
on React 19, MUI 9 is fully aligned.

The MUI release line **skipped v8** for `@mui/material` (npm dist-tags:
`latest-v7=7.3.11`, then directly `latest=9.0.1`). So the conceptual jump
is **5 → 6 → 7 → 9**, but the npm bump is a single `^9.0.1` install.

Decision (resolved before drafting): **single PR, direct 5 → 9**. Audit
(2026-06-04) found **zero hard blockers**: no `makeStyles`, no `@mui/styles`,
no `@mui/lab`, no `<Hidden>`, no `@mui/system`-direct usage, no test
asserting on a `MuiXxx-` class name. The migration's blast radius is well
bounded; cumulating three majors of breaking changes is acceptable.

Audit of the migration surface (run 2026-06-04 against master tip `2af0b8d`):

- **83 files** import `@mui/material` (213 import statements). Top 10:
  Box (39), Typography (33), Card (20), Button (19), TextField (18),
  CardContent (18), Stack (14), Alert (11), Tooltip (7), IconButton (5).
- **`@mui/icons-material`**: ~60 unique icons, ~130 import sites — sub-path
  imports throughout (`import DeleteIcon from '@mui/icons-material/Delete'`).
- **`@mui/x-date-pickers`** v6.18.0 in 2 files (`PropertyPricingSeasonsPage`,
  `EstablishmentClosuresPage`) — `LocalizationProvider`, `AdapterDayjs`,
  `DatePicker`, `frFR` locale.
- **Theme** ([client/src/theme.js](client/src/theme.js)): `createTheme()`
  with palette + typography + 6 `styleOverrides` (MuiButton, MuiTableContainer,
  MuiDialog, MuiDialogContent, MuiCard, MuiPaper). No `cssVarsTheme`. No
  `StyledEngineProvider`.
- **`<Grid container>` + `<Grid item xs={…}>`**: **56 `<Grid>` tags across
  8 files** (40 `xs=`, 26 `md=`, 10 `sm=`). Hot spots:
  [FinanceSection.js](client/src/components/reservation/FinanceSection.js) (14 tags),
  [PropertyDetail.js](client/src/pages/PropertyDetail.js) (10 tags),
  [SchoolHolidayFormFields.js](client/src/components/SchoolHolidayFormFields.js) (4 tags).
- **`color="default"`** (removed in v5 already but surfaced by 9-strict
  linting): 2 sites — [FinancePage.js:459](client/src/pages/FinancePage.js#L459)
  (Chip), [DevisPage.js:238](client/src/pages/DevisPage.js#L238) (IconButton).
- **`useTheme` + `useMediaQuery`**: 6 + 10 call sites — API unchanged.
- **`<Autocomplete>` `getOptionLabel` + `isOptionEqualToValue`**: 2 sites —
  signatures unchanged.
- **`<Select>` `renderValue`**: 2 sites — signature unchanged.
- **No legacy `<Hidden>` / `makeStyles` / `withStyles` / `@mui/styles` / `@mui/lab`**.
- **15 test files** mount MUI components; none use `<ThemeProvider>` (rely on
  default), none assert on `MuiXxx-` class names. Safe.
- **Emotion** v11.11.0 (`@emotion/react` + `@emotion/styled`) — MUI 9 peer
  requires `^11.5.0` ✅.

## 2. Goal

Bump `@mui/material` 5 → 9 + `@mui/x-date-pickers` 6 → 9 (single PR) with
**zero observable behavior change** for the end user. Every visual layout
behaves identically on every breakpoint; every keyboard / focus / aria
contract is preserved; every page renders the same content.

Behind the scenes: refactor the 56 `<Grid item xs=…>` sites to the v7+
`<Grid size={{…}}>` shape, fix 2 `color="default"` props, bump the date
pickers. Theme survives as-is (the 6 `styleOverrides` are v9-compatible).

## 3. Functional rules

### 3.1 Package bumps

1. **`client/package.json`** — bump:
   - `@mui/material@^5.15.0` → `@mui/material@^9.0.1`
   - `@mui/icons-material@^5.15.0` → `@mui/icons-material@^9.0.1`
   - `@mui/x-date-pickers@^6.18.0` → `@mui/x-date-pickers@^9.4.0`
2. Run `npm install` to regenerate `package-lock.json`. Verify:
   - `npm ls @mui/material`: single top-level `9.x` entry, zero duplicates.
   - `npm ls @mui/x-date-pickers`: single top-level `9.x` entry.
   - `npm ls @emotion/react @emotion/styled`: unchanged `11.11.x`, peer
     satisfied (MUI 9 requires `>= 11.5`).
3. Do NOT install `@mui/material-pigment-css`. It's an OPTIONAL peer for the
   pigment-css zero-runtime engine; we stay on the emotion-based engine
   (which MUI 9 still ships as the default).

### 3.2 Grid migration (mechanical, the biggest source-code touch)

4. **Refactor every `<Grid>` callsite** in the 8 files inventoried in §1.
   Pattern transformation:
   ```jsx
   // before (v5)
   <Grid container spacing={2}>
     <Grid item xs={12} md={6}>…</Grid>
   </Grid>

   // after (v9)
   <Grid container spacing={2}>
     <Grid size={{ xs: 12, md: 6 }}>…</Grid>
   </Grid>
   ```
   - Drop the `item` prop entirely (v7+ removed it — `<Grid>` is now always
     an item unless `container` is set).
   - Replace `xs={N}` / `sm={N}` / `md={N}` / `lg={N}` / `xl={N}` props with
     a single `size={{ xs: N, sm: N, md: N, … }}` prop. If only one
     breakpoint is used, the shorter form `size={N}` is also accepted.
5. The import path stays `import { Grid } from '@mui/material'`. In v7+,
   the bare name `Grid` IS the new "Grid2" — no rename gymnastics.
6. **Visual parity check** after each file: the layout must be
   pixel-identical (same column widths, same gaps). Manual smoke at the
   three breakpoints (xs/sm/md) per CLAUDE.md §7 responsive rule. The
   underlying flex/grid math is unchanged in v9.

### 3.3 `color="default"` removal

7. **[FinancePage.js:459](client/src/pages/FinancePage.js#L459)**: the
   "Acompte désactivé" `<Chip>` currently passes `color="default"`. v9
   removed the `default` color token — replace with no `color` prop (Chip
   already renders gray by default).
8. **[DevisPage.js:238](client/src/pages/DevisPage.js#L238)**: the convert
   `<IconButton>` passes `color="default"`. Same fix — drop the prop.

### 3.4 Date pickers bump (v6 → v9)

9. **No source code change required** in the 2 callers. `LocalizationProvider`
   + `AdapterDayjs` + `DatePicker` + `frFR` locale import paths all stay
   identical in v9 (verified against the v9 changelog).
10. The `frFR` locale path `import { frFR } from '@mui/x-date-pickers/locales'`
    remains valid in v9.

### 3.5 Theme + setup

11. **No change** to [theme.js](client/src/theme.js). The 6 `styleOverrides`
    block (MuiButton, MuiTableContainer, MuiDialog, MuiDialogContent,
    MuiCard, MuiPaper) uses the v5+ canonical shape, fully accepted in v9.
    Palette + typography + breakpoints overrides keep identical semantics.
12. **No change** to [App.js](client/src/App.js) `<ThemeProvider>` /
    `<CssBaseline>` mount.
13. **No `<StyledEngineProvider>` adoption**. The audit confirmed we don't
    mix engines (emotion-only), and MUI 9 still defaults to emotion when
    pigment-css is not installed.

### 3.6 Out-of-scope opt-in features (explicit)

14. **`cssVarsTheme`**: NOT adopted. The v6 opt-in to CSS variables on the
    theme is a future-readiness improvement (dark-mode SSR, etc.) but adds
    refactoring scope. A separate spec ("mui-css-vars-adoption") can pick
    it up later.
15. **`@mui/material-pigment-css`**: NOT adopted. Pigment CSS is a zero-runtime
    engine alternative to emotion. Different trade-offs (bundle size + build
    time + sx coverage). Out of scope; emotion stays the default.
16. **TypeScript adoption**: stays out of scope (consistent with other migration
    specs).
17. **`<Grid2>` from `@mui/material/Unstable_Grid2`**: NOT relevant in v9 —
    that path was the v6 staging area; in v7+, the bare `Grid` IS the v2 API.
18. **`<DataGrid>` from `@mui/x-data-grid`**: NOT in use today, NOT in scope.

### 3.7 Documentation

19. **CHANGELOG entry** under `[Unreleased] / Changed`: summarise the bump,
    the Grid surface refactored, the bundle delta, the gate results.
20. **Spec status** moves to `Implemented` after the merge.
21. **README** — no mention of MUI versions today, no update needed.

**Edge cases:**

- **A `<Grid item>` nested directly inside another `<Grid item>` without an
  intermediate `<Grid container>`**: not present in the audit (every nested
  Grid has an intermediate container) — but worth pinning visually in the
  manual smoke if any layout suddenly collapses.
- **A `<Grid>` with `direction="column"` + `xs` children**: the v9 mental
  model treats `size` as still meaningful inside a column container, same
  semantics as v5. No special handling needed.
- **A page that breaks at xs (mobile) because the new Grid sets a different
  default `min-width: 0`**: covered by the manual smoke at three breakpoints.
- **A `<TextField variant="filled">` styling shift**: v6+ tightened the
  underline color contrast. The two `filled` callsites
  ([FinancePage.js:468](client/src/pages/FinancePage.js#L468),
  [FinancePage.js:475](client/src/pages/FinancePage.js#L475)) need a visual
  check; functionally identical.
- **A `<Dialog>` padding shift**: covered by the existing theme override
  on `MuiDialogContent.root.padding` (theme.js:36-40).
- **`<CssBaseline>` reset adjustments in v6+**: minor tag-level CSS resets
  (margin/padding zeroing, font inheritance). Could surface as a small
  layout shift on a custom-styled page. Caught by the visual smoke.

---

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** Pure client infrastructure +
> styling change. Zero server impact. The visual smoke is the primary check
> beyond the test gate.

### 4.1 Server side (`server/src/`)

No changes. Tripwire only on `cd server && npm test` for incidental regression.

### 4.2 Client side (`client/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `package.json` | [client/package.json](client/package.json) | T | Bump `@mui/material` + `@mui/icons-material` + `@mui/x-date-pickers` |
| `package-lock.json` | [client/package-lock.json](client/package-lock.json) | T | Re-lock via `npm install` |
| `src/theme.js` | [client/src/theme.js](client/src/theme.js) | — | No change (audit verified) |
| `src/App.js` | [client/src/App.js](client/src/App.js) | — | No change (ThemeProvider + CssBaseline mounted as before) |
| **Grid refactor** | [client/src/components/reservation/FinanceSection.js](client/src/components/reservation/FinanceSection.js) | T | 14 Grid tags → `size={{…}}` |
| **Grid refactor** | [client/src/pages/PropertyDetail.js](client/src/pages/PropertyDetail.js) | T | 10 Grid tags |
| **Grid refactor** | [client/src/components/SchoolHolidayFormFields.js](client/src/components/SchoolHolidayFormFields.js) | T | 4 Grid tags |
| **Grid refactor** | [client/src/pages/TouristTaxPage.js](client/src/pages/TouristTaxPage.js) | T | 1+ tag |
| **Grid refactor** | ~4 other page files | T | Misc Grid tags (~27 across them) |
| **`color="default"` fix** | [client/src/pages/FinancePage.js](client/src/pages/FinancePage.js) | T | Drop `color="default"` on the Chip (line 459) |
| **`color="default"` fix** | [client/src/pages/DevisPage.js](client/src/pages/DevisPage.js) | T | Drop `color="default"` on the IconButton (line 238) |
| `src/__tests__/router-smoke.test.js` | — | — | No change. The MUI Button case still passes verbatim under v9. |

**Component reuse declaration (mandatory):** no new components introduced;
no existing component refactored beyond the Grid API shift. The change is
mechanical refactor + dep bump.

### 4.3 Ops / CI

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `.github/workflows/deploy.yml` | — | — | No change. `npm ci && npm run build` covers it. |
| `.github/workflows/e2e.yml` | — | — | No change. E2E rerun is the acceptance gate. |
| Spec | `specs/mui-5-to-9-migration.md` | C | This file. Status → Implemented after merge. |
| Docs | `CHANGELOG.md` | T | `[Unreleased] / Changed` entry. |

---

## 5. Data model

No schema change. No `database.js` migration. No fixture change.

## 6. UI / UX

Zero user-visible change targeted. Every layout, color, typography, and
interaction stays identical. The visual smoke at three breakpoints (xs / sm /
md) is the primary gate beyond the automated suite.

### 6.1 Performance budget

- Production bundle: target ≤ +25 kB gzip vs the post-router-v7 baseline
  (434.13 kB gzip per the V02.01.00 + Vite + router-v7 measurement). MUI v6+
  internals are roughly bundle-size-neutral with v5 (some components got
  smaller, theme cleanup), but the new Grid implementation adds ~5 kB
  vs the legacy Grid. Documented honestly in the CHANGELOG with the
  measured number.
- Dev server startup: no expected impact (Vite handles MUI's barrel imports
  through pre-bundling).
- Page render latency: no expected impact.

### 6.2 Production deployment notes

- The `release` deploy uses `npm ci` — respects the locked v9 entries.
- No `.env.local` change required.
- Rollback path: revert the merge commit, `npm ci` on the Pi restores v5.

---

## 7. Test plan

### 7.1 Acceptance criteria — all must pass before merging

- [ ] `cd client && npm install` completes; `npm ls @mui/material
      @mui/x-date-pickers` shows single top-level v9.x entries with zero
      duplicates.
- [ ] `cd client && npm run build` succeeds; **0 esbuild warnings**.
- [ ] `cd client && npm test` runs all 21 Vitest files (156 cases) — green.
      No test refactor expected; if any test fails on a class-name assertion
      we missed, document + fix.
- [ ] **`npm run test:e2e` from the root produces 18 passed / 1 skipped /
      0 failed**, identical to the post-router-v7 baseline. **Primary gate.**
- [ ] `cd server && npm test` — green (tripwire; allow the same 2-3
      pre-existing parallel-runner flakes that pass in isolation).
- [ ] Manual visual smoke at **three breakpoints** (xs / sm / md): every
      page renders the same layout as before, no broken Grids, no console
      warnings about deprecated MUI APIs, no aria regressions.
- [ ] Bundle size gzip ≤ +25 kB vs baseline (documented in CHANGELOG).

### 7.2 Test additions (this PR)

| Test file | Cases | Pins |
|---|---|---|
| `client/src/__tests__/mui-smoke.test.js` (NEW) | 4 new (one more than planned, added during implementation to pin the `<Switch>` role upgrade that broke ExtrasSection tests): (1) `<Grid container><Grid size={{xs:12,md:6}}/></Grid>` renders without throwing under v9 API; (2) `<Chip>` without a `color` prop renders correctly — pins the post-`color="default"` shape; (3) `<Switch slotProps={{ input: { 'aria-label': … } }}>` exposes `role="switch"` (v9 WAI-ARIA upgrade); (4) `<DatePicker>` from `@mui/x-date-pickers/DatePicker` under `<LocalizationProvider dateAdapter={AdapterDayjs}>` mounts without throwing. | Rules 4 + 7 + 9 + Switch accessibility upgrade. |

Four smoke cases. Like the router-v7 ones, they pin the migration contract
so a future v10 catches the same patterns.

### 7.3 Existing client Vitest suite

Stays green. 156 cases unchanged. The 15 MUI-touching test files do not
assert on `MuiXxx-` class names (audit confirmed).

### 7.4 E2E suite (PR #110)

Stays green. **18 passed / 1 skipped / 0 failed.** Identical to post-router-v7.

### 7.5 Server unit suite

Stays green. Tripwire only.

### 7.6 Manual smoke after a real deploy

- [ ] Trigger a `release` push; deploy log clean, PM2 restart OK.
- [ ] Login → Dashboard, no console warnings (esp. MUI deprecation messages).
- [ ] Open a reservation in edit mode and verify every Grid section in
      FinanceSection (deposit/balance/complement cards) at desktop + mobile.
- [ ] Property detail page — verify the 10 Grid tags' layout is identical.
- [ ] Establishment closures page + Pricing seasons page — verify the date
      picker UX (open, pick, confirm) hasn't shifted.
- [ ] Devis page — convert button still works (the `color="default"` fix).
- [ ] FinancePage — "Acompte désactivé" chip still visible + gray.
- [ ] Mobile (xs): drawer reachability, no broken Grid collapses.

### 7.7 Rollback path

- Tag pre-merge baseline: master tip at branch creation. Documented in the
  CHANGELOG.
- If a regression hits prod: revert the merge commit + `git push origin
  <pre-merge-sha>:release`. `npm ci` restores v5 since `package-lock.json`
  is reverted. No DB migration to undo.

---

## 8. Out of scope

(Each its own future spec.)

- **`cssVarsTheme` adoption** — better SSR / theme-switching ergonomics, but
  needs theme refactor. Picked up only if dark mode or theme-switcher is
  on the roadmap.
- **`@mui/material-pigment-css` engine** — zero-runtime CSS-in-JS, different
  trade-offs (smaller bundle, fewer dynamic features). Future spec if
  bundle pressure justifies it.
- **`@mui/x-data-grid` adoption** — currently we render plain `<Table>`
  components. Future if we hit pagination / virtualization pain.
- **TypeScript adoption** — separate concern.
- **React 18 → 19** — next chain item (its own spec, after this one merges).
- **Recharts 2 → 3** — independent migration (its own spec).

## 9. Open questions

(Resolved before moving Status to Approved.)

- **Q1** (resolved 2026-06-04): Use `mui-codemod` (the official
  `@mui/codemod` package) for the Grid refactor — `codemod first`, then
  manual review of each edited file + a manual sweep for the conditional-
  rendering cases the codemod misses. Covers `v6.0.0/grid-props` +
  `v7.0.0/grid-v2-props` transforms.
- **Q2** (resolved 2026-06-04): **3 commits** on the branch — (1) deps
  bump + theme verification, (2) Grid refactor + the 2 `color="default"`
  fixes, (3) smoke tests + spec status flip + CHANGELOG. Squashed on
  merge per CLAUDE.md §5.3.
- **Q3** (resolved 2026-06-04): **Strict** bundle-size budget ≤ +25 kB
  gzip. If exceeded, investigate before merging; relax only if cause is
  a known upstream change (same protocol as the router-v7 +5 kB → +10 kB
  call).
- **Q4** (resolved 2026-06-04): **Stay on the existing picker UX** with
  `<DatePicker>` + `<LocalizationProvider>`. Adopt the new
  `<DateField>` field-components only if/when typing-only UX is wanted.
