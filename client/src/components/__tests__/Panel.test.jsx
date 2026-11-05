/**
 * specs/report-grammar.md §3 rule 7 — a report panel: a section named by its small uppercase label
 * (theme role `panelLabel`), an optional action beside it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import Panel from '../Panel';

test('rule 7 — the panel is a region named by its label, which is a heading', () => {
  render(<ThemeProvider theme={theme}><Panel label="Répartition des encaissements" action={<button type="button">Action</button>}>contenu</Panel></ThemeProvider>);
  expect(screen.getByRole('region', { name: 'Répartition des encaissements' })).toHaveTextContent('contenu');
  expect(screen.getByRole('heading', { level: 3, name: 'Répartition des encaissements' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
});

test('rule 7 — the panelLabel role is uppercase, tracked, muted', () => {
  expect(theme.typography.panelLabel).toMatchObject({ textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600 });
});
