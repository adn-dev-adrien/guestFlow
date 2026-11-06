/**
 * specs/report-grammar.md §3 rules 21, 27, 28, 29, 30 and 32 — review round R5: the fixed domain
 * reaches the axis, the copy holds what is shown (visible series, rates in percent), an empty period
 * says so, a hidden series stays readable, the chart is a figure the keyboard passes over, and a
 * sixth series never repeats a hue.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import TrendChart, { withColors } from '../TrendChart';
import { chart } from '../../utils/chartColors';

const MONTHS = [{ key: 'm1', label: 'oct.' }, { key: 'm2', label: 'nov.' }];
const SERIES = [
  { key: 'cur', name: '2026-27', values: [0.1463, null], area: true },
  { key: 'prev', name: '2025-26', values: [0.12, 0.2], dashed: true },
];
const rate = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const renderChart = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <TrendChart categories={MONTHS} series={SERIES} formatValue={rate} ariaLabel="Taux d'occupation" {...props} />
  </ThemeProvider>,
);
const setClipboard = (value) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
afterEach(() => { delete navigator.clipboard; });

test('rule 27 — a rate is copied in percent with « (%) », and a hidden series is left out', async () => {
  const writeText = vi.fn().mockResolvedValue();
  setClipboard({ writeText });
  renderChart({ ratio: true, yDomain: [0, 1] });
  await userEvent.click(screen.getByRole('button', { name: '2025-26' }));
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copier les données' }));
  await screen.findByText('Données copiées');
  expect(writeText.mock.calls[0][0]).toBe('Période;2026-27 (%)\noct.;14,6\nnov.;');
});

test('rule 28 — an empty period shows the server sentence, no chart, no legend, no menu', () => {
  renderChart({ emptyText: 'Aucun encaissement sur la période.' });
  expect(screen.getByText('Aucun encaissement sur la période.')).toBeInTheDocument();
  expect(screen.queryByRole('figure')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Options du graphique' })).toBeNull();
});

test('rule 29 — a hidden series reads in text.secondary (5,4:1), crossed out', async () => {
  renderChart();
  const b = screen.getByRole('button', { name: '2025-26' });
  await userEvent.click(b);
  expect(b).toHaveStyle({ color: theme.palette.text.secondary, textDecoration: 'line-through' });
});

test('rule 30 — the chart is a named figure, with nothing focusable inside', () => {
  const { container } = renderChart();
  const figure = screen.getByRole('figure', { name: "Taux d'occupation" });
  expect(figure.querySelector('[tabindex]')).toBeNull();
  expect(container.querySelector('[role="img"]')).toBeNull();
});

test('rule 32 — a sixth series takes the grey of « Autres », never a recycled hue', () => {
  const colors = withColors(Array.from({ length: 6 }, (_, i) => ({ key: `s${i}` }))).map((s) => s.color);
  expect(new Set(colors).size).toBe(6);
  expect(colors[5]).toBe(chart.other);
});
