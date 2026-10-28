// specs/dashboard-planning-scroll.md rule 16 — the page bar publishes its bottom edge as
// `--gf-page-bar-bottom` on the document root, and takes it away when it leaves.
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';

vi.mock('../../hooks/usePageTitle', () => ({ usePublishPageTitle: () => {}, useTopBarActionSlot: () => null }));

const root = () => document.documentElement.style.getPropertyValue('--gf-page-bar-bottom');

test('rule 16 — the variable is the app bar plus the bar\'s own height, and is removed on unmount', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(72);
  const { unmount } = render(<MemoryRouter><ThemeProvider theme={theme}><PageActionBar title="Planning" /></ThemeProvider></MemoryRouter>);
  expect(parseFloat(root())).toBe(64 + 72);
  unmount();
  expect(root()).toBe('');
  height.mockRestore();
});

test('rule 16 — the bar measured again when it changes size', () => {
  let observed = null;
  const original = global.ResizeObserver;
  global.ResizeObserver = class { constructor(cb) { observed = cb; } observe() {} disconnect() {} };
  let h = 56;
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => h);
  const { unmount } = render(<MemoryRouter><ThemeProvider theme={theme}><PageActionBar title="Planning" /></ThemeProvider></MemoryRouter>);
  expect(parseFloat(root())).toBe(64 + 56);
  h = 104;
  observed();
  expect(parseFloat(root())).toBe(64 + 104);
  unmount();
  global.ResizeObserver = original;
  height.mockRestore();
});
