// specs/pricing-components.md rules 23, 105, 107 (stabilisation loop t6, S6-4) — the arrival commit is judged like the fiche: offering on the recap a
// line the guest already paid answers 409 OVERPAID; the dialog asks « Offrir · X à rembourser » and commits again with `forceOverpayment`, or
// keeps the line (« Garder ») and commits nothing. Loop t7 UI7-2 / UI7-3 (rule 107 d): « Garder » puts the paid line the 409 names
// (`overpaymentKeys`) back to billed, so the recap asks its price again and « Valider » does not ask the same question twice; the departure
// commit goes through the same confirmation.
import { screen, waitFor } from '@testing-library/react';
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
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const overpaid = (key) => Object.assign(new Error('Trop-perçu : 45,00 € déjà encaissés au-delà du nouveau total.'), { code: 'OVERPAID', overpaymentTtc: 45, overpaymentKeys: [key] });

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
  api.commitArrivalSas.mockRejectedValueOnce(overpaid('option:12')).mockResolvedValue({ ok: true, complementAmount: 0 });
  api.commitDepartureSas.mockRejectedValueOnce(overpaid('option:4')).mockResolvedValue({ ok: true });
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

test('kept: nothing is committed again, no error is shown, and the paid line is billed again on the recap', async () => {
  await offerThePaidLineAndCommit();
  clickBtn('Garder');
  await waitFor(() => expect(screen.queryByText('Ligne déjà payée')).not.toBeInTheDocument());
  expect(api.commitArrivalSas).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Échec de l'enregistrement/)).not.toBeInTheDocument();
  expect(await screen.findByText(/Total : 45,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Offrir' })).toBeInTheDocument();
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(2));
  expect(api.commitArrivalSas.mock.calls[1][1].offered).toEqual([]);
  expect(screen.queryByText('Ligne déjà payée')).not.toBeInTheDocument();
});

async function offerTheRecalledPaidLineAndCommit() {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: null },
    arrivalComplement: {
      amount: 45,
      paid: 0,
      detail: [{ label: 'Balade', kind: 'option', qty: 1, unitPrice: 45, amount: 45, ref: { kind: 'option', id: 4 } }],
    },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  clickBtn('Offrir');
  await waitFor(() => expect(screen.queryByText(/Total à percevoir : 45,00 €/)).toBeNull());
  clickBtn('Valider et terminer');
  return screen.findByText('Ligne déjà payée');
}

test('departure, confirmed: the same check-out commit goes again with forceOverpayment', async () => {
  await offerTheRecalledPaidLineAndCommit();
  clickBtn('Offrir · 45,00 € à rembourser');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(2));
  const [first, second] = api.commitDepartureSas.mock.calls.map((call) => call[1]);
  expect(first.forceOverpayment).toBeUndefined();
  expect(second).toEqual({ ...first, forceOverpayment: true });
  expect(second.offeredArrivalExtras).toEqual([{ kind: 'option', id: 4 }]);
});

test('departure, kept: nothing is committed again and the recalled line is billed again', async () => {
  await offerTheRecalledPaidLineAndCommit();
  clickBtn('Garder');
  await waitFor(() => expect(screen.queryByText('Ligne déjà payée')).not.toBeInTheDocument());
  expect(api.commitDepartureSas).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Total à percevoir : 45,00 €/)).toBeInTheDocument();
});
