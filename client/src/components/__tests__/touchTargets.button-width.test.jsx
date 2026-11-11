// specs/ds-components.md rules 21 + 28 (2026-10-27 audit) — measured on a touch screen at 390 px, the
// text button « Détail » of the payment ledger was 44 px high but 33 px wide: a short label must not
// shrink a button under a finger's width either.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { Button } from '@mui/material';
import theme from '../../theme';

test('a short text button is 44 px wide on touch, not only 44 px high', () => {
  render(<ThemeProvider theme={theme}><Button size="small" variant="text">Détail</Button></ThemeProvider>);
  const el = document.querySelector('.MuiButton-root');
  const own = [...el.classList].find((c) => c.startsWith('css-'));
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const at = css.indexOf('@media (pointer: coarse)', css.indexOf(`.${own}`));
  const rule = css.slice(at, css.indexOf('}}', at) + 2);
  expect(rule).toMatch(/min-height:\s*44px/);
  expect(rule).toMatch(/min-width:\s*44px/);
});
