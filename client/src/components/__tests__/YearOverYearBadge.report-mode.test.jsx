/**
 * specs/report-grammar.md §3 rules 3 and 4 — the report pill gives the change AND last year's value,
 * in points for a rate, and reads « — vs N-1 » when there is nothing to compare with.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import YearOverYearBadge from '../YearOverYearBadge';

const r = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

test('rule 3 — a rise, with one decimal and last year in brackets, reads as good news', () => {
  const { container } = r(<YearOverYearBadge change={21.3} previous="15 210 €" />);
  expect(container.textContent).toBe('↑ +21,3 %(N-1 : 15 210 €)');
  expect(container.firstChild).toHaveAttribute('data-tone', 'good');
});

test('rule 3 — a rate moves in points, a drop uses the typographic minus', () => {
  const { container } = r(<YearOverYearBadge change={-2.4} previous="55,1 %" unit="points" />);
  expect(container.textContent).toBe('↓ −2,4 pt(N-1 : 55,1 %)');
  expect(container.firstChild).toHaveAttribute('data-tone', 'bad');
});

test('rule 3 — when lower is better, a drop is good news; a change under 0,05 is flat', () => {
  const { container, rerender } = r(<YearOverYearBadge change={-5} previous="12" better="lower" />);
  expect(container.firstChild).toHaveAttribute('data-tone', 'good');
  rerender(<ThemeProvider theme={theme}><YearOverYearBadge change={0.04} previous="12" /></ThemeProvider>);
  expect(container.textContent).toBe('= 0,0 %(N-1 : 12)');
  expect(container.firstChild).toHaveAttribute('data-tone', 'flat');
});

test('rule 4 — no comparable last year: « — vs N-1 », never an infinite percentage', () => {
  r(<YearOverYearBadge change={null} showEmpty />);
  expect(screen.getByText('— vs N-1')).toHaveAttribute('data-tone', 'none');
});
