# Integrations — one tab per plugin

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/integrations-tab-per-plugin` (from `inte/plugins`) |
| **Created** | 2026-10-22 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Summary for review** | [`docs/specs/2026-10-22-integrations-tab-per-plugin.html`](../docs/specs/2026-10-22-integrations-tab-per-plugin.html) |
| **Builds on** | [`plugins-phase-1-sdk.md`](plugins-phase-1-sdk.md) rule 13 (slot `settings.integrations`), [`plugins-phase-0-foundation.md`](plugins-phase-0-foundation.md) rules 25–27 (`#plugin-<id>` anchor), [`ds-tabs.md`](ds-tabs.md) |

---

## 1. Context

Paramètres › Intégrations (`IntegrationsSettingsPage.jsx`) stacks, one under the other, the
sections that seven plugins contribute to the `settings.integrations` slot: website booking, Google
Agenda, Neat, Météo-France, the Sowel gate, the Gîtes de France intake and the Booking intake. On
Solio, reaching the Booking section means scrolling about four screens. The Plugins page's
« Configurer » reaches a section through a `#plugin-<id>` anchor that has to be held in place while
the lazy sections above it load and grow (`useAnchorScroll`, phase 0 rules 26–27).

Owner's remark (2026-10-22): « il faudrait un onglet par plugin dans la page Intégration ».

## 2. Goal

Each active plugin that contributes to Intégrations gets its own tab, so its settings open on their
own, from the page or from any link that points at that plugin.

## 3. Functional rules

1. **One tab per plugin, not per section.** The tabs are built from the `settings.integrations`
   contributions of the active plugins, grouped by `pluginId`; a plugin contributing two sections
   shows both, in their `order`, under its one tab. Tabs follow the order of each plugin's first
   section. Nothing in the page names a plugin: installing one adds its tab, switching one off
   removes it.
2. **Tabs live in the page action bar** (`PageActionBar` `tabs` slot, `PageTabs` variant `bar`,
   `ds-tabs.md` rule 2): centred on `sm+`, second row of the sticky block on `xs`, scrolling, never
   wrapping.
3. **A single plugin draws no tab strip.** With one contributing plugin the page shows its
   section(s) directly, as today.
4. **Tab label.** _(arbitration 1, 2026-10-22: short labels)_ A short label each plugin's client module
   declares on its contribution (`tabLabel`): Site, Google Agenda, Neat, Météo-France, Portail,
   Gîtes de France, Booking. Without one, the tab falls back to the plugin's catalogue name.
5. **The open tab is in the URL** as `?tab=<pluginId>`. Changing tab replaces the history entry
   (`ds-tabs.md` behaviour: Back leaves the page). A missing, unknown or inactive `tab` opens the
   first tab and rewrites the URL with `replace`.
6. **Old anchors keep working.** `/settings/integrations#plugin-<id>` opens that plugin's tab and
   rewrites the URL to `?tab=<id>`. The server's « Configurer » targets
   (`server/src/constants/plugins.js`) move to `?tab=<id>`.
7. **The Google OAuth return opens the Google tab.** `?google=connected|error|invalid_state` with no
   `tab` selects `google-calendar`; the section reads the parameter as today.
8. **Settings search opens the tab.** A search keyword of the Intégrations page that belongs to one
   plugin (Neat, Météo-France, Sowel…) navigates to `?tab=<that plugin>`. The keywords move from the
   hard-coded list in `settingsMenu.js` to each contribution (`keywords`), so a new plugin brings
   its own.
9. **A section mounts on the first opening of its tab and stays mounted.** Hidden tabs are not
   rendered before they are opened (no layout measured while hidden); once opened, a tab keeps its
   component so its draft survives a switch.
10. **Unsaved changes across tabs.** _(arbitration 2, 2026-10-22: keep the draft)_ Switching tab never
    asks nor discards; a tab with unsaved changes carries the « modifié » dot (`PageTabs` `badge`).
    Save saves every dirty tab in tab order; Cancel resets them all. The first tab whose save is
    refused stops the run, becomes the open tab, and its own error shows as today; the tabs saved
    before it stay saved.
11. **Plugin to set up.** _(arbitration 3, 2026-10-22: amber dot)_ The tab of an active plugin whose
    setup state is « à configurer » (the `setup` view `GET /api/plugins` already returns for the
    Plugins page) carries an amber dot. A refused or modified tab shows its own dot instead (one dot
    at a time: refused > modified > to set up).
12. **Keyboard.** Tabs follow the `PageTabs`/MUI tablist behaviour (arrow keys move, the panel is
    labelled by its tab).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Change |
|---|---|---|
| `constants/` | `plugins.js` | « Configurer » targets become `/settings/integrations?tab=<id>` (rule 6) |
| `tests/` | `plugins-setup-state.unit.test.js`, `settings-summary.unit.test.js` | expectations follow the new target |
| `controllers/` | `settingsSummaryController.js` | unchanged: it counts the plugins to set up by the `/settings/integrations` prefix, which `?tab=` keeps; the summary row opens the page, whose first tab then shows |

No route, model or schema change.

### 4.2 Client side (`client/src/`)

| Layer | File | Change |
|---|---|---|
| `pages/settings/` | `IntegrationsSettingsPage.jsx` | groups contributions by plugin, renders `PageTabs` in the bar, mounts on first open, dirty/refused/to-set-up dots, save loop that stops on the first refusal and opens its tab, URL ↔ tab sync, `#plugin-` and `?google=` mapping |
| `components/` | `SettingsFormPage.jsx` | new optional `tabs` prop, passed to `PageActionBar` |
| `components/` | `TabDot.jsx` (new, generic) | the dot after a tab label (`color`, `label`); also used by `PropertyDetail` for its modified / refused tabs |
| `hooks/` | `useAnchorScroll.js` | **removed** with its suite: Intégrations was its only user (phase 0 rules 26–27 replaced) |
| `constants/` | `settingsMenu.js` | `INTEGRATIONS_PATH`; Intégrations leaves `SETTINGS_KEYWORDS`, its words come from the contributions |
| `pages/settings/` | `SettingsHomePage.jsx` | searches the Intégrations row with the contributions' `keywords`; a word of one plugin links to `?tab=<id>` (rule 8) |
| `plugins/*/index.js` | the seven contributing modules | `tabLabel` and `keywords` on their `settings.integrations` contribution |
| `plugins/sdk/` | slot docs | `settings.integrations` contribution shape gains `tabLabel?`, `keywords?` |

Consumes `PageTabs`, `PageActionBar`, `SettingsFormPage`; creates `TabDot` (second use of the dot drawn inline by `PropertyDetail`).

### 4.3 API contract

Unchanged. `GET /api/plugins` already returns `setup` per plugin (rule 11).

## 5. Data model

None.

## 6. UI / UX

See the interactive summary. Desktop: title left, tabs centred, Save/Cancel right. Mobile: tabs on
the bar's second row, horizontally scrollable, the open tab scrolled into view. Tab switch: a short
fade of the panel, none under `prefers-reduced-motion`.

## 7. Test plan

- **Client (Vitest)** — suite green at **2046** (385 files):
  - new `pages/settings/__tests__/IntegrationsSettingsPage.tabs.test.jsx` (12 tests): rules 1, 2, 4
    (one tab per plugin, in the bar, short label or catalogue name, two sections under one tab),
    3 (one plugin → no strip), 5 (`?tab=` opens, a click names the new tab, unknown/inactive → first,
    rewritten), 6 (`#plugin-neat`), 7 (`?google=connected`), 9 (mount once, stay mounted), 10 (draft
    kept + « modifié », save stops on the refusal and opens it, the tabs before stay saved, Cancel
    resets all), 11 (amber dot, replaced by « modifié »), 12 (arrow keys);
  - new `pages/settings/__tests__/SettingsHomePage.integration-tabs.test.jsx` (3 tests): rule 8;
  - new `plugins/sdk/__tests__/settingsIntegrations.contributions.test.js` (2 tests): rules 4 and 8 on
    the real modules;
  - adapted: `plugins/neat/__tests__/IntegrationsSettingsPage.neat-save.test.jsx` (opens `?tab=neat`,
    switches to Météo-France for the two-card save), `constants/__tests__/settingsMenu.groups.test.js`,
    `PluginCard.setup`, `PluginsPage.to-configure`;
  - removed: `hooks/__tests__/useAnchorScroll.settle.test.jsx` (with the hook).
- **Server** — 5799 / 5799; `plugins-setup-state` and `settings-summary` follow the `?tab=` target.
- **E2E** — 147 passed, 1 skipped. `plugins/plugins-page.spec.js`: « Configurer » on Google Agenda,
  Neat and Vigilance Météo-France opens its tab at 390 and 1280 px without horizontal page scroll;
  an old `#plugin-neat` link becomes `?tab=neat`; at 390 px the strip scrolls inside the bar.
  `neat.spec.js` and `booking-intake.spec.js` open their tab.
- **Manual** — E2E database (every plugin active), screenshots at 1400 / 900 / 390 px (in the PR).

## 10. Implementation notes

- **Colours of the dots.** « modifié » is the primary (fir-green) dot shown on the summary page,
  « à configurer » the amber one, « refusé » red. On `PropertyDetail` « modifié » stays amber: that
  page has no « to set up » state to tell apart, and its look is unchanged by this spec.
- **Width.** At 1400 px with seven tabs and the subtitle, `PageActionBar` moves Save / Cancel to a
  row of their own (its existing rule when the actions do not fit); at 900 px the tabs take the
  second row and scroll.
- **Google return.** The page writes `?tab=google-calendar` next to `?google=…` before the Google
  section (lazy) reads and strips its parameter, so the tab survives the clean-up.

## 8. Out of scope

- The content of each section (cards, fields, texts).
- Any other Settings page.
- An « all » tab or a summary tab (the Plugins page plays that role).

## 9. Open questions

None. Resolved 2026-10-22 by the owner on the interactive summary, each time the recommended option:

1. Tab labels → **short labels** declared by each plugin (rule 4).
2. Unsaved changes on tab switch → **the draft is kept**, Save runs every dirty tab (rule 10).
3. Plugin to set up → **amber dot** on its tab (rule 11).
