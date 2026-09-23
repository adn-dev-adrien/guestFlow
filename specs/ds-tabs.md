# Design system — one tab pattern for the whole app

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/ds-tabs` |
| **Created** | 2026-09-23 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Tabs are drawn by hand in seven places, and no two look alike. The audit of 2026-09-23 (maquette:
`docs/specs/2026-09-23-tabs-design-unification.html`) found four distinct renderings:

| Screen | Where the tabs sit | Deviation |
|---|---|---|
| `PropertyDetail` (6 tabs) | A detached strip **under** the bar, on the paper background | Left-aligned, full-width divider, `mb: 2`, **not sticky** — the tabs scroll away |
| `OptionsResourcesPage`, `SeasonsClosuresPage`, `ClientsPage` | **Inside** the white sticky bar, centred (`center` slot) | `minHeight: 40` |
| `EmailHistoryPage` | Inside the filter card, `variant="fullWidth"`, `maxWidth: 420` | `minHeight: 44`, stretched tabs |
| `FinancePage` (×2), `TermsSettingsPage`, `ArchivedHtmlDialog` | Inside a card / a dialog | Three different spacings, with or without a bottom border |

On top of the inconsistency, the wrapper pattern has a **defect on `xs`**: `OptionsResourcesPage` and
`SeasonsClosuresPage` render their tab strip **above** the child's `PageActionBar`, and since the bar
hides its title on `xs`, the page shows a strip of tabs followed by a white bar containing nothing but
« Nouvelle option » — **no page title at all**.

`specs/design-system.md` never covered tabs: the « Maison » direction defines typography, radius, cards,
badges and the sticky bar, but no tab role. Every page therefore invented its own.

## 2. Goal

Tabs look and behave the same everywhere in GuestFlow — same place, same typography, same touch target,
on desktop as on mobile — and a page can no longer invent its own.

## 3. Functional rules

1. **One component.** A generic `PageTabs` (`client/src/components/PageTabs.jsx`) is the only way to draw
   tabs. No page keeps a hand-written `<Tabs>`/`<Tab>` pair or tab-specific `sx`.
2. **Page-level tabs live in the sticky bar** (direction B, arbitrated 2026-09-23): on `sm+` they render
   **centred** in `PageActionBar` via a new `tabs` prop; on `xs` they render as a **second row of the same
   sticky block**, directly under the title row — never above the bar, never on the paper background.
3. **The title is always visible when tabs are present.** Passing `tabs` to `PageActionBar` implies
   `titleOnXs`: the mobile bar can never be an anonymous row of actions again.
4. **Card-level tabs** (a switch that belongs to one card or dialog, not to the page) use the same
   component with `variant="card"`: same typography, left-aligned, a bottom divider and a standard
   `mb: 2` rhythm. No forced width, no `fullWidth` stretching.
5. **Typography.** Labels in sentence case — no more CSS uppercase, consistent with the theme's buttons.
   Inactive: `text.secondary`, weight 500. Active: `primary.main`, weight 600. Font size `0.9rem`.
6. **Touch target 44 px.** `minHeight: 44` on the strip and on each tab, both variants (CLAUDE.md §7
   responsive rules); the indicator is a 2 px bar with a 2 px top radius in `primary.main`.
7. **Overflow scrolls, it never wraps or truncates.** Every strip is `variant="scrollable"` +
   `allowScrollButtonsMobile`; the page body never gains a horizontal scrollbar because of tabs.
8. **A tab may carry a badge** — a small node rendered after the label (the property « modifié » /
   « erreur » dot). The tab stays reachable by its label; when the badge carries its own
   `aria-label`, it joins the accessible name (« Général modifié »), which is the behaviour the
   property page already had and is worth keeping for a screen reader.
9. **The defaults live in the theme.** `MuiTabs` / `MuiTab` overrides in `client/src/theme.js` carry the
   look (rule 5, 6), so a stray `<Tabs>` written later still lands on the house style; `PageTabs` carries
   the structure and the behaviour (rules 4, 7, 8).
10. **Nothing about tab content changes** — same labels, same order, same `?tab=` URLs, same routes.

**Edge cases:**
- 6 long labels + a long page title on a laptop (~1040 px of content) → the tabs scroll **inside** the
  bar, with `allowScrollButtonsMobile` arrows; the title ellipsizes rather than pushing them out.
- A wrapper page whose child is a standalone route (`/options`, `/school-holidays`) → no tabs passed, the
  bar renders exactly as today.
- `center` and `tabs` on the same bar → `tabs` wins the centre column; no page does this today, and the
  JSDoc states they are mutually exclusive.

---

## 4. Architecture

Pure client-side change: presentation only. No server layer is touched, no payload, no business rule.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| all | — | — | (none — no server change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PageTabs.jsx` | C | The one tab component: items, value, onChange, `variant` (`bar` \| `card`), badge slot, scrollable overflow. |
| `components/` | `PageActionBar.jsx` | T | New `tabs` prop: centre column on `sm+`, second row inside the same sticky block on `xs`; implies `titleOnXs`. |
| `components/` | `DataPageScaffold.jsx` | T | `barCenter` → `barTabs` passthrough to `PageActionBar.tabs`. |
| `components/` | `PricedItemsPage.jsx` | T | Same rename, passthrough to `DataPageScaffold`. |
| `components/` | `ArchivedHtmlDialog.jsx` | T | Dialog tabs → `PageTabs variant="card"`. |
| `components/` | `EmailSequenceSimulation.jsx` | — | Untouched: it already receives the tabs as an opaque `tabs` node. |
| `pages/` | `PropertyDetail.jsx` | T | Detached strip removed; tabs move into its `PageActionBar` (`tabs` prop), badge = the dirty/error dot. |
| `pages/` | `OptionsResourcesPage.jsx`, `SeasonsClosuresPage.jsx` | T | Build a `PageTabs`, hand it to the active child as `barTabs`; the `xs` strip they rendered themselves disappears (the bar owns it). |
| `pages/` | `OptionsPage.jsx`, `ResourcesPage.jsx`, `BillableAmountsPage.jsx`, `SchoolHolidaysPage.jsx`, `EstablishmentClosuresPage.jsx` | T | `barCenter` prop → `barTabs`. |
| `pages/` | `ClientsPage.jsx` | T | Bucket tabs → `PageTabs`, passed as `barTabs`; its own `xs` strip removed. |
| `pages/` | `EmailHistoryPage.jsx` | T | Card tabs → `PageTabs variant="card"`; the 420 px cap disappears. |
| `pages/` | `FinancePage.jsx` | T | Both in-card strips (chart switch, list switch) → `PageTabs variant="card"`. |
| `pages/settings/` | `TermsSettingsPage.jsx` | T | FR/EN draft tabs → `PageTabs variant="card"`. |
| `theme.js` | `theme.js` | T | `MuiTabs` / `MuiTab` overrides: sentence case, 44 px, weights, indicator. |

**Test harness (root):** `e2e/clientUrl.js` (C) holds the client dev origin — 3000 by default,
`E2E_CLIENT_PORT` when that port is taken locally — and `playwright.config.js`, `e2e/global-setup.js`,
`e2e/fixtures/apiSeed.js` and the four specs that opened their own request context (T) all read it
instead of hardcoding `localhost:3000`. The client dev server now starts with `--strictPort`, so a
busy port fails the run instead of silently testing a neighbouring app — which is exactly what
happened while verifying this spec.

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `DataPageScaffold`, `PricedItemsPage` | Pre-existing; extended, not forked. |
| **Created (new generic)** | `PageTabs` | Generic by construction: it is consumed by 7 unrelated screens (a property form, three settings catalogs, a client list, an email history, a finance dashboard, a CGV editor, a dialog). JSDoc lists props + the two variants. |
| **Specific (kept feature-local)** | — | None. The property « modifié » dot stays in `PropertyDetail` and is injected through the generic `badge` slot. |

### 4.3 API contract

No endpoint touched.

---

## 5. Data model

No schema change, no migration, no data impact.

## 6. UI / UX

**Page-level tabs (`variant="bar"`)** — `PropertyDetail`, `OptionsResourcesPage`, `SeasonsClosuresPage`,
`ClientsPage`:

- `sm+` — one sticky white block: `[Retour] [Titre] … [Onglets centrés] … [actions / CTA]`. The strip has
  no border of its own; the bar's bottom border closes the block.
- `xs` — the same block on two rows: row 1 `[Titre] … [CTA]` (the title is now always shown), row 2 the
  tabs, full width, horizontally scrollable, separated from row 1 by a hairline `divider`.
- The property tabs stop scrolling out of view: they stay stuck under the app header like every other page.

**Card-level tabs (`variant="card"`)** — `EmailHistoryPage`, `FinancePage` (×2), `TermsSettingsPage`,
`ArchivedHtmlDialog`: left-aligned at the top of the card/dialog content, bottom divider, `mb: 2` before
the content. Same typography and 44 px target; scrollable on `xs` like the rest.

**Copy:** unchanged everywhere. Only the CSS casing changes (`GÉNÉRAL` → `Général`).

**Sticky action bar:** every page in scope keeps its existing `PageActionBar` contract (title, actions,
CTA); the only addition is the `tabs` prop described above.

## 7. Test plan

### Server unit tests
None — no server-side logic (CLAUDE.md §9 "tests not required for pure styling changes").

### Client unit tests (Vitest) — 7 new tests, suite green at 1311
- [x] `components/__tests__/PageTabs.render.test.jsx` — renders one `role="tab"` per item, marks the active
      one `aria-selected`, fires `onChange` with the clicked value, renders the badge node, keeps the
      label as the accessible name (rules 1, 5, 8).
- [x] `components/__tests__/PageActionBar.tabs.test.jsx` — with `tabs`, the node is rendered and the title
      is present even when `titleOnXs` was not passed (rules 2, 3).

### E2E (Playwright) — 2 new tests, suite green at 84 passed / 1 skipped
- [x] `e2e/specs/mobile/page-tabs.spec.js` — at 390 px on `/parametres/options-ressources`: the page title
      is visible, the tabs come **after** the title in the DOM, switching tab keeps both visible, and the
      document has no horizontal overflow (guards the defect of §1).
- [x] Full suite re-run: no selector moved (CSS casing does not change an accessible name).

### Manual UI verification (done 2026-09-23, screenshots at 1400 px and 390 px)
- [x] `/properties/:id` at 1400 px: tabs centred in the bar, scrollable, dirty dot still shown, tabs stay
      stuck when the form scrolls.
- [x] `/properties/:id` at 390 px: title on row 1, tabs on row 2, no horizontal page scroll.
- [x] `/parametres/options-ressources` and `/parametres/vacances-fermetures` at 390 px: title visible
      (the fixed defect), tabs under it, `?tab=` still drives the selection.
- [x] `/clients`, `/emails/historique`, `/finance`, `/parametres/conditions-generales`: same typography and rhythm, no
      regression on the filters/tables that follow the tabs.

## 8. Out of scope

- Tab **content**, order, labels, routes and `?tab=` params — untouched.
- `PageActionBar`'s `center` slot for non-tab nodes (date navigation, property picker): unchanged.
- The sidebar, the app header, and any other navigation surface.
- A tab-level "unsaved changes" guard or any behaviour beyond selection.

## 9. Open questions

- Q: Tabs in the bar (B) or on a second line everywhere (A)?
  - A (2026-09-23, Adrien): **B — in the bar, centred**, with the `xs` fallback on a second row of the
    same block. The 6-tab property page fills the bar on a laptop; accepted, it scrolls inside the bar.
- Q: Underline or segmented pills?
  - A (2026-09-23, Adrien): **refined underline** — sentence case, fir-green active, 2 px indicator.
- Q: Scope limited to page tabs, or all seven sites?
  - A (2026-09-23, Adrien): **all seven**, through one component.
