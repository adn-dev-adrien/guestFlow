/**
 * specs/report-grammar.md §3 rules 28 and 32 — review round R5 / R4: never two categories in one hue
 * (five hues, then the grey of « Autres »), the segment's hover text says what the bar measures, an
 * empty breakdown says so.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import ShareTable, { shareColors } from '../ShareTable';
import { chart } from '../../utils/chartColors';
import { formatCurrency } from '../../utils/formatters';

const SEVEN = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: k, label: k.toUpperCase(), amount: 10, share: 0.15 }))
  .concat([{ key: 'other', label: 'Autres', amount: 25, share: 0.25, other: true }]);

test('rule 32 — five palette hues, then « Autres » in grey: no hue twice', () => {
  const colors = shareColors(SEVEN).map((r) => r.color);
  expect(colors.slice(0, 5)).toEqual(chart.categorical);
  expect(colors[5]).toBe(chart.other);
  expect(new Set(colors).size).toBe(6);
  expect(shareColors([...SEVEN.slice(0, 5), { key: 'f', label: 'F', amount: 1, share: 0 }])[5].color).toBe(chart.other);
});

test('rule 32 — the segment says its share by default, or the caption the caller sends', () => {
  render(
    <ThemeProvider theme={theme}>
      <ShareTable rows={[{ key: 'g', label: 'Gîtes', amount: 14930, quantity: 12, share: 0.4, caption: 'Gîtes : 12 séjours' }, { key: 'b', label: 'Booking', amount: 100, share: 0.6 }]} total={{ amount: 15030 }} formatAmount={formatCurrency} />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('share-segment-g')).toHaveAttribute('title', 'Gîtes : 12 séjours');
  expect(screen.getByTestId('share-segment-b')).toHaveAttribute('title', 'Booking : 60 %');
});

test('rule 28 — an empty breakdown shows the sentence instead of « Total 0 »', () => {
  render(<ShareTable rows={[]} total={{ amount: 0 }} formatAmount={formatCurrency} emptyText="Aucun encaissement sur la période." />);
  expect(screen.getByText('Aucun encaissement sur la période.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});
