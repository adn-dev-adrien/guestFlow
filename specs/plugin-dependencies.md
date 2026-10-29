# Plugin dependencies — one graph, seen on both sides

| Field | Value |
|---|---|
| **Status** | Implemented (2026-10-29) |
| **Branch** | `feature/plugin-dependencies` (cut from `inte/plugins`) |
| **Created** | 2026-10-29 |
| **Author** | Adrien |
| **Related PR** | (link once opened) — builds on #844 (`fix/audit-plugins`, merged into `inte/plugins` as 53c60253: rules 36–41 of `plugins-phase-4-registry.md`) |
| **Summary for decision** | [`docs/specs/2026-10-29-plugin-dependencies.html`](../docs/specs/2026-10-29-plugin-dependencies.html) |

---

## 1. Context

The owner's request (2026-10-29): « Il faudrait avoir une notion de dépendance pour le plugin, car si
un plugin a besoin d'un autre pour fonctionner il faut qu'on soit en mesure de le voir. Un peu comme
le système de dépendance dans python ou sur Linux. Bref trouve une solution simple, facilement
maintenable et légère. »

Most of the *mechanics* already exist. What is missing is mostly **visibility**, plus a few holes.
Map measured on `fix/audit-plugins` (#844) on 2026-10-29, re-read on `inte/plugins` after its merge.

### 1.1 What already works

| Piece | Where | What it does |
|---|---|---|
| Declaration | `manifest.json` → `requires: [{ id, range }]`, validated by `plugins/manifest.js` (`validateManifest`: id shape + valid range) | The single source of a dependency (`plugins-phase-4-registry.md` rule 2). |
| Load guard | `plugins/loader.js` `loadPackages` (≈ l. 300) | A package whose requirement is not loadable, or loaded at a version outside the range, stays installed but unloaded: `REQUIREMENT_MISSING`, « Nécessite <nom>. », card « Incompatible avec cette version ». Packages mode only. |
| Install plan | `utils/pluginOffers.js` `requirementPlan` | Recursive, requirements first; refusals `REQUIREMENT_TOO_OLD`, `REQUIREMENT_OUT_OF_PLAN`, `REQUIREMENT_MISSING`. |
| apt-like install | `pluginsController.installFromPackages` + `PluginCard` | 409 `REQUIREMENTS` without `withRequirements`; the card first shows « Nécessite : X » and a ConfirmDialog « Nécessite aussi : X 1.8.3, installé en premier. » / « Tout installer ». All or nothing (rule 29). |
| Uninstall guard | `refuseIfRequiredBy` (rule 12) | 409 `REQUIRED_BY` « Nécessaire à X : à désinstaller d'abord. » while any installed plugin requires it. |
| Deactivate guard | `refuseIfRequiredBy({ activeOnly })` (rule 36) | 409 `REQUIRED_BY` « … à désactiver d'abord. » while an **active** plugin requires it. |
| Activate guard | `refuseIfRequirementInactive` (rule 37) | 409 `REQUIREMENT_INACTIVE` « Nécessite X : à activer d'abord. » |
| Install guard | same, `installedOnly` (rule 38, #844) | Install refused while a requirement is installed but off. |
| Update guard | `updateView` | An update whose new version needs a plugin not installed is refused « Nécessite X : à installer d'abord. » |
| Reconciler | `utils/pluginReconciler.js` `planSteps` | Deactivates dependants before their requirements, activates/installs requirements first. |
| Console | `control-plane/.../customerModulesController.js` | Switch on refused 422 `REQUIREMENT_OFF`, switch off refused 422 `REQUIRED_BY`, creation form refused, erase/uninstall refused while an installed dependant exists (`blockedBy`, shown on the line **before** the click). |

### 1.2 What the operator sees today

**Space › Plugins page** (self-managed space):

| Situation | Seen before acting | Seen after acting |
|---|---|---|
| Available plugin, requirement not installed (release) | caption « Nécessite : X » | confirmation « Tout installer » |
| Available plugin, requirement installed but off | **nothing** | red line « Nécessite X : à activer d'abord. » |
| Available plugin, dev tree (sources) | **nothing** — and the install **goes through without its requirement** (hole H1) | — |
| Installed plugin that requires another | **nothing** (no « Nécessite ») | — |
| Installed plugin required by another | **nothing** (no « Utilisé par ») | « Désactiver… » → confirmation → *then* red « Nécessaire à X : à désactiver d'abord. » (the refusal comes after a confirmation: rule 8 of phase 0 — « a refusal is said before the click » — is broken for dependencies) |
| Inactive plugin whose requirement is off | **nothing** | red « Nécessite X : à activer d'abord. » |
| Requirement installed at a version below the range | **nothing** on the installed side | install refused « Nécessite X 1.7 ou plus récent. » with no pointer to X's own update |
| Package loaded without its requirement | badge « Incompatible avec cette version » + « Nécessite X. » | — |

**Operator-managed space**: the Plugins page shows only live plugins (`plugin-operator-provisioning.md` rule 5); dependencies are the console's business.

**Console › client › Modules**: each line has a switch. No line says what it needs or what needs it;
a switch refused for a dependency answers 422 under the line *after* the click. The erase/uninstall
menu is the one place where a dependant is shown in advance (`blockedBy`).

### 1.3 Holes

- **H1 — dev tree installs without requirements.** `install` outside packages mode only runs the
  rule 38 check (`installedOnly`): a requirement *not installed* is not refused, and `registerAll`
  loads every source module with no requirement check. Harmless in production (releases run
  packages), misleading in development and in the E2E suites.
- **H2 — cycles are silent.** `requirementPlan` skips an already-seen id (`seen`), the loader accepts
  A↔B, and rules 36/37 then deadlock: neither can be activated first. Nothing rejects a cycle.
- **H3 — no CI check of `requires`.** `check-plugin-versions.mjs` checks bumps, host modules and core
  modules, not that a `requires` names a shipped plugin, that the shipped version satisfies the
  range, or that the graph has no cycle.
- **H4 — the console can make an incoherent plan.** `PlanMatrix` and the option add-ons accept a plan
  that allows a dependant without its requirement; `dropNotAllowed` (plan downgrade) removes a
  requirement from the choice and leaves its dependant chosen. The space then runs the dependant
  while its requirement is off by licence (`registry.isLive` does not look at requirements).
- **H5 — the dependency is invisible once installed**, on both sides, in the space and in the console.

### 1.4 Inventory of the shipped plugins (16 manifests, 2026-10-29)

**Declared:** exactly one edge — `google-vacation-rentals` 1.0.2 → `website-booking ^1.7.1`
(shipped 1.8.3, satisfied). Every other manifest has `requires: []`.

**Implicit, not declared** (from `plugin-removal-resilience.md` §1.2 and a grep of every plugin's
server and client sources for the other plugins' ids, slots and registry reads):

| Plugin | Couples to | Nature | Verdict |
|---|---|---|---|
| `weather-alerts` | `sas` | Its surfaces are « Intégrations › Météo » and « L'étape météo du sas ». The settings only hold the API key: **without the SAS, the plugin produces nothing anywhere.** | **Hard in practice — undeclared.** Declared by this spec (rule 20, Q4). |
| `gate-access` | `sas` | Fills `sas.portal`; also emails, fiche card, public `/public/v1/gate` | Soft: useful without the SAS. |
| `linen` | `sas` | SAS steps; `sas/controller.js:39` reads `registry.isLive('linen')` directly | Soft both ways. |
| `hourly-resources` | `sas` | « créneaux » step; planning and fiche work alone | Soft. |
| `neat` | `website-booking` | Insurance offer in the public projections; the fiche chip works alone | Soft. |
| `online-payment` | `website-booking` | Pay routes behind `paymentProviders.active()`; links from the fiche work alone | Soft. |
| `google-vacation-rentals` | `tariff-recipes` | Listens to `pricing.changed`; reprices on its own schedule otherwise | Soft. |

No plugin source imports another plugin (guarded by the phase 1 tests). Soft links stay undeclared
(§8, Q7): a field for them would be a second notion for the operator to learn, for no refusal.

## 2. Goal

On a plugin, the operator sees what it needs and what uses it — in the space and in the console —
and every action that would break that link either takes the linked plugins along under one
explicit confirmation, or says why it is refused *before* the click.

## 3. Functional rules

### 3.A The graph

1. **The manifest stays the only declaration.** `requires: [{ id, range }]`, unchanged. No new field,
   no table, no setting. A dependency is added or removed by editing one manifest (and bumping it,
   rule 28 of phase 4).
2. **One server-computed graph.** A pure module `server/src/utils/pluginGraph.js` takes the manifests
   in play (the installed row's manifest when there is one, else the catalogue's) and the stored
   states, and answers: the requirements of a plugin with their status, its dependants, the ordered
   closure of requirements (to switch on) and of active dependants (to switch off), and the cycles.
   The space's controller, the reconciler and the console all read it; none recomputes an edge.
3. **A requirement's status** is one of `ok` (installed, active, version in range), `inactive`
   (installed, off), `missing` (not installed), `outOfRange` (installed at a version the range
   refuses), `outOfPlan` (the licence does not allow it). The server writes the French label.
4. **Transitive.** Closures follow requirements of requirements. Today's graph has depth 1; the rule
   costs nothing and keeps a future chain honest.
5. **A cycle is an error, never a silent skip.** `pluginGraph.cycles()` returns each cycle as an
   ordered list of ids. `requirementPlan` refuses a plugin in a cycle with `REQUIREMENT_CYCLE`
   (« Dépendance circulaire : A → B → A. ») instead of skipping the seen id, and the loader leaves
   every member unloaded with the same code. Rule 9 keeps this from ever shipping; this rule keeps a
   registry-installed package honest.

### 3.B Visible on both sides

6. **« Nécessite … » on the dependant.** Every plugin view carries `dependencies.requires`: one line
   per requirement — name, status, label. When met: « Nécessite Réservation depuis le site ». When
   not: the same line followed by the status in a `StatusBadge` (« inactif », « non installé »,
   « hors forfait », « version 1.6.0 — 1.7.1 ou plus récente requise »). The range is shown **only
   when unmet** (Q5).
7. **« Utilisé par … » on the requirement.** Every installed plugin's view carries
   `dependencies.usedBy`: the installed plugins that require it, with their state. The line reads
   « Utilisé par Google Vacation Rentals »; an inactive dependant is suffixed « (inactif) ».
   Available plugins carry no `usedBy` (nothing uses what is not installed).
8. **Refusals are said before the click.** Each view carries `actions`, computed by the server:
   `activate`, `deactivate`, `uninstall`, each `{ allowed, blockedBy | null, alsoActivates | alsoDeactivates }`.
   The card disables a refused action and shows `blockedBy` next to it, as it already does for the
   business blockers of `blockerFor` (open payment links, Accueil/Comptable accounts).

### 3.C Taking the linked plugins along

9. **Install pulls what is missing, in order** (rule 12 of phase 4, completed). The install plan
   now lists two kinds of steps: `install` for a requirement not installed, `activate` for one
   installed but off (this replaces the bare 409 of rule 38 — Q3). One confirmation lists them
   (« Installe aussi Réservation depuis le site 1.8.3. » / « Active aussi … »), one click
   « Tout installer », all or nothing (rule 29). The 409 `REQUIREMENTS` payload gains `op` per line.
10. **Same plan in a development tree** (closes H1). Outside packages mode the install plan reads
    the source manifests (`host().runningCopy`) and installs/activates the requirements' rows first,
    under the same confirmation. A requirement absent from the tree is refused `REQUIREMENT_MISSING`.
    The views of available plugins carry the same `offer.requirements` there, so the card asks the
    same question in both modes.
11. **Activate pulls inactive requirements** (Q3, same answer as rule 9). `POST /:id/activate` with `withRequirements: true`
    activates the closure of inactive requirements first, then the plugin. Without the flag, and with
    a requirement off, the answer stays 409 `REQUIREMENT_INACTIVE` (rule 37) and now carries
    `requirements: [{ id, name }]`. A requirement **not installed** is refused (`REQUIREMENT_MISSING`,
    « Nécessite X : à installer d'abord. »): installing is the card's « Installer », never a side
    effect of « Activer ».
12. **Deactivate takes the active dependants along — with explicit confirmation** (Q1).
    `POST /:id/deactivate` with `withDependents: true` deactivates the closure of **active**
    dependants first (deepest first), then the plugin. All or nothing: if one of them is refused by
    a business blocker (`blockerFor`), nothing moves and the answer names that plugin and its reason.
    Without the flag the answer stays 409 `REQUIRED_BY` (rule 36) with `dependents: [{ id, name }]` —
    the reconciler (`req.reconciling`) never passes the flag and keeps today's behaviour.
13. **Re-activating never re-activates dependants.** After a cascade, the operator turns the
    dependants back on one by one (or with rule 11 from the dependant's card). The confirmation of
    rule 12 says so in one line: « À réactiver ensuite un par un. »
14. **Uninstall never cascades** (Q2). While any installed plugin requires it, uninstalling is refused
    as today (rule 12 of phase 4), and the refusal is now on the card before the click
    (`actions.uninstall.blockedBy`, « Utilisé par X : à désinstaller d'abord. »). Uninstall can erase
    data (`?purge=1`); a cascade there would erase data of a plugin the operator did not open.
15. **An update or a version below the range points to the fix.** `REQUIREMENT_TOO_OLD` reads
    « Nécessite X 1.7.1 ou plus récent (installé : 1.6.0). » and, when X has an update in range, the
    requirement line carries `updateAvailable: true` so the card says « Mise à jour de X disponible ».
    The update itself stays X's own « Mise à jour » (restart, rule 13 of phase 4): no cascading update.

### 3.D CI and console

16. **CI validates the shipped graph** (closes H3). `check-plugin-versions.mjs` gains a pure
    `requirementViolations(manifests)` run in every mode but `--built`: an id not shipped, a plugin
    requiring itself, a range the shipped version of the requirement does not satisfy, and any cycle.
    It already runs on every PR (`unit-tests.yml`) and in the release `verify` job. Messages in
    English, one per violation, e.g. `google-vacation-rentals requires website-booking ^2.0.0, shipped 1.8.3`.
17. **The console reads the same graph.** `control-plane/server/src/utils/gf.js` exposes
    `pluginGraph`; `customerModulesController.lineOf` adds `requires` and `usedBy` lines (rules 6–7),
    plus `alsoOn` / `alsoOff` (the modules a switch would take along), `confirm` (`{ title, message, label }`,
    the server's confirmation text) and `switchBlockedBy` (a requirement the plan does not license: the
    switch is disabled and says why before the click; `alsoOn` never lists it). Statuses
    come from the console's own choice and the plan (« éteint » for an off module, not an `outOfRange`:
    the space does not report versions to the console).
18. **The console's switches take the linked modules along, with confirmation.** Switching on a module
    whose requirement is off opens « Activer aussi X ? » and sends `{ on: true, withRequirements: true }`;
    switching off a module that switched-on modules require lists them in the existing switch-off
    dialog and sends `{ on: false, withDependents: true }`. Without the flag the 422s stay as today.
    One audit line per module moved, one licence issued. The reconciler then applies the licence in
    graph order (unchanged `planSteps`).
19. **The console refuses an incoherent plan** (closes H4, Q6). A plan or add-on composition
    (`PlanMatrix`, option add-ons) that allows a plugin without allowing its requirements is refused
    422 « Google Vacation Rentals nécessite Réservation depuis le site : à inclure aussi. »; a plan
    change on a customer that would leave a chosen dependant without its requirement drops the
    dependant with it, with one audit line each (« … retiré (nécessite …) »). Only what lost its requirement
    in THIS change follows: a choice that was already incoherent keeps running and its line reads « Nécessite … · éteint ».

### 3.E The shipped graph

20. **`weather-alerts` requires `sas`** (Q4, 2026-10-29). Its only output is the SAS arrival step;
    without the SAS it runs and shows nothing. Manifest: `requires: [{ id: 'sas', range: '^1.7.0' }]`
    (shipped `sas` 1.7.2), bumped to 1.3.0 with the changelog line « Nécessite Arrivée et départ
    guidés. ». The CHANGELOG fragment (`changed`) says that a space with weather-alerts and without
    the SAS sees it « Nécessite Arrivée et départ guidés » after the update, data kept. The other
    implicit links of §1.4 stay undeclared (Q7).

**Edge cases:**
- A requirement installed from the registry at a newer version whose own manifest changed its
  `requires` → the graph reads the **installed row's** manifest (rule 2), never the catalogue's.
- An orphan plugin (installed, no longer shipped) still appears in `usedBy` under its stored name.
- A plugin out of plan (licence) as dependant → it does not block a deactivation (it is not live) and
  is not switched off with it (`dependantsOf(…, { activeOnly })` keeps only active, licensed ones —
  this also changes the manual path, which used to count it); it still blocks an uninstall (rule 12 of
  phase 4, reconciler exception unchanged).
- A dependant failed at `register` → counts as active for rule 12 (its row is enabled), so the
  cascade switches it off too: switching off a failed plugin is harmless.
- A cascade interrupted by a business blocker on a dependant → nothing moves, the message names the
  dependant: « Google Vacation Rentals ne peut pas être désactivé : <raison>. »
- A requirement and its dependant both in one « Tout mettre à jour » → unchanged (one switch, one restart).
- A dependant left unloaded at boot (`REQUIREMENT_MISSING`) is registered live as soon as an install makes its
  requirement live, with its activation hook: no restart. An install plan that switches a requirement on and
  then needs a restart marks that requirement `hooks_pending` (rule 41 of phase 4), so it gets its hooks at boot.
- `activate` checks the licence before the switch-off: a requirement out of plan is `REQUIREMENT_OUT_OF_PLAN`, not « à activer d'abord ».

---

## 4. Architecture

> **Fat backend, thin frontend.** The graph, the statuses, the closures, the labels and the
> confirmation texts are server-computed. The client renders `dependencies` and `actions` and sends
> back one flag; it never walks an edge.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pluginGraph.js` | C | Pure graph: `requirementsOf`, `dependantsOf`, `requirementClosure`, `activeDependantClosure`, `cycles`, status + French label of each edge (rules 2–7). Absorbs `pluginOffers.dependentsOf`. |
| `utils/` | `pluginOffers.js` | T | `requirementPlan` emits `{ op: 'install' \| 'activate' }` steps, refuses `REQUIREMENT_CYCLE`, enriches `REQUIREMENT_TOO_OLD` with the installed version (rules 5, 9, 15). `dependentsOf` moves to `pluginGraph`. |
| `controllers/` | `pluginsController.js` | T | Views gain `dependencies` and `actions` (rules 6–8); `install` runs `activate` steps and the dev-tree plan (9–10); `activate` honours `withRequirements` (11); `deactivate` honours `withDependents`, all or nothing (12); uninstall refusal exposed in the view (14). |
| `plugins/` | `loader.js` | T | `loadPackages` marks cycle members `REQUIREMENT_CYCLE` (rule 5). |
| `utils/` | `pluginReconciler.js` | T | Reads closures from `pluginGraph` instead of its local `visit` (behaviour unchanged). |
| `routes/` | `plugins.js` | — | Unchanged: the flags travel in the existing bodies. |
| `models/`, `database.js` | — | — | No schema change. |
| `scripts/` | `check-plugin-versions.mjs` | T | `requirementViolations(manifests)` (rule 16). |
| `plugins/weather-alerts/` | `manifest.json` | T | Rule 20: `requires: [{ id: 'sas', range: '^1.7.0' }]`, version 1.3.0 + changelog line. |

**Console (`control-plane/`)**

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `server/src/utils/` | `gf.js` | T | Exposes `pluginGraph`. |
| `server/src/controllers/` | `customerModulesController.js` | T | `requires` / `usedBy` lines (17); `withRequirements` / `withDependents` on toggle (18); dependants dropped with their requirement on plan change (19). |
| `server/src/controllers/` | `catalogueController.js` | T | Refuses an incoherent plan / add-on composition (19). |
| `client/src/components/` | `ModulesSection.jsx` | T | Renders the two lines; confirmation texts from the payload; sends the flag. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PluginCard.jsx` | T | Renders `dependencies.requires` / `usedBy` lines (the server's `label`); disables refused actions with `actions.*.blockedBy`; ConfirmDialog texts from `actions.*.confirm` / `offer.confirm` (`{ title, message, label }`, server-written); sends `withRequirements` / `withDependents`. A plugin left unloaded for a missing requirement shows the one dependency line, not the loader's repeat. |
| `pages/` | `PluginsPage.jsx` | — | Unchanged: `onAction(action, options)` already passes the flags, and `load()` after every action reloads the list (several cards changed). |
| `api.js` | `api.js` | T | `activatePlugin(id, { withRequirements })`, `deactivatePlugin(id, { withDependents })`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ConfirmDialog` (fullScreen on xs) | The unmet status chip; the three confirmations. |
| **Created (new generic)** | — | A dependency line is a caption plus a `StatusBadge`; no new component. |
| **Specific (kept feature-local)** | `PluginCard` (exists) | Only the Plugins page lists plugins. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/plugins` | — | each view + `dependencies: { requires: [{ id, name, range, status, label, updateAvailable }], usedBy: [{ id, name, state }] }`, `actions: { activate, deactivate, uninstall }` each `{ allowed, blockedBy, alsoActivates?: [{id,name}], alsoDeactivates?: [{id,name}] }` | Additive. Managed space: unchanged minimal list. |
| POST | `/api/plugins/:id/install` | `{ withRequirements? }` | view, `reload` | 409 `REQUIREMENTS` lines gain `op: 'install' \| 'activate'`; 409 `REQUIREMENT_CYCLE`. |
| POST | `/api/plugins/:id/activate` | `{ withRequirements? }` | view | 409 `REQUIREMENT_INACTIVE` + `requirements`; 409 `REQUIREMENT_MISSING`. |
| POST | `/api/plugins/:id/deactivate` | `{ withDependents? }` | view | 409 `REQUIRED_BY` + `dependents`; 409 `PLUGIN_BLOCKED` naming the dependant on a cascade. |
| DELETE | `/api/plugins/:id` | — | unchanged | Refusal unchanged, now announced by `actions.uninstall`. |
| POST | console `/api/customers/:id/modules/:pluginId` | `{ on, withRequirements?, withDependents? }` | the GET payload | 422s unchanged without the flag. |
| PUT | console plan / add-on composition | unchanged | unchanged | 422 `REQUIREMENT_NOT_IN_PLAN`. |

All admin-only, as today.

---

## 5. Data model

No schema change, no migration. The graph is recomputed from manifests on every request (16 plugins,
≤ 1 edge each: negligible). **Data impact:** none. Rule 20 adds one edge; an existing space with
`weather-alerts` and without `sas` would see weather-alerts load as « Nécessite Arrivée et départ
guidés » (unloaded, data kept) after the update — the CHANGELOG fragment must say so.

## 6. UI / UX

French copy, short and impersonal. Mockups: the HTML summary (interactive, mobile and desktop).

**PluginCard (space)**
- Under the description, one caption line per edge, in this order: « Nécessite X » then « Utilisé par Y ».
  An unmet requirement adds a `StatusBadge` (`warning`: inactif, hors forfait, version ; `neutral`:
  non installé). Several names join with « , ».
- « Activer » on a plugin whose requirement is off → ConfirmDialog « Activer Google Vacation
  Rentals » / « Active aussi : Réservation depuis le site. » / « Tout activer ».
- « Désactiver… » on a plugin used by an active plugin → the existing ConfirmDialog, title
  « Désactiver Réservation depuis le site ? », message « Désactive aussi : Google Vacation Rentals.
  Réglages et données gardés. À réactiver ensuite un par un. », button « Tout désactiver ».
- « Désinstaller » used by an installed plugin → disabled, with « Utilisé par Google Vacation
  Rentals : à désinstaller d'abord. » under it.
- Install with missing requirements → existing dialog, lines « Installe aussi … 1.8.3 » / « Active aussi … ».

**Responsive:** `xs` — captions wrap under the description, buttons full-width (unchanged card
layout), ConfirmDialog full-screen. `md`/`lg` — unchanged card grid. No PageActionBar change (the
page's bar is untouched).

**Console ModulesSection:** the same two captions under the module name; the switch-on confirmation
is new, the switch-off one gains the list.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `server/src/tests/plugin-graph.unit.test.js` — statuses, labels, closures (order, transitive), cycles (rules 1–5, 7).
- [x] `server/src/tests/plugin-dependencies-actions.unit.test.js` — views (`dependencies`, `actions`); activate with requirements; deactivate cascade all-or-nothing with a blocker; uninstall refusal unchanged (6–8, 11–15).
- [x] `server/src/tests/plugin-install-plan-activate.unit.test.js` — `activate` steps, release and dev-tree plans, `REQUIREMENT_CYCLE` in the plan and in the loader (5, 9–10, 15).
- [x] `server/src/tests/check-plugin-requirements.unit.test.js` — `requirementViolations`, the shipped graph (16, 20).
- [x] `control-plane/server/src/tests/console-module-dependencies.unit.test.js` — lines, cascaded toggles (also over the route), plan coherence (17–19).
- [x] Existing suites kept green: `plugins-activate-requires-active`, `plugin-install-requirement-inactive`, `plugin-reconciler`; `plugins-phase-0/1/4` and `customer-modules-erase` adjusted for the new shipped edge and `op` on plan steps.

### Client tests
- [x] `client/src/components/__tests__/PluginCard.dependencies.test.jsx` — both lines, disabled uninstall, the dialogs send their flag (6–9, 11–15).
- [x] `control-plane/client/src/__tests__/ModulesSection.dependencies.test.jsx` — console lines and confirmations (17–18).

### Manual UI verification
Run on a copy of real data (sources mode), headless Playwright, by the dev and again by the reviewer.
- [x] Happy path: GVR card shows « Nécessite Réservation depuis le site »; website-booking shows « Utilisé par Google Vacation Rentals ».
- [x] Désactiver website-booking with GVR on → « Tout désactiver » → both off; Activer GVR → « Tout activer » → both on.
- [x] Désinstaller website-booking → disabled with the reason.
- [x] Mobile (390 px): captions wrap, no horizontal scroll (also 900 and 1280). Full-screen dialogs are `ConfirmDialog`'s own behaviour, unchanged.
- [x] Console (reviewer): lines, « Active aussi » / « Désactive aussi » confirmations, flags, on a test customer.
- [ ] Console PlanMatrix refusal: not exercised in a browser; covered by `console-module-dependencies.unit.test.js` (matrix click, catalogue save, creation, plan change).

## 8. Out of scope

- **Soft links** (`enhances` / « recommande ») — the SAS steps of linen, gate-access, hourly-resources;
  Neat and online-payment inside website-booking. They refuse nothing, so a field would only add
  vocabulary (Q7).
- **Conflicts** (« incompatible avec X ») — no pair of shipped plugins excludes another.
- **Cascading updates** — an update needs a restart; each plugin keeps its own « Mise à jour » (rule 15).
- **Cascading uninstall** (rule 14).
- **Optional or alternative requirements** (`A | B`), version pinning beyond the existing ranges.
- **Runtime liveness cascade** (`registry.isLive` false when a requirement is not live) — rule 19 keeps
  the console from producing the case; the loader already covers packages.
- A dependency graph view (diagram page): two caption lines per card are enough at 1 edge.

## 9. Open questions

None open. **Resolved 2026-10-29** (owner, AskUserQuestion — each time the recommended option):

- **Q1 — Deactivating a plugin an active plugin uses?** → **Both are switched off, after a
  confirmation that names the dependants** (rules 12–13). Reversible, data kept, no automatic
  re-activation.
- **Q2 — Uninstalling a plugin another installed plugin uses?** → **Refused, with the reason shown
  before the click** (rule 14). Uninstall can erase data; it never cascades.
- **Q3 — Installing or activating on top of an installed but switched-off requirement?** →
  **Proposed in the same confirmation** (« Active aussi … », rules 9 and 11). Replaces the bare 409
  of rule 38 of phase 4 when the operator confirms; without the flag the 409 stays.
- **Q4 — Declare weather-alerts → sas?** → **Yes** (rule 20).
- **Q5 — Show the version range?** → **Only when unmet** (rule 6), e.g. « version 1.6.0 — 1.7.1 ou
  plus récente requise ».
- **Q6 — Plan coherence in the console?** → **Refuse an incoherent plan or option, and drop the
  dependant with its requirement on a plan change** (rule 19). No runtime `isLive` cascade (§8).
- **Q7 — Declare soft links (« Complète … »)?** → **No** (§8). They refuse nothing.

---

## 10. Implementation progress

Implemented 2026-10-29 on `feature/plugin-dependencies`, in three lots: (1) server graph, cascades, loader,
CI check and `weather-alerts` 1.3.0; (2) `PluginCard`; (3) console. Deviations from the draft, all
recorded above: the install 409 keeps rule 38's `REQUIREMENT_INACTIVE` for a plan of switch-ons alone;
a dependant out of plan neither blocks nor follows a deactivation; the console's statuses come from its
own choice (no versions reported); the plan-coherence refusal also covers customer creation and plan
change. The manual UI check (Plugins page at 390 / 900 / 1280 on a copy of real data) is reported in the
hand-off, not here.
