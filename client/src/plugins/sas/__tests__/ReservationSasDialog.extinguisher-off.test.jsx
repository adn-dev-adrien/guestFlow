// specs/plugins-phase-p-productisation.md rule 16 — with « Contrôle de l'extincteur » off, the departure
// SAS has no extinguisher step and sends no seal field.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

test('departure SAS without the extinguisher check: from the keys straight to the recap, no seal sent', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
    extinguisherCheck: false,
    repairAmounts: [{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 }],
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.queryByText(/bon état/i)).not.toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.extinguisherSealOkAtDeparture).toBeUndefined();
  expect(arg.extinguisherCharges).toEqual([]);
});
