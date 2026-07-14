# GuestFlow Design System — « Maison » reference

> The living version of this document is the admin-only **`/design`** page, which renders every
> token and component from the real theme. This file is the written contract; the umbrella program
> spec is [design-system.md](design-system.md). (Named `-reference` because macOS's case-insensitive
> filesystem forbids `DESIGN-SYSTEM.md` next to `design-system.md`.) Last updated with phase 2
> (2026-07-15).

---

## 1. Tokens (single source: `client/src/theme.js`)

| Token | Value | Use |
|---|---|---|
| `primary.main` | `#2F5D46` | Vert sapin — actions, sélection, focus, aujourd'hui. |
| `secondary.main` | `#C99038` | Miel — accent ponctuel. |
| `background.default` | `#F8F5EF` | Fond papier de l'app. |
| `background.paper` | `#FFFFFF` | Cartes. |
| `text.primary` / `text.secondary` | `#27251F` / `#6E6A5E` | Encre chaude / atténuée. |
| `success/warning/error/info` `.main` + **`.soft`** | see `/design` | `.soft` = fond des puces de statut. |
| `divider` | `rgba(60,54,36,0.1)` | Filets chauds. |
| `shape.borderRadius` | `14` | Global. |
| Card/Paper shadow | `0 3px 16px rgba(60,54,36,0.09)` | Ombre chaude. |

- **Spacing scale**: `0.5, 1, 1.5, 2, 3` — nothing else in `Stack` spacing / `gap` / paddings.
- **Content max-widths**: `900` (forms) or `1240` (wide pages). Two values, no others.
- **Colors**: never inline hex/rgba in pages — palette tokens or `alpha(theme.palette…)`. Domain hex
  lives in `constants/` (platforms, school zones) only.

## 2. Typography roles (custom variants)

| Variant | Face | Role |
|---|---|---|
| `pageTitle` | Source Serif 4, 600 | THE page title — rendered by `PageActionBar`/`PageHeader` only. |
| `sectionHeader` | Source Serif 4, 600 | Section headings inside a page. |
| `kpiValue` | Inter 700, `tabular-nums` | KPI figures. **Amounts/dates never render in serif.** |
| `kpiLabel` | Inter 600 0.72rem | KPI captions (pair with `color: 'text.secondary'`). |

Raw `h4`/`h6` page titles and `subtitle*`+`fontWeight` section headers are legacy — migrate on touch.
Specimens/demos must pass `component="p"` so they don't inject headings into the document outline.

## 3. Money & dates (`utils/formatters.js` — the only formatters)

| Function | Output | Use |
|---|---|---|
| `formatCurrency(n)` | `1 234,50 €` | **Rows, footers, totals, actionable chips — any exact amount.** |
| `formatCurrencyRounded(n)` | `1 235 €` | KPI tiles & chart labels ONLY (overview style). |
| `displayDate(iso)` | `10/07/2026` | Plain date columns/fields (empty → `—`). |
| `displayDateShort(iso)` | `10 juil. 2026` | Compact humanized (alerts, dialogs). |
| `displayDateLong(iso)` | `10 juillet 2026` | Prose-like contexts. |
| `displayDateTime(iso)` | `10/07/2026 14:35` | Timestamps. |

No local `toFixed(2)+'€'`, no local `toLocaleDateString` for these roles. Deliberate contextual
formats (weekday-long planning labels) may stay local.

## 4. Page actions — the top-right bar (umbrella §3.4)

All page-level actions live **exclusively** in `PageActionBar`:
`[Back] [Title] … [actionsBefore] [Save filled primary] [Cancel bordered] [actionsAfter destructive]`.
One icon per role app-wide: Save `SaveIcon` · Cancel `CloseIcon` · Delete `DeleteIcon` (error) ·
Sync `SyncIcon` (info) · PDF `DescriptionIcon` (info). Icon-only buttons carry a French `Tooltip`
**and** `aria-label`; ≥44 px targets. Labeled create-CTAs use an `actionsBefore` `node` item
(`DataPageScaffold` does this for you).

## 5. Tables (umbrella §3.5)

- Text left; **amounts/counts right with `tabular-nums`**; header aligns like its column body.
- Currency via `formatCurrency`; status column via `StatusBadge`; platform via `PlatformChip`.
- Empty cell → `—`; empty list → `EmptyState`.
- Always scroll-contained (`TableCard`); operator-critical lists get cards on xs via
  `ResponsiveTable` (`renderMobileCard`).

## 6. Component catalogue (`client/src/components/`)

| Component | Use | Never |
|---|---|---|
| `PageActionBar` | Every page's title + actions. | Hand-rolled sticky headers. |
| `DataPageScaffold` | List/CRUD pages (bar + filters + table + empty). | Rebuilding the trio by hand. |
| `LoadingState` | Loading placeholder (`spinner`/`skeleton`). | Inline `CircularProgress` / « Chargement… » text. |
| `EmptyState` | Empty lists, 404, crash fallback. | Ad-hoc « Aucun… » Typographies. |
| `ErrorAlert` | Load/action failure, optional `onRetry`. | Silently swallowing a fetch error. |
| `useToast()` | Post-action feedback (`showSuccess`/`showError`). | Inline success Alerts, `window.alert`, success modals. |
| `useAppDialogs()` | `confirm` / `alert` (**options object**) / `openForm`. | Raw `<Dialog>` for these roles. |
| `FormDialog` / `ConfirmDialog` | Form/confirm dialogs — fullScreen on xs built-in. | Forgetting they exist. |
| `UnsavedChangesDialog` | The one dirty-form prompt (stay first, « Enregistrer »). | Page-local variants. |
| `StatusBadge` | Status chips — soft bg + dark text. | Filled semantic Chips; local StatusBadge clones. |
| `PlatformChip` | Platform badges (color via `getPlatformColor`). | Hand-rolled boxes/chips. |
| `ResponsiveTable` | Table md+ / cards xs. | Scroll-only tables for operator-critical lists. |
| `TableCard` | Scroll-contained table wrapper. | Raw unwrapped `<Table>`. |
| `ErrorBoundary` (`RouteErrorBoundary`) | Wraps the routed shell. | — (already mounted). |
| `ScrollToTop` | Mounted once — pages open at the top. | — (already mounted). |
| `MaskedTextField` / `HelpedTextField` / `SummaryItem` / `StatusCard` | Settings-style forms & health cards. | One-off equivalents. |

**Load vs action rule:** a *load* failure renders a persistent `ErrorAlert` (with retry); an *action*
outcome toasts. A toast is never a substitute for « impossible de charger la page ».

## 7. Dialogs & feedback

- Shared dialogs are fullScreen under `sm` (built into the primitives).
- Toasts: bottom-center, one at a time, success 4 s / error 6 s, soft semantic background.
- `alert()` takes an **options object** (`{ title, message }`) — never a bare string.

## 8. Per-page done-criteria (sweeps)

See [design-system.md §3.9](design-system.md) — the checklist every swept page must satisfy.
