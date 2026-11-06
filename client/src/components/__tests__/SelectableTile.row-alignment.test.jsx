// specs/report-grammar.md §3 rule 18 — a tile with a definition or a pill is a column laid from its top,
// so the labels of a row stay level whether a tile carries a pill or not; the legacy tile is untouched
// (its markup is pinned by ReportGrammar.legacy-unchanged.test.jsx).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SelectableTile from '../SelectableTile';

const tile = (props) => render(
  <ThemeProvider theme={theme}>
    <SelectableTile label="Encaissé" value="29 653 €" caption="97 % du chiffre d'affaires" selected={false} onClick={() => {}} {...props} />
  </ThemeProvider>,
);

test.each([
  ['with a pill', { info: 'Paiements reçus.', comparison: { change: 44.4, previous: '20 534 €' } }],
  ['without a pill', { info: 'Paiements reçus.' }],
])('rule 18 — a selectable tile %s lays its content from the top', (_, props) => {
  tile(props);
  const style = getComputedStyle(screen.getByRole('button', { name: 'Encaissé : afficher le détail' }));
  expect(style.display).toBe('flex');
  expect(style.flexDirection).toBe('column');
  expect(style.justifyContent).toBe('flex-start');
});
