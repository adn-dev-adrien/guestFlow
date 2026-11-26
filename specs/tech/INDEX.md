# Tech — build and test tooling, schema baseline, spec tooling, backend/client structure, performance

Start with: `spec-rule-coverage` (how rule numbers, citations and the CI gate work). See also: `hosting/`, `design-system/`.

- `spec-rule-coverage` — a spec rule is a numbered §3 entry; tests cite `specs/<name>.md rule N`; CI refuses added rules without citation or `Sans test`. Code: `scripts/check-spec-coverage.mjs`, `server/src/tests/spec-rule-coverage-draft.unit.test.js`.
- `server-test-isolation` — one DB per test process, fixed Paris zone, per-file caps, 2 server shards and 3 client shards, `--test-concurrency=4`. Code: `server/src/tests/setup/isolateDefaultDb.js`, `scripts/test-runner/run-test-shard.mjs`, `.github/workflows/unit-tests.yml`.
- `e2e-playwright-smoke-suite` — Playwright suite on an ephemeral DB with Vite dev client; global-state specs in serialised projects; servers reach no outside service. Code: `playwright.config.js`, `e2e/projects.js`, `e2e/specs`.
- `migrations-baseline` — `schema.sql` is the schema's source of truth, replayed at every boot; new columns go there plus a guarded migration for existing rows. Code: `server/src/schema.sql`, `server/src/database.js`.
- `db-hygiene-quick-wins` — idempotent FK indexes, unique indexes on resource bookings and iCal sources with duplicate pre-check, legacy `resources.propertyId` drop. Code: `server/src/utils/dbHygiene.js`.
- `vite-8-oxc-migration` — every file containing JSX must be named `.jsx` (Vite 8 decides JSX by extension); dev port 3000, `/api` + `/uploads` proxy, `dist` output unchanged. Code: `client/vite.config.js`, `client/vitest.config.js`.
- `express-5-upgrade` — global JSON error middleware; unreadable bodies are 400/413/415 and bad path params 404, never logged as crashes, public envelope under `/public/`. Code: `server/src/index.js`, `server/src/utils/bodyParserRefusal.js`.
- `inte-performance` — lazy routes with idle prefetch, gzip bundle budget in CI, coalesced identical GETs, slim `view=` payloads, immutable hashed assets, production-build shadow. Code: `client/src/App.jsx`, `scripts/check-bundle-budget.mjs`, `scripts/start-shadow.mjs`.
- `reservations-backend-mvc` — reservation routes thin, logic in controller/model/utils (pricing snapshot, occupancy, history, beds), behaviour-preserving. Code: `server/src/controllers/reservationsController.js`, `server/src/models/reservationsModel.js`, `server/src/routes/reservations.js`.
- `pricing-summary-extraction` — `PricingSummary` renders the server quote (live or stored mode, `topNotice`); offer toggles via callbacks, display toggles local. Code: `client/src/components/PricingSummary.jsx`.
- `calendar-page-decomposition` — CalendarPage split into utils, infinite-month hook and cell/grid/note components; holidays computed server-side; labels fit and read right. Code: `client/src/pages/CalendarPage.jsx`, `client/src/utils/calendarVisuals.js`, `client/src/hooks/useInfiniteMonthScroll.js`.
