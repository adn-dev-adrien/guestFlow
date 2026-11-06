// specs/defer-arrival-complement-to-checkout.md rule 21, specs/single-payment-at-check-in.md rule 18 (audit R25-A1) — a
// complement paid before check-in (payment link, fiche tick, reconciliation) hides the recap's payment buttons; the first
// arrival SAS must not send « not settled » for it: the mode is read from the stored flags, as the departure does
// (specs/recall-unpaid-arrival-complement-at-checkout.md rule 9bis).
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
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 50 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

// Paid a few days before the check-in, whatever today is.
const PAID_ON = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

async function commitFirstArrival(reservation) {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, complementAmount: 50, arrivalSasDoneAt: null, ...reservation },
    cleaning: { included: true, price: null },
    arrivalPayment: { complementOpen: Number(reservation.complementPaid || 0) !== 1, group: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByRole('button', { name: 'Valider et terminer' });
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  return api.commitArrivalSas.mock.calls[0][1];
}

test('first arrival SAS, complement paid by card before check-in: no buttons, the commit says it is settled', async () => {
  const body = await commitFirstArrival({ complementPaid: 1, complementPaidDate: PAID_ON, complementPaidCash: 0 });
  expect(screen.queryByRole('button', { name: 'Payé en liquide' })).not.toBeInTheDocument();
  expect(body.complementSettled).toBe(true);
  expect(body.complementPaidCash).toBe(false);
  expect(body.arrivalPaymentMode).toBe('card');
});

test('first arrival SAS, complement paid into the caisse interne before check-in: the commit keeps the caisse interne', async () => {
  const body = await commitFirstArrival({ complementPaid: 1, complementPaidDate: PAID_ON, complementPaidCash: 1 });
  expect(body.complementSettled).toBe(true);
  expect(body.complementPaidCash).toBe(true);
  expect(body.arrivalPaymentMode).toBe('cash');
});

test('first arrival SAS, complement still due: « En fin de séjour » stays the default', async () => {
  const body = await commitFirstArrival({ complementPaid: 0 });
  expect(body.complementSettled).toBe(false);
  expect(body.arrivalPaymentMode).toBe('defer');
});
