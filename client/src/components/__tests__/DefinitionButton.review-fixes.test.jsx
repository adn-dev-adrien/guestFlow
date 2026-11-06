/**
 * specs/report-grammar.md §3 rule 23 — review round R5: the bubble is as wide as its text (≤ 280 px,
 * never the 24 px of its anchor), lives outside any clipping card, is announced (aria-describedby)
 * and closes when the focus leaves by Tab.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DefinitionButton, { BUBBLE_SX } from '../DefinitionButton';

const r = () => render(
  <ThemeProvider theme={theme}>
    <div style={{ overflow: 'hidden', width: 24 }} data-testid="clip"><DefinitionButton label="RevPAR" definition="Revenu des nuits ÷ nuits ouvertes." /></div>
    <button type="button">suivant</button>
  </ThemeProvider>,
);

test('rule 23 — the bubble takes its text width up to 280 px, within the screen', () => {
  expect(BUBBLE_SX).toMatchObject({ width: 'max-content', maxWidth: 'min(280px, calc(100vw - 32px))' });
});

test('rule 23 — open, the bubble sits outside the clipping card and describes its button', async () => {
  r();
  const i = screen.getByRole('button', { name: 'Définition : RevPAR' });
  await userEvent.click(i);
  const bubble = screen.getByTestId('definition-bubble');
  expect(screen.getByTestId('clip').contains(bubble)).toBe(false);
  expect(i).toHaveAccessibleDescription('Revenu des nuits ÷ nuits ouvertes.');
});

test('rule 23 — Tab away closes the bubble', async () => {
  r();
  await userEvent.click(screen.getByRole('button', { name: 'Définition : RevPAR' }));
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'suivant' })).toHaveFocus();
  expect(screen.queryByRole('tooltip')).toBeNull();
});
