// specs/dashboard-planning-scroll.md rule 4 — an empty list takes one line; a list with items shows them.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import FoldedDayList from '../FoldedDayList';

const mount = (props, children = <div>LISTE</div>) => render(
  <ThemeProvider theme={theme}><FoldedDayList title="Départs du jour" emptyText="Aucun départ aujourd'hui" {...props}>{children}</FoldedDayList></ThemeProvider>,
);

test('rule 4 — empty: the title and the muted sentence on one folded line, children not rendered, `after` below it', () => {
  mount({ empty: true, after: <p>SUITE</p> });
  const line = screen.getByTestId('folded-day-list');
  expect(line).toHaveTextContent("Départs du jourAucun départ aujourd'hui");
  expect(screen.queryByText('LISTE')).not.toBeInTheDocument();
  expect(screen.getByText('SUITE')).toBeInTheDocument();
});

test('rule 4 — with items: the title and the children, no folded line and no `after`', () => {
  mount({ empty: false, after: <p>SUITE</p> });
  expect(screen.getByText('Départs du jour')).toBeInTheDocument();
  expect(screen.getByText('LISTE')).toBeInTheDocument();
  expect(screen.queryByTestId('folded-day-list')).not.toBeInTheDocument();
  expect(screen.queryByText("Aucun départ aujourd'hui")).not.toBeInTheDocument();
  expect(screen.queryByText('SUITE')).not.toBeInTheDocument();
});
