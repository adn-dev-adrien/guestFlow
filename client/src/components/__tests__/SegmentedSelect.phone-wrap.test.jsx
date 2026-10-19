// specs/ui-review-2026-10-19-operations.md rule 25 — on a phone a long segment label wraps on two lines
// instead of ending in an ellipsis; from sm the segments keep one line.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SegmentedSelect from '../SegmentedSelect';
import { setViewport, resetViewport } from './viewportFixture';
import { valueUnder } from './mediaRulesFixture';

afterEach(resetViewport);

const OPTIONS = [{ value: 'all', label: 'Tous' }, { value: 1, label: 'Aventura lodge' }, { value: 2, label: 'Gîte' }, { value: 3, label: 'L’Estiva' }];
const renderAt = (width) => {
  setViewport(width);
  return render(<ThemeProvider theme={theme}><SegmentedSelect label="Logement" options={OPTIONS} value="all" onChange={() => {}} maxSegments={4} /></ThemeProvider>);
};

test('rule 25: at 390 px « Aventura lodge » may wrap, never ellipsised', () => {
  renderAt(390);
  const segment = screen.getByRole('button', { name: 'Aventura lodge' });
  expect(valueUnder(segment, 'white-space', 'min-width:0px')).toBe('normal');
  expect(valueUnder(segment, 'text-overflow', 'min-width:0px')).toBe('clip');
});

test('rule 25: from sm the segments keep one line', () => {
  renderAt(1280);
  expect(valueUnder(screen.getByRole('button', { name: 'Aventura lodge' }), 'white-space', 'min-width:600px')).toBe('nowrap');
});
