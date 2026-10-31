// specs/payment-link-lifecycle.md rule 46 — an information dialog can carry, under its message, the records a refusal
// names (`details`, a ConflictList): the DATES_HELD refusal of the devis fiche shows the stays that hold the nights.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider, { useAppDialogs } from '../DialogProvider';

function Probe() {
  const { alert } = useAppDialogs();
  return <button type="button" onClick={() => alert({ title: 'Dates déjà réservées', message: 'Dates déjà réservées : devis non enregistré.', details: <p>T41 · Ana Test</p> })}>ouvrir</button>;
}

test('the details are drawn under the message', async () => {
  render(<DialogProvider><Probe /></DialogProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'ouvrir' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Dates déjà réservées : devis non enregistré.')).toBeInTheDocument();
  expect(within(dialog).getByText('T41 · Ana Test')).toBeInTheDocument();
});
