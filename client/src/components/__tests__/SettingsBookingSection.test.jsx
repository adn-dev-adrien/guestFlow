// specs/gift-voucher-campaigns.md rule 51 — « Horizon de réservation en ligne »: the months field, its refusal sentence.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsBookingSection from '../SettingsBookingSection';

test('the field shows the stored months and sends the typed number', () => {
  const onChange = vi.fn();
  render(<SettingsBookingSection values={{ horizonMonths: 12 }} onChange={onChange} />);
  const field = screen.getByLabelText('Horizon de réservation en ligne (mois)');
  expect(field).toHaveValue(12);
  fireEvent.change(field, { target: { value: '18' } });
  expect(onChange).toHaveBeenLastCalledWith('horizonMonths', 18);
  fireEvent.change(field, { target: { value: '' } });
  expect(onChange).toHaveBeenLastCalledWith('horizonMonths', '');
});

test('the server\'s refusal sentence replaces the hint under the field', () => {
  render(<SettingsBookingSection values={{ horizonMonths: 40 }} errors={{ bookingHorizonMonths: 'Doit être un nombre entier de mois entre 1 et 36.' }} onChange={() => {}} />);
  expect(screen.getByText('Doit être un nombre entier de mois entre 1 et 36.')).toBeInTheDocument();
  expect(screen.getByLabelText('Horizon de réservation en ligne (mois)')).toBeInvalid();
});

test('without a stored value the field reads the default, 12', () => {
  render(<SettingsBookingSection values={{}} onChange={() => {}} />);
  expect(screen.getByLabelText('Horizon de réservation en ligne (mois)')).toHaveValue(12);
});
