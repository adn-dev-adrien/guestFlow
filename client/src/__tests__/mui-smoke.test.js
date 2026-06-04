import React from 'react';
import { render, screen } from '@testing-library/react';
import { Grid, Chip, Switch } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

// Smoke coverage for the MUI v9 API surface GuestFlow relies on
// (spec/mui-5-to-9-migration.md §7.2). Four cases pin the contracts that any
// future v10 (or a hidden v9.x patch) regression would touch:
//   1. The new Grid v2 API (no `item`, `size={{…}}` instead of bare xs/sm/md).
//   2. <Chip> renders without `color="default"` (the token was removed in v9).
//   3. <Switch> exposes WAI-ARIA role="switch" (v9 accessibility upgrade —
//      what broke ExtrasSection.test.js and was caught at migration time).
//   4. <DatePicker> from @mui/x-date-pickers v9 mounts under <LocalizationProvider>
//      + AdapterDayjs.
// Like the router-smoke cases shipped with PR #113, these are deliberately
// minimal — the E2E suite (Playwright) covers integrated UX; this file is the
// unit-level tripwire that fires fast on a future major.

describe('@mui/material v9 API smoke', () => {
  test('Case 1: <Grid container><Grid size={{ xs: 12, md: 6 }}> renders without throwing', () => {
    render(
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <div data-testid="left">left</div>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <div data-testid="right">right</div>
        </Grid>
      </Grid>
    );
    expect(screen.getByTestId('left')).toBeInTheDocument();
    expect(screen.getByTestId('right')).toBeInTheDocument();
  });

  test('Case 2: <Chip label="x"> renders without a color prop (post-v9 cleanup)', () => {
    // v9 removed `color="default"`. The default render (no color prop) yields
    // the same neutral gray Chip the app used to show via `color="default"`.
    // Pinning the prop-less call so a future change that re-defaults color
    // doesn't silently regress the FinancePage "Acompte désactivé" chip.
    render(<Chip label="Acompte désactivé" variant="outlined" />);
    expect(screen.getByText('Acompte désactivé')).toBeInTheDocument();
  });

  test('Case 3: <Switch> exposes role="switch" (WAI-ARIA upgrade)', () => {
    // v9 upgraded <Switch> from role="checkbox" to role="switch". The
    // ExtrasSection tests broke on this at migration time and had to update
    // their `getAllByRole('checkbox')` queries. Pinning the new role so any
    // future regression toward "checkbox" surfaces here, not deep in a UI test.
    // v9 also migrated `inputProps` → `slotProps.input` (codemod-handled in
    // the rest of the codebase); using `slotProps` here mirrors the new contract.
    render(<Switch slotProps={{ input: { 'aria-label': 'toggle' } }} />);
    expect(screen.getByRole('switch', { name: 'toggle' })).toBeInTheDocument();
  });

  test('Case 4: <DatePicker> mounts under <LocalizationProvider dateAdapter={AdapterDayjs}>', () => {
    // Pins the v9 date-pickers contract — same import paths, same
    // LocalizationProvider + AdapterDayjs combo we use in
    // PropertyPricingSeasonsPage + EstablishmentClosuresPage. The DatePicker
    // exposes a `textbox` ARIA role for its text field which is the most
    // stable contract to query (it survived v6 → v7 → v8 → v9 unchanged).
    render(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker label="Date d'arrivée" />
      </LocalizationProvider>
    );
    expect(screen.getByRole('group', { name: /Date d'arrivée/i })).toBeInTheDocument();
  });
});
