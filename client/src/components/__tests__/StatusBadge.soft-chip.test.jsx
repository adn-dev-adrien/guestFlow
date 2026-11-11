// specs/ds-components.md rule 27 — `softChipSx(status)` gives a Chip the soft background and dark text
// of the status tokens while it keeps its own height and radius (never a filled semantic Chip).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { Chip } from '@mui/material';
import theme from '../../theme';
import { softChipSx } from '../StatusBadge';

test('the semantic statuses read the soft background and the dark text of the theme', () => {
  ['success', 'warning', 'error', 'info'].forEach((status) => {
    const css = softChipSx(status)(theme);
    expect(css.bgcolor).toBe(theme.palette[status].soft);
    expect(css.color).toBe(theme.palette[status].text);
  });
});

test('an unknown status is neutral grey, never a semantic fill', () => {
  const css = softChipSx('whatever')(theme);
  expect(css.bgcolor).toBe(theme.palette.grey[200]);
  expect(css.color).toBe(theme.palette.text.secondary);
});

test('the chip keeps the height the caller sets, with no filled colour variant', () => {
  render(
    <ThemeProvider theme={theme}>
      <Chip size="small" label="Complément" sx={[softChipSx('warning'), { height: 22 }]} />
    </ThemeProvider>,
  );
  const chip = screen.getByText('Complément').closest('.MuiChip-root');
  expect(chip).toHaveStyle({ height: '22px' });
  expect(chip.className).not.toMatch(/colorWarning|filledWarning/);
});
