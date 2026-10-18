# Plugins — phase 4: plugin packages, a signed registry, install and update from the Plugins page

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugins-phase-4` (from `inte/plugins` at 4a5a66ae) |
| **Created** | 2026-10-08 |
| **Author** | Adrien |
| **Related PR** | #692 (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — D1, §8, §11 risk 4, phasing §12 |
| **Previous phase** | [`specs/plugins-phase-p-productisation.md`](plugins-phase-p-productisation.md) (PR #672) |
| **Summary for review** | [`docs/specs/2026-10-08-plugins-phase-4-registry.html`](../docs/specs/2026-10-08-plugins-phase-4-registry.html) |

---

## 1. Context

D1 (2026-09-28): plugins are downloaded, as in Sowel — a registry, one package per plugin, SHA-256
pinned, installed from the Plugins page. Phases 0–3 gave every optional feature a module behind the
SDK (`server/src/plugins/<id>`, `client/src/plugins/<id>`), but the twelve modules are still compiled
into the core:

- `server/src/plugins/index.js` and `client/src/plugins/index.js` are static import lists;
- the `plugins` table has no `manifest` and no pinned hash (`utils/pluginsSchema.js`), the catalogue is
  a frozen constant (`constants/plugins.js`) with `requires` frozen to `[]`;
- the SDK has no version, the core does not check any range;
- the release workflow publishes one core archive and nothing per plugin;
- the client plugins still import core files directly (`../../../api`, `DialogProvider`, `useAuth`…).

D4 makes the repository private: an instance cannot download from GitHub without a token
(`plugins-inventory.md` §10). The control plane already holds an Ed25519 key and every managed
instance already verifies its signatures (`control-plane-plans-and-access.md` rules 11 and 30).

## 2. Goal

A plugin is a package with its own version. An administrator installs, updates or removes it from the
Plugins page; the package comes from the official registry when the instance has one, or from the
copy shipped in the release archive when it has none. A plugin that is not installed costs nothing:
no server code loaded, no client code downloaded.

## 3. Functional rules

### 3.A Decisions taken for this phase (2026-10-08)

The owner asked for the whole plan to run end to end and to be asked only when blocked. The options
below are the recommended ones; each is reversible in a later spec.

- **P23 — the registry lives in the control plane.** It signs the index with the key it already uses
  for licences and serves the packages. Instances only make outbound calls. GitHub raw (Sowel) is
  ruled out by D4.
- **P24 — the release archive still ships every plugin package.** An instance without registry (Solio
  today, a development machine, an offline install) installs and updates plugins from the archive it
  runs; the registry only adds versions published between two core releases.
- **P25 — the administrator of the instance installs and updates plugins**, within the plugins its
  licence allows (control-plane rule 11). Nothing updates by itself. Fleet-wide pushes are the
  operator's, in the hosting phase H.
- **P26 — one plugin version per plugin, semver, bumped by the release.** A plugin whose files changed
  since the last tag gets a patch bump; the `verify` job refuses a release where a plugin changed and
  its version did not.
  > **2026-10-17 (review of PR #692):** « bumped by the release » is replaced by rule 28: the pull
  > request that changes a plugin bumps it, because the owner's authorisation to merge the release
  > PR covers only the three `package.json` bumps and the changelog fold (CLAUDE.md §5.6).
- **P27 — one loading path in production.** Every plugin, bundled or downloaded, is loaded from a
  package directory on the server and from its own ES module in the browser. The development server
  keeps loading sources directly, so hot reload still works.

### 3.B Package and manifest

1. A plugin package is a `tar.gz` named `<id>-<version>.tgz`. It holds `manifest.json`, `server/`
   (the module's server code, CommonJS, no `node_modules`) and `client/` (one ES module `index.js`
   plus its chunks and assets). No `npm install` at install time.
   > **2026-10-08 (implementation):** The package also lands unpacked next to its archive in `plugins-dist/<id>/`, which is what a `bundled` row runs (rule 17). `tar` is created with `COPYFILE_DISABLE=1`: macOS would otherwise add `._*` members the instance refuses.
2. The manifest is the single description of a plugin: `id`, `name`, `version`, `description`,
   `icon`, `surfaces`, `requires` (`[{ id, range }]`), `guestflow` (core version range), `sdk` (SDK
   version range). It lives in the plugin's source folder (`server/src/plugins/<id>/manifest.json`);
   `constants/plugins.js` builds the catalogue from the twelve manifests instead of repeating them.
   > **2026-10-08 (implementation):** Every module of the host side validates with the same `server/src/plugins/manifest.js` (`validateManifest`): the catalogue, the package store, the registry client, the package build and the console's registry. `changelog` is an optional `{ version: [lines] }` (rule 24). The twelve manifests start at `1.0.0` with `guestflow: ">=3.9.0"` and `sdk: "^1.0.0"`: the core version is a floor only — the SDK range is what protects a plugin from a breaking core, so a major core release does not orphan every plugin.
3. The SDK has a version (`sdk/version.js`, semver, starting at `1.0.0`). Removing or changing an SDK
   entry point is a major bump; adding one is a minor bump.
4. A plugin's server code requires the core only through `guestflow/sdk` (and its sub-paths); its
   client code imports only `react`, `react-dom`, `react-router`, `@mui/material`,
   `@mui/icons-material` and `guestflow/sdk` (and its sub-paths). The build of a package fails on any
   other import that leaves the plugin folder. The core imports the client SDK re-exports (`api`
   helpers, `DialogProvider`, `useAuth`, menu constants) from one place.
   > **2026-10-08 (implementation):** The plugin sources keep requiring `../sdk` (server) and importing `../sdk` / `../sdk/ui` (client): development, the unit suites and the console (which renders the online-payment page from the sources) run them as they are. The package build is where rule 4 is enforced: on the server it rewrites every require reaching `server/src/plugins/sdk` to `guestflow/sdk[/<file>]` and fails on any other require leaving the folder, or on an npm package `server/package.json` does not ship; on the client the same check turns the SDK into the externals `guestflow/sdk` and `guestflow/sdk/ui`. At run time the loader resolves `guestflow/sdk` to the core SDK and a package's npm requires to the core's `node_modules` (a `Module._resolveFilename` hook limited to the package directories).
5. The client bundle is built with `react`, `react-dom`, `react/jsx-runtime`, `react-router`,
   `@mui/material` and `guestflow/sdk` as externals, resolved at run time to the host's own modules:
   one React, one MUI theme. Icons are bundled into the plugin.
   > **2026-10-08 (implementation):** The externals are the list `client/src/plugins/hostModules.json` — `react`, `react/jsx-runtime`, `react-dom`, `react-router`, `@mui/material` and its `styles`, `colors` and `utils` sub-paths (an icon imports `createSvgIcon` from `@mui/material/utils`), `guestflow/sdk`, `guestflow/sdk/ui`. No import map: the build rewrites each import of an external into a read of `globalThis.__GUESTFLOW_HOST__.modules[<name>]`, which `client/src/plugins/runtime.js` fills with the app's own modules before importing any bundle. A bare import left in a bundle fails the build.
   > **2026-10-17 (review of PR #692):** Superseded in part by rule 26: the externals are no longer a fixed list. Everything of React, the router, MUI (`@mui/material/*`, `@mui/system`, `@mui/utils`, …) and emotion stays the host's, whoever imports it — an icon imports `@mui/material/SvgIcon`, which used to pull a copy of MUI and emotion into every bundle (~100 KB each) and drop the GuestFlow theme on the icons.
   > **2026-10-18 (merge of `master` v3.10.0):** `@mui/icons-material` 9.5 makes `createSvgIcon` a
   > re-export (`export { createSvgIcon as default } from '@mui/material/SvgIcon'`), which Vite keeps as a
   > chunk re-exporting the host module. The build now rewrites such a re-export like an import — a read
   > of the host module, re-exported under the chunk's name — instead of refusing the bundle.

### 3.C Registry

6. The registry index is a JSON document listing, per plugin, every published version with its
   manifest, its SHA-256 and its size. It is signed with Ed25519 (detached signature next to the
   index). An index whose signature does not verify is ignored entirely.
7. The control plane serves `GET /registry/v1/index.json`, `GET /registry/v1/index.json.sig` and
   `GET /registry/v1/packages/<id>-<version>.tgz`, without authentication (packages contain no
   customer data; the licence decides what an instance may install).
8. The operator publishes packages from the console page **Registre**: upload one or more `.tgz`
   files; the console reads each manifest, refuses a duplicate `id@version`, a manifest that fails
   rule 2, or an archive whose layout fails rule 1, stores the file under `CP_DATA_DIR/registry/`,
   and re-signs the index. A published version can be withdrawn (it disappears from the index; an
   instance that runs it keeps it).
9. An instance reads the registry from `GUESTFLOW_REGISTRY_URL` and verifies it with
   `GUESTFLOW_REGISTRY_PUBLIC_KEY`, falling back to `GUESTFLOW_LICENCE_PUBLIC_KEY`. Without a URL, or
   without a key, the instance has no remote registry and says so nowhere: it simply offers what its
   archive ships (P24). The index is fetched at boot, then every 6 hours, and on demand from the
   Plugins page (« Rechercher des mises à jour »).
   > **2026-10-08 (implementation):** The URL must be https, except a loopback address (the E2E registry, a development machine). The page shows the state of the last read under the search field: « Registre lu il y a 5 min. », « Registre injoignable, dernière lecture il y a 3 h. », or « Registre ignoré : signature invalide. » (rule 6) — and nothing at all without a registry. « Rechercher des mises à jour » is an icon of the page's action bar, shown only when a registry is configured.

### 3.D Install, update, uninstall

10. Sources, in order: the registry, then the packages shipped in the release archive
    (`<release>/plugins-dist/`). For each plugin the instance offers the highest version that is
    compatible (rule 12) and allowed by the licence.
   > **2026-10-08 (implementation):** Offers exist only where packages run (rule 19): a development tree is offered nothing and runs its sources. Only the twelve plugin ids of the catalogue are offered: a registry entry for another id is ignored, because a new plugin needs a core that knows its licence entry and its plan (third-party plugins are out of scope, §8).
11. Installing or updating downloads the package (or copies it from the archive), checks its SHA-256
    against the signed index (or against `plugins-dist/SHA256SUMS`, itself covered by the release's
    `SHA256SUMS`), unpacks it to `<GUESTFLOW_DATA>/plugins/<id>/<version>/`, then switches the
    plugin's `current` pointer. The `plugins` row records `version`, `source`
    (`registry` | `bundled`), `manifest` and `pinned_sha256`. A failed download or a hash mismatch
    leaves the running version untouched.
   > **2026-10-08 (implementation):** A `bundled` version is not unpacked at install: the release already carries it unpacked in `plugins-dist/<id>/`, covered by the release's own SHA-256 when the core was installed. Its row records the archive's hash from `plugins-dist/SHA256SUMS` as `pinned_sha256`. A registry download is limited to 50 MB and follows no redirect.
12. A version is compatible when the running core satisfies `guestflow`, the SDK satisfies `sdk`, and
    every `requires` entry names an installed plugin whose version satisfies its range. Installing a
    plugin whose requirement is missing proposes to install the requirement first, in the same
    confirmation. Uninstalling a plugin that another installed plugin requires is refused with the
    name of that plugin.
   > **2026-10-08 (implementation):** The confirmation of rule 12 is a dialog on the card: « Nécessite aussi : Linge et blanchisserie 1.0.0, installé en premier. » with « Tout installer »; the server answers 409 `REQUIREMENTS` with the plan when the request did not include `withRequirements`. An **update** whose new version requires a plugin not installed is refused with « Nécessite X : à installer d’abord. » instead of installing it on the way: an update restarts the instance and stays one plugin at a time.
13. A plugin's server code takes effect without a restart for an install (its routes, jobs and
    migrations are registered live). An **update** asks for a restart of the instance, done by the
    application itself as the core update already does (`specs/self-update-and-releases.md`); the
    page says « Redémarrage en cours » and reloads when the server answers.
   > **2026-10-08 (implementation):** Two precisions. An install in a release answers `reload: true` and the page reloads, because the browser loads plugin bundles only before the app renders (rule 18); the server part needed no restart. Reinstalling, in the same process, a version other than the one still loaded from before an uninstall restarts the instance, like an update. The restart is a clean exit that the supervisor turns into a restart: PM2 in production (`pm_id` set), `GUESTFLOW_SUPERVISED=1` for the E2E harness. Without a supervisor an update is refused with 412 « Redémarrage automatique indisponible sur cette installation : rien n’a été modifié. » before anything moves. The page waits until `/api/version` answers with a new start time, then reloads.
   > **2026-10-17 (review of PR #692):** `/api/version` gives the start time of the process (fixed at boot): it used to be the time of the request, so the page « detected » a restart on its first poll. The restart is a SIGINT through the server's own shutdown (requests in flight finish), not an immediate exit.
14. At boot, a package whose ranges no longer match the running core (after a core update) stays
    installed but is not loaded; the Plugins page shows it as « Incompatible avec cette version » and
    offers the compatible version when one exists. Its data is untouched.
   > **2026-10-08 (implementation):** A package whose requirement is itself not loadable (missing, incompatible, or at a version outside the range) is left unloaded too, with « Nécessite <plugin>. ». A package whose files are missing (deleted by hand) is reported « Paquet introuvable : à réinstaller. ». The compatible version is offered on the card as « Installer la version x.y.z » — it goes through the update path (restart).
   > **2026-10-17 (review of PR #692):** An update to an **older** version is accepted only for a plugin in this state; otherwise only a newer one.
15. Each plugin has a persistent data directory `<GUESTFLOW_DATA>/plugin-data/<id>/` exposed as
    `ctx.dataDir`; updates never touch it; uninstalling with « Effacer aussi ses données » removes it.
16. The last two versions of a plugin are kept on disk. « Revenir à la version précédente » is offered
    for 7 days after an update, then the older copy is deleted.
   > **2026-10-08 (implementation):** The previous copy is recorded in the row (`previous_version`, `previous_source`, `previous_sha256`, `rollback_until`, §5). A rollback is a restart like an update, and clears the window: there is no « rollback of the rollback ». The housekeeping that deletes an expired copy runs at boot and every 6 hours; it also deletes the package directories of plugins no longer installed.

### 3.E Loading

17. Production: the server loads each installed plugin from `<GUESTFLOW_DATA>/plugins/<id>/current/server`
    (the release's own copy for `bundled` packages that were never re-installed). `guestflow/sdk` is
    resolved to the core SDK by the loader. A module that throws keeps the existing failure isolation
    (phase 1 rule 4).
   > **2026-10-08 (implementation):** A `bundled` row runs from the release's unpacked package, `<release>/plugins-dist/<id>/server` — not from `server/src/plugins/<id>`, which the archive still ships for the console and the unit suites: one loading path for every plugin (P27). Only the installed packages load: a plugin not installed registers nothing, and the registry then answers « not live » for it (`requireRecord`).
18. Production: `GET /api/plugins` gives each active plugin's `clientEntry` (a URL served by the
    instance under `/plugin-assets/<id>/<version>/`, long-cache, immutable). The client imports every
    active entry before rendering the routes; a plugin whose bundle fails to load is shown as failed on
    the Plugins page and the rest of the app renders.
   > **2026-10-08 (implementation):** The list of entries is `GET /plugin-assets/entries.json`, outside `/api` and readable before the login: the browser imports the bundles before the app's modules evaluate, so the menus, routes and slots computed from the module list see them, and a session never needs a reload. It lists every loaded package — active or inactive (activating stays instant); not installed costs nothing. The few maps the core derived at import time from the module list (`ROUTE_PLUGINS`, `MODULE_ROUTE_ROLES`, `ROUTE_ROLES`, `useSlot`'s ids) read it live. A bundle that fails to import is shown « Échec du chargement. » on its card; the failure is a fact of that browser, kept client-side (`BUNDLE_FAILURES`).
   > **2026-10-17 (review of PR #692):** `/plugin-assets/entries.json` is readable without a session on purpose (it names the active plugins and their versions, nothing else). When it cannot be read, the app renders without its plugins and shows « Modules indisponibles. » with « Recharger ». The App chunks are fetched (`modulepreload`, without evaluation) in parallel with the bundles, and the list is fetched before the runtime arrives. Measured with `npx vite build`: the code loaded before the first render is 572 KB gzip (+ 8 KB of plugin entry bundles) against 573 KB on `inte/plugins` — under +5 %.
19. Development (`npm run dev`) and the unit suites keep importing the plugin sources directly. One E2E
    suite runs against the production build served by the server, so the package path is exercised in
    CI.
   > **2026-10-08 (implementation):** The mode is `GUESTFLOW_PLUGINS=packages|sources`; without it a process that finds `plugins-dist/SHA256SUMS` beside `server/` runs packages, whatever `NODE_ENV` says — a release's client build carries no plugin code, so a release must never fall back to sources. `npm run dev` and the dev E2E suite set `sources`. The production-build suite is `npm run test:e2e:prod` (`playwright.prod.config.js`, `e2e/prod/`), a job of the E2E workflow: it serves `client/dist` and the packages beside a test registry signed with a throwaway key, behind a supervisor that restarts the server like PM2.

### 3.F Plugins page

20. Each installed plugin's card shows its version. When a newer compatible version exists, a chip
    « Mise à jour 1.2.0 » opens a dialog with the plugin's changelog lines for the versions in between
    and one button « Mettre à jour ». A banner « 3 mises à jour disponibles » offers « Tout mettre à
    jour ».
   > **2026-10-08 (implementation):** « Tout mettre à jour » downloads and verifies every package first; a refused one leaves every plugin as it was. Then it switches them all and restarts once.
21. The « Disponibles » tab lists plugins allowed by the licence and not installed, with their version;
    a plugin outside the licence keeps the « Hors forfait » state of control-plane rule 11.
22. Refusals are shown in the dialog, in plain French, never as a raw error: version of GuestFlow too
    old (« Nécessite GuestFlow 4.1 ou plus récent »), missing requirement, package refused (« Le
    paquet reçu ne correspond pas à sa signature — rien n'a été modifié »), download impossible.

### 3.G Release and publication

23. The release workflow builds the twelve packages (`scripts/build-plugin-packages.mjs`), puts them in
    the core archive under `plugins-dist/` with a `SHA256SUMS`, and attaches them to the GitHub
    release. The `verify` job runs `scripts/check-plugin-versions.mjs`: a plugin folder changed since
    the previous tag with the same manifest version fails the release.
   > **2026-10-08 (implementation):** `release.sh` builds the packages when `plugins-dist/` is missing and copies the directory into the archive; the release workflow builds them after the client and attaches every `<id>-<version>.tgz` to the GitHub release (they are listed in the release's `SHA256SUMS` like every asset). `scripts/check-plugin-versions.mjs --bump` is the release skill's step that patch-bumps every changed plugin; tests-only changes do not count.
   > **2026-10-17 (review of PR #692):** The release PR no longer bumps plugins (rule 28); the `verify` job's check now passes or stops the release. The package job also compares each package's content hash with the package published under the same version in the previous release (rule 27).
24. Plugin changelog lines live in `changelog.d/` like the core's, with a `plugin:<id>` prefix on the
    bullet; the release fold writes them into the core section and into the manifest's `changelog`
    entry for that version.
   > **2026-10-08 (implementation):** The `plugin:<id>` bullet is written in **French**, like the operator digest: it is read inside the application, in the update dialog. In the core section it becomes « **Plugin `<id>`** — <text> ». The fold runs after the bump (P26), so the lines land under the version this release ships.
   > **2026-10-17 (review of PR #692):** Superseded by rule 28: the release fold no longer edits manifests. A `plugin:<id>` bullet still names its plugin in the core section; the French lines the update dialog shows are written in the manifest by the PR that bumps the plugin.

**Edge cases:**
- Registry unreachable → the page shows the archive's versions; no error toast, a discreet « Registre
  injoignable, dernière lecture il y a 3 h ».
- Registry and archive both offer the same version → the archive copy is used (no download).
- A plugin installed from the registry, then the core is updated to a release that ships an older
  version of that plugin → the installed (newer) version stays.
- An instance offline for months → nothing changes until someone clicks; the 7-day rollback window
  starts at the update, not at the first boot after it.
- Two administrators click « Mettre à jour » together → the second request gets 409 « Mise à jour déjà
  en cours ».

### 3.H Added during implementation (2026-10-08)

25. A `bundled` row follows the copy the running release ships: at each boot its `version`,
    `manifest` and `pinned_sha256` are those of `plugins-dist/<id>/`. A core update that ships a newer
    version of a `bundled` plugin therefore updates it with the core, with no separate click; a plugin
    installed from the registry (`registry` row) keeps its own version (edge case « older version in
    the archive »). Added because the spec said where a `bundled` package runs (rule 17) but not which
    version its row then records.

### 3.I Added after the review of PR #692 (2026-10-17)

26. **The host gives the plugins exactly what they import.** A plugin bundle carries no copy of React,
    the router, MUI (any `@mui/material` sub-path, `@mui/system`, `@mui/utils`) or emotion — only its
    icons — and the package build fails otherwise. The names the twelve-plus plugins take from the host
    are listed in `client/src/plugins/hostModules.json` and imported one by one by `hostModules.js`,
    both generated by `node scripts/build-plugin-packages.mjs --write-host`; the build fails when a
    plugin takes a name the list lacks. A bundle checks the names as it loads: a version built for a
    newer core that needs a name this core does not expose fails to load (shown « Échec du
    chargement. ») instead of rendering `undefined` — and its `guestflow` floor must say so.
    > **2026-10-18 (second review):** The SDK (`guestflow/sdk`, `guestflow/sdk/ui`) is exposed whole: it is GuestFlow's own versioned contract, so a plugin version built later may use any of its entries. The list is append-only and each package says what it needs (rule 33).
27. **A plugin's client files are cached by content.** Their URL carries the package's hash
    (`/plugin-assets/<id>/<version>-<hash12>/…`), so files served immutable are never those of another
    build with the same version. Each package's manifest records a `contentHash` of its files; the
    release refuses a package whose content differs from the one already published under the same
    version (a dependency bump, say) — the plugin is then bumped in a PR.
    > **2026-10-18 (second review):** The URL's hash is the package manifest's `contentHash` (not the archive's), and the archive itself is reproducible: names sorted, owner 0, mtime 0, gzip without a timestamp. When a rebuilt package differs from the one published under the same version but the plugin's sources did not change since the previous tag (a dependency bump), the release keeps the published package instead of failing; it fails only for changed sources without a bump — and the release skill runs the same check in its pre-flight, so this never fails after the tag.
28. **A plugin is versioned in the pull request that changes it.** CI refuses a PR that changes a
    plugin's files (tests excepted) without a new `version` in its manifest and French lines under
    `changelog["<version>"]`. The release PR never edits a manifest; it only folds `changelog.d/`.
29. **One plugin operation at a time, all or nothing.** An install takes the same lock as an update
    (409 « Mise à jour déjà en cours. »); a requirement installed for a plugin whose own install then
    fails is uninstalled again; an install that needs a restart (another version still loaded) is
    refused without a supervisor, like an update (412).
    > **2026-10-18 (second review):** Every refusal releases the lock; only an actual restart keeps it (the next process starts unlocked). An undone requirement loses its row, its `current` pointer and its place in the list of bundles the browser loads; its server code, already registered, stays in memory, inert (not live), until the next restart.
30. **A replayed index is refused.** The instance remembers the `generatedAt` of the last index it
    accepted (`<data>/plugins/registry-state.json`) and ignores an older one, even correctly signed
    (« Registre ignoré : index plus ancien que le dernier lu. »). An index or package larger than its
    limit is refused as it streams (declared length first), not after being read whole.
    > **2026-10-18 (second review):** An index dated more than 24 hours ahead of the instance's clock is refused and not remembered (one bad date would otherwise lock out every honest index after it). The remembered date is kept per registry URL and key. The console dates each index after the previous one (`max(now, last + 1 ms)`).
31. **Writes under `/api` come from GuestFlow's pages.** A non-GET request whose `Origin` (or
    `Referer`) names another site is refused with 403 — so another site cannot install or update a
    plugin with an administrator's session. Requests without either (scripts, server-to-server) and
    the plugin webhooks pass; the public API (`/public/v1`, the WordPress site) is not under `/api`. A
    development process (`NODE_ENV` unset) does not check: the Vite proxy rewrites the host.
    > **2026-10-18 (second review):** Same origin is now the same host **and port**. The check is on everywhere unless `GUESTFLOW_DEV=1`, which only the development scripts set (`npm run dev`, the dev E2E suite) — no longer inferred from `NODE_ENV`. The boot log says « same-origin writes: on » or « off ».
32. **The waits ask and give up.** « Revenir à la version précédente » asks for confirmation; the
    « Redémarrage en cours » wait says « Le redémarrage est plus long que prévu. » after 90 s and
    offers « Réessayer ».
33. **A package says what it needs from the app, and the app's list only grows** (added 2026-10-18,
    second review). The package build records in each package's manifest the names it takes from the
    app (`hostImports`) and ships the app's own list with the release (`plugins-dist/hostModules.json`).
    An instance refuses a version — install, update, or loading at boot — whose `hostImports` its app
    does not expose, with the refusal of a core too old (« Nécessite une version plus récente de
    GuestFlow. »). `client/src/plugins/hostModules.json` only grows: `--write-host` keeps what was there,
    and CI refuses a PR or a release that removes a module or a name since its base.
34. **A package names the last GuestFlow major it runs on** (added 2026-10-18, code review M3). Every
    manifest's `guestflow` range has an upper bound (`">=3.9.0 <4.0.0"`); the package build refuses a
    manifest without one. An instance reads an open range published before this rule as stopping at
    the next major of its floor (`>=3.9.0` → `>=3.9.0 <4.0.0`), so GuestFlow 4 refuses every 3.x
    package — install, update or loading at boot — with « Nécessite une version plus récente de
    GuestFlow. » until a version built for it is published.
35. **What `coreModule()` hands a server plugin is part of the SDK contract** (added 2026-10-18, code
    review M3). `server/src/plugins/sdk/coreModules.json` lists every module of `CORE_MODULES` and the
    names it exports. A unit test fails when a listed module or name is no longer exported, when the
    list and `CORE_MODULES` differ, or when a plugin calls `coreModule()` with a name outside the list;
    `check-plugin-versions` refuses a PR or a release that removes a module or a name since its base
    unless the SDK major version moves (`server/src/plugins/sdk/version.js`). Adding stays free, like
    the host modules of rule 33.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sdk/` | `version.js` | C | SDK semver |
| `plugins/<id>/` | `manifest.json` (×12) | C | Rule 2 |
| `plugins/` | `index.js` | T | Development list only; production goes through `packageStore` |
| `plugins/` | `loader.js` | T | Load from a package directory, resolve `guestflow/sdk`, live register on install, compatibility at boot |
| `plugins/` | `packageStore.js` | C | Unpack, verify, `current` pointer, keep two versions, rollback window, `dataDir` |
| `plugins/` | `registryClient.js` | C | Fetch + verify the signed index, merge with `plugins-dist`, 6 h poll |
| `utils/` | `semverRange.js` | C | Range checks (dependency `semver`) |
| `utils/` | `pluginsSchema.js` | T | `manifest`, `pinned_sha256` columns |
| `models/` | `pluginsModel.js` | T | Version, source, manifest, hash |
| `controllers/` | `pluginsController.js` | T | Offers, install, update, rollback, uninstall checks (rules 10–16) |
| `routes/` | `plugins.js` | T | `POST /api/plugins/:id/update`, `/rollback`, `POST /api/plugins/refresh` |
| `index.js` | `index.js` | T | `/plugin-assets` static mount |
| `constants/` | `plugins.js` | T | Catalogue built from the manifests |
| `plugins/` | `manifest.js` | C | _(added 2026-10-08)_ Rule 2 validation, shared by the catalogue, the store, the registry client, the package build and the console |
| `plugins/` | `host.js` | C | _(added 2026-10-08)_ The mode (rule 19), the boot of the packages (rules 14, 17, 25), the housekeeping (rule 16), `/plugin-assets` and its entries (rule 18) |
| `utils/` | `pluginOffers.js` | C | _(added 2026-10-08)_ Pure offer logic: best compatible version, refusals in French, requirement plan, changelog lines (rules 10, 12, 20, 22) |
| `utils/` | `processRestart.js` | C | _(added 2026-10-08)_ The clean exit a supervisor turns into a restart (rule 13) |
| `middleware/` | `sameOriginWrites.js` | C | _(added 2026-10-17)_ Rule 31 |
| `plugins/sdk/` | `createContext.js`, `registry.js` | T | _(added 2026-10-08)_ `ctx.dataDir` (rule 15); a plugin with no record is not live in the package mode |
| `models/` | `pluginsModel.js` | T | _(added 2026-10-08)_ `switchVersion`, `rollBack`, `expireRollback`, `syncBundled` |
| `scripts/` | `seed-e2e.js` | T | _(added 2026-10-08)_ `E2E_SEED_PLUGINS` picks the installed plugins; rows are `bundled` |
| `plugins/sdk/` | `coreModules.json` | C | _(added 2026-10-18)_ The modules and names `coreModule()` exposes (rule 35) |
| `utils/` | `semverRange.js` | T | _(added 2026-10-18)_ `hasUpperBound`, `boundedRange` (rule 34) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sdk/` | `index.js`, `ui.js` | T | Re-export everything a plugin needs from the core (rule 4) |
| `plugins/` | `runtime.js` | C | Expose the host modules to bundles; import active entries before render |
| `plugins/` | `index.js` | T | Development only |
| `pages/` | `PluginsPage.jsx` | T | Versions, update chip, banner, dialogs, refusals |
| `components/` | `PluginUpdateDialog.jsx` | C | Changelog between versions + action; generic enough for the core update dialog later |
| `components/` | `PluginCard.jsx` | T | _(added 2026-10-08)_ Version, « Mise à jour x.y.z » chip, « Incompatible avec cette version », « Installer la version x.y.z », the requirements confirmation, « Revenir à la version précédente », « Échec du chargement. » |
| `plugins/` | `runtimeModules.js`, `hostModules.json` | C | _(added 2026-10-08)_ The module list of a production build, the failed bundles, the host module names |
| `plugins/` | `hostModules.js` | C | _(added 2026-10-17)_ Generated: the exact host names the plugins import (rule 26) |
| `components/` | `PluginLoadBanner.jsx` | C | _(added 2026-10-17)_ « Modules indisponibles. » (rule 18) |
| `index.jsx`, `vite.config.js` | — | T | _(added 2026-10-08)_ The build redirects `plugins/index.js` to the runtime list; the bundles load before `App` is imported |
| `constants/`, `plugins/sdk/`, `utils/` | `plugins.js`, `roles.js`, `useSlot.js`, `liveRecord.js` | T/C | _(added 2026-10-08)_ The maps derived from the module list read it live (rule 18) |
| `api.js` | — | T | _(added 2026-10-08)_ status, refresh, update, update-all, rollback, `withRequirements` |

**Component reuse declaration:** `FormDialog`, `ConfirmDialog`, `StatusBadge`, `PageActionBar`
reused; `PluginUpdateDialog` is plugin-specific.

### 4.3 Control plane (`control-plane/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| server `utils/` | `registryStore.js` | C | Store packages, validate, sign the index |
| server `routes/` | `registry.js` | C | Public `/registry/v1/*`, operator upload and withdraw |
| client `pages/` | `RegistryPage.jsx` | C | Upload, list, withdraw |
| server | `database.js`, `context.js`, `app.js`, `utils/gf.js` | T | _(added 2026-10-08)_ `registry_packages`, the store in the context, the public mount before the session, the instance's package checks shared |
| client | `App.jsx`, `api.js` | T | _(added 2026-10-08)_ « Registre » in the navigation; list, upload (one request per file, raw body), withdraw |

### 4.4 Tooling

`scripts/build-plugin-packages.mjs` (Vite library build per plugin + tar), `scripts/check-plugin-versions.mjs`,
`.github/workflows/release.yml` (rules 23–24), `release.sh` (copies `plugins-dist/`).
_(added 2026-10-08)_ `scripts/build-changelog.mjs` folds the `plugin:<id>` bullets (rule 24);
`playwright.prod.config.js`, `e2e/prod/{serve,global-setup}.js` and the `production-build` job of
`.github/workflows/e2e.yml` run the production-build suite (rule 19); `npm run test:e2e:prod`.

## 5. Data model

`plugins`: `+ manifest TEXT` (JSON), `+ pinned_sha256 TEXT`; `source` takes `bundled` or `registry`
(existing `builtin` rows become `bundled`). Idempotent migration, no data loss.
_(added 2026-10-08)_ `+ previous_version`, `+ previous_source`, `+ previous_sha256`, `+ rollback_until`
(rule 16); the default of `source` is `bundled` on a new database. `enabled` and every plugin table
are untouched: Solio's twelve rows stay installed and active (verified on a copy of the dev database).

Control plane: `registry_packages(id, version, sha256, size, manifest, published_at, withdrawn_at)`.

## 6. UI / UX

See the summary page. Mobile: cards stack, the update chip stays on the card, dialogs are full screen.
_(added 2026-10-08)_ The banner « N mises à jour disponibles » with « Tout mettre à jour » sits above
the search field; the registry line beside it (under it on a phone); « Rechercher des mises à jour »
is an icon of the action bar. « Redémarrage en cours » covers the page until the server answers
again. Console « Registre »: a table on desktop, cards on a phone. The cards sit two per row from
`lg` only (1 200 px): at 900 px, beside the menu, two columns squeezed each description to a
word per line (seen in the browser check of 2026-10-17).

## 7. Test plan

- Server unit: manifest validation, range checks, compatibility and dependency refusal, package
  store (hash mismatch leaves the running version, rollback window, two versions kept), signed index
  (bad signature ignored), loader from a package directory, live install.
- Control plane unit: upload validation, duplicate refusal, signature, withdraw.
- Client unit: Plugins page states (update chip, banner, refusals, incompatible).
- E2E: production-build suite (rule 19) — app renders with plugins loaded from bundles; install from
  a test registry; update with restart.
- Release tooling: version check fails on a changed plugin without a bump.
- _(added 2026-10-18)_ `plugins-manifest-upper-bound.unit.test.js` (rule 34) and
  `plugins-sdk-core-modules-contract.unit.test.js` (rule 35).

## 8. Out of scope

Third-party plugins and developer accounts (§8.2 rule 5); fleet-wide plugin pushes (phase H); moving
plugins to separate repositories.

## 9. Open questions

None at writing time; P23–P27 are recorded in §3.A.

## 10. Implementation progress

Implemented 2026-10-08, merged with `inte/plugins` on 2026-10-17 (H2 #673, Saisie Gîtes de France
#683). That merge brought a thirteenth plugin, `gites-de-france-intake`: it got its manifest
(`1.0.0`) and builds into a package like the others, so « the twelve » in this spec reads « every
plugin of the catalogue » from then on.

2026-10-18 — `master` (v3.10.0) merged into `inte/plugins` brought a fourteenth plugin,
`booking-intake` (`specs/booking-extranet-intake.md` §10), manifest `1.0.0`. The two SDK entries it uses
(`ctx.core.clients.update`, `ctx.core.reservations.platformCommission`) and the core module
`planningDateRange` (the 750-day cap of the planning reads, `specs/reception-role-checkin-only.md`
rule 12ter) raise the SDK to **1.1.0** (rule 3, minor). Under rule 28 the plugins whose sources the
merge changed are bumped in the merge PR: `gate-access` 1.1.0 (« Partager » on the « Portail » step),
`linen` 1.0.1 and `hourly-resources` 1.0.1 (both `sdk ^1.1.0`).

2026-10-18 — code review (`fix/review-code-security`): rules 34 and 35. Every manifest is bounded
`<4.0.0`, an open range is read as bounded, and `coreModules.json` freezes what `coreModule()` exposes.
`ctx.secretRoutes` (`specs/hosting-h2-account-security.md` rule 23) and the core module `qonto`
(`specs/plugins-phase-3a-online-payment.md` rule 22) raise the SDK to **1.2.0** (minor); every plugin is
bumped for its new range, and `booking-intake`, `gate-access` and `online-payment` ask for `sdk ^1.2.0`.

| Suite | Result (after the second review, 2026-10-18, merged with `inte/plugins` #691 #693 #694) |
|---|---|
| Server (`node --test`) | 5 136 / 5 136 — of which `plugins-phase-4-registry.unit.test.js` 54, `plugin-packages-release.unit.test.js` 15 |
| Client (Vitest) | 1 605 / 1 605 — of which `PluginsPage.registry.test.jsx` 13, `runtime.bundles.test.jsx` 4, `PluginLoadBanner.modules.test.jsx` 2 |
| Control plane server | 173 / 173 — of which `registry.unit.test.js` 6 |
| Control plane client | 51 / 51; console build OK |
| Spec rules | 33 / 33 rules cited by a test |
| E2E dev suite | 103 passed, 1 skipped |
| E2E production build (`npm run test:e2e:prod`) | 4 / 4 |
| Package build | 13 packages, reproducible byte for byte; no MUI, emotion or React code inside a bundle |
| Eager client code (gzip, `npx vite build`) | 576 KB + 8 KB of plugin entry bundles, against 578 KB on `inte/plugins` (+1.0 %) |

The review (2026-10-17) also checked in the browser, production mode, on the copy of the
development database: the hourly-resources card icon (`color: 'info.main'`) renders `#31556E`, the
Maison palette — MUI's default would be `#0288d1`; a cross-site write gets 403; the rollback asks
for confirmation.

Verified by hand on a copy of the development database (Solio's data), first booted by the code of
`inte/plugins` before phase 4 (twelve `builtin` rows), then by this branch in the package mode with
the production client build: the rows became `bundled` 1.0.0, all active; dashboard, reservation
page, planning, Plugins page, Paramètres › Linge, Intégrations and Vacances scolaires render without
a console error; an update from a local signed registry restarted the instance and left the rollback;
a package with a wrong hash was refused with nothing changed. Screenshots at 390 px and 1 280 px.
