# Performance on inte/plugins — what is the shadow, what is the code, and the fixes

| Field | Value |
|---|---|
| **Status** | Implemented |
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
   caller continues, so one mutating its list cannot change another's). Any write empties the table when it starts and again when it settles, so
   a read started after a write never joins a read started before it commits. A failed read rejects every
   caller and is not remembered. Measured on the production-build shadow: one request fewer on every
   page (the shell and a page both read `/system/version`; `/properties` on its own page).
9. **One « count + word » helper.** (Added 2026-10-28.) `plural(n, word)` lives in
   `utils/formatters.js`; the three identical private copies (`FinancePage`, `FinanceDetailPanel`,
   `EmailTextsSettingsPage`) are removed.
10. **A page's chunk starts before the router asks for it.** (Added 2026-10-28, decision of the
    coordinator after the lazy routes measured slower on the home.) `lazyPage(loader)` returns a component
    with `.preload()`: one memoised import shared by the boot, the idle prefetch and `React.lazy`; a
    failed preload is forgotten so the navigation can retry. `App.jsx` calls `preloadRoute(PAGE_ROUTES,
    location.pathname)` when it is evaluated, in parallel with `/auth/me`, and, once the shell is
    mounted, `prefetchOnIdle` imports the main pages (home, planning, calendar, reservation, clients,
    emails, devis; not finance nor the settings) one idle slot at a time (`requestIdleCallback`, a
    1.5 s timer without it), never when `navigator.connection.saveData` is set. A page whose chunk is
    already loaded renders at once: going through `React.lazy` again suspends once more, and React
    holds back a boundary that showed a fallback for 300 ms, which was the whole slowness measured.
11. **The email timeline carries no template body.** `GET /api/email-templates?view=timeline` drops
    `body` and `bodyEn` (after `hasEnglish` is computed from them); the editor of Emails › Modèles reads
    both with `GET /:id` when it opens, shows a skeleton, keeps « Enregistrer » disabled until they are
    read (an empty body is never saved over a real one) and offers « Réessayer » when the read fails (it re-reads the two bodies only; what was typed stays).
    The plain list and `GET /:id` keep their full rows.
12. **« Réservations à venir » answers what its cards render.** `GET /api/reservations/upcoming` maps
    each stay to the fields `ReservationCard` and the page read (`CARD_FIELDS`, field by field), its
    options as `{ title, billedUnits, quantity }` and its resources as `{ name, billedUnits, quantity }`.
    The grouping, the counts and `?day=` are unchanged. The only caller is the page (no plugin, no SDK
    surface), so there is no `view` switch to keep the old shape.
13. **The side menu reads the properties once.** `App.jsx` read `/properties` at every pathname or query
    change; it now reads once and again on the data-changed event every successful write dispatches.
14. **The fiche reads the property's `stay` view.** `GET /api/properties/:id?view=stay` is the detail
    without `pricingRules` (about 60 % of it: 127 of 212 kB on the shadow), which only the tariff pages
    render; the reservation fiche asks for it. The default answer is unchanged.
15. **The fiche reads nothing it does not show.** The option catalogue it fetched as a fallback for a
    payload that "predates" the property's own options (always present) is gone, and the client list
    (all clients, 29 kB here, growing with the business) is read only when the client search is shown
    (a new stay, « changer » on an existing one, or an existing stay whose client lookup failed); an
    existing stay shows its client from `GET /clients/:id`.
16. **The email pickers carry no body.** `GET /api/email-templates?view=picker` is the list, in stay
    order, without `body` and `bodyEn`; the history filter and the send and compose dialogs use it.
17. **A computation is not a write.** (Added 2026-10-28, review finding.) The POSTs that only compute or
    preview (`calculatePrice`, `suggestBeds`, `computePlatformCommission`, `previewMidStayNote`,
    `previewTerms`, `previewEmailDraft`, `previewProgressivePricing`, `describeTemplateWhen`,
    `parseClientContact`, `detectSmtp`) are sent `readOnly: true`: they do not announce a data change
    (the side menu re-read `/properties` on every price calculation of the fiche) and do not reset the
    in-flight table of rule 8.
18. **The reload guard is per route.** The `sessionStorage` flag of rule 2 holds the route whose chunk
    failed and was reloaded once; it is cleared only when THAT route renders, never by a preload or an
    idle prefetch of another page. A chunk answered with `index.html` (what the SPA fallback sends for a
    missing asset) therefore reloads once, then shows « Page indisponible. » — before, a successful
    prefetch cleared the flag and the page reloaded in a loop (12 reloads in 5 s).
19. **The release carries no Vite manifest.** `release.sh` copies `client/dist` without `.vite/`: the
    manifest is read by the CI budget (rule 4) and is not served by production.
20. **The fiche reads its property's stays as occupancy.** (Follow-up lot, 2026-10-28, after the calendar,
    home and Planning rewrites merged.) `GET /api/reservations?propertyId=…&view=occupancy` answers
    `id, propertyId, startDate, endDate, checkInTime, checkOutTime` of each stay (what the overlap checks and
    the mini planning read) instead of the whole row (128 kB for one property on the shadow). Same rows,
    same order; reception keeps its own finance-free list; the plain list is unchanged.
21. **The stay view names group options by id.** In `GET /api/properties/:id?view=stay` the options of
    `optionGroups` (`ungrouped` and each group) are `{ id }`: the groups repeated every option in full
    (49 kB beside the 28 kB of `options`). `utils/optionGroups.js` joins them back in the fiche. The default
    detail keeps the groups whole.
22. **Planning days carry what the page renders.** `GET /api/planning/days` maps each arrival to the card
    fields of rule 12 and each departure to the fields of `DepartureMiniRow` (`DEPARTURE_FIELDS`), including
    the reception locks. `GET /api/planning/today` (5 kB) is unchanged: the home's tables read many more
    columns.
23. **The fiche reads the resource availability once.** The effect that refreshes it when the dates change
    skips the key (property, dates, excluded stay) the init has just read.
24. **The email log preview is full screen on a phone** (`EmailLogViewDialog`, CLAUDE.md §7).

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

- [x] `email-templates-timeline-lean.unit.test.js` — rules 11, 16 — **5 cases**; `upcoming-reservations-lean.unit.test.js` —
      rule 12 — **3 cases**; `property-stay-view.unit.test.js` — rule 14 — **4 cases**.
- [x] `server/src/tests/hashed-assets-cache.unit.test.js` — rule 7 — **2 cases**.

- [x] `server/src/tests/heavy-endpoints-budget.unit.test.js` — rule 5 (6 endpoints × 2 cases: same
      statement count at 20 and 2 000 reservations, time budget; plus a control that the counter sees a
      statement per reservation) — **13 cases**.

### Client Vitest (lot 5 and the preload)

- [x] `LazyPage.preload.test.jsx` — rule 10 — **7 cases**; `EmailTemplatesPage.body-on-open.test.jsx` — rule 11 — **3 cases**;
      `App.menu-properties.test.jsx` — rule 13; `ReservationPage.fiche-reads.test.jsx` — rules 14–15;
      `api.property-view.test.js` — rules 14, 16.

### Follow-up lot tests

- [x] `planning-days-lean.unit.test.js` — rules 20, 22 — **5 cases**; `property-stay-view.unit.test.js` — rule 21 (+2);
      client `optionGroups.test.js` — rule 21; `ReservationPage.fiche-reads.test.jsx` — rules 20, 23;
      `EmailLogViewDialog.full-screen.test.jsx` — rule 24.

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

Audit of the calls each main page makes (kB before → after the work of this lot) on the production build (63 reservations, 78 clients;
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

Done in this lot: rules 8 to 16. Measured on the production-build shadow (`node` + Playwright, response bodies):

| Page | calls | kB |
|---|---|---|
| `/reservations/upcoming` | 10 → 9 | **62 → 11** |
| `/emails` | 11 → 10 | **38 → 14** |
| `/emails/historique` | 10 | **44 → 18** |
| `/reservations/:id` (fiche) | 24 | **304 → 133** |
| `/calendar` | 20 → 18 | 80 → 77 |
| `/clients`, `/finance`, `/settings`, `/planning`, `/` | one call fewer each | unchanged |

### Follow-up lot, after the pages rewritten elsewhere (done 2026-10-28)

**Resolved 2026-10-28** (coordinator): done once `dashboard-planning-scroll`, `calendar-property-parity` and
`options-resources-ux` were merged, on a branch cut from `inte/plugins`. What the merged code does now, measured
on the production-build shadow (calls, kB), and what was done:

| Page | before | after | What |
|---|---|---|---|
| `/` | 17 calls, 17 kB | unchanged | the four full-row windows are gone: three `GET /calendar?from&to` of 1–2 kB each, `GET /planning/today` 5 kB |
| `/calendar` | 14 calls, 15 kB | unchanged | one `GET /calendar` per window, 1–2 kB each; the second `/properties` read is gone |
| `/planning` | 25 calls, 51 kB | **25 calls, 20 kB** | three `GET /planning/days` windows of 13–14 kB → 3 kB each (rule 22); no `GET /reservations/:id` any more |
| `/reservations/:id` | 23 calls, **244 kB** | **22 calls, 93 kB** | `GET /reservations?propertyId` 128 → 4 kB (rule 20), `GET /properties/1?view=stay` 76 → 52 kB (rule 21), availability read once (rule 23) |
| `/properties` | 8 calls, 5 kB | unchanged | no duplicate any more |
| `/options` | 10 calls, 16 kB | unchanged | the new `GET /options/catalogue-view` is 9 kB (was 26 kB on `?view=catalogue`) |

Not changed, with the reason: the home's `GET /planning/today` (5 kB) feeds tables that read most columns;
the three overlapping `GET /calendar` windows are 1–2 kB each; `GET /today` is read twice on the home (two
`useServerToday` instances, 0.1 kB); the options pages read `/properties` a second time after the shell's
(not concurrent); the server still answers `GET /options?view=catalogue` (a test covers it) although no client
screen calls it since the catalogue view replaced it.

### Bundle redundancy pass (2026-10-28)

Found, not changed: no barrel import of `@mui/icons-material` (all deep imports); the plugin bundles are
small (entry ≤ 1.8 kB gzip, 11 to 25 kB with their chunks) and bundle no React nor MUI; but **six
plugins each ship their own `createSvgIcon` chunk** (the host does not expose `@mui/material/utils`),
about 1 kB gzip each; **17 hand-built `<Dialog>`** repeat the same preamble (`useTheme` +
`useMediaQuery(down('sm'))` + title / content / actions) beside `FormDialog` and `ConfirmDialog`
(`BreakfastPrepDialog`, `ClientCleanupDialog`, `MidStayNoteDialog`, `RefundDialog`, the two Laundry dialogs,
`TariffRecipeCard`, `BackupCodesDialog`, `UpdateDialog`, `ArchivedHtmlDialog`, `EmailLogViewDialog`…): a
generic read-only `ViewDialog` and moving the form-shaped ones onto `FormDialog` would remove them, at
the price of a visual check of each; `EmailLogViewDialog` is the one that misses the phone full-screen
rule of CLAUDE.md §7. Small helpers duplicated and now shared: `plural` (rule 9). Left for a lot of
their own: they are UI refactors, not measurable payload or bundle gains.

## 9. Open questions

- Q1 — **Resolved 2026-10-28:** the shadow runs the production build by default; `--dev` on demand.
- Q2 — **Resolved 2026-10-28:** lazy routes (rules 2–3) are in this spec, as their own lot (lot 3). After the measurement of §11 Adrien decided, the same day, to **keep them**: the bytes parsed on a phone are the production gain.
- Q3 — **Resolved 2026-10-28:** the bundle budget is blocking in CI, with 10 % headroom.

## 10. Implementation (ordered lots, each shippable)

1. **Lot 1 — email texts page** (guest-email-texts rules 50–52): 1 page, 1 new test file, existing
   suites adjusted. Biggest measured gain on a real page.
2. **Lot 2 — shadow on a build** (rule 1, 6): `scripts/start-shadow.mjs` + test + README +
   `e2e/perf/measure-pages.mjs`. Biggest gain for what Adrien feels.
3. **Lot 3 — lazy routes** (rules 2–3): `LazyPage.jsx`, `App.jsx`, test, both E2E suites.
4. **Lot 4 — guards** (rules 4–5): budget script + CI step + manifest, server budget test.

## 11. Implementation progress (2026-10-28)

- [x] Lot 1 — email texts page (guest-email-texts rules 50–52): `29c25079`.
- [x] Lot 2 — shadow on a build, measurement tool (rules 1, 6): `b5e805fe`.
- [x] Lot 3 — lazy routes (rules 2–3): `1e6ac20c`.
- [x] Lot 4 — guards (rules 4–5): `c5c3f852`.
- [x] Rule 7 (immutable hashed assets), added because lot 3 multiplies the files of a first load: `e04d95a0`.
- [x] Follow-up lot (rules 20–24, branch `feature/inte-performance-windows`).
- [x] Lot 5 — widening: rules 8–16 and the page-by-page audit of §8b (`7cce4826`, `7a5b4350`, `993bc84f`, the lean-reads commits).

Tests: server 6 874 + 2 (`hashed-assets`) green; client 2 287; spec coverage green. The three
statement/budget/shadow suites run inside `npm test` of the server.

### Measured (same Mac, production build, headless Chromium, `measure-pages.mjs`)

The machine was heavily loaded by parallel agents during every measurement (load average 40 to 125),
so absolute times are 2 to 4 times those of §1.2 and only interleaved comparisons mean anything.

- Initial JavaScript (gzip): **637 kB → 284.9 kB** (rule 2), 286.6 kB with rule 8; budget 313.3 kB.
  The pages are now separate chunks: `FinancePage` 128 kB, `ReservationPage` 60 kB, `PropertyDetail` 14 kB,
  `CalendarPage` 10 kB, `Dashboard` 10 kB, `EmailTextsSettingsPage` 8 kB.
- Script files of a first load: 29 → 87 on `/` (the pages and their shared chunks are separate files);
  rule 7 makes a repeat load revalidate none of them.
- Settled time, interleaved pre-lazy build vs lazy build, `--cpu 1`, 5 runs, 3 rounds. Lazy routes
  alone (rule 2): `/` 180–320 → 560–710 ms, `/clients` 210–290 → 480–550 ms. After rule 10 (boot preload
  of the URL's chunk, no re-suspension of a loaded page, idle prefetch): `/` 258–290 → **323–339**,
  `/emails` 398–415 → **386–412**, `/calendar` 383–418 → **373–400**, `/clients` 201–232 → **290–310** ms.
  Equal on the pages that do real work, ~+40 to +90 ms on the two lightest ones (one more round of chunk
  evaluation); the bytes parsed on a first visit are 637 → 285 kB gzip. The 300 ms that rule 2 added was
  React's fallback throttling, not the network. The machine was still loaded (load average 50 to 200).
- Email texts page: idle 670 ms (§1.2, quiet machine) → 480 ms under load, 40 inputs mounted at open
  (136 before), first preview requested at once (rule 50).
- `/emails`, `/settings/plateformes` unchanged in code: any change in their figures is noise.
