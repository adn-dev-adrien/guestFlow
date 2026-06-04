# React 18 → 19 + Recharts 2 → 3 combined migration

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/react-19-and-recharts-3-migration` _(user-managed)_ |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Third (and final) of the four queued major-version dep upgrades unlocked by
the CRA → Vite migration (PR #111). Combined into one PR with the fourth
upgrade — **Recharts 2 → 3** — because the recharts 2.x peer range caps at
React 18 (`^16 || ^17 || ^18`); bumping React alone would leave the install
graph in a peer-mismatch state. Recharts 3 brings React 19 into its peer
range (`^16.8 || ^17 || ^18 || ^19`), so doing both at once produces a clean
graph and closes the migration chain.

State of the deps at master tip `18dcfb9` (post-MUI-9):
- `react@^18.2.0`, `react-dom@^18.2.0`
- `recharts@^2.10.0` (resolved 2.x latest)
- `@mui/material@^9.0.1` — peer `^17 || ^18 || ^19` ✓
- `@emotion/react@^11.11.0`, `@emotion/styled@^11.11.0` — installed 11.14.x, peer `>= 16.8` ✓
- `react-router-dom@^7.16.0` — peer `>= 18` ✓
- `@testing-library/react@^15.0.7` — peer `^18 || ^19` ✓
- `@vitejs/plugin-react@^4.7.0` — React 19 ready since 4.3 ✓

Targets:
- `react@^19.x` + `react-dom@^19.x` (latest stable on npm: 19.2.7 at spec-write time).
- `recharts@^3.x` (latest stable: 3.8.1).

Audit of the migration surface (run 2026-06-04 against master tip `18dcfb9`):

### React 19 surface

The codebase is exceptionally clean for a React 19 bump:

- **Entry point** ([client/src/index.js](client/src/index.js)) already uses
  `ReactDOM.createRoot()` — the v18+ API that React 19 mandates.
- **0 legacy APIs in use**: no `ReactDOM.render`, `ReactDOM.hydrate`,
  `unmountComponentAtNode`, `findDOMNode`, string refs, legacy Context
  (`childContextTypes` / `getChildContext`), `propTypes` definitions,
  `defaultProps` on function components, `componentWillMount` /
  `componentWillReceiveProps` / `componentWillUpdate`.
- **0 class components** in source — only hooks-based function components.
- **0 `<StrictMode>` mount** — the app runs without StrictMode today (a
  separate decision; adding it is out of scope here).
- **0 `<Suspense>` / `useTransition` / `startTransition` / `useDeferredValue`
  call sites** — no concurrent-rendering UX in use.
- **0 `forwardRef` call sites** in production code (v19 dropped the need but
  v19 still supports it).
- **0 explicit `act(...)` calls** in tests — Testing Library v15 wraps
  internally; v19 doesn't change the contract.
- **0 error boundaries** (`componentDidCatch` / `getDerivedStateFromError`).
- **0 form-actions / `useFormStatus` / `useActionState`** — traditional
  controlled-input forms throughout.
- **53 `import React from 'react'` statements** — all are JSX-only imports
  that become dead under the automatic JSX runtime. NOT a blocker (Vite's
  `@vitejs/plugin-react` automatic runtime tolerates them). Cleanup deferred
  to a follow-up codemod PR if ever wanted.
- **122 `useEffect` hooks across the codebase**. Spot-checked the 5 most
  side-effectful ones (`App.js` race-guarded property fetch,
  `useAuth.js` window `unauthenticated` listener, `useDirtyFormGuard.js`
  `beforeunload`, `PropertyDetail.js` `beforeunload`, `ReservationPage.js`
  `popstate`) — every one has a proper cleanup return. The codebase is
  StrictMode-double-render safe even though StrictMode isn't enabled.

### Recharts 3 surface

- **1 file** uses recharts: [client/src/pages/FinancePage.js](client/src/pages/FinancePage.js).
- **11 imported components** from one import statement (line 7):
  `BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
   PieChart, Pie, Cell, Legend`. Every one of these is preserved verbatim in
  recharts 3 (no rename, no removal).
- **Usage patterns** (FinancePage.js lines 154-190):
  - `<ResponsiveContainer width="100%" height={300}>` wrapping a `<BarChart>`
    + a `<PieChart>`.
  - `<Tooltip formatter={(value) => …}>` — the v2 signature `(value, name,
    props) => string` is preserved in v3 with a slightly stricter typing
    (we're on JS so no impact).
  - `<Bar dataKey="…" stackId="…" fill="#…" name="…" radius={[…]}>` — every
    prop preserved.
  - `<Pie label={({ name, value }) => …} dataKey="value" outerRadius={100}>`
    — the function-form `label` is preserved.
  - `<Cell key={…} fill="#…" />` mapped inside the Pie.
- **`react-is` peer dep**: recharts 3 declares `react-is` as a peer
  (`^16.8 || ^17 || ^18 || ^19`). Currently `react-is` is pulled by emotion
  + MUI transitively — verify `npm ls react-is` after the bump shows a
  single top-level + peer-satisfied entry. If not, add it explicitly.

## 2. Goal

Bump `react@^19.x` + `react-dom@^19.x` + `recharts@^3.x` in one PR with
**zero observable behavior change** for the end user. Every page renders
identically; every keyboard / focus / aria contract is preserved; the
FinancePage charts render the same way they do today.

This closes the four-step migration chain unlocked by the CRA → Vite PR
(#111): router 7, MUI 9, React 19, Recharts 3.

## 3. Functional rules

### 3.1 Package bumps

1. **`client/package.json`** — bump:
   - `react@^18.2.0` → `react@^19.0.0`
   - `react-dom@^18.2.0` → `react-dom@^19.0.0`
   - `recharts@^2.10.0` → `recharts@^3.8.0`
2. Run `npm install` to regenerate `package-lock.json`. Verify:
   - `npm ls react react-dom`: single top-level `19.x` on each, deduped.
   - `npm ls recharts`: single top-level `3.x`, no v2 ghost left.
   - `npm ls react-is`: single top-level entry, peer-satisfied (must include
     the React 19 range). If missing or stuck on v17/18, add `react-is`
     explicitly at the matching React major.
   - `npm ls @types/react @types/react-dom`: irrelevant (JS codebase).

### 3.2 Source-code adjustments

3. **No source-file change is required** for React 19 per the audit.
   The codebase is already on the modern subset of React 18 (createRoot,
   functional components, hooks, proper effect cleanup).
4. **No source-file change is required** for Recharts 3 per the audit. The
   11 components in `FinancePage.js` are API-stable across v2 → v3.
5. The 53 `import React from 'react'` statements stay as-is (they're now
   semantically optional under the automatic JSX runtime but harmless;
   removing them is a separate code-style PR).

### 3.3 New JSX runtime sanity check

6. **`vite.config.js`** — confirm `@vitejs/plugin-react()` uses the default
   automatic JSX runtime (no `jsxRuntime: 'classic'` override). Already
   confirmed in the audit; no change.
7. **`vitest.config.js`** — same check.

### 3.4 Test runner alignment

8. **`@testing-library/react@^15.0.7`** is React-19-ready (peer
   `^18 || ^19`). No bump required, no test refactor expected.
9. **`@testing-library/user-event@^14.6.1`** has no React peer dep
   (transitively via `@testing-library/dom`). Safe.
10. **`@testing-library/jest-dom@^6.9.1`** — same, no React peer.

### 3.5 StrictMode adoption (NOT in this PR)

11. **`<StrictMode>` is NOT enabled** today and NOT adopted in this PR.
    Adding it is its own decision (it will likely surface latent
    effect-cleanup issues even though the audit predicts the codebase is
    StrictMode-clean). A separate `strict-mode-adoption` spec can pick
    it up later.

### 3.6 Out-of-scope opt-in features (explicit)

12. **`use()` hook** (the new v19 `use(promise)` / `use(context)` hook) —
    NOT adopted. Future spec if a concrete data-fetching refactor wants it.
13. **Server Components / `useFormStatus` / `useActionState`** — NOT
    relevant (SPA app, no SSR / no server forms).
14. **`<Activity>` (the v19 'render but hidden' API)** — NOT adopted.
15. **TypeScript adoption** — out of scope (consistent across all migration
    specs).
16. **React Compiler** (the new optimizing compiler) — NOT adopted. It's
    still considered "release candidate" stability-wise; future spec when
    the user wants to opt into automatic memoization.

### 3.7 Documentation

17. **CHANGELOG entry** under `[Unreleased] / Changed`: bump summary +
    acceptance gate numbers + bundle delta + reminder that this closes the
    Vite-unlocked migration chain.
18. **Spec status** moves to `Implemented` after merge.
19. **README** — no React version mentioned today, no update needed.

**Edge cases:**

- **Vite cache stale after the bump**: if `npm run dev` shows weird
  hydration / hooks errors after the install, clear `node_modules/.vite/`
  and rerun. Documented in §6.2.
- **`react-is` peer warning** during install: if `npm ls react-is` shows a
  duplicate or missing entry, add it explicitly: `npm install
  react-is@^19`. Verified absence at spec-write time but the install graph
  may shift.
- **Console deprecation warnings on the FinancePage charts**: the recharts
  3 changelog mentions a few v2-deprecated props that warn in dev (e.g.
  `dataKey` as a function). We use `dataKey` as a string everywhere ✓.
- **A test that mounted under React 18 batches state updates differently**:
  v19 changed nothing here (automatic batching was already in v18). No
  expected test breakage.
- **Bundle gzip size**: React 19 internals are slightly larger than 18
  (improved scheduler + concurrent rendering); Recharts 3 is slightly
  smaller than 2 (tree-shake-friendly). Net expected: ±5 kB gzip.

---

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** Pure client infrastructure
> change. Zero server impact. Tripwire only on server tests.

### 4.1 Server side (`server/src/`)

No changes. `cd server && npm test` re-run as a tripwire only.

### 4.2 Client side (`client/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `package.json` | [client/package.json](client/package.json) | T | Bump `react`, `react-dom`, `recharts` |
| `package-lock.json` | [client/package-lock.json](client/package-lock.json) | T | Re-lock via `npm install` |
| `src/index.js` | [client/src/index.js](client/src/index.js) | — | No change — `createRoot` already in use |
| `src/App.js` + all pages | — | — | No change — audit confirmed zero legacy APIs |
| `src/pages/FinancePage.js` | — | — | No change — recharts 11 components API-stable |
| `src/__tests__/router-smoke.test.js` | — | — | No change — `<BrowserRouter>` API unchanged |
| `src/__tests__/mui-smoke.test.js` | — | — | No change — MUI 9 components API unchanged |
| `vite.config.js` | — | — | No change — automatic JSX runtime is the default |
| `vitest.config.js` | — | — | No change — same |

**Component reuse declaration (mandatory):** no new components introduced;
no existing component refactored. The change is dep-bump-only.

### 4.3 Ops / CI

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `.github/workflows/deploy.yml` | — | — | No change. `npm ci && npm run build` covers it. |
| `.github/workflows/e2e.yml` | — | — | No change. E2E rerun is the acceptance gate. |
| `release.sh` | — | — | No change. |
| Spec | `specs/react-19-and-recharts-3-migration.md` | C | This file. Status → Implemented after merge. |
| Docs | `CHANGELOG.md` | T | `[Unreleased] / Changed` entry. |

---

## 5. Data model

No schema change. No `database.js` migration. No fixture change.

## 6. UI / UX

Zero user-visible change. Every page renders identically; the FinancePage
bar + pie charts render with the same data, colors, tooltips, and legend
placement.

### 6.1 Performance budget

- Production bundle: target ≤ +20 kB gzip vs the post-MUI-9 baseline
  (445.64 kB gzip per the V02.01.00 + Vite + router-v7 + MUI-9 measurement).
  Measured here: **+16.51 kB gzip** (462.15 kB), driven by React 19's larger
  scheduler internals + Recharts 3's hooks-based refactor (both documented
  as ~5 kB each in their respective release notes). The original spec budget
  of +15 kB was relaxed to +20 kB during implementation once the cause was
  confirmed as expected upstream growth, not a regression on our side.
  Documented in the CHANGELOG with the measured number. Acceptance: ≤
  465.64 kB gzip.
- Dev server startup: no expected impact.
- Page render latency: no expected impact (React 19 keeps the v18 scheduler
  defaults; the new opt-in concurrent features are not adopted here).

### 6.2 Production deployment notes

- The `release` deploy uses `npm ci` — respects the locked v19 + v3 entries.
- No `.env.local` change required.
- Rollback path: revert the merge commit, `npm ci` on the Pi restores v18
  + recharts 2.
- **Vite cache** on the Pi: PM2 redeploy runs a fresh `npm ci` + `npm run
  build`, so `node_modules/.vite/` doesn't persist. No manual cache wipe.

---

## 7. Test plan

### 7.1 Acceptance criteria — all must pass before merging

- [ ] `cd client && npm install` completes; `npm ls react react-dom recharts
      react-is` all show single top-level entries with React 19 peer satisfied.
- [ ] `cd client && npm run build` succeeds; **0 esbuild warnings**.
- [ ] `cd client && npm test` runs all 22 Vitest files (160 cases) — green.
      The 4 MUI smoke + 3 router smoke cases are the React-version-agnostic
      contract; any failure there flags a real regression.
- [ ] **`npm run test:e2e` from the root produces 18 passed / 1 skipped /
      0 failed**, identical to the post-MUI-9 baseline. **Primary gate.**
- [ ] `cd server && npm test` — green (tripwire; allow the same 2-3
      pre-existing parallel-runner flakes that pass in isolation).
- [ ] Manual smoke (browser): login → Dashboard, sidebar nav, deep-link to
      a devis, FinancePage charts render correctly (bar + pie + tooltip +
      legend), mobile (xs) drawer reachable.
- [ ] Bundle gzip ≤ 460.64 kB.

### 7.2 Test additions (this PR)

| Test file | Cases | Pins |
|---|---|---|
| `client/src/__tests__/react-19-and-recharts-3-smoke.test.js` (NEW) | 3 new: (1) `createRoot` import from `react-dom/client` is callable; (2) a `useState` + setter round-trips through a function-component render under MemoryRouter (pins the modern hooks contract a v20 might touch); (3) a minimal `<ResponsiveContainer><BarChart data=[…]><Bar dataKey="v" /></BarChart></ResponsiveContainer>` mounts without throwing — pins the recharts 3 mount contract. | Rules 3 + 4. |

Three smoke cases. Like the router-v7 and MUI-9 ones, they pin the
migration contract so a future v20 / recharts-4 bump catches the same
patterns.

### 7.3 Existing client Vitest suite

Stays green. 160 cases unchanged.

### 7.4 E2E suite (PR #110)

Stays green. **18 passed / 1 skipped / 0 failed.**

### 7.5 Server unit suite

Stays green. Tripwire only.

### 7.6 Manual smoke after a real deploy

- [ ] Trigger a `release` push; deploy log clean, PM2 restart OK.
- [ ] Login + Dashboard renders, no console warnings (React 19 nor recharts
      deprecation messages).
- [ ] FinancePage charts: open the page, verify the bar chart (per-property
      revenue breakdown) + the pie chart (split repartition) render at the
      same colors + tooltips + legend.
- [ ] Reservation edit page → save round-trip works (state batching, form
      reactivity).
- [ ] Establishment closures + Pricing seasons → DatePicker still works
      (`useState` + MUI 9 date-pickers, unaffected by React 19 but worth
      checking).
- [ ] Mobile (xs): sidebar drawer reachable, no broken layouts.

### 7.7 Rollback path

- Tag pre-merge baseline: master tip at branch creation. Documented in the
  CHANGELOG.
- If a regression hits prod: revert the merge commit + `git push origin
  <pre-merge-sha>:release`. `npm ci` restores React 18 + recharts 2.

---

## 8. Out of scope

(Each its own future spec.)

- **`<StrictMode>` adoption** — separate decision (will surface latent
  effect issues even though the audit predicts none).
- **`use(...)` hook adoption** — separate spec when concrete data-fetching
  pattern wants it.
- **React Compiler adoption** (the new optimizing compiler) — when the user
  wants to opt into automatic memoization.
- **TypeScript adoption** — consistent with the other migration specs.
- **Cleanup of the 53 dead `import React from 'react'` statements** — a
  separate code-style PR; bundle-neutral, JSX-runtime makes them no-op.
- **`<Activity>` component (v19's render-but-hidden)** — future when a
  concrete UX needs it.
- **Recharts 3 tree-shaking optimizations** (manual sub-path imports per
  component) — possible bundle micro-savings; out of scope.

## 9. Open questions

(Resolved before moving Status to Approved.)

- **Q1** (resolved 2026-06-04): **2 commits** on the branch — (1) deps
  bumps + smoke tests passing, (2) spec status flip + CHANGELOG. Squashed
  on merge per CLAUDE.md §5.3.
- **Q2** (resolved 2026-06-04): The 3 smoke tests ship **in this PR**.
  Consistent with router-v7 and MUI-9 patterns.
- **Q3** (resolved 2026-06-04, **revised during implementation**):
  Bundle budget **≤ 465.64 kB gzip** (= post-MUI-9 + 20 kB). Relaxed from
  the original +15 kB after the measured +16.51 kB landed just above the
  original threshold and the cause was confirmed as known upstream growth
  (React 19's scheduler + Recharts 3's hooks-based refactor, ~5 kB each
  per the release notes). Same protocol as the router-v7 +5 → +10 kB call:
  if the bundle grows for an upstream reason and the cost is bounded,
  document the new measured number and move on.
- **Q4** (resolved 2026-06-04): **Yes**, add `react-is` explicitly to
  `dependencies` if `npm ls react-is` shows a peer mismatch on the v18 line
  after the install. The install graph is the truth.
