// The arrival recap rendered from the server's preview — specs/sas-arrival-total-server-side.md rules
// 15-22: the money comes from the server only, the requests are coalesced and the latest wins, the
// waiting and failing states are said, and a commit on another total is announced.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { recapFor } from './sasPreviewFake';

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

// A stay whose complement holds one 20 € « Panier gourmand » — the recap can offer it.
const PAYLOAD = sasPayload({
  reservation: {
    cautionAmount: 0,
    complementAmount: 20,
    options: [{
      optionId: 5, title: 'Panier gourmand', inComplement: 1, offered: 0,
      totalPrice: 20, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1,
    }],
  },
  cleaning: { included: true, price: null },
});

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const answer = (draft, delay = 0) => wait(delay).then(() => recapFor(PAYLOAD, draft));

beforeEach(() => {
  vi.clearAllMocks();
  api.getReservationSas.mockResolvedValue(PAYLOAD);
  api.previewArrivalSas.mockImplementation((id, draft) => answer(draft));
  api.commitArrivalSas.mockResolvedValue({ ok: true, complementAmount: 20, warning: null });
});

async function openRecap() {
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText(/Total : 20,00 €/);
}

// rule 15
test('the recap shows the server’s figures, and the draft it sends carries no amount', async () => {
  await openRecap();
  const [, draft] = api.previewArrivalSas.mock.calls[0];
  expect(JSON.stringify(draft)).not.toMatch(/amount|total|price/i);
  expect(draft.offeredExtras).toEqual([]);
});

// rules 17-18
test('three quick gestures make one request, and only the latest answer is shown', async () => {
  await openRecap();
  const before = api.previewArrivalSas.mock.calls.length;
  clickBtn('Offrir');
  clickBtn('✓ Offert');
  clickBtn('Offrir');
  await screen.findByText(/Total : 0,00 €/);
  expect(api.previewArrivalSas.mock.calls.length - before).toBe(1);

  // A slow answer overtaken by a newer one is ignored.
  api.previewArrivalSas
    .mockImplementationOnce((id, draft) => answer(draft, 600))
    .mockImplementationOnce((id, draft) => answer(draft, 0));
  clickBtn('✓ Offert');                                  // → 20 €, slow
  await act(() => wait(260));
  clickBtn('Offrir');                                    // → 0 €, fast
  await screen.findByText(/Total : 0,00 €/);
  await act(() => wait(500));
  expect(screen.getByText(/Total : 0,00 €/)).toBeInTheDocument();
  expect(screen.queryByText(/Total : 20,00 €/)).toBeNull();
});

// rules 19-20
test('while the server computes, « Valider » waits and says so', async () => {
  await openRecap();
  api.previewArrivalSas.mockImplementationOnce((id, draft) => answer(draft, 400));
  clickBtn('Offrir');
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument(); // the gesture answers at once
  expect(screen.getByRole('button', { name: 'Calcul du total…' })).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Calcul du total' })).toBeInTheDocument();
  await screen.findByText(/Total : 0,00 €/);
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeEnabled();
});

// rule 21
test('no answer from the server: « Total indisponible », nothing can be validated, « Réessayer » recovers', async () => {
  api.previewArrivalSas.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { status: undefined }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  expect(await screen.findByText('Total indisponible : pas de réponse du serveur.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
  clickBtn('Réessayer');
  expect(await screen.findByText(/Total : 20,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeEnabled();
});

// rules 12, 21
test('a plugin refusing the draft is said on the recap, before « Valider »', async () => {
  await openRecap();
  api.previewArrivalSas.mockRejectedValueOnce(Object.assign(new Error('SLOT_CONFLICT'), { status: 409, error: 'SLOT_CONFLICT' }));
  clickBtn('Offrir');
  expect(await screen.findByText('Ce créneau n’est plus libre.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Revenir à l’étape' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
});

// rule 22
test('a commit recorded on another total says so instead of closing, and sends the total it showed', async () => {
  const onClose = vi.fn();
  api.commitArrivalSas.mockResolvedValue({
    ok: true, complementAmount: 25, warning: { code: 'ARRIVAL_TOTAL_DIFFERED', displayed: 20, stored: 25 },
  });
  renderDialog({ mode: 'arrival', onClose });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText(/Total : 20,00 €/);
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].displayedArrivalTotal).toBe(20);
  expect(await screen.findByText('Enregistré à 25,00 € — le récap affichait 20,00 €.')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  clickBtn('Fermer');
  expect(onClose).toHaveBeenCalled();
});
