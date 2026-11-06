/**
 * specs/report-grammar.md §3 rules 24 and 25 — review round R5: an open tile with a definition keeps
 * its pointer toward the panel, and a screen reader hears the figure, its line and its pill.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SelectableTile from '../SelectableTile';

const tile = (selected) => (
  <ThemeProvider theme={theme}>
    <SelectableTile label="Déjà payé" value="786 €" caption="3 séjours" info="Payé sur les séjours de la période." comparison={{ change: null }} selected={selected} onClick={() => {}} controls="d" />
  </ThemeProvider>
);
const cssOf = (el) => {
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  return { css, cls };
};

test('rule 24 — the open tile draws its pointer; the closed one does not', () => {
  const { rerender } = render(tile(true));
  let { css, cls } = cssOf(screen.getByRole('button', { name: 'Déjà payé : masquer le détail' }));
  expect(css).toMatch(new RegExp(`\\.${cls}::after\\{[^}]*rotate\\(45deg\\)`));
  rerender(tile(false));
  ({ css, cls } = cssOf(screen.getByRole('button', { name: 'Déjà payé : afficher le détail' })));
  expect(css).not.toMatch(new RegExp(`\\.${cls}::after\\{`));
});

test('rule 25 — the tile names its action and describes its figure, line and pill', () => {
  render(tile(false));
  const b = screen.getByRole('button', { name: 'Déjà payé : afficher le détail' });
  expect(b).toHaveAccessibleDescription(/786 €.*3 séjours.*— vs N-1/);
});
