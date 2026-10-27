import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import ReservationCard from '../ReservationCard';
import DepartureMiniRow from '../DepartureMiniRow';
import theme from '../../theme';

// specs/design-system.md §3.1 (2026-10-27 audit) — « never filled semantic Chips for statuses »:
// ARRIVÉE / DÉPART pills, « Linge de lit non pris », « Caution à percevoir » rendered white on a
// solid warning colour. They now use the soft background + dark text tokens.

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const chipOf = (text) => screen.getByText(text).closest('.MuiChip-root');
const withTheme = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const ARRIVAL = {
  id: 1, clientId: 2, firstName: 'Léa', lastName: 'Martin', propertyName: 'Gîte',
  checkInTime: '16:00', checkInReady: false, adults: 2,
  bedLinenAlert: { type: 'no_linen' }, cautionAmount: 300, cautionReceived: false,
};

test('arrival card pills and alerts use the soft warning tokens, not a filled chip', () => {
  withTheme(<ReservationCard reservation={ARRIVAL} onToggleReady={() => {}} />);
  for (const text of ['ARRIVÉE', 'Linge de lit non pris', 'Caution à percevoir : 300,00 €']) {
    const style = window.getComputedStyle(chipOf(text));
    expect(style.backgroundColor).toBe(hex(theme.palette.warning.soft));
    expect(style.color).toBe(hex(theme.palette.warning.text));
  }
});

test('departure pill uses the soft tokens too', () => {
  withTheme(<DepartureMiniRow reservation={{ id: 3, propertyName: 'Gîte', firstName: 'A', lastName: 'B', checkOutDone: true }} onToggleDone={() => {}} />);
  const style = window.getComputedStyle(chipOf('DÉPART'));
  expect(style.backgroundColor).toBe(hex(theme.palette.success.soft));
  expect(style.color).not.toBe('rgb(255, 255, 255)');
});
