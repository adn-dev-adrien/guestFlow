// specs/ds-components.md rule 29 — a month column of the pace chart is a finger-sized target.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { MonthTick } from '../PaceMonthChart';

test('rule 29: the month tick carries a transparent 56 x 44 hit rect', () => {
  const months = [{ month: '2026-10', label: 'octobre', tick: 'oct.', current: 10, comparable: false, tone: null }];
  const { getByTestId } = render(
    <ThemeProvider theme={theme}>
      <svg>
        <MonthTick x={0} y={0} payload={{ value: '2026-10', index: 0 }} months={months} formatShort={String} formatValue={String} hasComparison={false} selected={null} onSelectMonth={() => {}} theme={theme} />
      </svg>
    </ThemeProvider>,
  );
  const hit = getByTestId('pace-month-hit');
  expect(Number(hit.getAttribute('width'))).toBe(56);
  expect(Number(hit.getAttribute('height'))).toBe(44);
});
