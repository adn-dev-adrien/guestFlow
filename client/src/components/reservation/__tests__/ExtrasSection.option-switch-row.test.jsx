// specs/reservation-form-sections.md rule 7 (2026-10-27 audit) — on a phone the « Arrivée anticipée » card showed
// its switch floating alone with « Ajout automatique » stacked under it. The switch and the word that
// explains it are one FormControlLabel row, and the switch carries the option's name.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

test('« Ajout automatique » labels the switch on the same row', () => {
  const ctx = makeMockContext({
    propertyOptions: [{ id: 11, title: 'Arrivée anticipée', price: 30, priceType: 'per_stay', autoEnabled: 1, autoOptionType: 'early_check_in', autoPricingMode: 'fixed' }],
  });
  render(<ReservationFormProvider value={ctx}><ExtrasSection /></ReservationFormProvider>);
  const sw = screen.getByRole('switch', { name: 'Arrivée anticipée' });
  const row = sw.closest('label');
  expect(row).not.toBeNull();
  expect(row).toHaveTextContent('Ajout automatique');
});
