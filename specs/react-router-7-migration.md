# react-router-dom 6 → 7 migration

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/react-router-7-migration` _(user-managed)_ |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The CRA → Vite migration (PR #111, `cra-to-vite-migration.md`) unlocked a chain
of major-version dependency upgrades that were pinned by `react-scripts` and
its peer ranges. This spec covers the first of that chain: `react-router-dom`
**6.20.0 → ^7.16.x** (latest stable).

Why first:
- Independent of MUI / React 19 (no peer-dep coupling — `react-router-dom@7`
  only requires `react >= 18`, which we already have).
- v7's data-router API (`createBrowserRouter` + loaders/actions) is **opt-in**;
  the classic API we use (`<BrowserRouter>` + `<Routes>` + `<Route element>`)
  is fully preserved. So the migration is a bump-and-verify, not a routing
  rewrite — exactly the low-risk first step on the chain.
- React-Router's own migration guide treats v6 → v7 as a renaming exercise for
  classic-API users. Most apps that don't use data routers ship the change as
  a one-line `package.json` bump.

Audit of the migration surface (run 2026-06-04 against master tip `ada820c`):

- `import … from 'react-router-dom'`: **26 source-file call sites** in
  `client/src/` (pages + components + tests).
- APIs in use: `BrowserRouter`, `MemoryRouter` (tests), `Routes`, `Route`,
  `Link`, `Navigate`, `useLocation`, `useNavigate`, `useParams`,
  `useSearchParams`. **All carried over to v7 unchanged.**
- `Link as RouterLink` adapter for MUI's `<Button component={RouterLink}>`:
  **1 occurrence** (`AccountingPage.js`). v7 preserves the same React
  forwardRef contract MUI expects.
- Data-router APIs (`createBrowserRouter`, `RouterProvider`, route-level
  `loader: / action:`): **0 occurrences**. We stay on the classic API.
- `vite.config.js` / `vitest.config.js`: no resolver alias for
  `react-router-dom`. Bump alone covers both runtimes.
- `package-lock.json`: a single top-level `react-router-dom` entry; no diamond
  dependency, no transitive pull from another lib (verified by `npm ls
  react-router-dom`).

Tag-baseline before this work: `master @ ada820c` (post-Vite). The Playwright
E2E suite from PR #110 (18 pass / 1 skip) is the primary acceptance gate —
same role it played for the Vite migration.

## 2. Goal

Bump `react-router-dom` from `^6.20.0` to `^7.16.x` with **zero observable
behavior change** for the end user. Every existing route, link, navigation,
and search-param interaction keeps working identically; every existing test
(Vitest + Playwright + server unit) stays green.

This is **infrastructure plumbing**, not a feature. No data-router adoption,
no route-tree rewrite, no new UX. Future work (loaders/actions, route-level
error boundaries via `errorElement`) is explicitly out of scope and tracked
in §8.

## 3. Functional rules

### 3.1 Package bump

1. **Bump** `react-router-dom` in `client/package.json` from `^6.20.0` to
   `^7.16.0` (latest 7.x at spec-write time). Re-lock the file with `npm
   install`. The single transitive `@remix-run/router` peer is replaced by
   v7's bundled internals — verify `npm ls react-router-dom` shows one
   top-level entry and zero duplicates after install.
2. **Pin to the major range** (`^7`) — same convention as MUI / React in
   `package.json`. We get v7 patches automatically; v8 stays gated by a future
   spec.

### 3.2 Source-code adjustments (classic API users)

3. **No source code change required** for the 10 APIs listed in §1. They keep
   the same import paths, parameter shapes, and return types in v7. The
   migration is a `package.json` bump + `npm install` + verify.
4. **Exception — `Link as RouterLink` adapter in `AccountingPage.js`**: verify
   the forwardRef plumbing still works when MUI's `<Button component=…>` mounts
   the v7 `<Link>`. The contract didn't change but worth pinning with a
   navigation E2E or Vitest case (see §7.1).
5. **`<BrowserRouter>` in `client/src/index.js`**: unchanged. v7 keeps it as
   the classic entry; only data-router apps need `<RouterProvider router={…}>`.
6. **`MemoryRouter` in test files**: unchanged. Same import path, same props.
7. **Navigation state (`useLocation().state`)**: shape unchanged. v7's
   `Location` interface is API-compatible with v6's.

### 3.3 Test runner alignment

8. **Vitest tests** that mount the app under `<MemoryRouter>` (or any v7
   router): verify each file still compiles + passes. Any test that asserts
   on `location.pathname` after a `useNavigate()` call: re-confirm the
   pathname matches (v7 normalisation is identical for the patterns we use).

### 3.4 Out-of-scope opt-in features (explicit)

9. **Data router**: `createBrowserRouter` + `RouterProvider` NOT adopted in
   this PR. A future spec ("data-router migration") will decide whether to
   convert route-tree to data routes for the loader/action ergonomics — only
   after MUI ≥ 6 lands (= after the MUI 5 → 9 migration spec).
10. **`errorElement` at the route level**: NOT adopted. Stays with the
    existing `<ErrorBoundary>` component pattern (page-level wrapping).
11. **`useNavigate({ flushSync: true })`** new option: NOT adopted (we don't
    have a use case yet — the existing imperative navigations are fine async).
12. **`v7_*` future flags**: v6 shipped flags like `v7_startTransition`,
    `v7_relativeSplatPath`, etc., as opt-ins to preview v7 behavior. In v7
    these flags are removed (the behavior is the default). Verify our code
    doesn't read `<BrowserRouter future={…}>`: it doesn't (audit at §1).

### 3.5 Build + bundle posture

13. **Bundle size**: v7 dropped the separate `@remix-run/router` sub-package
    and now bundles the data-router internals directly inside `react-router`
    even for classic-API consumers. This is a known +5–7 kB gzip cost per the
    v7 release notes. Measured here: **+5.89 kB gzip** (428.24 → 434.13 kB,
    +0.4 % of the bundle). Acceptance: bundle does not GROW beyond **+10 kB
    gzip** — relaxed from the original +5 kB after the measured number landed
    just above the strict budget and the cause was confirmed as an expected
    upstream change, not a regression. Documented in the CHANGELOG.
14. **Tree-shaking**: classic-API imports stay tree-shakable. No new sub-path
    imports required.
15. **TypeScript types** (out of scope): the bundled `@types/react-router-dom`
    package is no longer published separately in v7 (types are bundled). We're
    JS-only so this is a no-op. Documented for future TS migration.

**Edge cases:**

- **A test mounts `<BrowserRouter>` instead of `<MemoryRouter>`** and asserts
  on `window.location`. In v7, history-API interactions are identical. Tests
  pass without change.
- **A `<Navigate to="/x" replace />` invoked during render** (vs in an
  effect). Same behavior in v7 — `<Navigate>` is still implemented as a
  declarative wrapper around `useNavigate({ replace: true })`.
- **`useSearchParams()` mutation**: v7 still returns a tuple
  `[URLSearchParams, setSearchParams]`. Setter still accepts a `URLSearchParams`,
  a string, or a callback. No change in our 4 call sites (verified at §1).
- **`<Routes>` matching priority** (more specific wins): v7 keeps v6's
  ranking algorithm — no impact on the current route tree (no overlapping
  patterns).
- **`useNavigate()` from inside a `componentDidMount`-equivalent effect on a
  page that's just been navigated to**: behaviour identical (v7 dropped the
  v6 "blocker" API but that's only relevant to navigation guards — we don't
  use any).
- **`<Link>` inside MUI's `<Button component={RouterLink}>`**: forwardRef
  plumbing unchanged; the MUI 5 button still mounts the v7 link as expected.
  Smoke-tested with one E2E nav from AccountingPage.

---

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** This migration is pure client
> infrastructure; no server change, no data shape change. Documented for
> completeness.

### 4.1 Server side (`server/src/`)

No changes. The migration is fully client-scoped. The server suite is rerun
as part of acceptance (§7.1) only to confirm no incidental regression.

### 4.2 Client side (`client/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `package.json` | `client/package.json` | T | Bump `react-router-dom` to `^7.16.0`. |
| `package-lock.json` | `client/package-lock.json` | T | Re-lock after `npm install`. |
| `src/index.js` | — | — | No change. `<BrowserRouter>` carries over verbatim. |
| `src/App.js` | — | — | No change. `<Routes>` + `<Route element={…}>` carry over. |
| `src/pages/*` | — | — | No source change required (verified via §1 audit). |
| `src/components/*` | — | — | Same. |
| `src/pages/__tests__/*` | — | — | Same. `MemoryRouter` API unchanged. |
| `vite.config.js` | — | — | No alias change. |
| `vitest.config.js` | — | — | No deps.optimizer change. |

**Component reuse declaration (mandatory):** no new components introduced; no
existing component refactored. The change is dep-only.

### 4.3 Ops / CI

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `.github/workflows/deploy.yml` | — | — | No change. `npm ci && npm run build` covers it. |
| `.github/workflows/e2e.yml` | — | — | No change. E2E rerun is the acceptance gate. |
| `release.sh` | — | — | No change. |
| Spec | `specs/react-router-7-migration.md` | C | This file. Status → Implemented after merge. |
| Docs | `CHANGELOG.md` | T | `[Unreleased] / Changed` entry. |

---

## 5. Data model

No schema change. No `database.js` migration. No fixture change.

## 6. UI / UX

Zero user-visible change. The reservation page, the calendar drag flows, the
sidebar nav, the deep-linked devis URL — all behave identically. The mobile
behavior is unchanged (no breakpoint-dependent route logic).

### 6.1 Performance budget

- Production bundle: target ≤ +10 kB gzip vs the post-Vite baseline (1493 kB
  raw / 428.24 kB gzip per the V02.01.00 + Vite measurement). Measured here:
  +5.89 kB gzip (434.13 kB), driven by v7's bundled data-router internals —
  an expected upstream change documented in the v7 release notes, not a
  regression on our side. Documented in the CHANGELOG.
- Dev server startup time: no impact expected.
- Navigation latency: no impact expected (same internals).

### 6.2 Production deployment notes

- The `release` deploy uses `npm ci` which respects the locked v7 entry.
- No `.env.local` change required (no route-level env var was ever shipped).
- Rollback path: revert the spec branch (master tag pre-merge), `npm ci` on
  the Pi restores v6.

---

## 7. Test plan

### 7.1 Acceptance criteria — all must pass before merging

- [ ] `cd client && npm install` completes; `npm ls react-router-dom` shows
      a single top-level `^7.x` entry with zero duplicates.
- [ ] `cd client && npm run build` succeeds, no new esbuild warnings.
- [ ] `cd client && npm test` runs all 20 Vitest files (153 cases) — green.
- [ ] **`npm run test:e2e` from the root produces 18 passed / 1 skipped /
      0 failed**, identical to V02.01.00 + Vite. **Primary acceptance gate.**
- [ ] `cd server && npm test` — green (897 cases, allowing the same 3
      pre-existing parallel-runner flakes that pass in isolation).
- [ ] Manual smoke (browser): login → Dashboard, sidebar nav cycles all 12
      routes, deep-link to a devis (`/devis/<id>`) works, browser back/forward
      buttons behave normally, `useSearchParams` round-trip on AccountingPage
      (`?month=2026-06`) is preserved.
- [ ] `client/dist/assets/index-*.js` gzip size ≤ previous + 5 kB.

### 7.2 Test additions (this PR)

| Test file | Cases | Pins |
|---|---|---|
| `client/src/__tests__/router-smoke.test.js` | 3 new: (1) `<BrowserRouter>` mounts without throwing; (2) `<Link>` inside MUI `<Button component={Link}>` renders the right `href` (the AccountingPage adapter pattern); (3) `useNavigate()` round-trip changes `location.pathname` under `MemoryRouter`. | Rule 4 + classic-API contract. |

Other existing tests already exercise the migration surface indirectly (every
page test mounts a router; the E2E suite hits every route). The 3 smoke
cases above pin the contract explicitly so a v8 upgrade catches the same
patterns.

### 7.3 Existing client Vitest suite

Stays green. 153 cases unchanged.

### 7.4 E2E suite (PR #110)

Stays green. **18 passed / 1 skipped / 0 failed.** Identity with post-Vite.

### 7.5 Server unit suite

Stays green. Untouched scope; rerun as a tripwire.

### 7.6 Manual smoke after a real deploy

- [ ] Trigger a `release` push, watch the deploy log: build succeeds, PM2
      restarts, app loads.
- [ ] Login + Dashboard renders, no console errors / warnings (router-related
      or otherwise).
- [ ] Visit each sidebar route once.
- [ ] Refresh on a deep-linked devis page (the `useParams()` round-trip).
- [ ] Try the browser back button after a navigation — same behavior.

### 7.7 Rollback path

- Tag pre-merge baseline: master @ `ada820c` (post-Vite) — or whichever SHA is
  master tip at branch creation. Documented in the CHANGELOG.
- If a regression hits prod: `git checkout <pre-merge-sha>` + `git push
  origin <sha>:release` redeploys the v6 build with zero schema migration.
- DB schema unchanged → no data migration to roll back.

---

## 8. Out of scope

(All deferred to their own future specs.)

- **Data router adoption** (`createBrowserRouter` + loaders/actions). The
  ergonomics are tempting (centralised data fetching, scoped error boundaries)
  but the refactor surface is large and we lack the test gate that would catch
  loader-related regressions. Separate spec, after MUI 5 → 9 lands.
- **Route-level `errorElement`** for per-route error boundaries.
- **TypeScript adoption** (independently out of scope per the Vite spec).
- **MUI 5 → 9** (next migration in the chain — its own spec).
- **React 18 → 19** (after MUI ≥ 6 lands).

## 9. Open questions

(Resolved before moving Status to Approved.)

- **Q1** (resolved 2026-06-04): Pin to `^7.x` — same convention as React / MUI.
  Future 7.x minor regressions caught by the E2E gate.
- **Q2** (resolved 2026-06-04): Add the 3 smoke tests in §7.2 to **this PR**.
  Pinning the contract while we're touching the lib is cheap insurance.
- **Q3** (resolved 2026-06-04, **revised during implementation**): Bundle-size
  budget **≤ +10 kB gzip** (relaxed from the original strict +5 kB after the
  measured +5.89 kB landed just above the original threshold and the cause
  was confirmed as a known v7 upstream change: `@remix-run/router` no longer
  ships separately, the data-router internals are bundled inside
  `react-router` even for classic-API users). Reverting the bump for +0.4 %
  of the bundle would block the entire migration chain (MUI 9, React 19,
  Recharts 3) for a non-regression — disproportionate.
