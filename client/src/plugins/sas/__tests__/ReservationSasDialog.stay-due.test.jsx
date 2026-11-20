// The stay step reads the plan — specs/pricing-components.md rule 117 (stabilisation loop t8, S8-1).
//
// A paid line put back to billed moves the solde inside the commit: the « Séjour à régler » the wizard shows is the latest preview's
// (`recap.stayPayment`), the commit sends the « Séjour » the recap showed (`displayedStayDue`), and a 409 STAY_DUE_CHANGED reads the recap again.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, stayDue, renderDialog, clickBtn, stayPageReady } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn(() => Promise.resolve({ ok: true, complementAmount: 0 })),
    commitDepartureSas: vi.fn(() => Promise.resolve({ ok: true })),
    getReservationWeatherAlerts: vi.fn(() => Promise.resolve({ configured: false, resolved: false, department: null, alerts: [] })),
  },
}));

// The server's plan raised the solde by 45 € (a paid line billed again): the preview answers 525 where the stored payload said 480.
const PLANNED = 525;
beforeEach(() => {
  vi.clearAllMocks();
  const base = previewLikeTheServer(api);
  api.previewArrivalSas.mockImplementation(async (id, draft, options) => {
    const recap = await base(id, draft, options);
    return { ...recap, stayDue: PLANNED, stayPayment: stayDue({ total: PLANNED }), totalAtArrival: PLANNED + recap.arrivalComplementTotal };
  });
  api.getReservationSas.mockResolvedValue(sasPayload({
    cleaning: { included: true, price: 80 }, reservation: { cautionAmount: 0 }, stayPayment: stayDue(),
  }));
});

test('rule 117 — the stay page shows the planned solde and the commit sends the « Séjour » the recap showed', async () => {
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Séjour à régler :');
  expect(await screen.findByText('525,00 €')).toBeInTheDocument();
  clickBtn('CB / Chèque');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect([payload.stayPaid, payload.displayedStayDue]).toEqual([true, PLANNED]);
});

test('rule 117 — a 409 STAY_DUE_CHANGED shows its message and reads the recap again', async () => {
  api.commitArrivalSas.mockRejectedValueOnce(Object.assign(new Error('Le séjour à régler est maintenant de 570,00 € : relire le récapitulatif.'), {
    code: 'STAY_DUE_CHANGED', stayDue: 570,
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await stayPageReady();
  clickBtn('CB / Chèque');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — à percevoir');
  const asked = api.previewArrivalSas.mock.calls.length;
  clickBtn('Valider et terminer');
  expect((await screen.findAllByText(/relire le récapitulatif/)).length).toBeGreaterThan(0);
  await waitFor(() => expect(api.previewArrivalSas.mock.calls.length).toBeGreaterThan(asked));
});
