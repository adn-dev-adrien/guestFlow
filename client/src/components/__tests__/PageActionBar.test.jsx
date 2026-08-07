import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import PageActionBar from '../PageActionBar';

// specs/reservation-page-action-bar.md + the « bandeau » centre slot: PageActionBar can render a
// centered node (e.g. the reservation's client name + number) between the title and the actions.

function renderBar(props = {}) {
  return render(
    <MemoryRouter>
      <PageActionBar title="Modifier la réservation" onSave={() => {}} {...props} />
    </MemoryRouter>,
  );
}

test('renders the centered node when `center` is provided', () => {
  renderBar({
    center: (
      <>
        <span>Jean Dupont</span>
        <span>N° 202607001</span>
      </>
    ),
  });
  expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
  expect(screen.getByText('N° 202607001')).toBeInTheDocument();
});

test('no centered node by default (other pages unaffected)', () => {
  renderBar();
  expect(screen.queryByText(/N° /)).toBeNull();
  // The bar still renders its title + Save action.
  expect(screen.getByText('Modifier la réservation')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
});
