# GuestFlow design — « Maison »

Read before any UI work. Self-sufficient: it replaces the `apple-design` and `impeccable` skills on this
repo (don't load them). Values live in `client/src/theme.js` (wins on conflict); component catalogue in
`specs/design-system/design-system-reference.md` §6; `PageActionBar` contract, responsive and component-reuse rules
in `CLAUDE.md` §7 — not repeated here.

## Direction
The owner's desk in a well-kept guest house: warm paper, fir-green ink, a touch of honey, serif titles
like a house-book — over the precision of a ledger. An **operating tool** (laptop at the office, phone in
the field, one hand, sunlight, interrupted tasks): scanability and consistency over expression; the brand
lives in details. Moderate density; each screen answers the day ahead first.

## Principles
- **Earned familiarity** — a back-office user trusts every control at first sight. No invented
  affordance, odd control or decorated button. Same action, same look everywhere.
- **Purpose** — every element earns its place. Common path first, advanced one level down
  (`AdvancedDetails`, `CollapsibleSection`). Simple ≠ minimal: added context can simplify.
- **Wayfinding** — where am I (title, selected nav row/tab), what's here, way back (`backTo`). No dead end.
- **Grouping** — a control sits beside what it changes; tight within a group, generous between groups,
  more space above a heading than below.
- **Forgiveness** — undo or an editable draft (Save/Cancel) over confirmation; `confirm()` only for
  destructive, irreversible actions.
- **Specific words** — controls named by their action (« Relancer l'acompte »), nav by content; errors
  say the problem and the way out. UI text French, short, impersonal.

## Tokens (`theme.palette.*` etc. — never a literal in a page)
| Path | Value | Use |
|---|---|---|
| `primary.main` / `.dark` | `#2F5D46` / `#214131` | Fir — the ONLY action/selection/focus colour; Save, active tab, today, app name |
| `secondary.main` | `#C99038` | Honey — rare accent, never an action |
| `background.default` / `.paper` | `#F8F5EF` / `#FFF` | Paper (app + sidebar) / white surfaces (cards, dialogs, bars) |
| `text.primary` / `.secondary` | `#27251F` / `#6E6A5E` | Ink / muted ink (secondary text, inactive tabs, labels, ticks) |
| `divider` | `rgba(60,54,36,.1)` | Every rule and 1 px border |
| `<sem>.main` · `.soft` · `.text` | success `#3E7D54` · warning `#8F6A1D` · error `#A8433A` · info `#31556E` · neutral `#6E6A5E` | `main` icons/borders, `soft` chip/glyph bg, `text` = text on soft (≥ 4.5:1) |
| `chart.*` | see theme | `current` fir, `upcoming`/`today` deep honey, `lastYear` sand + `lastYearEdge`, `grid` (decoration only), `series` (per property), `categorical` (no red — red is for alerts), `other` warm grey |
| `shape.borderRadius` | 14 | `borderRadius: 1` = 14 px. Exceptions: nav rows `2` (28 px), severity glyph 10 px, counts/chips pill |
| spacing | `0.5 1 1.5 2 3` | Only these steps; less on xs (`p: { xs: 1.5, sm: 2 }`) |
| max-width | `900` / `1240` | Forms & settings / wide pages. Nothing else |
| shadows | card `0 3px 16px rgba(60,54,36,.09)` (theme default on Card/Paper) · panel `0 1px 2px rgba(39,37,31,.04)` + 1 px border · choice tile `0 2px 10px rgba(60,54,36,.07)` | Warm, low, ambient; never black, stacked or glowing. Top bar & page bar flat |
| breakpoints | xs <600 · sm 600 · md 900 · lg 1200 | Check at ≤600, ~900, ≥1200 |

Colour rules: domain colours (platforms, school zones) only in `constants/`; otherwise `alpha(theme.palette…)`.
Contrast: text ≥ 4.5:1, large text & chart marks ≥ 3:1, visible focus everywhere; inactive = muted, never saturated.

## Typography
Inter (400–700) + Source Serif 4 (600), self-hosted. Use the named variants, never raw `h4`/`h6`:
- `pageTitle` serif 600 1.35rem (1.2 on xs) — the one `h1`, drawn only by `PageActionBar` (top bar on phone)
- `sectionHeader` serif 600 1.05rem — `h2`, empty-state titles
- `kpiValue` Inter 700 1.6rem tabular · `kpiLabel` Inter 600 .72rem muted
- `panelLabel` Inter 600 .74rem, .09em, UPPERCASE, muted — `Panel` titles; the app's only uppercase
- body1/body2 1rem/.875rem; buttons & tabs sentence case, 500 (600 selected)

**Ledger rule:** amounts, dates, counts, times — never serif, always `tabular-nums`, right-aligned in
tables, formatted only by `utils/formatters.js` (`formatCurrency` exact; `formatCurrencyRounded` KPI &
chart labels only; `displayDate*`). Serif nowhere else than the two title roles.
Fixed `rem` scale, never `clamp`/`vw`; hierarchy = weight + size + leading, emphasis by weight; tracking
0 (except `panelLabel`); prose ≤ 75 ch, tables may be denser.

## Layout
- Shell: white flat top bar 56/64 px + bottom rule (serif 700 fir app name; on phone it shows the page
  title and may take a lone page action) · 256 px paper sidebar (drawer on mobile), `ListItemButton`
  rows radius 28, sub-items `pl: 6` body2, selected = 8 % fir tint · main `px {xs 1.5, sm 2, md 3}`,
  `py {xs 2, md 3}` · pages open at the top (`ScrollToTop`).
- Page sticky elements stick at `var(--gf-page-bar-bottom)`. Page tabs = `PageTabs` in the bar's `tabs` slot.
- Reports: grid of `Panel`s, 2 per row desktop, 1 on phone.
- Tables: `<Table>` from md in `TableCard`; operator-critical lists → cards on xs (`ResponsiveTable`);
  empty cell `—`. Never page-level horizontal scroll on xs.
- **Thumb rule** (< sm, stacked actions in a flow or dialog): at the bottom; secondary first (neutral,
  text/outlined), primary **last, filled, full width**; bottom bars pad `env(safe-area-inset-bottom)`.
  From sm: one row, right-aligned, primary last.
- 44 × 44 touch targets — the theme enforces it on coarse pointers; never force smaller sizes.

## Components (assemble, don't restyle)
- **Buttons:** sentence case, 500. One contained (fir) per area max — dialog submit, an attention card's
  primary, an empty-state CTA; others text/outlined (`color="inherit"` when neutral). In the page bar,
  Save is the only filled button; one icon per role: Save `SaveIcon`, Cancel `CloseIcon`, Delete
  `DeleteIcon` (error), Sync `SyncIcon` (info), PDF `DescriptionIcon` (info).
- **Status:** `StatusBadge` (600, `<sem>.soft` bg + `<sem>.text`; `wrap` for long labels) or `softChipSx`
  for custom-size chips. Never a filled semantic chip. Platforms → `PlatformChip`.
- **Card** white, card shadow, `p {xs 1.5, sm 2}` · **Panel** white, 1 px divider, panel shadow,
  `panelLabel` row + optional action · **AttentionCard** — the one "needs the operator" recipe: 32 px
  severity glyph (radius 10, soft bg, `main` icon), 600 title + `CountChip` (pill, tabular), muted detail,
  text actions with ≤ 1 filled, border `divider` or `error.main` if urgent; words from the server.
- **Fields:** MUI outlined. The theme keeps 12 px above floating labels — no local margins. Reuse
  `DateField`, `QuantityField`, `BoundedNumberField`, `ArithmeticTextField`, `MaskedTextField`,
  `HelpedTextField`, `SearchField`, `ClientPickerField`. Refusals shown on the field, validated inline
  (on type/blur), never only in a toast.
- **Feedback homes:** status → `StatusBadge` / bar `progress` · completion → `useToast()` (bottom-centre,
  full width on xs, one at a time, soft bg, 4 s / 6 s error) · warning → `AttentionCard` or helper text ·
  error → field helper (input), persistent `ErrorAlert` + retry (load), toast (action).
- **Loading:** skeleton in content (`LoadingState variant="skeleton"`), spinner only inside the button/bar
  that triggered the work. **Empty:** `EmptyState` (muted 44 px icon, optional serif title, ≤ 420 px message, optional CTA).
- **Dialogs last:** only to interrupt (irreversible confirm) or protect focus (detached form) — else inline,
  expand, or `SidePanel`. Use `FormDialog`/`ConfirmDialog`/`useAppDialogs()` (full-screen on xs built in),
  `UnsavedChangesDialog` for dirty forms.
- **Icons:** `@mui/icons-material`, one style per screen, or an authored SVG in the same stroke
  (`BedIcon`, `WheatIcon`). Never emoji or glyphs.

## States & motion
- Every control ships **default, hover, focus-visible, pressed, disabled, loading, error**; every view
  **empty** and **success**. A disabled action whose reason matters stays focusable (`ariaDisabled`) with
  the reason as tooltip. Tab order = reading order.
- Respond on press (ripple/`:active`), no artificial delay on the input path.
- 120–250 ms; `ease-out` for tints, `cubic-bezier(0.2,0,0,1)` for expand/collapse. Animate only
  transform, opacity, color, background-color, border-color. No load choreography, staggers or loops.
- Interruptible: never block input mid-transition; restart from the current position. Gestures (planning
  drag, sheet swipe) track 1:1 from the grab point with springs (no bounce unless flicked) taking the
  release velocity, and never swallow page scroll.
- Exit the way you entered; menus grow from their trigger; overlays in a portal (never clipped).
- `prefers-reduced-motion`: remove movement (slides, scales, rotations, springs; dialogs
  `transitionDuration={0}`), keep helpful colour/opacity changes — never a global kill.

## Never
Filled status colours · serif numbers · hex/rgba or a new radius/shadow/width/spacing in a page · hand-rolled
sticky header, tabs, `<Dialog>`, spinner or « Aucun… » text · uppercase buttons/tabs · a 2nd filled button
beside Save · honey as an action · a swallowed load error or a toast in its place · a card in a card · pages
of identical icon+title+text cards · eyebrow labels above headings · decorative section numbers · gradient
text · decorative blur/glass · coloured side border > 1 px · hard offset shadows · a confirm where undo would do.

## Before the PR
On the real app at ≤600, ~900, ≥1200; report what was checked and what couldn't be.
1. **A11y** — contrast in every state; French tooltip + `aria-label` on icon buttons; headings h1 (bar) →
   h2 → h3 (panels); labelled fields, errors on the field; full keyboard use, visible focus.
2. **Responsive** — no xs horizontal scroll; 44 px; full-screen dialogs on xs; thumb rule; tables → cards
   or `TableCard`; gestures work by finger.
3. **Theming** — no literal or new value; named type variants; formatters for money/dates.
4. **States** — loading, empty, error (load + action), success, disabled, long content (long guest name,
   7-figure amount, 0 and 200 rows), missing (`—`).
5. **Consistency** — shared components, not copies; actions only in `PageActionBar` with canonical icons;
   wording like neighbouring screens.
6. **Motion & perf** — allowed properties only; reduced motion; no console error, layout shift or input lag.
7. **Clean diff** — no debug, dead code, unused imports/styles.

Rank leftovers P0 (blocked, wrong/lost data) · P1 (WCAG AA, major difficulty — fix before merge) · P2
(workaround exists) · P3 (polish). Polish refines; a wrong concept is reported, not redesigned in passing.

## Not adopted (don't reintroduce)
Translucent/blurred bars (opaque white reads in sunlight, runs on old phones) · dark mode · haptics/sounds ·
momentum & rubber-banding (only with a real gesture surface) · marketing/brand-surface rules (site, guest
app) · `impeccable` tooling · a new visual world (that's a spec decision).
