// specs/reception-role-checkin-only.md rule 18 (loop t7 A7-1) — the 409 OVERPAID a reception account meets at the SAS carries no amount:
// the dialog shows the refusal and offers no « Offrir · X à rembourser » confirmation, so nothing can be forced.
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

test('a refusal without amount is shown as is, never confirmed, never sent again', async () => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.commitArrivalSas.mockRejectedValue(Object.assign(new Error('Ligne déjà payée : à voir avec l’administrateur.'), { code: 'OVERPAID' }));
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0,
      complementAmount: 45,
      options: [{ lineId: 805, optionId: 12, title: 'Balade', inComplement: 1, offered: 0, totalPrice: 45, originalTotalPrice: 45, unitPrice: 45, billedUnits: 1, quantity: 1 }],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Offrir');
  await screen.findByText(/Total : 0,00 €/);
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect((await screen.findAllByText(/à voir avec l’administrateur/)).length).toBeGreaterThan(0);
  expect(screen.queryByText('Ligne déjà payée')).not.toBeInTheDocument();
  expect(api.commitArrivalSas).toHaveBeenCalledTimes(1);
});

// Loop t8 A8-2 — the reception refusal keeps the recap keys of the refused lines (no amount): the dialog puts exactly those back to billed,
// as « Garder » does for the admin, and leaves the other offered lines alone; the next « Valider » sends the corrected set.
test('a refusal without amount puts back to billed only the lines it names', async () => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.commitArrivalSas.mockReset();
  api.commitArrivalSas
    .mockRejectedValueOnce(Object.assign(new Error('Ligne déjà payée : à voir avec l’administrateur.'), { code: 'OVERPAID', overpaymentKeys: ['option:12'] }))
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
  for (const button of screen.getAllByRole('button', { name: /^Offrir/ })) button.click();
  await screen.findByText(/Total : 0,00 €/);
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect((await screen.findAllByText(/à voir avec l’administrateur/)).length).toBeGreaterThan(0);
  expect(screen.queryByText('Ligne déjà payée')).not.toBeInTheDocument();
  await screen.findByText(/Total : 45,00 €/);
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(2));
  const offered = api.commitArrivalSas.mock.calls[1][1].offered;
  expect(offered.map((ref) => ref.id)).toEqual([13]);
});
