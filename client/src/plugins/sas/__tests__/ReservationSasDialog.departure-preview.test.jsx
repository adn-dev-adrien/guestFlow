// The departure recap rendered from the server's preview — specs/sas-departure-recap-server-side.md rules
// 13-20, 22: the money comes from the server only, the requests are coalesced and the latest wins, the
// waiting and failing states are said, and a commit on another total is announced.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { departureRecapFor } from './sasPreviewFake';

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

const PAYLOAD = sasPayload({
  reservation: { cautionAmount: 0 },
  cleaning: { included: false, price: 80 },
  linenItems: [{ id: 4, label: 'Serviette', price: 6.5, category: 'bath' }],
  repairAmounts: [{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 }],
});

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const answer = (draft, delay = 0) => wait(delay).then(() => departureRecapFor(PAYLOAD, draft));

beforeEach(() => {
  vi.clearAllMocks();
  api.getReservationSas.mockResolvedValue(PAYLOAD);
  api.previewDepartureSas.mockImplementation((id, draft) => answer(draft));
  api.commitDepartureSas.mockResolvedValue({ ok: true, recap: null, warning: null });
});

// ménage « Pas OK », nothing missing, keys back, extinguisher in good condition → the recap.
async function openRecap(props = {}) {
  renderDialog({ mode: 'departure', ...props });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText(/Total à percevoir : 80,00 €/);
}

// rules 13, 4
test('the recap shows the server’s figures, and the draft it sends carries no amount', async () => {
  await openRecap();
  const [, draft] = api.previewDepartureSas.mock.calls[0];
  expect(JSON.stringify(draft)).not.toMatch(/amount|total|price/i);
  expect(draft.cleaningCharged).toBe(true);
  expect(draft.missingItems).toEqual([]);
});

// rules 16-17
test('three quick gestures make one request, and only the latest answer is shown', async () => {
  await openRecap();
  const before = api.previewDepartureSas.mock.calls.length;
  clickBtn('Offrir');
  clickBtn('✓ Offert');
  clickBtn('Offrir');
  await waitFor(() => expect(screen.queryByText(/Total à percevoir/)).toBeNull());
  expect(api.previewDepartureSas.mock.calls.length - before).toBe(1);

  // A slow answer overtaken by a newer one is ignored.
  api.previewDepartureSas
    .mockImplementationOnce((id, draft) => answer(draft, 600))
    .mockImplementationOnce((id, draft) => answer(draft, 0));
  clickBtn('✓ Offert');                                  // → 80 €, slow
  await act(() => wait(260));
  clickBtn('Offrir');                                    // → 0 €, fast
  await waitFor(() => expect(api.previewDepartureSas.mock.calls.length - before).toBe(3));
  await act(() => wait(700));
  expect(screen.queryByText(/Total à percevoir/)).toBeNull();
});

// rules 18-19
test('while the server computes, the toggle answers at once, the figures stay dimmed, « Valider » waits and says so', async () => {
  await openRecap();
  api.previewDepartureSas.mockImplementationOnce((id, draft) => answer(draft, 400));
  clickBtn('Offrir');
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument(); // the gesture answers at once
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument(); // the last server figure stays — no estimate of ours
  expect(screen.getByRole('button', { name: 'Calcul du total…' })).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Calcul du total' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/Total à percevoir/)).toBeNull());
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeEnabled();
});

// rule 20
test('no answer from the server: « Total indisponible », amounts « — », nothing can be validated, « Réessayer » recovers', async () => {
  await openRecap();
  api.previewDepartureSas.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { status: undefined }));
  clickBtn('Offrir');
  expect(await screen.findByText('Total indisponible : pas de réponse du serveur.')).toBeInTheDocument();
  expect(screen.getByText(/Ménage de fin de séjour : —/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'CB / Chèque' })).toBeNull();
  clickBtn('Réessayer');
  await waitFor(() => expect(screen.queryByText('Total indisponible : pas de réponse du serveur.')).toBeNull());
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeEnabled();
});

test('before any answer, a failing server replaces the list with the same panel', async () => {
  api.previewDepartureSas.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: undefined }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  expect(await screen.findByText('Total indisponible : pas de réponse du serveur.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
});

// rule 15
test('the extinguisher page shows the server’s subtotal, « — » until it answered', async () => {
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Non');
  await screen.findByText('Frais extincteur à facturer');
  api.previewDepartureSas.mockImplementation((id, draft) => answer(draft, 300));
  fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]);
  expect(await screen.findByText('Sous-total : —')).toBeInTheDocument();
  expect(await screen.findByText('Sous-total : 30,00 €')).toBeInTheDocument();
});

// rule 22
test('a commit recorded on another total says so instead of closing, and sends the total it showed', async () => {
  const onClose = vi.fn();
  api.commitDepartureSas.mockResolvedValue({
    ok: true, recap: null, warning: { code: 'DEPARTURE_TOTAL_DIFFERED', displayed: 80, stored: 85 },
  });
  await openRecap({ onClose });
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  expect(api.commitDepartureSas.mock.calls[0][1].displayedDepartureTotal).toBe(80);
  expect(await screen.findByText('Enregistré à 85,00 € — le récap affichait 80,00 €.')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  clickBtn('Fermer');
  expect(onClose).toHaveBeenCalled();
});

// rule 24
test('an adjusted end-of-stay total says so under the total, and the Ajustement line is not offered as a line', async () => {
  api.previewDepartureSas.mockImplementation((id, draft) => answer(draft).then((recap) => ({
    ...recap, endOfStayTotal: 50, grandTotal: 50, adjusted: { endOfStay: { amount: 50, engineAmount: 80 }, arrival: null },
  })));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  expect(await screen.findByText(/Total à percevoir : 50,00 €/)).toBeInTheDocument();
  expect(screen.getByText('Montant ajusté sur la fiche (calcul : 80,00 €)')).toBeInTheDocument();
  expect(screen.queryByText(/Ajustement/)).toBeNull();
});

// rule 9 — the keys of the stored lines are the server's, recomputed at every preview
test('a stored line’s key follows the last answer: « Offrir » still reaches it after the server re-keyed it', async () => {
  const payload = sasPayload({
    reservation: {
      cautionAmount: 0,
      endOfStayComplementDetail: JSON.stringify([{ label: 'Linge de toilette', qty: 3, unitPrice: 8, amount: 24, source: 'arrivalBathLinen' }]),
    },
    cleaning: { included: true, price: null },
  });
  api.getReservationSas.mockResolvedValue(payload);
  // A mid-stay sync rewrote the detail between the load and the recap: the server now names the line otherwise.
  api.previewDepartureSas.mockImplementation((id, draft) => wait(0).then(() => {
    const back = { ...draft, storedLines: (draft.storedLines || []).map((x) => ({ ...x, key: 'stored:0:test' })) };
    const recap = departureRecapFor(payload, back);
    return { ...recap, lines: recap.lines.map((l) => (l.key === 'stored:0:test' ? { ...l, key: 'stored:0:fresh' } : l)) };
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText(/Linge de toilette : 3 × 8,00 € = 24,00 €/);
  await waitFor(() => {
    const last = api.previewDepartureSas.mock.calls.at(-1)[1];
    expect(last.storedLines).toEqual([{ key: 'stored:0:fresh', offered: false }]);
  });
  clickBtn('Offrir');
  await waitFor(() => expect(screen.queryByText(/Total à percevoir/)).toBeNull());
  const last = api.previewDepartureSas.mock.calls.at(-1)[1];
  expect(last.storedLines).toEqual([{ key: 'stored:0:fresh', offered: true }]);
});

// rule 12 — a row stored before the SAS marker existed is pre-filled, not dropped
test('lines the server seeds on a never-committed departure come back in the draft', async () => {
  api.getReservationSas.mockResolvedValue({
    ...PAYLOAD,
    departureSeed: {
      missingItems: { 4: 2 }, cleaningCharged: false, extinguisherQty: {}, storedKeys: [], offeredKeys: [],
    },
  });
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Oui');
  await screen.findByText('Éléments manquants');
  clickBtn('Suivant');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  expect(api.previewDepartureSas.mock.calls[0][1].missingItems).toEqual([{ itemId: 4, qty: 2, offered: false }]);
});
