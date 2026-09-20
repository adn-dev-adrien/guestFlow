/**
 * ReservationLostItemsCard — « Objets oubliés », saved on its own PATCH (specs/guest-email-sequence.md
 * rule 33).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({ __esModule: true, default: { updateReservationLostItems: vi.fn() } }));
vi.mock('../DialogProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));

import api from '../../api';
import ReservationLostItemsCard from '../ReservationLostItemsCard';

beforeEach(() => api.updateReservationLostItems.mockReset());

test('saves the text on its own endpoint, only once it changed', async () => {
  const user = userEvent.setup();
  api.updateReservationLostItems.mockResolvedValue({ lostItems: 'un doudou lapin bleu' });
  render(<ReservationLostItemsCard reservationId={12} initialValue="" />);
  const save = screen.getByRole('button', { name: 'Mettre à jour les objets' });
  expect(save).toBeDisabled();
  await user.type(screen.getByLabelText('Objets retrouvés après le départ'), 'un doudou lapin bleu');
  await user.click(save);
  await waitFor(() => expect(api.updateReservationLostItems).toHaveBeenCalledWith(12, 'un doudou lapin bleu'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mettre à jour les objets' })).toBeDisabled());
});
