// specs/mixed-method-payments.md rules 32, 45 (audits R34-C-M1, R34-A1) — the SAS dialog stays mounted for the whole page:
// every opening starts with one method, so a check-out with nothing to collect after a split one ends on « Valider et
// terminer »; and reception, which records a check-out with one method only, is never offered « Plusieurs moyens ».
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';

import api from '../../../api';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import ReservationSasDialog from '../ReservationSasDialog';
import { sasPayload, clickBtn } from './sasFixtures';
import { previewLikeTheServer, departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
});

const tree = (open, reservationId) => (
  <MemoryRouter>
    <ThemeProvider theme={theme}><DialogProvider>
      <ReservationSasDialog open={open} mode="departure" reservationId={reservationId} onClose={() => {}} onDone={() => {}} />
    </DialogProvider></ThemeProvider>
  </MemoryRouter>
);

// Walks the check-out to its recap; the ménage « Pas OK » bills the 80 € cleaning, « OK » bills nothing.
async function toRecap(cleaningOk) {
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn(cleaningOk ? 'OK' : 'Pas OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
}

const payload = (over = {}) => sasPayload({ reservation: { cautionAmount: 0 }, cleaning: { included: false, price: 80 }, ...over });

test('rule 32 (R34-C-M1) — after a split check-out, the next opening with nothing to collect ends on « Valider et terminer »', async () => {
  api.getReservationSas.mockResolvedValue(payload());
  const view = render(tree(true, 1));
  await toRecap(false);
  await screen.findByText(/Total à percevoir : 80,00 €/);
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
  fireEvent.change(document.querySelector('[data-tender-amount="0"]'), { target: { value: '30' } });
  clickBtn('Encaisser 80,00 €');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));

  view.rerender(tree(false, 1));
  view.rerender(tree(true, 2));
  await toRecap(true);
  await screen.findByText('Rien à percevoir');
  expect(screen.queryByRole('button', { name: /^Encaisser/ })).toBeNull();
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(2));
  const second = api.commitDepartureSas.mock.calls[1][1];
  expect(second.complementsTenders).toBeUndefined();
  expect(second.complementsSettled).toBe(false);
});

test('rule 32 (R34-C-M1) — reopened on a stay to collect, the payment buttons are back, no lines', async () => {
  api.getReservationSas.mockResolvedValue(payload());
  const view = render(tree(true, 1));
  await toRecap(false);
  await screen.findByText(/Total à percevoir : 80,00 €/);
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
  view.rerender(tree(false, 1));
  view.rerender(tree(true, 2));
  await toRecap(false);
  await screen.findByText(/Total à percevoir : 80,00 €/);
  expect(document.querySelector('[data-tender-line]')).toBeNull();
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeInTheDocument();
});

test('rule 45 (R34-A1) — reception is offered no « Plusieurs moyens » at check-out', async () => {
  api.getReservationSas.mockResolvedValue({ ...payload(), canSplitPayment: false });
  render(tree(true, 1));
  await toRecap(false);
  await screen.findByText(/Total à percevoir : 80,00 €/);
  expect(document.querySelector('[data-split-toggle="departure"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeInTheDocument();
});
