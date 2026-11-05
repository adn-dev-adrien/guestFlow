/**
 * specs/report-grammar.md §3 rules 8, 9, 10, 11 and 12 — TrendChart: legend items are toggle buttons
 * (crossed out when off, an empty-state line when every series is off), the « ⋯ » menu switches to an
 * accessible table of the same data and copies it as CSV, and the tooltip lists the visible series at
 * the hovered category. Recharts draws nothing in jsdom: the tooltip is tested as a named export.
 */
import React from 'react';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import TrendChart, { TrendTooltip, ALL_HIDDEN } from '../TrendChart';
import { COPY_DONE, COPY_REFUSED } from '../ChartMenu';
import { EXERCISE_MONTHS, TREND_SERIES } from '../../pages/reportGrammarFixtures';
import { formatCurrencyRounded } from '../../utils/formatters';

const renderChart = () => render(
  <ThemeProvider theme={theme}>
    <TrendChart categories={EXERCISE_MONTHS} series={TREND_SERIES} formatValue={formatCurrencyRounded} ariaLabel="Encaissements cumulés" />
  </ThemeProvider>,
);

const setClipboard = (value) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
afterEach(() => { delete navigator.clipboard; });

test('rule 9 — one toggle per series; the series flagged hidden start off and crossed out', async () => {
  renderChart();
  const legend = screen.getByRole('group', { name: 'Séries affichées' });
  const on = within(legend).getByRole('button', { name: '2026-27' });
  const off = within(legend).getByRole('button', { name: '2024-25' });
  expect(on).toHaveAttribute('aria-pressed', 'true');
  expect(off).toHaveAttribute('aria-pressed', 'false');
  expect(off).toHaveStyle({ textDecoration: 'line-through' });
  await userEvent.click(off);
  expect(off).toHaveAttribute('aria-pressed', 'true');
});

test('rule 9 — every series off: one line says so instead of an empty chart', async () => {
  renderChart();
  await userEvent.click(screen.getByRole('button', { name: '2026-27' }));
  await userEvent.click(screen.getByRole('button', { name: '2025-26' }));
  expect(screen.getByText(ALL_HIDDEN)).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Encaissements cumulés' })).toBeNull();
});

test('rules 10 and 11 — « Voir en tableau » renders every series, formatted, « — » for a gap, and back', async () => {
  renderChart();
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Voir en tableau' }));
  const table = screen.getByRole('table', { name: 'Encaissements cumulés' });
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Période', '2026-27', '2025-26', '2024-25', '2023-24']);
  const dec = within(table).getByRole('row', { name: /déc\./ });
  expect(within(dec).getAllByRole('cell').map((c) => c.textContent)).toEqual(['—', '6 050 €', '4 980 €', '4 210 €']);
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Voir le graphique' }));
  expect(screen.queryByRole('table')).toBeNull();
});

test('rule 10 — « Copier les données » writes the CSV and says so', async () => {
  const writeText = vi.fn().mockResolvedValue();
  setClipboard({ writeText });
  renderChart();
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copier les données' }));
  expect(await screen.findByText(COPY_DONE)).toBeInTheDocument();
  const csv = writeText.mock.calls[0][0].split('\n');
  expect(csv[0]).toBe('Période;2026-27;2025-26;2024-25;2023-24');
  expect(csv[3]).toBe('déc.;;6050;4980;4210');
});

test('rule 10 — a refused clipboard is said, not swallowed', async () => {
  setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
  renderChart();
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  await act(async () => { await userEvent.click(screen.getByRole('menuitem', { name: 'Copier les données' })); });
  expect(await screen.findByText(COPY_REFUSED)).toBeInTheDocument();
});

test('rules 8 and 12 — the tooltip names the category and each visible series with a value; a gap is left out', () => {
  const series = [{ key: 'a', name: '2026-27', color: '#2F5D46' }, { key: 'b', name: '2025-26', color: '#B07F2E', dashed: true }];
  render(<TrendTooltip active payload={[{ payload: { key: 'm3', label: 'déc.', a: null, b: 6050 } }]} series={series} formatValue={formatCurrencyRounded} />);
  expect(screen.getByText('déc.')).toBeInTheDocument();
  expect(screen.getByText('2025-26 : 6 050 €')).toBeInTheDocument();
  expect(screen.queryByText(/2026-27/)).toBeNull();
});

test('rule 12 — the tooltip draws nothing when inactive', () => {
  const { container } = render(<TrendTooltip active={false} payload={[]} series={[]} formatValue={String} />);
  expect(container).toBeEmptyDOMElement();
});

test('rule 16 — legend toggles are at least 44 px tall', () => {
  renderChart();
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const cls = Array.from(screen.getByRole('button', { name: '2026-27' }).classList).find((c) => c.startsWith('css-'));
  expect(css).toMatch(new RegExp(`\\.${cls}\\{[^}]*min-height:44px`));
});
