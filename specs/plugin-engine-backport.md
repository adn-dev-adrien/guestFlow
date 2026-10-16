# Minimal plugin engine on master — to ship two plugins without the plugins branch

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugin-engine-backport` → **`master`** |
| **Created** | 2026-10-15 |
| **Author** | Adrien |
| **Related PR** | — |
| **Decision page** | [docs/specs/2026-10-15-plugin-engine-backport.html](../docs/specs/2026-10-15-plugin-engine-backport.html) |
| **Ships with** | `gites-de-france-intake` (spec `gites-de-france-mail-intake.md`, built on `inte/plugins`, PR #683); `booking-intake` follows in its own PR (spec `booking-extranet-intake.md`) |

---

## 1. Context

The plugin engine (loader, SDK context, slots, per-database plugin state) lives only on
`inte/plugins`, together with months of refactoring meant to make GuestFlow generic (subscriptions,
control plane, roles, features moved out of the core). That branch is risky and will be tested at
length before it reaches production. `master`, and therefore production, has no plugin engine.

Two integrations are wanted in production **now** and independently of that branch: the Gîtes de
France mail intake (already written and merged on `inte/plugins`, #683) and a Booking.com intake. Both
are plugins (not in a base installation), so they need the engine.

Measured on 2026-10-15 (`origin/master` 3a5782d8 vs `origin/inte/plugins`): the strictly necessary part
of the engine is ~20 server files (~1,320 lines, 1,075 of them copied unchanged) and ~8 client files
(~190 lines); `master`'s wiring points (`index.js`, `database.js`, `ReservationPage`, `Dashboard`,
`IntegrationsSettingsPage`, `reservationsController`) have not moved since the common base, and nothing
else of the branch is needed.

## 2. Goal

Production gets the two plugins, off by default, switchable from the Réglages, while the plugins
branch stays untouched; when that branch finally merges into `master`, the overlap resolves by taking
its version of each file.

## 3. Functional rules

1. **Scope — the engine and nothing else.** Only the files of §4 come over: loader, SDK context,
   registry, migrations, settings storage, the `requirePlugin` guard, the client slot registry, the
   four slots the two plugins use. Not taken: the Plugins page, `licence`, `enforceSubscription`,
   role access, events wiring (`reservation.*`), payment/quote/price-line/SAS/e-mail hooks, and the
   other eleven plugins of the branch. The catalogue lists the plugins shipped on `master` only (Gîtes de France in this PR; Booking joins it in its own).
2. **Same names, same signatures.** Files are copied from `origin/inte/plugins` with
   `git checkout origin/inte/plugins -- <path>` wherever possible, so that a later merge sees identical
   content. Every deviation (trimmed file, 2-line patch) is listed in §4 and resolves by taking the
   branch's version.
   > **Sans test** — a method of work (how files are copied), not behaviour: nothing to assert.
3. **Seeded installed but inactive.** At boot, the two plugin ids get a `plugins` row with
   `enabled = 0` (`INSERT OR IGNORE`), recorded in its own ledger entry `plugins_backport_seed_v1`.
   The branch's `seedBuiltinPlugins` and its ledger `plugins_builtin_seed_v1` are **never** called on
   `master`: calling it would make the later full merge skip seeding the other plugins on existing
   databases.
4. **Inactive means absent.** A plugin with `enabled = 0` (or without a row): every route it mounts
   answers `404 { error: 'PLUGIN_INACTIVE' }`, its jobs do not tick, its slots render nothing
   (`user.enabledPlugins` excludes it), no table of its own is read.
5. **Activation.** `GET /api/plugins` (admin) lists the two plugins with their state;
   `POST /api/plugins/:id/activate` and `/deactivate` flip it. Admin only; unknown id → 404.
6. **Plugin routes sit behind the core guards.** They are mounted after `requireAuth` and
   `enforceRoleAccess`, so they are admin-only by default. A public mount (`ctx.mount(path, router,
   { public: true })`, path under `/public/`, not `/public/v1`) skips the session: the plugin
   authenticates it itself.
7. **A failing plugin never blocks the boot.** A throwing `register` or migration marks that plugin
   failed (its routes 404) and the server starts.
8. **Everything off = today's GuestFlow.** With both plugins inactive, the reservation payload, the
   dashboard and the Réglages page are those of `master` before this change, plus the activation card
   of rule 11.
9. **Plugin settings.** `ctx.settings.declare / get / set` store in `plugin_settings`; a key declared
   `secret` is encrypted at rest and never returned by `GET /api/plugins/:id/settings`; `set` on an
   undeclared key throws.
10. **Reservation update service.** `reservationsController.update` is split into `update` (HTTP) and
    `performUpdate(id, body)` (service, same validation, pricing, history, notifications) so that
    `ctx.core.reservations.update` changes a fiche the way « Enregistrer » does. Behaviour of
    `PUT /api/reservations/:id` is unchanged. `utils/reservationUpdateBody.js` rebuilds the stored
    fiche as a PUT body for a patch.
11. **Client slots and activation card.** Three slots are wired: `reservation.banners` (top of the
    fiche), `dashboard.alerts` and `dashboard.alerts.urgent`, `settings.integrations` (end of the
    integrations page). A small generic card « Modules » on that page lists the two plugins with an
    Activer / Désactiver switch.
12. **Isolation (rule 0 of the Gîtes de France spec).** No core file mentions a plugin's table, route
    or folder, except `plugins/index.js`, `constants/plugins.js` (server and client) and the wiring
    lines of §4.

**Edge cases:**
- Database restored from a backup taken before this change → the seed runs again, idempotent.
- `inte/plugins` merges later → add/add conflicts on the trimmed files only (§4.1); each resolves by
  taking the branch's version; `authController.js` is reviewed by hand so that master's later
  security fixes survive.
- A plugin activated, then deactivated → its tables and settings stay (data kept); purge is out of
  scope (§8).

---

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** The client side is slot plumbing and one switch card;
> every decision (live or not) is the server's.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/` | `loader.js` | C (verbatim) | `registerAll`, migrations, `mountApi` / `mountPublic`, `startJobs`. |
| `plugins/sdk/` | `createContext.js`, `eventBus.js`, `pluginMigrations.js`, `testing.js`, `index.js`, `coreServices.js` | C (verbatim) | The `ctx` a plugin receives. Dormant declarations (payment, quote, SAS…) stay: cutting them would only create conflicts later. |
| `plugins/sdk/` | `registry.js` | C (trimmed) | `allowsImpl` defaults to `() => true`; the `utils/licence` require is dropped. |
| `plugins/` | `index.js` | C (trimmed) | Lists the two plugins. |
| `middleware/` | `requirePlugin.js` | C (verbatim) | The 404 `PLUGIN_INACTIVE` guard. |
| `models/` | `pluginsModel.js`, `pluginSettingsModel.js` | C (verbatim) | Plugin state and settings storage. |
| `utils/` | `pluginsSchema.js` | C (verbatim) | `ensurePluginsTable`, `ensurePluginSettingsTable` only are called (rule 3). |
| `utils/` | `pluginReservationBlocks.js`, `pluginScheduling.js` | C (verbatim) | Engine helpers. |
| `utils/` | `reservationUpdateBody.js`, `resultRecorder.js` | C (verbatim, #683) | Rule 10. |
| `constants/` | `plugins.js` | C (trimmed) | Catalogue: the two plugins. |
| `controllers/` | `pluginsController.js` | C (trimmed, ~120 lines) | `list`, `activate`, `deactivate`, `getSettings`, `saveSettings`. Cut: blockers, plan/licence, `uninstall`/purge. |
| `routes/` | `plugins.js` | C (trimmed) | `GET /`, `POST /:id/activate`, `/deactivate`, settings; no install/uninstall. |
| `controllers/` | `reservationsController.js` | T | Rule 10 (the #683 hunks). |
| `controllers/` | `authController.js` | T (~4 lines) | `enabledPlugins` in the `login` and `me` payloads. |
| `.` | `index.js` | T (~12 lines) | `registerAll` after the DB, `mountPublic`, `/api/plugins` + `mountApi` after the core routers, `startJobs` after `startScheduledTasks`. |
| `.` | `database.js` | T (~8 lines) | `ensurePluginsTable`, `ensurePluginSettingsTable`, the seed of rule 3. |
| `scripts/` | `check-spec-coverage.mjs` | T (1 line) | The spec-rules check also reads the tests that live in a plugin folder (the same line as on the plugins branch). |
| `.` | `package.json` | T | `imapflow` (Gîtes de France); the `test` glob adds `src/plugins/**/tests/*.test.js`. |
| `.` | `package-lock.json` | T | Only the 22 package entries `imapflow` brings, merged by hand: `npm install` on macOS strips the `libc` fields of unrelated entries. Verified by `npm ci`. |
| `utils/` | `pluginsBackportSeed.js` | C | Rule 3: seeds the plugins inactive, under the ledger `plugins_backport_seed_v1`. |
| `plugins/gites-de-france-intake/` | 6 files + tests | C (verbatim, #683) | The first plugin. |
| `tests/` | `plugin-engine-backport.unit.test.js`, `reservation-update-service.unit.test.js` | C | §7. |

No route, table or column of the core changes (`plugins`, `plugin_settings` are created from code).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `Slot.jsx`, `useSlot.js`, `registry.js`, `ui.js` | C (verbatim) | Slot plumbing. |
| `plugins/sdk/` | `index.js` | C (trimmed, 1 line) | What a plugin may import from the core; the `SasKeypadCode` export is dropped (that component does not exist on `master`). |
| `plugins/` | `index.js` | C (trimmed) | The two plugin modules. |
| `constants/` | `plugins.js` | C (trimmed) | The two ids. |
| `hooks/` | `usePlugins.js` | C (verbatim) | `usePlugin(id)` reads `user.enabledPlugins`. |
| `components/` | `PluginActivationCard.jsx` | C | Rule 11: generic list of plugins with a switch (JSDoc props at the top). Replaced by the Plugins page when the branch lands. |
| `components/` | `PluginsActivationSection.jsx` | C | Loads the list, calls activate/deactivate, refreshes the auth context; renders the card. |
| `pages/` | `ReservationPage.jsx` | T (~14 lines) | `reservation.banners` slot + `reloadToken` (#683 hunks). |
| `pages/` | `Dashboard.jsx` | T (3 lines) | The two alert slots. |
| `pages/settings/` | `IntegrationsSettingsPage.jsx` | T (~35 lines) | `settings.integrations` slot + the activation section + one save/dirty map for the Neat card and the plugin sections. Its Neat-save test mocks the auth context and the activation section. |
| `.` | `api.js` | T (~12 lines) | `getPlugins`, `activatePlugin`, `deactivatePlugin`, `getPluginSettings`, `savePluginSettings`. |
| `plugins/gites-de-france-intake/` | 4 files + tests | C (verbatim, #683) | The first plugin's UI. |
| `components/__tests__/` | `PluginActivationCard.test.jsx`, `PluginsActivationSection.test.jsx` | C | Rules 5, 11. |

**Not touched** (not needed): `App.jsx`, `constants/roles.js`, `settingsMenu.js` (no plugin page or
route).

**Component reuse:** consumes `StatusCard`, `ErrorAlert`, `LoadingState`. `PluginActivationCard` is
generic by design (a list of `{ id, name, description, enabled }`), named by what it does.

### 4.3 API contract

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/plugins` | — | `[{ id, name, description, enabled }]` (admin) |
| POST | `/api/plugins/:id/activate` | — | `{ id, enabled: true }` |
| POST | `/api/plugins/:id/deactivate` | — | `{ id, enabled: false }` |
| GET / PUT | `/api/plugins/:id/settings` | `{ values }` | settings, secrets masked |
| GET | `/api/auth/me` | — | adds `enabledPlugins: string[]` |

## 5. Data model

Two tables created from code at boot (same DDL as `inte/plugins`):
`plugins (id PK, enabled 0|1, source, version, installed_at, updated_at)` and
`plugin_settings (pluginId, key, value, secret…)`. Rows for the two plugin ids with `enabled = 0` after
the first boot. No existing table or column changes; no migration of data.

## 6. UI / UX

The only new visible element is the card « Modules » at the bottom of Réglages → Intégrations: one row
per plugin (name, one-line description, switch). Mobile: rows stack, the switch keeps a 44 px target.
Activated plugins add their own settings card below it (`settings.integrations`), their fiche banner
and dashboard lines.

## 7. Test plan

- `plugin-engine-backport.unit.test.js` (cites rules 1, 3–10, 12): the seed (one row per shipped plugin, `enabled = 0`,
  ledger name, idempotent, `seedBuiltinPlugins` never called); inactive plugin → 404 over HTTP, no
  job tick, absent from `enabledPlugins`; activate/deactivate (admin only, unknown id); routes
  behind `requireAuth`; a throwing `register` and a throwing migration → plugin failed, boot goes
  on; settings round-trip with a secret masked on read; catalogue has exactly the two ids; isolation.
- `reservation-update-service.unit.test.js` (rule 10, copied from `inte/plugins`): the extracted
  service behaves like the old handler.
- Gîtes de France plugin tests copied with it (its own rules 0–17).
- Client: `PluginActivationCard.test.jsx` (rule 11); the plugin banner/alert tests of #683.
- Without activating anything: `cd server && npm test`, `cd client && npx vitest run`,
  `npm run test:e2e` green; the reservation payload unchanged (rule 8).
- Manual (dev): activate Gîtes de France → card + banner appear; deactivate → they vanish; mobile
  check of the activation card at 390 px.

## 8. Out of scope

- The Plugins page, plugin purge/uninstall, licence and subscription gating.
- Events (`reservation.*`) — neither plugin needs them; wiring them touches `create`/`update`/`remove`
  and the iCal sync, where the branch rewrote the same code.
- Merging or syncing `inte/plugins`.
- The other eleven plugins; moving existing core features into plugins.

## 9. Open questions

None.

## 10. Implementation progress

- 2026-10-15 — implemented on `feature/plugin-engine-backport`: server engine (20 files, 12 copied
  verbatim from `origin/inte/plugins`), seed, activation endpoints, `enabledPlugins`, `performUpdate`
  (#683 hunks), client slots + « Modules » card, Gîtes de France plugin copied with its tests.
  Server suite 4 695 → green with 12 new engine tests; client 3 + 3 new tests; `npm ci` verified on
  both lockfiles.
- Deviations from verbatim, each resolved by taking the plugins branch's version at the full merge:
  `plugins/sdk/registry.js` (licence stub), `plugins/index.js`, `constants/plugins.js` (server and
  client), `controllers/pluginsController.js`, `routes/plugins.js`, `client/src/plugins/index.js`,
  `client/src/plugins/sdk/index.js` (1 line), `IntegrationsSettingsPage.jsx`, `authController.js`.
- Booking's catalogue entry, `ctx.core.clients.update` and the public route land in the Booking PR.
