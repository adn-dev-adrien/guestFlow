/**
 * specs/report-grammar.md §3 rules 15 and 16 — part-to-whole: the bar's widths are the server's
 * shares, a 0 share draws no segment, hovering or focusing a row brings its segment forward (and a
 * segment its row), the total row is the server's.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import ShareTable from '../ShareTable';
import { SHARE_ROWS, SHARE_TOTAL } from '../../pages/reportGrammarFixtures';
import { formatCurrency } from '../../utils/formatters';

const renderTable = (props = {}) => render(
  <ThemeProvider theme={theme}><ShareTable rows={SHARE_ROWS} total={SHARE_TOTAL} formatAmount={formatCurrency} labelHeader="Moyen" {...props} /></ThemeProvider>,
);

test('rule 15 — segment widths are the shares sent; the table gives quantity, amount, share and the total', () => {
  renderTable();
  expect(screen.getByTestId('share-segment-transfer')).toHaveStyle({ width: '38.3%' });
  expect(screen.getByRole('img', { name: 'Répartition' })).toBeInTheDocument();
  const row = screen.getByTestId('share-row-link');
  expect(row).toHaveTextContent('Lien de paiement');
  expect(row).toHaveTextContent('21');
  expect(row).toHaveTextContent('5 310,60 €');
  expect(row).toHaveTextContent('24 %');
  expect(screen.getByRole('row', { name: /Total/ })).toHaveTextContent('9621 980,60 €');
});

test('rule 15 — a zero share draws no segment but keeps its row', () => {
  renderTable({ rows: [...SHARE_ROWS, { key: 'none', label: 'Avoir', quantity: 0, amount: 0, share: 0 }] });
  expect(screen.queryByTestId('share-segment-none')).toBeNull();
  expect(screen.getByTestId('share-row-none')).toBeInTheDocument();
});

test('rule 15 — hovering a row dims the other segments; hovering a segment dims the other rows; leaving clears', () => {
  renderTable();
  fireEvent.pointerEnter(screen.getByTestId('share-row-cheque'));
  expect(screen.getByTestId('share-segment-cheque')).toHaveAttribute('data-dimmed', 'false');
  expect(screen.getByTestId('share-segment-transfer')).toHaveAttribute('data-dimmed', 'true');
  fireEvent.pointerEnter(screen.getByTestId('share-segment-platforms'));
  expect(screen.getByTestId('share-row-platforms')).toHaveAttribute('data-dimmed', 'false');
  expect(screen.getByTestId('share-row-cheque')).toHaveAttribute('data-dimmed', 'true');
  fireEvent.pointerLeave(screen.getByRole('img', { name: 'Répartition' }).parentElement);
  expect(screen.getByTestId('share-row-cheque')).toHaveAttribute('data-dimmed', 'false');
});

test('rules 15 and 16 — rows are reachable by keyboard and a focused row highlights its segment', () => {
  renderTable();
  const row = screen.getByTestId('share-row-cash');
  expect(row).toHaveAttribute('tabindex', '0');
  fireEvent.focus(row);
  expect(screen.getByTestId('share-segment-transfer')).toHaveAttribute('data-dimmed', 'true');
  expect(screen.getByTestId('share-segment-cash')).toHaveAttribute('data-dimmed', 'false');
});

test('rule 15 — quantityHeader null drops the quantity column', () => {
  renderTable({ quantityHeader: null });
  expect(screen.queryByRole('columnheader', { name: 'Qté' })).toBeNull();
});

test('rule 16 — the dimming transition is switched off under prefers-reduced-motion', () => {
  renderTable();
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const segment = Array.from(screen.getByTestId('share-segment-cash').classList).find((c) => c.startsWith('css-'));
  expect(css).toContain(`@media (prefers-reduced-motion: reduce){.${segment}{-webkit-transition:none;transition:none;}}`);
});
