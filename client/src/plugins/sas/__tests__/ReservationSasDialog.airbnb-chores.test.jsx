// specs/airbnb-no-checkout-chores.md rule 3 — the « vaisselle / poubelles » reminder follows the
// server's `cleaning.guestReminder`, never `cleaning.included`: a guest of a channel that forbids
// checkout chores (Airbnb, rule 8) is not asked for any.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn().mockResolvedValue({ lines: [], total: 0 }),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

async function reachRecap(guestReminder) {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: 80, guestReminder },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  // The recap renders once the server preview answers: wait for it or for the next « Suivant ».
  for (;;) {
    const next = await waitFor(() => screen.queryByText('Récapitulatif — complément à percevoir')
      || screen.getByRole('button', { name: 'Suivant' }));
    if (next.tagName !== 'BUTTON') break;
    fireEvent.click(next);
  }
}

test('chore-free channel, ménage included: the recap asks for no chore', async () => {
  await reachRecap(false);
  expect(screen.queryByText(/vaisselle doit être faite/)).toBeNull();
});

test('other channel, ménage included: the recap keeps the reminder', async () => {
  await reachRecap(true);
  expect(screen.getByText(/vaisselle doit être faite/)).toBeInTheDocument();
});

// specs/airbnb-no-checkout-chores.md rule 7 — no « ménage fait correctement ? » page on such a departure.
test('chore-free channel departure without a cleaning line: straight to the missing-items question', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80, billableAtDeparture: false },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  expect(screen.queryByText(/Le ménage de fin de séjour a-t-il été fait correctement/)).toBeNull();
});
