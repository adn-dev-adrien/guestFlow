import React from 'react';
import { render } from '@testing-library/react';
import { useReservationForm } from '../ReservationFormContext';
import { vi } from 'vitest';

function Consumer() {
  useReservationForm();
  return null;
}

test('useReservationForm throws a clear error when used outside its provider', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<Consumer />)).toThrow(
    'useReservationForm must be used within a ReservationFormProvider'
  );
  spy.mockRestore();
});
