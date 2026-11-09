// specs/resource-booking-pricing-and-invoicing.md rules 7, 9 — the offered time moves by 15 minutes; the refusal is the server's.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import OfferedTimeField from '../OfferedTimeField';

test('rule 7 — + and − move by 15 minutes, never below 0 nor above the slot', () => {
  const onChange = vi.fn();
  const { rerender } = render(<OfferedTimeField value={0} max={30} onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Moins 15 minutes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Plus 15 minutes' }));
  expect(onChange).toHaveBeenLastCalledWith(15);
  rerender(<OfferedTimeField value={30} max={30} onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Plus 15 minutes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Moins 15 minutes' }));
  expect(onChange).toHaveBeenLastCalledWith(15);
});

test('rule 9 — the server\'s refusal is shown under the stepper', () => {
  render(<OfferedTimeField value={45} max={60} onChange={() => {}} refusal="Le temps offert dépasse la durée réservée." />);
  expect(screen.getByText('Le temps offert dépasse la durée réservée.')).toBeInTheDocument();
});
