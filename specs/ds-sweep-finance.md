# DS Phase 4 — Sweep Finance & comptabilité

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/ds-sweep-finance` |
| **Created** | 2026-07-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Umbrella** | [design-system.md](design-system.md) — phase 4 of 6 |
| **Reference** | [design-system-reference.md](design-system-reference.md) |

---

## 1. Context

Second block sweep. Scope = the Finance & comptabilité surface: `FinancePage` (`/finance`),
`AccountingPage` (`/comptabilite`), `TouristTaxPage` (`/finance/tourist-tax`), `DevisPage`
(`/devis`), and the finance components `OperationalPaymentsTable` + `FinanceBreakdownDialog`.
(`PlatformAccountsPage` was swept in phase 3. `PricingSummary` and `PlatformPriceCard` live in the
reservation/property fiches → swept with their host pages in phase 6.)

Block audit (2026-07-16, file:line evidence, current tree incl. #330/#334):
- **KPI variants unused block-wide:** `kpiValue`/`kpiLabel` adoption = **0**. 11 KPI figures render on
  raw `h4`/`h5` + `subtitle2` — FinancePage `renderCard` (`:147,:152`, ×5) and projection tiles
  (`:176-186`, ×3); TouristTaxPage (`:134-159`, ×3). **This is the headline phase-4 adoption.**
- **`sectionHeader` adoption = 0** across the block (all `h6`/`subtitle1`).
- **`PlatformChip` real consumers = 0.** Four ad-hoc filled-Chip sites: `FinancePage:451`,
  `OperationalPaymentsTable:105`, `FinanceBreakdownDialog:91`, + `AccountingPage:266` (platform as
  bare text).
- **FinancePage is the worst page:** legacy **non-sticky `PageHeader`** (`:232`); **silent fetch —
  no `.catch`** on `getFinanceSummary`/`getFinanceProjection`/`loadOperational` (`:56,:60,:63`) and
  **no loading indicator**; 3 raw scroll-only tables (projection `:188`, overdue `:330`, period
  `:431`); the most inline hex in the block (12 — KPI card backgrounds `#00838f/#006064/#4CAF50/
  #f57c00`, chart fills, info-chip hexes); Recharts hardcoded fills (`#1565c0` bar `:276`,
  `#4CAF50/#f57c00` pie `:101-102`, `#fff` labels); chip currency escapees (`${amount}€` `:350,:353,
  :456`).
- **`OperationalPaymentsTable` (shared, highest-traffic list):** local `eur()` (`:28`) + 3 raw
  `{n}€` cells (`:37,:51,:136`); **bucket numerics `align="center"`** (`:86-90,:106-135`) instead of
  right + `tabular-nums`; raw scroll-only table, **no xs cards** → prime `ResponsiveTable` target;
  ad-hoc platform Chip (`:105`).
- **AccountingPage** (already on `PageActionBar` — good): encaissements money columns **left-aligned**
  (`:271,:272,:276`), raw `Box overflowX` table; inline error `<Alert>` (`:133`), `CircularProgress`
  (`:169`), raw-Typography empties; `rgba()` literals (`:24-28,:246,:275,:402,:417`); filled semantic
  balance chips (`:158-163,:391-397`) → `StatusBadge`.
- **TouristTaxPage:** legacy `PageHeader`; 4 `toLocaleString(...)+' €'` escapees (`:159,:173,:220,
  :221`); local `formatDeclaredDate` (`:40-43`); raw table; inline `<Alert>`, no loading; card hex
  `#00897b/#ef6c00`.
- **DevisPage** (bar OK): raw table re-implementing the scaffold trio (`:143-282`); **silent load
  catch** (`:63-66`); `CircularProgress` + raw-Typography empty; status filled Chip (`:26-31`) →
  `StatusBadge`; `py:6` off-scale.
- **FinanceBreakdownDialog:** **raw `<Dialog>` with manual fullScreen** (`:29,:57`) → `FormDialog`;
  local `eur()` (`:25`); silent catch (`:40`); ad-hoc platform Chip (`:91`).

## 2. Goal

Every Finance & comptabilité page satisfies the umbrella done-criteria — KPI figures on the
`kpiValue`/`kpiLabel` variants, sticky canonical bars, real loading/empty/error states (no silent
fetch), §3.5 tables (right-aligned tabular amounts, `formatCurrency`, mobile cards on the payments
lists), `PlatformChip`/`StatusBadge` for badges, theme-tokenized chart colors, serif section
headings, tokens-only colors, blessed spacing — with no change to any computed figure.

## 3. Functional rules

### 3.1 KPI variants (the headline adoption)

1. FinancePage `renderCard` (labels → `kpiLabel`, values → `kpiValue`) and the 3 projection tiles;
   TouristTaxPage's 3 cards → same. Currency amounts in tiles use `formatCurrencyRounded` (KPI/overview
   style) — unchanged from today's rounding intent, now via the shared formatter. TouristTax's first
   two tiles are **integer counts** (réservations, adultes-nuits) → `kpiValue` tabular, no currency
   formatter; only « Taxe de séjour totale » uses `formatCurrencyRounded`.
2. **KPI card treatment** — see §9 decision (loud colored backgrounds vs neutral « Maison » tiles).
   Chosen 2026-07-16 (AskUserQuestion): **neutral « Maison » tiles (option A)** — white/paper card, kpiLabel muted + kpiValue tabular, thin semantic left accent. Applied to all Finance/TouristTax KPI cards + the projection tiles.

### 3.2 Headers → sticky bars (§3.4/§3.6)

3. FinancePage: legacy `PageHeader` → `PageActionBar` (title « Suivi financier »); the existing
   `refreshAll()` is bound to a bar **Sync action** (`SyncIcon`, tooltip « Actualiser », info) — the
   page's first manual refresh control. The 3–4 operational sub-view tabs stay content-local (they
   switch a view, not a page) but now sit under the sticky bar.
4. TouristTaxPage: legacy `PageHeader` → `PageActionBar` (title « Taxe de séjour »).
5. AccountingPage + DevisPage bars unchanged (already compliant).

### 3.3 Chart colors → theme tokens (FinancePage Recharts)

6. Bar `fill="#1565c0"` → `theme.palette.primary.main`; pie fills `#4CAF50`/`#f57c00` → a small
   chart palette from tokens (`success.main` / `warning.main`); `#fff` labels → `common.white`
   (kept white on colored marks — legible). One `CHART` token object at the top of the file so the
   palette is single-sourced.

### 3.4 Currency (§3 reference — exact via `formatCurrency`)

7. `OperationalPaymentsTable`: delete `eur()`, replace the 3 `{n}€` cells and footers with
   `formatCurrency`. `FinanceBreakdownDialog`: delete `eur()` → `formatCurrency`. TouristTaxPage:
   the 4 `toLocaleString` sites → `formatCurrency` (exact rows) / `formatCurrencyRounded` (KPI
   tiles). FinancePage chip labels (`:350,:353,:456`) → `formatCurrency`.

### 3.5 Tables → ResponsiveTable / alignment (§5 reference)

8. `OperationalPaymentsTable` → `ResponsiveTable`: bucket numerics **right-aligned + `tabular-nums`**
   (were centered), `renderMobileCard` (client + platform + reste-à-payer + buckets), empty « — »
   kept. Its header cells realign to match the body.
9. FinancePage projection / overdue / period tables → amounts right + `tabular-nums`; empty lists →
   `EmptyState`. **Implemented deviation:** these three carry a **totals footer**, and
   `ResponsiveTable` has no footer slot — so (like the phase-3 rule-16 exemption) they stay
   scroll-contained `<TableCard>`/`Table` with tabular-nums rather than becoming xs cards. The xs
   cards land where they matter most — the operator payments lists (`OperationalPaymentsTable`).
10. TouristTaxPage per-property table + DevisPage list → `ResponsiveTable` (xs cards, no footer);
    AccountingPage encaissements table → `TableCard` with money columns right + `tabular-nums`.
11. `FinanceBreakdownDialog` table → kept a plain `<Table>` with a **manual `TableFooter` total**
    inside the dialog (no xs cards needed). **Implemented deviation:** not `TableCard` — the footer
    total is integral to this read-only detail (row/footer reconciliation), and `TableCard` exposes
    no footer slot.

### 3.6 Platform badges → `PlatformChip`

12. The 4 ad-hoc sites (FinancePage:451, OperationalPaymentsTable:105, FinanceBreakdownDialog:91,
    AccountingPage:266 text→chip) → `PlatformChip`.

### 3.7 Status badges → `StatusBadge`

13. DevisPage status column (`STATUS_COLORS` map) and AccountingPage balance chips
    (« Équilibré/Déséquilibre ») → `StatusBadge` (soft « Maison » style).

### 3.8 States (no silent failures)

14. FinancePage: wrap the three loaders in a shared `load()` with `.catch` → `ErrorAlert` (retry);
    `LoadingState` while loading; empty lists → `EmptyState`.
15. DevisPage: `load()` catch → `ErrorAlert`; `CircularProgress` → `LoadingState`; empty →
    `EmptyState`; success toasts on delete/convert (via `useToast`).
16. AccountingPage: inline error `<Alert>` → `ErrorAlert`; `CircularProgress`/text → `LoadingState`;
    empties → `EmptyState`.
17. TouristTaxPage: inline `<Alert>` → `ErrorAlert`; add `LoadingState`; empty → `EmptyState`.
18. FinanceBreakdownDialog: silent catch → `ErrorAlert`; « Chargement… » → `LoadingState`.

### 3.9 Dialog primitive

19. `FinanceBreakdownDialog` — **Implemented deviation: kept as a bespoke read-only `<Dialog>`**, not
    `FormDialog`. It is a read-only detail view whose only action is « Fermer »; `FormDialog` would
    impose Annuler/Enregistrer footer actions that are wrong here. It keeps its own
    `useMediaQuery`-driven `fullScreen`-on-xs (the theme's `MuiDialog.paperFullScreen` override still
    applies) and adopts the block's `formatCurrency` / `PlatformChip` / `LoadingState` / `ErrorAlert`
    / `EmptyState`. Documented like the phase-3 read-only-dialog exemption.

### 3.10 Typography, tokens, spacing

20. All block section headings (`FinancePage:166,257,288,306`; `AccountingPage:150,205`;
    `TouristTaxPage:167`) → `variant="sectionHeader"`.
21. Inline hex → tokens; `rgba()` → `alpha(theme.palette.*)` (AccountingPage `LINE_STYLES` + row
    backgrounds; the KPI/info-chip hexes per §3.1 treatment). Off-scale spacing → blessed scale
    (`py:0.75`→`1`, `gap:0.75`→`1`, `py:6`→ standard empty-state padding via `EmptyState`,
    `mb:2.5`→`2`, `px:2.5`→`2`, `spacing:0.75`→`1`).

### 3.11 DevisPage scaffold

22. DevisPage migrates to `DataPageScaffold` (filters as `topContent`, list via `ResponsiveTable`,
    states + `EmptyState` for free) — stops hand-rolling the bar+filters+table+empty trio. « Nouveau
    devis » stays the bar CTA.

**Edge cases:**
- FinancePage sub-view tabs remain content-local (not `barCenter`) — they are view switches within
  one page, not sibling pages (unlike the phase-3 wrappers).
- AccountingPage journal mini-table keeps its `monospace` debit/credit columns (an accounting-ledger
  convention) but gains `tabular-nums`; not forced into cards on xs (dense ledger, scroll-contained).
- No computed figure changes — presentation only.

---

## 4. Architecture

> **Fat backend, thin frontend — unaffected.** No endpoint, payload or business-logic change.

### 4.1 Server side — no change.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| pages | `FinancePage.js` | T | Bar + Sync, KPI variants, chart tokens, tables→ResponsiveTable, states, PlatformChip, sectionHeader, hex→tokens. |
| pages | `AccountingPage.js` | T | Money columns right+tabular, states, StatusBadge, PlatformChip, rgba→alpha, sectionHeader. |
| pages | `TouristTaxPage.js` | T | Bar, KPI variants, formatCurrency, table→ResponsiveTable, states, hex→tokens, sectionHeader. |
| pages | `DevisPage.js` | T | DataPageScaffold, ResponsiveTable, StatusBadge, states + toasts. |
| components | `OperationalPaymentsTable.js` | T | ResponsiveTable, right-align+tabular numerics, formatCurrency, PlatformChip. |
| components | `FinanceBreakdownDialog.js` | T | Bespoke read-only Dialog (not FormDialog — §3.9), formatCurrency, PlatformChip, manual footer total, states. |

**Component reuse declaration:** consumes phase-1/2 generics only (`kpiValue`/`kpiLabel`/
`sectionHeader` variants, `LoadingState`, `EmptyState`, `ErrorAlert`, `ResponsiveTable`, `TableCard`,
`PlatformChip`, `StatusBadge`, `FormDialog`, `useToast`, `formatCurrency*`). No new generic expected.

### 4.3 API contract — unchanged.

## 5. Data model — none.

## 6. UI / UX

- KPI tiles per §9 decision, all figures `kpiValue` tabular.
- Payments lists become cards on `xs` (operator-critical); all tables right-align money + tabular.
- Charts keep their shape; only the palette moves to tokens.
- Responsive re-verified at xs/md/lg; mobile check on FinancePage + the payments table mandatory.

## 7. Test plan

### Client unit tests (vitest)
- [x] FinancePage suite green: `formatCurrency` figures in rows/footers (row+footer both render the
  amount → `getAllByText(...).length >= 1`); existing figures unchanged.
- [x] `OperationalPaymentsTable`: amounts `formatCurrency`, right-aligned; xs cards; `PlatformChip`.
- [x] DevisPage: `DataPageScaffold` bar CTA + status `StatusBadge`; loading/empty/error states; the
  DialogProvider mock gained `useToast` (delete/convert/pdf go through toasts now).
- [x] AccountingPage: money columns right-aligned; `StatusBadge` balance; error/loading states
  (both Accounting suites wrapped in `ThemeProvider` + `DialogProvider`).
- [x] TouristTaxPage: neutral KPI tiles; `formatCurrency`; states; test wrapped in
  `ThemeProvider` + `DialogProvider` (page now uses `useToast` + theme variants).
- [x] `FinanceBreakdownDialog`: read-only Dialog; `formatCurrency` (covered indirectly via the
  FinancePage suite; no dedicated new test — the component has no branching logic to pin).
- [x] Full suite green — **639 tests / 84 files** (was 639; no count change, fixtures adjusted only).

### E2E (Playwright)
- [ ] Full suite green; +1 mobile smoke: `/finance` pending tab renders cards at 390px, no
  horizontal page scroll.

### Manual UI verification
- [ ] `/finance`: sticky bar + Actualiser; KPI tiles (chosen treatment); charts in token colors;
  console clean; error state via offline reload.
- [ ] `/comptabilite`, `/finance/tourist-tax`, `/devis`: states, tables, badges.
- [ ] xs/md/lg pass on the block; payments table as cards on xs.

## 10. Implementation notes (2026-07-16)

Presentation-only sweep — **no computed figure changed**. Highlights + deviations (all cross-linked
to the rules above):
- **KPI tiles** neutral « Maison » across FinancePage (5 cards + 3 projection tiles) and TouristTax
  (3 tiles) — white card, muted `kpiLabel`, tabular `kpiValue`, thin semantic left accent.
- **Footer-bearing tables stay scroll-contained** (rule 9): FinancePage projection/overdue/period
  keep a totals footer that `ResponsiveTable` can't render → `TableCard`/`Table` + `tabular-nums`.
  xs cards land on the operator payments lists (`OperationalPaymentsTable`).
- **`FinanceBreakdownDialog` kept as a read-only `<Dialog>`** (rules 11 + 19), not `FormDialog`, with
  a manual `TableFooter` total; adopts the shared formatters/chips/states.
- **`MonthYearPicker` cleanliness fix** (shared, rendered by Finance + Tourist-tax): its Stack
  `alignItems` moved from a bare prop into `sx` — it was leaking to the DOM (React « unknown prop »
  warning). Removes the warning from the Finance + comptabilité console.
- Currency everywhere via `formatCurrency` (exact rows/footers) / `formatCurrencyRounded` (KPI/charts
  only); `PlatformChip`/`StatusBadge` for badges; `sectionHeader` for section titles; `rgba()`→
  `alpha()`, inline hex → tokens, off-scale spacing → blessed scale.

## 8. Out of scope

- `PricingSummary`, `PlatformPriceCard` → phase 6 (their host fiches).
- Planning/Dashboard/App-shell → phase 5; Réservations → phase 6.
- Any server or figure change.

## 9. Open questions

- **Resolved 2026-07-16 (AskUserQuestion): neutral « Maison » KPI tiles** (option A). 
- (historical) **KPI card treatment (needs Adrien's call before build):** the Finance/TouristTax KPI cards
  currently use loud full-color backgrounds (teal/orange/green hex). Options: (A) neutral « Maison »
  tiles — white/paper card, `kpiLabel` muted + `kpiValue`, thin semantic accent (matches the chosen
  mockup + the Dashboard); (B) keep colored cards but move the hex to theme tokens. Resolved via
  AskUserQuestion at spec approval.
