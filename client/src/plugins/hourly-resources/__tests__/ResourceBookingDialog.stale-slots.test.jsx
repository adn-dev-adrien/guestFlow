// specs/plugins-phase-3c-hourly-resources.md rule 32 — the occupied slots drawn in the booking dialog
// are always those of the date on screen: the late answer for a date just left is dropped.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn(),
    getClients: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
    previewResourceBooking: vi.fn().mockResolvedValue({ total: 0 }),
  },
}));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00',
  slotDuration: 30, minimumUsageMinutes: 60,
};

test('a late occupied-slots answer for the previous date is not drawn on the new date', async () => {
  let resolveBusyDay;
  api.getOccupiedSlots.mockImplementation((resourceId, date) => (date === '2099-03-10'
    ? new Promise((resolve) => { resolveBusyDay = resolve; })
    : Promise.resolve({ occupiedSlots: [] })));
  render(<ResourceBookingDialog open resource={RESOURCE} booking={null} onClose={() => {}} onSave={() => {}} onDelete={() => {}} />);

  const date = screen.getByLabelText('Date');
  fireEvent.change(date, { target: { value: '2099-03-10' } });
  fireEvent.change(date, { target: { value: '2099-03-11' } });
  await waitFor(() => expect(api.getOccupiedSlots).toHaveBeenCalledWith(3, '2099-03-11'));
  await act(async () => { resolveBusyDay({ occupiedSlots: [{ id: 1, startTime: '12:00', endTime: '20:00', turnover: 0 }] }); });

  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  const option = await screen.findByRole('option', { name: '13:00' });
  expect(option).not.toHaveAttribute('aria-disabled', 'true');
});
