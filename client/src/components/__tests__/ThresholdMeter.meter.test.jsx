// ThresholdMeter (specs/vat-optional-mode.md §6.7): a solid bar to the value, a hatched one to the
// projection, a tick at the limit, drawn past the tick when the limit is crossed; named for assistive tech.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import ThresholdMeter from '../ThresholdMeter';

const draw = (props) => render(<ThemeProvider theme={theme}><ThresholdMeter ariaLabel="Encaissé" limitLabel="seuil" limit={100} value={50} {...props} /></ThemeProvider>);
const width = (testId) => parseFloat(screen.getByTestId(testId).style.width || getComputedStyle(screen.getByTestId(testId)).width);
const left = (testId) => parseFloat(getComputedStyle(screen.getByTestId(testId)).left);

test('the solid bar fills to the value on the scale of the limit', async () => {
  draw({ value: 50 });
  await waitFor(() => expect(width('meter-value')).toBeCloseTo((50 / 105) * 100, 1));
  expect(screen.queryByTestId('meter-projected')).not.toBeInTheDocument();
});

test('a projection above the value adds a hatched bar behind the solid one', async () => {
  draw({ value: 40, projected: 90 });
  await waitFor(() => expect(width('meter-projected')).toBeCloseTo((90 / 105) * 100, 1));
  expect(width('meter-value')).toBeLessThan(width('meter-projected'));
});

test('past the limit the bars run beyond the tick, and the scale grows to keep them in view', async () => {
  draw({ value: 120, projected: 140, tone: 'error' });
  await waitFor(() => expect(width('meter-value')).toBeGreaterThan(left('meter-limit')));
  expect(width('meter-projected')).toBeLessThanOrEqual(100);
});

test('it is a labelled meter with the limit as its maximum, and the tick is named', () => {
  draw({ value: 50 });
  const meter = screen.getByRole('meter', { name: 'Encaissé' });
  expect(meter).toHaveAttribute('aria-valuenow', '50');
  expect(meter).toHaveAttribute('aria-valuemax', '100');
  expect(screen.getByText('seuil')).toBeInTheDocument();
});

test('past the limit the meter keeps its reading valid: the maximum follows the value, the words come from the server', () => {
  draw({ value: 120, ariaValueText: '20 € au-delà du seuil.' });
  const meter = screen.getByRole('meter', { name: 'Encaissé' });
  expect(meter).toHaveAttribute('aria-valuemax', '120');
  expect(meter).toHaveAttribute('aria-valuenow', '120');
  expect(meter).toHaveAttribute('aria-valuetext', '20 € au-delà du seuil.');
});

test('a negative value reads and draws as 0', async () => {
  draw({ value: -50, projected: -10 });
  const meter = screen.getByRole('meter', { name: 'Encaissé' });
  expect(meter).toHaveAttribute('aria-valuenow', '0');
  await waitFor(() => expect(width('meter-value')).toBe(0));
});
