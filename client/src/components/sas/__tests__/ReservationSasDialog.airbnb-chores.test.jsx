// specs/airbnb-no-checkout-chores.md rule 3 — the « vaisselle / poubelles » reminder follows the
// server's `cleaning.guestReminder`, never `cleaning.included`: an Airbnb guest is not asked for chores.
import { screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

async function reachRecap(guestReminder) {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: 80, guestReminder },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  while (!screen.queryByText('Récapitulatif — complément à percevoir')) {
    fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));
  }
}

test('Airbnb stay, ménage included: the recap asks for no chore', async () => {
  await reachRecap(false);
  expect(screen.queryByText(/vaisselle doit être faite/)).toBeNull();
});

test('other channel, ménage included: the recap keeps the reminder', async () => {
  await reachRecap(true);
  expect(screen.getByText(/vaisselle doit être faite/)).toBeInTheDocument();
});
