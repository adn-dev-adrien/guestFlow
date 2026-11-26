// specs/sas/reception-role-checkin-only.md rule 18 reading (loop t9 A9-4) — a reception commit refused 409 LINE_OWED names the owed lines'
// recap keys (`owedKeys`, no amount): the dialog puts exactly those back to offered, so the next « Valider » sends them offered and goes
// through instead of meeting the same refusal again.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn(() => Promise.resolve({ configured: false, resolved: false, department: null, alerts: [] })),
  },
}));

test('A9-4 — LINE_OWED puts the named lines back to offered; the next « Valider » sends them offered', async () => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.commitArrivalSas
    .mockRejectedValueOnce(Object.assign(new Error('Ligne déjà payée : à voir avec l’administrateur.'), { code: 'LINE_OWED', owedKeys: ['option:12'] }))
    .mockResolvedValueOnce({});
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0,
      complementAmount: 65,
      options: [
        { lineId: 805, optionId: 12, title: 'Balade', inComplement: 1, offered: 0, totalPrice: 45, originalTotalPrice: 45, unitPrice: 45, billedUnits: 1, quantity: 1 },
        { lineId: 806, optionId: 13, title: 'Vélo', inComplement: 1, offered: 0, totalPrice: 20, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1 },
      ],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].offered).toEqual([]);
  expect((await screen.findAllByText(/à voir avec l’administrateur/)).length).toBeGreaterThan(0);
  await screen.findByText(/Total : 20,00 €/);
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(2));
  expect(api.commitArrivalSas.mock.calls[1][1].offered.map((ref) => ref.id)).toEqual([12]);
});
