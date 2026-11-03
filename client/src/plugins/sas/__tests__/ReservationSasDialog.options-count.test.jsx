// specs/non-card-option-served-persons.md rule 27 — the « Prestations réservées » recap prints the figure
// the server sends, not `quantity`, which stays 1 on a typed line.
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer, departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

test('rule 27 — a typed line reads the people served; a lone unit reads no count', async () => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionReceived: 1,
      options: [
        { title: 'Linge', quantity: 1, displayCount: 3 },
        { title: 'Ménage', quantity: 1, displayCount: 1 },
      ],
    },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  expect(await screen.findByText('• Linge × 3')).toBeInTheDocument();
  expect(screen.getByText('• Ménage')).toBeInTheDocument();
});
