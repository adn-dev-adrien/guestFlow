/**
 * specs/report-grammar.md §3 rule 37 — the pill has no dark-surface variant any more (no caller since
 * the light hero card): an `onDark` passed by mistake changes nothing.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import YearOverYearBadge from '../YearOverYearBadge';

test('rule 37 — onDark is ignored: same markup as without it', () => {
  const html = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>).container.innerHTML;
  expect(html(<YearOverYearBadge change={-8} onDark />)).toBe(html(<YearOverYearBadge change={-8} />));
});
