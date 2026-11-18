// specs/gift-voucher-campaigns.md rule 51 — « Réservable jusqu'à » beside the opening hours of a slotted resource.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import HourlyResourceFields from '../HourlyResourceFields';

const DRAFT = { priceType: 'per_hour', price: 50, isComplex: true, minimumUsageMinutes: 60 };

test('the field reads the resource\'s months, 3 by default, and sends the typed value as a patch', () => {
  const onChange = vi.fn();
  render(<HourlyResourceFields draft={DRAFT} onChange={onChange} />);
  const field = screen.getByLabelText('Réservable jusqu\'à (mois)');
  expect(field).toHaveValue(3);
  fireEvent.change(field, { target: { value: '6' } });
  expect(onChange).toHaveBeenLastCalledWith({ bookingHorizonMonths: '6' });
});

test('a resource that is not slotted has no opening hours and no horizon field', () => {
  render(<HourlyResourceFields draft={{ ...DRAFT, isComplex: false }} onChange={() => {}} />);
  expect(screen.queryByLabelText('Réservable jusqu\'à (mois)')).toBeNull();
});
