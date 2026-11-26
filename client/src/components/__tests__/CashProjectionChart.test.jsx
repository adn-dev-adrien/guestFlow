// specs/planning/mobile-dashboard-exercise-cash.md rules 18-19 — the cash projection draws the server's series and answers the date cursor.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import CashProjectionChart from '../CashProjectionChart';
import { CASH_PROJECTION } from '../../pages/__tests__/financePageFixtures';

const fmt = (n) => `${n} €`;
const renderChart = (projection = CASH_PROJECTION) => render(
  <ThemeProvider theme={theme}><CashProjectionChart projection={projection} formatAmount={fmt} /></ThemeProvider>,
);

test('the default cursor is the end of the exercise and reads the server\'s last point', () => {
  renderChart();
  const answer = screen.getByTestId('cash-answer');
  expect(answer).toHaveTextContent("À la fin de l'exercice");
  expect(answer).toHaveTextContent(/3600 € encaissés, dont 600 € encore attendus/);
});

test('typing a date moves the cursor to the last point not after it', () => {
  renderChart();
  // date-literal-ok: a server payload the component renders as given; nothing compares it with today
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-06-20' } });
  const answer = screen.getByTestId('cash-answer');
  expect(answer).toHaveTextContent('20 juin 2026');
  expect(answer).toHaveTextContent(/3000 € encaissés/);
  expect(answer).not.toHaveTextContent('encore attendus');
});

test('tapping a month\'s bar puts the cursor on that month\'s last day and shows its figures', () => {
  renderChart();
  fireEvent.click(screen.getByTestId('cash-month-2026-06'));
  expect(screen.getByTestId('cash-answer')).toHaveTextContent('30 juin 2026');
  const tip = screen.getByTestId('cash-tip');
  expect(tip).toHaveTextContent('juin 2026');
  expect(tip).toHaveTextContent('Reçu 3000 €');
  expect(tip).toHaveTextContent('Attendu 0 €');
});

test('dragging on the curve moves the cursor along the server\'s day offsets', () => {
  renderChart();
  const hit = screen.getByTestId('cash-hit');
  hit.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240 });
  fireEvent.pointerDown(hit, { clientX: 48 + (562 * 12) / 61, pointerId: 1, pointerType: 'mouse' });
  expect(screen.getByTestId('cash-answer')).toHaveTextContent(/3000 € encaissés/);
  fireEvent.pointerMove(hit, { clientX: 48 + (562 * 40) / 61, pointerId: 1, pointerType: 'mouse' });
  expect(screen.getByTestId('cash-answer')).toHaveTextContent(/3600 € encaissés, dont 600 € encore attendus/);
});

test('the today marker is drawn when today is inside the exercise, not otherwise', () => {
  const { unmount } = renderChart();
  expect(within(screen.getByTestId('cash-today')).getByText("Aujourd'hui")).toBeInTheDocument();
  unmount();
  renderChart({ ...CASH_PROJECTION, todayMonth: null });
  expect(screen.queryByTestId('cash-today')).toBeNull();
});

test('a month outside the window is dimmed', () => {
  renderChart({ ...CASH_PROJECTION, months: CASH_PROJECTION.months.map((m) => ({ ...m, inWindow: m.key === '2026-07' })) });
  expect(screen.getByTestId('cash-month-2026-06')).toHaveAttribute('opacity', '0.35');
  expect(screen.getByTestId('cash-month-2026-07')).toHaveAttribute('opacity', '1');
});

test('the months are also written in a table for assistive technology', () => {
  renderChart();
  const table = screen.getByRole('table', { name: 'Trésorerie par mois' });
  expect(within(table).getByText('juillet 2026').closest('tr')).toHaveTextContent('600 €');
});

test('an exercise with no stay says so instead of drawing', () => {
  renderChart({ ...CASH_PROJECTION, empty: true });
  expect(screen.getByText('Aucun séjour sur cet exercice.')).toBeInTheDocument();
  expect(screen.queryByTestId('cash-answer')).toBeNull();
});

const hitWithBox = () => {
  const hit = screen.getByTestId('cash-hit');
  hit.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240 });
  return hit;
};
const X = (day) => 48 + (562 * day) / 61;

test('a vertical scroll that starts on the chart never moves the cursor', () => {
  renderChart();
  const hit = hitWithBox();
  fireEvent.pointerDown(hit, { clientX: X(12), clientY: 100, pointerId: 1, pointerType: 'touch' });
  fireEvent.pointerMove(hit, { clientX: X(12) + 2, clientY: 160, pointerId: 1, pointerType: 'touch' });
  fireEvent.pointerCancel(hit, { pointerId: 1, pointerType: 'touch' });
  expect(screen.getByTestId('cash-answer')).toHaveTextContent("fin de l'exercice");
});

test('a tap with a finger moves the cursor, and so does a clearly horizontal drag', () => {
  renderChart();
  const hit = hitWithBox();
  fireEvent.pointerDown(hit, { clientX: X(12), clientY: 100, pointerId: 1, pointerType: 'touch' });
  fireEvent.pointerUp(hit, { clientX: X(12), clientY: 101, pointerId: 1, pointerType: 'touch' });
  expect(screen.getByTestId('cash-answer')).toHaveTextContent(/3000 € encaissés/);
  fireEvent.pointerDown(hit, { clientX: X(12), clientY: 100, pointerId: 2, pointerType: 'touch' });
  fireEvent.pointerMove(hit, { clientX: X(40), clientY: 102, pointerId: 2, pointerType: 'touch' });
  expect(screen.getByTestId('cash-answer')).toHaveTextContent(/3600 € encaissés/);
});

test('the lines are steps: horizontal then vertical, never a diagonal between two dates', () => {
  const { container } = renderChart();
  const dashed = container.querySelector('path[stroke-dasharray]');
  expect(dashed.getAttribute('d')).toMatch(/H[\d.]+ V[\d.]+/);
  expect(dashed.getAttribute('d')).not.toMatch(/L/);
  expect(container.querySelector('path[stroke-width="2.2"]').getAttribute('d')).not.toMatch(/L/);
});

test('the dashed line starts where the solid one ends, then steps up at today', () => {
  // date-literal-ok: a server payload the component renders as given; nothing compares it with today
  const projection = { ...CASH_PROJECTION, daily: CASH_PROJECTION.daily.map((d) => (d.date === '2026-06-15' ? { ...d, expected: 400, cumulative: 3400, expectedCumulative: 400, dashed: 3400 } : d)) };
  const { container } = renderChart(projection);
  const d = container.querySelector('path[stroke-dasharray]').getAttribute('d');
  expect(d).toMatch(/^M[\d.]+,[\d.]+ V[\d.]+/);
});
