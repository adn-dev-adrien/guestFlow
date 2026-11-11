// Re-opening a completed SAS — specs/reopen-completed-sas.md.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

const returnedCaution = (over = {}) => sasPayload({
  reservation: { cautionAmount: 500, cautionReceived: 1, cautionReturned: 1, ...over },
  cleaning: { included: true, price: null },
});

async function walkToKeys() {
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
}

// specs/reopen-completed-sas.md rules 2 + 3 — re-opening a done departure shows the caution-return
// step even though the caution is already returned, pre-ticked from the stored flag.
test('departure re-open: the caution-return step is shown, pre-ticked « Caution rendue »', async () => {
  api.getReservationSas.mockResolvedValue(returnedCaution({ departureSasDoneAt: '2026-07-12 10:00:00' }));
  renderDialog({ mode: 'departure' });

  await walkToKeys();
  expect(await screen.findByText(/Rendre la caution de/)).toBeInTheDocument();
  expect(screen.getByText('Caution rendue')).toBeInTheDocument();
  clickBtn('Rendue');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  expect(api.commitDepartureSas.mock.calls[0][1].cautionReturned).toBe(true);
});

// specs/reopen-completed-sas.md rule 3 — outside a re-open, an already returned caution has no step.
test('first departure run: an already returned caution has no step', async () => {
  api.getReservationSas.mockResolvedValue(returnedCaution({ departureSasDoneAt: null }));
  renderDialog({ mode: 'departure' });

  await walkToKeys();
  await screen.findByText(/bon état/i);
  expect(screen.queryByText(/Rendre la caution de/)).toBeNull();
});

// specs/reopen-completed-sas.md rule 8 — « Quitter » on a re-opened wizard writes nothing.
test('re-open then « Quitter »: the dialog closes and nothing is committed', async () => {
  api.getReservationSas.mockResolvedValue(returnedCaution({ departureSasDoneAt: '2026-07-12 10:00:00' }));
  const onClose = vi.fn();
  renderDialog({ mode: 'departure', onClose });

  await walkToKeys();
  await screen.findByText(/Rendre la caution de/);
  fireEvent.click(screen.getByRole('button', { name: 'Quitter' }));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(api.commitDepartureSas).not.toHaveBeenCalled();
  expect(api.commitArrivalSas).not.toHaveBeenCalled();
});
