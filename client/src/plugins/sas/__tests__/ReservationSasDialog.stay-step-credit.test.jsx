// The stay step after a credit — specs/pricing-components.md rules 117, 118 (stabilisation loop t9, O9-1).
//
// The stored row still asks 30 € of solde, but a paid line offered at the recap frees 45 € the plan credits to that solde: the plan's
// « Séjour à régler » is 0 (`applicable: false`). The stay page never shows the stored 30 € in its place — before the first answer it reads
// « — », once the plan answered the page is gone — and the commit marks nothing paid.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, stayDue, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const STORED_SOLDE = stayDue({ total: 30, balance: { amount: 30, applicable: true, settled: false, due: 30, owned: false, collectible: 30 } });
const CREDITED = { applicable: false, total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  const base = previewLikeTheServer(api);
  api.previewArrivalSas.mockImplementation(async (id, draft, options) => {
    const recap = await base(id, draft, options);
    return { ...recap, stayDue: 0, stayPayment: CREDITED, totalAtArrival: recap.arrivalComplementTotal };
  });
  api.getReservationSas.mockResolvedValue(sasPayload({
    cleaning: { included: true, price: 80 }, reservation: { cautionAmount: 0, options: [{ title: 'Bois', quantity: 1 }] }, stayPayment: STORED_SOLDE,
  }));
});

test('O9-1 — the credit brings the stay due to 0: the stored 30 € is never shown, the page goes, nothing is marked paid', async () => {
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  expect(screen.queryByText('30,00 €')).not.toBeInTheDocument();
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  expect(api.previewArrivalSas).toHaveBeenCalled();
  expect(screen.queryByText('Séjour à régler :')).not.toBeInTheDocument();
  expect(screen.queryByText('30,00 €')).not.toBeInTheDocument();
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/Séjour :/)).not.toBeInTheDocument();
  // The button reads « Calcul du total… » while the recap's preview is in flight: wait for its own label, as the sibling suites do.
  await screen.findByRole('button', { name: 'Valider et terminer' });
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect([payload.stayPaid, payload.displayedStayDue]).toEqual([undefined, undefined]);
});
