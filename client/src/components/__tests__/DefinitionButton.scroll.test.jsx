/**
 * specs/report-grammar.md §3 rule 36 — the bubble is fixed to the screen: a scroll of the page or of
 * a container closes it, so it never rides over the app bar while its « i » scrolls away.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DefinitionButton from '../DefinitionButton';

test('rule 36 — a page scroll closes the open bubble', async () => {
  render(<DefinitionButton label="Déjà payé" definition="Payé sur les séjours de la période." />);
  await userEvent.click(screen.getByRole('button', { name: 'Définition : Déjà payé' }));
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.scroll(window);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('rule 36 — so does the scroll of a container', async () => {
  render(<div data-testid="pane" style={{ overflow: 'auto' }}><DefinitionButton label="RevPAR" definition="x" /></div>);
  await userEvent.click(screen.getByRole('button', { name: 'Définition : RevPAR' }));
  fireEvent.scroll(screen.getByTestId('pane'));
  expect(screen.queryByRole('tooltip')).toBeNull();
});
