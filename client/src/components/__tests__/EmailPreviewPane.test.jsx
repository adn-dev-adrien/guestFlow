// specs/guest-email-texts-made-simple.md rules 13–15 — the generic rendered-email viewer: the server's
// text as is, its states (loading, error, notice), the language toggle, the stay selector with
// « Exemple », and « M'envoyer un test ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailPreviewPane from '../EmailPreviewPane';

test('rule 13: the rendering, its stays and « Exemple »', () => {
  const onReservationChange = vi.fn();
  render(<EmailPreviewPane subject="À bientôt" body={'Bonjour Camille,\n\nCafé offert.'} reservations={[{ id: 7, label: 'Camille · Le Gîte' }]} reservationId={7} onReservationChange={onReservationChange} />);
  expect(screen.getByText('À bientôt')).toBeInTheDocument();
  expect(screen.getByTestId('email-preview')).toHaveTextContent('Bonjour Camille, Café offert.');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Réservation' }));
  fireEvent.click(screen.getByRole('option', { name: 'Exemple' }));
  expect(onReservationChange).toHaveBeenCalledWith('sample');
});

test('rule 14: the language toggle and the notice', () => {
  const onLanguageChange = vi.fn();
  render(<EmailPreviewPane language="en" onLanguageChange={onLanguageChange} notice="Texte anglais manquant : le français sera envoyé" />);
  expect(screen.getByText('Texte anglais manquant : le français sera envoyé')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'FR' }));
  expect(onLanguageChange).toHaveBeenCalledWith('fr');
});

test('rule 15: the test button, its result; loading and error states', () => {
  const onSendTest = vi.fn();
  const { rerender } = render(<EmailPreviewPane onSendTest={onSendTest} testMessage="Envoyé à contact@lespres.fr" loading />);
  expect(screen.getByLabelText('Aperçu en cours')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'M’envoyer un test' }));
  expect(onSendTest).toHaveBeenCalled();
  expect(screen.getByText('Envoyé à contact@lespres.fr')).toBeInTheDocument();
  rerender(<EmailPreviewPane error="Variable inconnue : {{prenon}}" />);
  expect(screen.getByText('Variable inconnue : {{prenon}}')).toBeInTheDocument();
  expect(screen.queryByTestId('email-preview')).toBeNull();
  expect(screen.queryByRole('button', { name: 'M’envoyer un test' })).toBeNull();
});
