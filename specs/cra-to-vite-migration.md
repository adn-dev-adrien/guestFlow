# Client build stack migration — Create React App → Vite

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/cra-to-vite-migration` |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Tagged baseline before this work: `V02.01.00`. The client tree is locked on
`react-scripts 5.0.1` (Create React App). Three accumulated facts make migration
necessary:

1. **Security**: `npm audit` on `client/` reports **42 vulnerabilities** (19 high / 14
   moderate / 9 low). All but a handful trace back to CRA's transitive deps
   (`react-scripts → @svgr → svgo`, `jsonpath`, `node-forge`, `nth-check`,
   `serialize-javascript`, etc.). No upstream fix exists on `react-scripts 5.0.1`.
2. **Maintenance**: CRA emits ~25 `npm warn deprecated` lines on every `npm install`
   (babel proposal plugins → transform plugins, workbox / svgo / abab / domexception
   / w3c-hr-time / `inflight` etc.). All transitive, all unfixable on CRA 5.
3. **Future blockers**: React 18 → 19, MUI 5 → 9, react-router-dom 6 → 7 are each
   held back by CRA's pinned tooling. Without migrating, we can't advance ANY of
   these.

Audit of the migration surface (run 2026-06-04 against the master tip):

- `process.env.REACT_APP_*`: **1 occurrence** (`client/src/api.js:1` — `REACT_APP_API_URL`).
- Asset imports (`import x from './x.svg'`): **0 occurrences**.
- Service worker / PWA: **0 references in source**.
- Custom Jest config: **none** (uses CRA default).
- CRA build flags referenced outside `client/package.json`: 3 sites —
  `deploy.yml` (`GENERATE_SOURCEMAP=false`), `release.sh` (4 mentions of
  `client/build/` + `GENERATE_SOURCEMAP=false`), `README.md` (3 mentions of
  `client/build/`).
- `client/public/index.html` has 3 `%PUBLIC_URL%/favicon.*` references.
- 19 client unit test files (`src/**/__tests__/*.test.js`) using
  `@testing-library/react` + Jest globals (via `react-scripts test`).

Safety net already in place (shipped in PR #110 under `V02.01.00`):

- 18 Playwright E2E tests covering routing graph, settings persistence, iCal
  Dashboard alerts, linen stock round-trip, mobile viewport. Same suite must stay
  green AFTER the migration → objective acceptance criterion.

## 2. Goal

Replace `react-scripts` with Vite as the client build stack. Migrate the 19 unit
tests to Vitest in the same PR (they're coupled — once `react-scripts test` is gone,
Jest needs its own config anyway, and Vitest is the Vite-native option). Update the
ops scripts that reference CRA-isms (build dir, sourcemap flag) accordingly. The
client behaves identically end-to-end: every route renders, every form persists,
every Dashboard alert surfaces, every E2E test stays green.

Expected outcome on `npm audit`: **42 → ~5 vulnerabilities** (the residue lives in
deps unrelated to the build chain — e.g. `recharts`, `dayjs` — and can be addressed
ad hoc afterward).

## 3. Functional rules

### 3.1 Build system

1. **Remove** `react-scripts` from `client/package.json`.
2. **Add** `vite`, `@vitejs/plugin-react`, `vite-tsconfig-paths` (last one optional
   — only if used). Pin to latest stable major (`vite ^6.x`).
3. **Create** `client/vite.config.js` (JS, not TS — staying aligned with the
   codebase). The config:
   - `plugins: [react()]`
   - `server.port = 3000` (matches the existing CRA dev port; E2E + dev parity).
   - `server.proxy: { '/api': 'http://localhost:4000' }` — equivalent of CRA's
     `"proxy"` field. Critical: the E2E suite (PR #110) relies on this proxying
     `/api/*` → `:4000`; same-origin cookies + session work the same way.
   - `build.outDir = 'dist'` (Vite default; we accept the rename `build/` → `dist/`).
   - `build.sourcemap = false` (equivalent of CRA's `GENERATE_SOURCEMAP=false`
     security flag — never ship sourcemaps to prod, per 2026-06-01 audit finding).
   - `build.rollupOptions.output.manualChunks` left default — no manual splitting
     required at this size.
   - `define.global = 'globalThis'` — guards against the rare `global.xxx` access in
     a transitive dep.
   - The `INLINE_RUNTIME_CHUNK=false` equivalent: Vite ships zero inline runtime
     scripts by default — already satisfies the CSP `script-src 'self'` posture
     pinned in the 2026-06-01 hardening. Documented in the migration note.
4. **HTML entry**:
   - Move `client/public/index.html` to `client/index.html` (Vite convention).
   - Replace `%PUBLIC_URL%/favicon.ico` → `/favicon.ico`. Same for `favicon.svg`
     (×2 occurrences).
   - Add `<script type="module" src="/src/index.js"></script>` before `</body>`.
5. **Public assets**: `client/public/favicon.ico` + `favicon.svg` stay where they
   are (Vite serves `public/` at root — same behaviour as CRA).
6. **Env var rename**: `process.env.REACT_APP_API_URL` → `import.meta.env.VITE_API_URL`
   in `client/src/api.js`. The lookup pattern stays:
   `const API = import.meta.env.VITE_API_URL || '/api';`
7. **Existing `.env.local` files**: any local override of `REACT_APP_API_URL` needs
   to be renamed to `VITE_API_URL`. Documented in §6.4 (deployment notes).

### 3.2 Test runner

8. **Replace** `react-scripts test` with `vitest`. Add `vitest` + `jsdom` +
   `@vitest/browser` (if needed; likely not — jsdom is enough for these tests).
9. **`client/vitest.config.js`** (separate from `vite.config.js` to keep concerns
   isolated):
   - `test.environment = 'jsdom'`
   - `test.globals = true` (lets us keep tests written with `describe / it / expect`
     globals without `import { ... } from 'vitest'` — preserves test file shape).
   - `test.setupFiles = ['./src/setupTests.js']` if needed (currently there's no
     setup file — confirm via grep; if absent, omit).
10. **`@testing-library/jest-dom`**: works under Vitest unchanged. The matchers
    (`toBeInTheDocument`, etc.) need to be loaded via `import '@testing-library/jest-dom';`
    in a setup file. If the existing tests rely on CRA's auto-extending, we add a
    one-line `src/setupTests.js`.
11. **Test files unchanged**: the 19 existing `.test.js` files continue to use
    `@testing-library/react` + global `describe / it / expect`. No mass edit.
12. **`"test"` script**: `vitest run` (single-run, headless, CI-friendly).

### 3.3 Build output rename: `build/` → `dist/`

13. **`release.sh`**: every `client/build` → `client/dist`. 4 sites.
14. **`.github/workflows/deploy.yml`** step that runs the client build:
    `GENERATE_SOURCEMAP=false npm run build` → `npm run build` (the flag is now in
    `vite.config.js`, so the env override becomes unnecessary). The build still
    produces a `dist/` directory; release.sh handles the rename.
15. **`README.md`**: 3 mentions of `client/build/` → `client/dist/`. Plus the
    "client built with `INLINE_RUNTIME_CHUNK=false`" note becomes "client built
    with Vite (`build.sourcemap = false`, zero inline runtime scripts)".
16. **`.gitignore`**: `client/build/` line stays + add `client/dist/`.

### 3.4 Lint

17. **CRA's bundled ESLint** is gone. We have two choices:
    - **Choice A** (recommended): no build-time lint. Lint stays available via a
      separate `npm run lint` if desired. Adrien already accepts CRA's
      lint-on-build pattern; a deliberate explicit step is fine.
    - **Choice B**: add `vite-plugin-eslint` for build-time linting. More config,
      bisects build speed gains.
    - Decision: **A**. Add `eslint` as a devDep + a minimal `.eslintrc.js` only if
      not present. (Currently no `eslintConfig` field in `client/package.json`.)
18. **No new lint errors introduced**: the existing source is CRA-clean. If Vite
    surfaces JSX/React issues CRA was masking, they're fixed in this PR.

### 3.5 Browser targets

19. **No `@vitejs/plugin-legacy`**. The app targets modern browsers (current
    Chrome / Firefox / Safari on dev devices and the comptable's machines). The
    `browserslist` block in `client/package.json` is removed — Vite uses its own
    targets via `build.target` (default `modules` = modern ESM browsers, fine).

### 3.6 E2E suite (PR #110)

20. **Same `e2e/specs/*` and `playwright.config.js` keep working without edits.**
    Vite dev server on `:3000`, CRA proxy translated to `server.proxy` config →
    same /api/* proxying → same cookie/origin model → same auth.
21. **Critical merge gate**: `npm run test:e2e` must produce **18 passed / 1
    skipped / 0 failed** identical to V02.01.00. Any deviation requires
    investigation before the migration ships. This is the migration's primary
    acceptance criterion.

### 3.7 Documentation

22. **CHANGELOG entry** under `[Unreleased] / Changed` covering: build system swap,
    test runner swap, env-var rename, output dir rename, security posture
    preserved (no sourcemap, no inline runtime, same proxy / cookie behaviour).
23. **README** updated for new build dir + replaced CRA mentions.
24. **Spec status** moves to `Implemented` after merge.

### 3.8 Out of scope (explicit)

- React 18 → 19. The MUI 5 ecosystem doesn't fully support React 19; deferred.
- MUI 5 → 9. Separate migration project — breaking theming API changes (v6, v7).
- react-router-dom 6 → 7. Separate; v7 has a data-router rewrite.
- Migrating to TypeScript. Codebase stays JS.
- Adding `vite-plugin-pwa`. We don't use PWA features (verified — `grep
  serviceWorker` returns nothing).
- Cross-browser E2E expansion. Chromium only stays.
- Wave 2 E2E specs (the 16 queued specs from PR #110's spec). Independent track.

**Edge cases:**

- **A MUI / emotion import path resolves differently under Vite's ESM strict
  mode** — manifests as duplicate `@emotion/react` instances and the React tree
  warning. Mitigation: pin `optimizeDeps.include = ['@emotion/react',
  '@emotion/styled']` in `vite.config.js`. Hot fix if it appears; not pre-emptive.
- **A library ships only CJS and Vite's dev-mode ESM transform mishandles it.**
  Mitigation case-by-case — add to `optimizeDeps.include`. The audit didn't flag
  any in our current dep tree.
- **A unit test relies on CRA's `jest.mock` hoisting timing.** Vitest's `vi.mock`
  has the same semantics. The 19 existing tests don't mock anything per a quick
  grep, so risk is low.
- **`process.env.NODE_ENV` references in source code (2 sites in `App.js`)**.
  Vite injects `import.meta.env.MODE` (= 'development' | 'production'); BUT it
  also defines `process.env.NODE_ENV` for compatibility. We leave the two
  existing references as-is. Documented as preserved.
- **`.env.local` migration on prod** (the Pi). After the deploy, if any local
  override of `REACT_APP_API_URL` exists in the prod environment, it's silently
  dropped. We verified no such override is used (the prod client calls
  same-origin `/api`); deploy notes mention this preemptively.
- **CRA-tolerated source-level bugs caught by Vite/esbuild's strict ESM.**
  Vite's esbuild transform refuses to silently overlook constructs that CRA's
  Babel chain tolerated. First production build on this branch caught **two
  duplicate keys** in the same object literal in
  [client/src/pages/ReservationPage.js](client/src/pages/ReservationPage.js):
  `complementPaid` was set three times (lines ~938 and ~1707, both build call
  sites) — only the last assignment ever took effect; the other two were dead
  code accumulated by a prior merge that wasn't caught by review. Fix: keep one
  assignment per call site, drop the dead ones. No behaviour change (last-write
  wins applied the same value), but the cleanup is captured here because it's a
  real CRA → Vite second-order win and worth documenting for the post-mortem.

---

## 4. Architecture

### 4.1 Client (`client/`)

| Layer | File | T/C/D | Responsibility |
|---|---|---|---|
| Config | `vite.config.js` | C | Vite build + dev server config (port, proxy, output dir, sourcemap off). |
| Config | `vitest.config.js` | C | Vitest config (jsdom env, globals on, setupFiles). |
| Config | `index.html` (was `public/index.html`) | T (moved) | Vite-style entry. `%PUBLIC_URL%` removed, `<script type="module" src="/src/index.js">` added. |
| Config | `package.json` | T | Remove `react-scripts`, add `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, drop `proxy`, `browserslist`, `eslintConfig`. Scripts: `start` → `vite`, `build` → `vite build`, `test` → `vitest run`. |
| Config | `.eslintrc.js` (optional) | C | If we want a basic lint, otherwise omit. |
| Source | `src/api.js` | T | One-line env var rename. |
| Source | (optional) `src/setupTests.js` | C | `import '@testing-library/jest-dom'` if needed. |
| Tests | `src/**/__tests__/*.test.js` | — | **Unchanged contents.** Run under Vitest via globals. |

### 4.2 Root + ops

| Layer | File | T/C/D | Responsibility |
|---|---|---|---|
| Build script | `release.sh` | T | `client/build` → `client/dist` (4 sites). |
| CI | `.github/workflows/deploy.yml` | T | Build step: drop `GENERATE_SOURCEMAP=false` env (now in `vite.config.js`). |
| CI | `.github/workflows/e2e.yml` | — | **Untouched.** Suite runs against Vite dev server identically. |
| Docs | `README.md` | T | 3 mentions of `client/build/` → `client/dist/`; CRA note → Vite note. |
| Docs | `CHANGELOG.md` | T | `[Unreleased] / Changed` entry. |
| Repo | `.gitignore` | T | Add `client/dist/`. |
| Spec | `specs/cra-to-vite-migration.md` | T | Status → Implemented. |

### 4.3 Server (no changes)

The server tree is untouched. The 880+ server unit tests stay green. The
`/api/*` contract is unchanged. The proxy in `vite.config.js` keeps the
client → server dev workflow identical.

### 4.4 E2E test suite (PR #110, no changes)

No spec file edit, no fixture edit, no `playwright.config.js` edit. The dev
servers behave identically from Playwright's perspective (same ports, same
proxy, same cookie scoping, same auth).

---

## 5. Data model

No schema change. The DB is untouched.

## 6. UI / UX

No user-visible UI change. The migration must be **invisible** to the operator —
same screens, same forms, same flows. The only observable consequence is faster
dev server startup (CRA's ~30 s webpack boot → Vite's ~3 s) and faster HMR.

### 6.1 Performance budget

- Dev server boot: < 5 s (was ~30 s on CRA).
- Production build: < 30 s on the GitHub-hosted runner (was ~40 s).
- E2E suite wall time: ~18 s, unchanged.
- Bundle size: monitored but not budgeted in this PR. Vite typically produces
  a 5–15 % smaller bundle than CRA for the same source — accepted as a side
  benefit, not a contractual requirement.

### 6.2 Production deployment notes

- The first deploy after the migration produces `client/dist/` instead of
  `client/build/`. `release.sh`'s pre-existing rebuild logic handles this; the
  Pi deploy doesn't keep state from prior deploys (per the PM2 deploy script).
- No `.env.local` rename needed on the Pi (verified: no `REACT_APP_*` override
  in the current prod env). If a future env override is added, it must be
  `VITE_*` prefixed.

---

## 7. Test plan

### 7.1 Acceptance criteria — all must pass before merging

- [ ] `cd client && npm run dev` boots in under 5 s, no errors.
- [ ] `cd client && npm run build` produces `client/dist/` with valid HTML +
      bundled JS/CSS, no sourcemap files (`.map`).
- [ ] `cd client && npm test` runs all 19 unit tests under Vitest — all green.
- [ ] **`npm run test:e2e` from the root produces 18 passed / 1 skipped /
      0 failed** (identical to V02.01.00). This is the primary acceptance
      gate.
- [ ] `cd server && npm test` is green (server untouched but worth confirming).
- [ ] `npm audit` on the client: total vulnerabilities drops to ≤ 10 (target
      ~5). Document the residual list in the CHANGELOG.
- [ ] CI workflow `.github/workflows/e2e.yml` turns green on this PR (the PR
      is its own smoke test).
- [ ] `.github/workflows/deploy.yml` build step succeeds on the runner (run
      a workflow_dispatch dry-run before merging, optional).

### 7.2 Manual smoke after a real deploy

- [ ] Trigger a `release` push, watch the deploy log: build succeeds, PM2
      restarts, `https://<your-app>.<your-domain>` loads.
- [ ] Login + Dashboard renders, no console errors.
- [ ] Create a test reservation, see it on the Planning page.
- [ ] Open a devis, download the PDF.
- [ ] Trigger an iCal sync (or wait for the auto-sync), check the Dashboard
      cards.
- [ ] Mobile (xs): open on an actual phone, sidebar drawer + tap targets OK.

### 7.3 Rollback path

- The pre-migration tag `V02.01.00` is on master. If anything goes wrong on
  prod, redeploy from that commit:
  ```
  git checkout V02.01.00
  git push origin V02.01.00:release
  ```
- The DB schema is unchanged → no data migration to roll back.

---

## 8. Out of scope

(See §3.8.) Summary: React 19, MUI 9, react-router 7, TypeScript, PWA, cross-browser
E2E. Each is its own project.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: ESLint at build time or out-of-band?
  - A: Out-of-band (Choice A in §3.4 rule 17). No `vite-plugin-eslint`. Adrien
    can run `npm run lint` manually if needed.
- Q: Browser targets — keep `browserslist` block?
  - A: Drop it. Vite's default `build.target = 'modules'` (ESM-capable browsers)
    is appropriate for the GuestFlow use case (laptop + recent mobile).
- Q: Migrate the 19 tests in this PR or follow-up?
  - A: This PR. They're coupled to the test runner; splitting leaves an awkward
    state where `npm test` fails between PRs.
- Q: Keep the `client/build/` line in `.gitignore` for safety, or replace it?
  - A: Keep BOTH `build/` and `dist/` — `build/` is a no-op safeguard if anyone
    accidentally runs the old script via a stale install.
