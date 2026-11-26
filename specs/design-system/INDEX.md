# Design system — « Maison » tokens, components, page patterns, report grammar and UI review rules

Start with: `design-system-reference` (token and component contract; the root `DESIGN.md` digests it). See also: `planning/`, `reservations/`, `sas/`.

- `design-system-reference` — the living contract: tokens, typography roles, component catalogue with do/don't, dialogs and feedback, primary action under the thumb on phones. Code: `client/src/theme.js`, `client/src/components`.
- `design-system` — umbrella programme: palette, typography roles, canonical page-action bar, table conventions, page opens at top, one money formatter, field-label room. Code: `client/src/theme.js`, `client/src/utils/formatters.js`, `client/src/components/ScrollToTop.js`.
- `ds-components` — generic component library and feedback system: `StatusBadge`, `EmptyState`, `ErrorAlert`, `LoadingState`, toasts, dialogs full screen on phones. Code: `client/src/components/StatusBadge.jsx`, `client/src/components/ErrorBoundary.jsx`.
- `ds-tabs` — one tab pattern for the whole app (`PageTabs` in the page bar, item counts, single source). Code: `client/src/components/PageTabs.jsx`.
- `report-grammar` — report screens composed from KPI tiles, `Panel`, tab counts and report charts with year-over-year comparison and data tables. Code: `client/src/components/SelectableTile.jsx`, `client/src/components/Panel.jsx`, `client/src/components/TrendChart.jsx`.
- `ds-sweep-settings` — phase 3: settings and admin pages moved to the page bar, states, toasts and tokens; one bar-level save for the billable amounts. Code: `client/src/components/DataPageScaffold.jsx`, `client/src/plugins/sas/BillableAmountsTab.jsx`.
- `ds-sweep-finance` — phase 4: finance, accounting and tourist-tax pages on bar, KPI roles and right-aligned money; tourist tax declared to the cent, no future month. Code: `client/src/pages/TouristTaxPage.jsx`, `client/src/components/MonthYearPicker.jsx`.
- `ds-sweep-planning` — phase 5: dashboard, planning, calendar and app shell on tokens, soft chips and the shared bar. Code: `client/src/pages/CalendarPage.jsx`, `client/src/components/CumulativeMonthCalendar.jsx`.
- `ds-sweep-reservations` — phase 6: reservation, clients, properties and related pages on the bar and shared states (closes the programme). Code: `client/src/pages/ReservationPage.jsx`, `client/src/pages/ClientsPage.jsx`, `client/src/components/ReservationConflictBadge.jsx`.
- `review-2026-10-18-reservations` — small reservation-screen fixes from the 2026-10-18 review: pricing labels, step counter, layout. Code: `client/src/components/PricingSummary.jsx`, `client/src/plugins/sas/ReservationSasDialog.jsx`.
- `ui-review-2026-10-19-operations` — 53 rules from the UI/UX review: SAS thumb footer, quotes list, fiche under 1200 px, calendar bars, quote PDF in every alphabet. Code: `client/src/plugins/sas/ReservationSasDialog.jsx`, `client/src/components/CumulativeMonthCalendar.jsx`, `client/src/components/StickyTotalBar.jsx`.
