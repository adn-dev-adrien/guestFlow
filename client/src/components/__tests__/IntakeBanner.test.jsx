// specs/airbnb-mail-intake.md §4.1 — the banner the intake plugins share: message, details, notes,
// choices, actions, link, close, busy.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import IntakeBanner from '../IntakeBanner';

test('renders every part it is given and nothing it is not', () => {
  render(
    <IntakeBanner
      severity="warning"
      title="Prix de location : 504 € ou 505 € ?"
      details={[{ key: 'a', text: 'Prénom : vide → Camille' }]}
      notes={['Ajouté tel quel : « Panier » 24 €', null]}
      choices={[{ key: 504, label: '504 €', caption: 'commission 50 €', onClick: () => {} }]}
      link={{ href: 'https://example.test', label: 'Voir sur Airbnb' }}
    >
      Le reste de la fiche est rempli.
    </IntakeBanner>,
  );
  expect(screen.getByText('Prix de location : 504 € ou 505 € ?')).toBeInTheDocument();
  expect(screen.getByText('Prénom : vide → Camille')).toBeInTheDocument();
  expect(screen.getByText('Ajouté tel quel : « Panier » 24 €')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /504 €/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir sur Airbnb' })).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
});

test('actions fire, and busy disables them and hides the close icon', async () => {
  const onApply = vi.fn();
  const { rerender } = render(
    <IntakeBanner severity="info" onClose={() => {}} actions={[{ key: 'apply', label: 'Appliquer', variant: 'contained', onClick: onApply }]}>
      Proposition
    </IntakeBanner>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  expect(onApply).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  rerender(
    <IntakeBanner severity="info" busy onClose={() => {}} error="Échec" actions={[{ key: 'apply', label: 'Appliquer', onClick: onApply }]}>
      Proposition
    </IntakeBanner>,
  );
  expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  expect(screen.getByText('Échec')).toBeInTheDocument();
});
