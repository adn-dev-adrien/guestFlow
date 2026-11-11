// specs/ui-review-2026-10-19-operations.md rule 35 — the screen-reader-only spans are 1px boxes: in MUI `sx`, a bare
// `width: 1` is 100% and `margin: -1` is -8px, which stretched the settings pages to a horizontal scroll.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { apiMock, media } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import BoundedNumberField from '../BoundedNumberField';
import AttentionCard from '../AttentionCard';
import TwoFactorSetupDialog from '../TwoFactorSetupDialog';
import { visuallyHidden } from '../../utils/visuallyHidden';

function expectOnePixel(node) {
  const style = getComputedStyle(node);
  expect(style.width).toBe('1px');
  expect(style.height).toBe('1px');
  expect(style.margin).toBe('-1px');
  expect(style.position).toBe('absolute');
}

test('rule 35: the bounded field live region is a 1px box', () => {
  render(<BoundedNumberField label="Délai" limits={{ min: 0, max: 30, integer: true, unit: 'jours' }} value={7} onCommit={() => {}} />);
  expectOnePixel(screen.getByRole('status'));
});

test('rule 35: the severity label of an attention card is a 1px box', () => {
  render(<ThemeProvider theme={theme}><AttentionCard attention={{ key: 'k', severity: 'urgent', count: 1, title: 'T', detail: 'D' }} /></ThemeProvider>);
  expectOnePixel(screen.getAllByText('Urgent')[0]);
});

test('rule 35: the step announcer of the 2FA dialog is a 1px box', () => {
  const orig = window.matchMedia;
  window.matchMedia = media();
  render(<TwoFactorSetupDialog open account="marie@x.fr" emailAvailable onClose={() => {}} onDone={() => {}} />);
  expectOnePixel(screen.getAllByRole('status')[0]);
  window.matchMedia = orig;
});

test('rule 35: the shared style never uses a unitless size', () => {
  expect(visuallyHidden.width).toBe('1px');
  expect(visuallyHidden.height).toBe('1px');
  expect(visuallyHidden.margin).toBe('-1px');
});
