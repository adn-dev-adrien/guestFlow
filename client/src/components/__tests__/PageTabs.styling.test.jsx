// specs/ds-tabs.md rules 4, 5, 6, 9 — the house style of a tab: sentence case, 44 px target, the
// weights, and the fact that the DEFAULTS live in the theme (so a `<Tabs>` written later, by
// someone who never read this spec, still lands on the right look). Plus the `card` variant's own
// rhythm: a bottom divider and a standard gap before the content, never a forced width.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { Tabs, Tab } from '@mui/material';

import theme from '../../theme';
import PageTabs from '../PageTabs';

const ITEMS = [
  { value: 'general', label: 'Général' },
  { value: 'tarifs', label: 'Tarifs' },
];

function renderTabs(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <PageTabs value="general" onChange={() => {}} items={ITEMS} {...props} />
    </ThemeProvider>,
  );
}

test('rule 9 — a RAW <Tabs> inherits the house style from the theme alone', () => {
  render(
    <ThemeProvider theme={theme}>
      <Tabs value="x"><Tab value="x" label="Général" /></Tabs>
    </ThemeProvider>,
  );
  const style = window.getComputedStyle(screen.getByRole('tab'));
  expect(style.textTransform).toBe('none');       // rule 5 — sentence case, no CSS uppercase
  expect(style.minHeight).toBe('44px');           // rule 6 — touch target
  expect(style.fontSize).toBe('14.4px');          // rule 5 — 0.9rem
});

test('rule 5 — the active tab is heavier than the others', () => {
  renderTabs();
  const active = window.getComputedStyle(screen.getByRole('tab', { name: 'Général' }));
  const idle = window.getComputedStyle(screen.getByRole('tab', { name: 'Tarifs' }));
  expect(active.fontWeight).toBe('600');
  expect(idle.fontWeight).toBe('500');
});

test('rule 4 — the card variant carries a bottom divider and the standard gap', () => {
  const { container } = renderTabs({ variant: 'card' });
  const style = window.getComputedStyle(container.querySelector('.MuiTabs-root'));
  expect(style.borderBottomWidth).toBe('1px');
  expect(style.borderBottomStyle).toBe('solid');
  expect(style.marginBottom).toBe('16px');
  // No forced width: the strip is as wide as its card (the old 420px cap is gone).
  expect(style.maxWidth).toBe('none');
});

test('rule 4 — the bar variant adds no border of its own (PageActionBar closes the block)', () => {
  const { container } = renderTabs();
  const style = window.getComputedStyle(container.querySelector('.MuiTabs-root'));
  expect(style.borderBottomWidth).not.toBe('1px');
  expect(style.marginBottom).not.toBe('16px');
});
