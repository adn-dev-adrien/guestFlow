// specs/ui-review-2026-10-19-operations.md rule 12 — whose reservation is open: an identity line on a
// second row of the bar below lg, where the centred name is hidden.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';
import { setViewport, resetViewport } from './viewportFixture';

afterEach(resetViewport);

const renderBar = () => render(
  <MemoryRouter><ThemeProvider theme={theme}>
    <PageActionBar title="Modifier la réservation" identity="Cobalt Sierra · N° 6600000002 · 07/08 → 13/08" identityBelow="lg" onSave={() => {}} />
  </ThemeProvider></MemoryRouter>,
);

test('rule 12 — below lg the identity line shows, on one ellipsised line', () => {
  setViewport(390);
  renderBar();
  const line = screen.getByTestId('page-action-bar-identity');
  expect(line).toHaveTextContent('Cobalt Sierra · N° 6600000002 · 07/08 → 13/08');
  expect(getComputedStyle(line).whiteSpace).toBe('nowrap');
  expect(getComputedStyle(line).textOverflow).toBe('ellipsis');
});

test('rule 12 — from lg the identity line is gone (the centred name takes over)', () => {
  setViewport(1280);
  renderBar();
  expect(screen.queryByTestId('page-action-bar-identity')).toBeNull();
});
