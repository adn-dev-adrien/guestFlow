// specs/review-2026-10-18-reservations.md rule 3 — the SAS shows « Étape N » with no total: an
// accepted upsell opens its own pages, and « 9/10 » becoming « 9/12 » read as going backwards.
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

test('rule 3 — the step counter names the step, never a total that can grow', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2, children: 1 },
    cleaning: { included: true, price: null },
    bathLinen: { available: true, unitPrice: 4, priceType: 'per_person', persons: 3, nights: 2, amount: 12, label: 'Linge de toilette' },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le linge de toilette/);
  expect(screen.getByText(/^Étape \d+$/)).toBeInTheDocument();
  expect(screen.queryByText(/^Étape \d+\/\d+$/)).toBeNull();
});
