// specs/pricing-components.md rules 23, 105, 107 (stabilisation loop t6, S6-4) — the arrival commit is judged like the fiche: offering on the recap a
// line the guest already paid answers 409 OVERPAID; the dialog asks « Offrir · X à rembourser » and commits again with `forceOverpayment`, or
// keeps the line (« Garder ») and commits nothing.
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
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const overpaid = () => Object.assign(new Error('Trop-perçu : 45,00 € déjà encaissés au-delà du nouveau total.'), { code: 'OVERPAID', overpaymentTtc: 45 });

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.commitArrivalSas.mockRejectedValueOnce(overpaid()).mockResolvedValue({ ok: true, complementAmount: 0 });
});

async function offerThePaidLineAndCommit() {
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
  return screen.findByText('Ligne déjà payée');
}

test('confirmed: the same commit goes again with forceOverpayment', async () => {
  await offerThePaidLineAndCommit();
  clickBtn('Offrir · 45,00 € à rembourser');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(2));
  const [first, second] = api.commitArrivalSas.mock.calls.map((call) => call[1]);
  expect(first.forceOverpayment).toBeUndefined();
  expect(second).toEqual({ ...first, forceOverpayment: true });
  expect(second.offered).toEqual([{ kind: 'option', id: 12 }]);
});

test('kept: nothing is committed again and no error is shown', async () => {
  await offerThePaidLineAndCommit();
  clickBtn('Garder');
  await waitFor(() => expect(screen.queryByText('Ligne déjà payée')).not.toBeInTheDocument());
  expect(api.commitArrivalSas).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Échec de l'enregistrement/)).not.toBeInTheDocument();
});
