# Performance on inte/plugins — what is the shadow, what is the code, and the fixes

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/inte-performance` (from `inte/plugins` 714ed5e4) |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Amends** | [`specs/guest-email-texts-made-simple.md`](guest-email-texts-made-simple.md) rules 50–52 (the email texts page) |
| **Summary for review** | [`docs/specs/2026-10-28-inte-performance.html`](../docs/specs/2026-10-28-inte-performance.html) |

---

## 1. Context

Feedback of 2026-10-28 on the `inte/plugins` shadow (prod copy of 2026-10-22): « l'application est
vraiment beaucoup plus lente […] L'ouverture de la page de modifications d'emails est hyper longue […]
L'ouverture de la page Plateforme est très longue ». The question: is it the shadow or the code?

### 1.1 How the shadow runs

`shadows/guestflow-shadow-inte/start.sh` (outside the repository) starts the server with
`NODE_ENV=development GUESTFLOW_PLUGINS=sources` and the client with **the Vite dev server**
(`npx vite`). Production runs neither: it serves `client/dist` (one minified bundle + plugin bundles)
with `GUESTFLOW_PLUGINS=packages`.

### 1.2 Measurements (2026-10-28, same Mac, same DB copy, headless Chromium)

Four builds on the same copy of the shadow database (63 reservations, 78 clients):

- **inte-dev** — what Adrien used: Vite dev server + `sources`;
- **inte-prod** — `inte/plugins` 714ed5e4 built (`vite build` + `scripts/build-plugin-packages.mjs`),
  served by its server in `packages` mode;
- **master-prod** — `origin/master` 03877f2f built and served the same way (what production runs);
- **master-dev** — `origin/master` on the Vite dev server.

Time = full page load until the content stops changing (no spinner, no DOM change for 1 s), median of 3.
« ×4 » = Chromium CPU throttling 4×, standing for a busy Mac or a mid-range phone.

| Page | inte-dev | inte-prod | master-prod | master-dev |
|---|---|---|---|---|
| `/` tableau de bord | 325 ms · ×4 1 489 | 130 · ×4 353 | 142 · ×4 346 | 300 · ×4 1 162 |
| `/emails` | 382 · ×4 728 | 64 · ×4 215 | 106 · ×4 188 | 373 · ×4 646 |
| `/settings/plateformes` | 488 · ×4 1 021 | 115 · ×4 255 | 113 · ×4 235 | 530 · ×4 811 |
| `/calendar` | 415 · ×4 1 249 | 87 · ×4 303 | 124 · ×4 301 | 401 · ×4 958 |
| `/settings/emails/textes` (inte only) | 831 · ×4 2 596 | **670 · ×4 1 150** | — | — |

Other facts measured:

- **The server is not the cause.** Every API call these pages make answers in 1–3 ms on both inte and
  master (`/email-templates?view=timeline` 1.4 ms / 33 kB, `/emails/pending` 1.6 ms,
  `/platforms/settings` 1.5 ms / 2.6 kB, `/email-texts` 2.3 ms / 51 kB, `/email-readiness` 2.8 ms,
  `POST /emails/preview` 8–14 ms). The slowest of the sweep is `/dashboard/attention` at 13 ms (it
  runs 11 card handlers). Same numbers in `sources` and `packages` mode.
- **Dev mode costs ×3 to ×6 on every page.** A full load in dev fetches **481 unbundled modules**
  (9–26 MB with inline source maps; WebKit re-downloads them on every reload), versus 27 files in
  production. React runs its development build. inte-dev is 20–30 % heavier than master-dev under
  load (874 client source files vs 505).
- **No regression from inte/plugins on `/emails` and `/settings/plateformes`:** inte-prod equals
  master-prod (64 vs 106 ms; 115 vs 113 ms). Both pages are slow **only in dev mode**.
- **The email texts page is genuinely slow, in production too** (670 ms idle, 1.15 s ×4). It is new in
  inte (master edits emails in a dialog). Two causes, both in
  [EmailTextsSettingsPage.jsx](../client/src/pages/settings/EmailTextsSettingsPage.jsx):
  1. **The first preview waits for a typing debounce.** The preview effect
     ([:154–178](../client/src/pages/settings/EmailTextsSettingsPage.jsx#L154)) always waits
     `PREVIEW_DELAY_MS = 400` ([:51](../client/src/pages/settings/EmailTextsSettingsPage.jsx#L51))
     before `POST /emails/preview`, even when nothing was typed. Measured: the request leaves at
     522 ms, answers at 563 ms. From a click on an email in Emails › Modèles to its rendered preview:
     598 ms, of which 400 ms is waiting.
  2. **Every section's fields are mounted, folded or not.** The seven `<Accordion>`
     ([:466](../client/src/pages/settings/EmailTextsSettingsPage.jsx#L466)) keep their details
     mounted: 65 `TokenTextField` (136 inputs, 1 590 DOM nodes) render on load and re-render on every
     keystroke, for one section shown. Mount long task: 80 ms prod, 233 ms dev.
  3. Side bug found on the way: each folded section's « Email » `<Select>` takes the **open** section's
     template id (`value={templateId || ''}`, [:490](../client/src/pages/settings/EmailTextsSettingsPage.jsx#L490)),
     out of its own options — 6 MUI « out-of-range value » warnings per render, all present in the
     shadow's `vite.log` at 08:17 and 08:19, the moments Adrien opened the page.
- **Prototype of fixes 1 + 2 measured** (scratch copy of inte, prod build): `/settings/emails/textes`
  **670 → 201 ms** idle, **1 150 → 669 ms** ×4; click in Emails › Modèles → preview **598 → 154 ms**;
  inputs mounted 136 → 52, DOM nodes 1 590 → 779; accordion click p50 72 → 48 ms; keystroke p50
  24 → 16 ms.
- **No route-level code splitting.** Every page is imported eagerly in
  [App.jsx:63–97](../client/src/App.jsx#L63); the production `App` chunk is 1 468 kB (416 kB gzip) plus
  `sdk` 461 kB and `index` 255 kB. master ships one 2 216 kB chunk. Not a regression, but every page's
  code is parsed before the first one shows, on a phone too, and in dev every first load pulls all
  481 modules.

### 1.3 Verdict

The slowness Adrien felt is **mostly the shadow**: a dev server is 3–6× slower than the build he runs in
production, and much more under load. **One page is really slow in the code**: the email texts page
(400 ms of artificial waiting + all sections mounted). The Plateformes page has no code problem.

## 2. Goal

The shadow feels like production, the email texts page opens in about 0.2 s, and a future regression of
the same kind fails CI instead of reaching Adrien.

## 3. Functional rules

1. **A shadow runs the production build.** `scripts/start-shadow.mjs --db <file> --port <api>` copies
   the database, builds the client (`vite build` into a folder of the shadow) and the plugin packages,
   and starts the server with `GUESTFLOW_PLUGINS=packages`, `GUESTFLOW_CLIENT_DIR`, the mail outbox,
   `GUESTFLOW_SMTP_DETECT=off` and the dead Qonto/Neat bases. It never sets `NODE_ENV=production` (the
   outbox is off in production, `utils/mailOutbox.js:14`): it uses `NODE_ENV=test`, like
   `e2e/prod/serve.js`. One process, one port: the server serves the client. `--dev` keeps today's
   Vite dev server for a session that needs hot reload. The environment is built by a pure function
   (`shadowEnv(options)`) so it is unit-tested.
2. **Every page is loaded on demand.** Each route element of `App.jsx` is a `React.lazy` import through
   one helper `lazyPage(() => import('./pages/X'))`; the shell (app bar, menu, banners) stays eager.
   While a page's chunk loads, its place shows `LoadingState` inside the shell — the bar and the menu
   never disappear. A chunk that fails to load (a release installed while the tab was open) reloads
   the page once, then shows `ErrorAlert` « Page indisponible. » with « Recharger ».
3. **Plugin pages follow rule 2.** A plugin's route contribution is rendered through the same lazy
   boundary; the production plugin bundles are already separate files and are unchanged.
4. **The initial JavaScript has a budget, checked in CI.** `scripts/check-bundle-budget.mjs` reads the
   Vite manifest of `client/dist` and sums the gzip size of the entry, of every chunk it imports
   statically and of the chunks `index.jsx` always imports at boot (`App`, the plugin runtime) with
   their static imports — what any first page pays; the pages, dynamic imports of `App`, are not
   counted. Above the budget the CI client job (`npm run build` then the script) fails and names the
   heaviest chunks. The budget is the measurement after rule 2 plus 10 % headroom, written in the
   script with the date it was measured: **284 851 bytes gzip measured on 2026-10-28, budget
   313 336**. Before rule 2: 637 kB gzip (`index` 77 + `sdk` 144 + `App` 416). It needs
   `build.manifest: true` in `client/vite.config.js`.
5. **The heavy endpoints do not grow with the data.** On a fixture of 2 000 reservations and 1 500
   clients, `GET /api/email-texts`, `POST /api/emails/preview`, `GET /api/dashboard/attention`,
   `GET /api/platforms/settings`, `GET /api/email-templates?view=timeline` and `GET /api/emails/pending`
   run **the same number of SQL statements as on 20 reservations** (no statement per reservation,
   counted by wrapping `db.prepare(...).run/get/all`, after one warm-up call), and each answers under
   250 ms on the CI runner. The test mounts the core routers only: a plugin's own attention handler is
   not exercised.
6. **A measurement tool lives in the repository.** `e2e/perf/measure-pages.mjs <base-url>` logs in with
   the dev test account (`GUESTFLOW_PERF_EMAIL` / `GUESTFLOW_PERF_PASSWORD`; the password is never in
   the repository) and prints, per page, the time to settled content, the number of requests and
   script files, the API calls and long tasks, with optional CPU throttling (`--cpu 4`). It is a
   tool, not a gate.
   > **Sans test** — a measurement script; its numbers depend on the machine. Rules 4, 5 and
   > guest-email-texts rules 50–52 are the gates.
7. **Hashed assets are cached for good.** (Added during implementation, 2026-10-28.) The server serves
   `assets/` of the client build with `Cache-Control: public, max-age=31536000, immutable`
   (`middleware/hashedAssets.js`, mounted before the static folder); `index.html` keeps `max-age=0`.
   Vite names every file there after its content, so a changed file is a new URL. Without it, the
   browser revalidated each of the 29 files of a page at every load, and the ~60 files rule 2 adds to
   a first load would have been 60 more conditional requests.
8. **Identical reads in flight are one request.** (Added 2026-10-28, widening decision below.) In
   `client/src/api.js`, GET requests for the same path started while one is in flight share it: the
   first caller gets the parsed body, each other a `structuredClone` of it (all copies made before any
   caller continues, so one mutating its list cannot change another's). Any write empties the table, so
   a read started after a write never joins a read started before it. A failed read rejects every
   caller and is not remembered. Measured on the production-build shadow: one request fewer on every
   page (the shell and a page both read `/system/version`; `/properties` on its own page).
9. **One « count + word » helper.** (Added 2026-10-28.) `plural(n, word)` lives in
   `utils/formatters.js`; the three identical private copies (`FinancePage`, `FinanceDetailPanel`,
   `EmailTextsSettingsPage`) are removed.

**Edge cases:**

- A lazy chunk of a plugin page fails the same way (the boundary recognises the browser's « failed to
  fetch dynamically imported module » in Chromium, Safari and Firefox wording); any other error thrown
  by a page is not a chunk failure and reaches the app's error boundary untouched.
- A lazy chunk fails because the release changed under an open tab → one automatic reload (guarded by a
  `sessionStorage` flag so it cannot loop), then the error state of rule 2.
- `--dev` on a shadow → today's behaviour, and the script prints that the shadow is not representative
  of production speed.
- A shadow started while another uses the same port → the script stops before copying anything.

---

## 4. Architecture

> **Fat backend, thin frontend.** No logic moves. The client changes are about *when* code and
> components are loaded and mounted, not what they compute.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | — | — | (none — rule 5 measures them; a statement found per reservation is fixed in the controller it lives in) |
| `models/` | — | — | (none) |
| `middleware/` | `hashedAssets.js` | C | Rule 7: static handler of the build's `assets/` folder, one-year immutable cache |
| `utils/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none) |
| `index.js` | `index.js` | T | Mounts `hashedAssets` on `/assets` before the static client folder (rule 7) |
| `tests/` | `heavy-endpoints-budget.unit.test.js` | C | Rule 5: seeds 20 then 2 000 reservations, counts statements per endpoint, asserts equal counts and the time budget |
| `tests/helpers/` | `statementCounter.js` | C | Wraps `db.prepare` to count executed statements during one request (test-only) |
| `tests/` | `hashed-assets-cache.unit.test.js` | C | Rule 7: `assets/` is immutable for a year, `index.html` is not, a missing asset is a 404 |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `settings/EmailTextsSettingsPage.jsx` | T | guest-email-texts rules 50–52: first preview without debounce, folded sections unmounted, each section's selector on its own email |
| `components/` | `ErrorAlert.jsx` | T | `retryLabel` prop (« Recharger » for a failed chunk; default « Réessayer » unchanged) |
| `components/` | `LazyPage.jsx` | C | `lazyPage(loader)` + its `Suspense`/error boundary: `LoadingState` while loading, one reload then `ErrorAlert` on a failed chunk (rule 2) |
| `App.jsx` | `App.jsx` | T | Page imports become `lazyPage(...)` (rule 2); plugin routes go through the same boundary (rule 3) |
| `hooks/` | — | — | (none) |
| `services/` / `api.js` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `LoadingState`, `ErrorAlert`, `Accordion` (MUI) | `LoadingState`/`ErrorAlert` are the shared states of the design system; `ErrorAlert` gains a `retryLabel` prop. |
| **Created (new generic)** | `LazyPage` (`lazyPage` helper) | Every route of the core and of the plugins uses it; nothing page-specific in it. |
| **Specific (kept feature-local)** | — | — |

### 4.3 Repository tooling

| File | T/C | Responsibility |
|---|---|---|
| `scripts/start-shadow.mjs` | C | Rule 1: copy DB, build client + plugin packages, start the server serving them; `--dev` for Vite |
| `server/src/tests/start-shadow.unit.test.js` | C | Rule 1 (the repository's script tests live with the server suite, like `release-notes-digest.unit.test.js`): `shadowEnv()` sets `packages`, the client dir, the outbox, the dead bases, never `NODE_ENV=production`; `--dev` sets `sources` |
| `scripts/check-bundle-budget.mjs` | C | Rule 4: manifest → static import graph of the entry → gzip sum → pass/fail with the chunk list |
| `server/src/tests/bundle-budget.unit.test.js` | C | Rule 4 on a fixture manifest: under budget passes, over budget fails and names the chunks, dynamic imports are not counted |
| `client/vite.config.js` | T | `build.manifest: true` so rule 4 can read the graph |
| `.github/workflows/unit-tests.yml` | T | Client job: `npm run build` then `node scripts/check-bundle-budget.mjs` |
| `e2e/perf/measure-pages.mjs` | C | Rule 6: the measurement used in this spec, kept |
| `README.md` | T | « Shadow » paragraph: `node scripts/start-shadow.mjs` |

### 4.4 API contract

No endpoint changes. Rule 5 asserts on the existing contracts.

---

## 5. Data model

None. No migration.

## 6. UI / UX

No screen changes beyond loading states.

- **Page change (rule 2):** the app bar, the menu and `PageActionBar` of the shell stay; the page area
  shows `LoadingState` only if the chunk takes more than ~150 ms (in production on localhost it never
  shows; on a slow phone network it does). Same on mobile.
- **Failed chunk:** `ErrorAlert` « Page indisponible. » + « Recharger ».
- **Email texts page:** see guest-email-texts rules 50–52. The preview pane's existing loading state
  shows for ~40 ms on open instead of 400 ms; nothing else visible changes. Mobile: the « Voir
  l'email » sheet opens on the same immediate preview.

## 7. Test plan

### Server unit tests

- [x] `server/src/tests/hashed-assets-cache.unit.test.js` — rule 7 — **2 cases**.

- [x] `server/src/tests/heavy-endpoints-budget.unit.test.js` — rule 5 (6 endpoints × 2 cases: same
      statement count at 20 and 2 000 reservations, time budget; plus a control that the counter sees a
      statement per reservation) — **13 cases**.

### Script tests (in the server suite, importing `scripts/*.mjs`)

- [x] `server/src/tests/start-shadow.unit.test.js` — rule 1 (packages env, never production, outbox + dead bases,
      `--dev`, port taken) — **5 cases**.
- [x] `server/src/tests/bundle-budget.unit.test.js` — rule 4 (boot chain counted once, page chunk
      ignored, under/over, CLI without manifest and over budget naming the chunks) — **4 cases**.

### Client Vitest

- [x] `client/src/components/__tests__/LazyPage.loading.test.jsx` — rules 2–3 (fallback inside the
      shell after 150 ms, page shown on resolve, one reload on chunk error, `ErrorAlert` + « Recharger »
      the second time, flag cleared on success, plugin route through the boundary and reloading once, a
      render crash is not a chunk failure) — **7 cases**.
- [x] `client/src/pages/settings/__tests__/EmailTextsSettingsPage.performance.test.jsx` —
      guest-email-texts rules 50–52 (see that spec) — **6 cases**.
- [x] Existing `EmailTextsSettingsPage.*.test.jsx` suites re-run: only the rule 25 test changed (the
      « Phrases non utilisées » fold is now unmounted, not hidden).

### E2E

- [ ] `npm run test:e2e` and `npm run test:e2e:prod` green: every page still opens through the lazy
      routes, on the dev server and on the production build.

### Manual verification (with the measurement tool, rule 6)

- [ ] On a shadow started by `scripts/start-shadow.mjs`: the pages of §1.2 within 20 % of the
      inte-prod column.
- [ ] `/settings/emails/textes` ≤ 250 ms idle, ≤ 750 ms at `--cpu 4`; Emails › Modèles → preview
      ≤ 250 ms.
- [x] **Mobile (390 px, `--cpu 4`)**: the email texts page opens a section and its « Voir l'email »
      sheet with the preview; a page change shows the bar and menu throughout.
- [ ] Regression: rule 45 (a click on a sentence of the preview opens its field in a folded section),
      dirty guard on leaving the texts page.

## 8. Out of scope

- The duplicated `GET /api/system/version` on each load (two `useAppUpdate` users): 1 ms, measured,
  not worth a change now.
- The 9 shell calls on every full load (`/auth/me`, `/settings`, `/properties`…): 1 ms each, parallel.
- Server caching: nothing measured justifies it (every endpoint ≤ 14 ms).
- `TokenTextField` memoisation: after rule 51 typing is at 16 ms p50; revisit only if a measurement
  says so.
- Changing production hosting (compression, HTTP/2): production loads in 130 ms on the LAN.

## 8b. Widening of 2026-10-28 (lot 5)

**Resolved 2026-10-28** (Adrien, via the coordinator): the slowness is general; only optimisations that
show in PRODUCTION count. Three axes, behaviour-neutral, measured on a production-build shadow, leaving
the pages other branches are rewriting (`Dashboard`, `PlanningPage`, `CalendarPage`) untouched.

Audit of the calls each main page makes on the production build (63 reservations, 78 clients;
`node` + Playwright, responses counted when fully read):

| Page | calls | kB | Finding |
|---|---|---|---|
| `/` | 22 → 21 | 109 | four overlapping `GET /reservations?from&to` windows (34 + 28 + 19 + 11 kB), full rows |
| `/calendar` | 20 → 19 | 80 → 79 | the same windows; `GET /properties` twice |
| `/planning` | 22 → 21 | 35 | `GET /reservations/:id` 22 kB for one stay |
| `/reservations/upcoming` | 10 → 9 | 62 | 57 kB: every stay in full (≈ 5.8 kB each, ~60 columns), cards read a few |
| `/clients` | 10 → 9 | 17 → 16 | none |
| `/finance` | 11 → 10 | 20 → 19 | none |
| `/settings` | 10 → 9 | 6 | none |
| `/emails` | 11 | 38 | timeline carries each template's FR + EN body (≈ 20 of 33 kB) the list does not show |

Done in this lot: rule 8 (every page: one call fewer) and rule 9. **Not done, noted for their owners
or for a decision**: trimming `reservations` rows to the columns the calendar/dashboard/cards render
(`Dashboard`, `CalendarPage`, `PlanningPage` are being rewritten by other branches; the upcoming cards
and the email timeline need a field-by-field audit of what their dialogs read: a trimmed payload is a
contract change to be done with that page, not beside it), the `/properties` re-read at ~350 ms on the
properties and calendar pages, and virtualisation (no list measured as costly: ≤ 63 stays here).
Bundle: no duplicated feature found beyond the helper of rule 9; the heaviest chunks are third-party
(`FinancePage` 128 kB gzip = Recharts, now loaded only on the finance pages; MUI core 108 kB).

## 9. Open questions

- Q1 — **Resolved 2026-10-28:** the shadow runs the production build by default; `--dev` on demand.
- Q2 — **Resolved 2026-10-28:** lazy routes (rules 2–3) are in this spec, as their own lot (lot 3).
- Q3 — **Resolved 2026-10-28:** the bundle budget is blocking in CI, with 10 % headroom.

## 10. Implementation (ordered lots, each shippable)

1. **Lot 1 — email texts page** (guest-email-texts rules 50–52): 1 page, 1 new test file, existing
   suites adjusted. Biggest measured gain on a real page.
2. **Lot 2 — shadow on a build** (rule 1, 6): `scripts/start-shadow.mjs` + test + README +
   `e2e/perf/measure-pages.mjs`. Biggest gain for what Adrien feels.
3. **Lot 3 — lazy routes** (rules 2–3): `LazyPage.jsx`, `App.jsx`, test, both E2E suites.
4. **Lot 4 — guards** (rules 4–5): budget script + CI step + manifest, server budget test.
